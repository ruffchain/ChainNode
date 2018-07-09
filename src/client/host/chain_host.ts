
import * as path from 'path';
import * as fs from 'fs-extra';

import {Options as CommandOptions} from '../lib/simple_command';

import {Chain, ChainOptions} from '../../core/value_chain/chain';
import {Miner, MinerOptions} from '../../core/value_chain/miner';
import {INode} from '../../core/net/node';
import {Node as StandaloneNode} from '../../core/net_standalone/node';
import handler = require('../handler');

import {ChainServer} from './rpc';
import GlobalConfig = require('../../core/chain/globalConfig');

type ConsensusInstance = {
    chain: (options: ChainOptions, commandOptions: CommandOptions)=>Chain|undefined;
    miner: (options: MinerOptions, commandOptions: CommandOptions)=>Miner|undefined;
    create: (command: CommandOptions)=>any|undefined;
};

type NetInstance = (commandOptions: CommandOptions)=>INode|undefined;

class ChainHost {
    constructor() {
        
    }

    public async initMiner(commandOptions: CommandOptions): Promise<boolean> {
        this.m_asMiner = true;
        let defaultOptions = null;
        if (! (await this._createChain(commandOptions, defaultOptions))) {
            return false;
        }
        let err = await this.m_miner!.initialize();
        if (err) {
            return false;
        }
        this.m_server = new ChainServer(this.m_chain!, this.m_miner);
        this.m_server.init(commandOptions);
        return true;
    }

    public async initPeer(commandOptions: CommandOptions): Promise<boolean> {
        this.m_asMiner = false;
        let defaultOptions = null;
        if (! (await this._createChain(commandOptions, defaultOptions))) {
            return false;
        }
        let err = await this.m_chain!.initialize();
        if (err) {
            return false;
        }
        this.m_server = new ChainServer(this.m_chain!, this.m_miner);
        this.m_server.init(commandOptions);
        return true;
    }

    public async createGenesis(commandOptions: CommandOptions): Promise<boolean> {
        this.m_asMiner = true;
        let defaultOptions = Object.create(null);
        defaultOptions.node = new StandaloneNode('');
        fs.emptyDirSync(commandOptions.get('dataDir'));
        
        if (!await this._createChain(commandOptions, defaultOptions)) {
            return false;
        }
        let ci = this.m_consensus.get(commandOptions.get('consensus'));
        let param: any = ci!.create(commandOptions);
        param.txlivetime = commandOptions.has('txlivetime') ? commandOptions.get('txlivetime') : 60*60 ;
        
        let err = await this.m_miner!.create(param);
        console.log(`create genesis finished with error code: ${err}`);
        return !err;
    }

    protected async _createChain(commandOptions: CommandOptions, defaultOptions: any): Promise<boolean> {
        let chainOptions: ChainOptions = Object.create(defaultOptions);
        if (!commandOptions.get('handler')) {
            console.error('no handler!');
            return false;
        } 
        if (!this._loadHandler(commandOptions.get('handler'))) {
            return false;
        }
        chainOptions.handler = handler;
        let node: INode|undefined;
        if (commandOptions.get('net')) {
            let ni = this.m_net.get(commandOptions.get('net'));
            if (!ni) {
                console.error('invalid net');
                return false;
            }
            node = ni(commandOptions);
        }
        if (!node && !chainOptions.node) {
            console.error('no net');
            return false;
        } else if (node) {
            chainOptions.node = node;
        }

        let dataDir: string = commandOptions.get('dataDir');
        if (!dataDir) {
            console.error('no dataDir');
            return false;
        }
        chainOptions.dataDir = dataDir;

        if (commandOptions.has('forceClean') || !fs.pathExistsSync(dataDir)) {
            let genesis = commandOptions.get('genesis');
            if (genesis) {
                await fs.emptyDir(dataDir);
                await fs.copy(genesis, dataDir);
            }
        }

        await GlobalConfig.LoadConfig(dataDir, Chain.kvConfig, Chain.s_dbFile);

        chainOptions.loggerOptions = {
            console: true, 
            level: 'debug', 
            file: {root: path.join(dataDir, 'log')}
        };
    
        let consensus = null;
        if (GlobalConfig.isLoad()) {
            consensus = GlobalConfig.getConfig('consensus');
        } else {
            consensus = commandOptions.get('consensus');
        }
        
        if (!consensus) {
            console.error('no consensus');
            return false;
        }
        let ci = this.m_consensus.get(consensus);
        if (!ci) {
            console.error('invalid consensus');
            return false;
        }
        
        if (!this.m_asMiner) {
            this.m_chain = ci.chain(chainOptions, commandOptions);
            if (!this.m_chain) {
                return false;
            }
            
        } else {
            let minerOptions: MinerOptions = Object.create(chainOptions);
            //dpos的miner可以没有coinbase，用secret代替
            minerOptions.coinbase = commandOptions.get('coinbase');
            // if (!minerOptions.coinbase) {
            //     console.error('invalid coinbase');
            //     return false;
            // }
            this.m_miner = ci.miner(minerOptions, commandOptions);
            if (!this.m_miner) {
                return false;
            }
            this.m_chain = this.m_miner!.chain; 
        }
        return true;
    }


    public registerConsensus(consensus: string, instance: ConsensusInstance) {
        this.m_consensus.set(consensus, instance);
    }

    private m_consensus: Map<string, ConsensusInstance> = new Map();

    public registerNet(net: string, instance: NetInstance) {
        this.m_net.set(net, instance);
    }

    private m_net: Map<string, NetInstance> = new Map();

    protected _loadHandler(_path: string): boolean {
        try {
            require(path.join(process.cwd(), _path));
        } catch (e) {
            console.error(`handler error: ${e.message}`);
            return false;
        }
        return true;
    }

    protected m_chain?: Chain;
    protected m_miner?: Miner;
    protected m_asMiner?: boolean;

    protected m_server?: ChainServer;
}

export = new ChainHost();

