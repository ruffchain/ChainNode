
import * as path from 'path';
import * as fs from 'fs-extra';

import {Options as CommandOptions} from '../lib/simple_command';

import {ValueChain, ChainOptions, INode, GlobalConfig, ChainCreator, ValueMinerOptions, ValueMiner, ErrorCode} from '../../core';
import handler = require('../handler');

import {ChainServer} from './rpc';
import { initLogger } from '../../core/lib/logger_util';

type ConsensusInstance = {
    chain: (commandOptions: CommandOptions) => Promise<ValueChain|undefined>;
    miner: (options: ValueMinerOptions, commandOptions: CommandOptions) => ValueMiner|undefined;
    create: (command: CommandOptions) => any|undefined;
};

type NetInstance = (commandOptions: CommandOptions) => INode|undefined;

class ChainHost {
    constructor() {
        
    }

    public async initMiner(commandOptions: CommandOptions): Promise<boolean> {
        let cc = await this.create(commandOptions, false);
        if (cc.err) {
            console.error(`create miner failed! err ${cc.err}`);
            return false;
        }

        let ci = this.m_consensus.get(cc.consensus!);
        if (!ci) {
            console.error(`invalid consensus: ${cc.consensus}`);
            return false;
        }
        let minerOptions: ValueMinerOptions = {};
        minerOptions.coinbase = commandOptions.get('coinbase');
        this.m_miner = ci.miner(minerOptions, commandOptions);

        let ct: ChainCreator = new ChainCreator();
        let err = await this.m_miner!.initialize(ct, commandOptions);
        if (err) {
            console.log(`miner initialize failed, err ${err}`);
            return false;
        }
        this.m_chain = this.m_miner!.chain;
        this.m_server = new ChainServer(this.m_chain!, this.m_miner);
        this.m_server.init(commandOptions);
        return true;
    }

    public async initPeer(commandOptions: CommandOptions): Promise<boolean> {
        let cc = await this.create(commandOptions, false);
        if (cc.err) {
            console.error(`create peer failed! err ${cc.err}`);
            return false;
        }

        let ci = this.m_consensus.get(cc.consensus!);
        if (!ci) {
            console.error(`invalid consensus: ${cc.consensus}`);
            return false;
        }
        
        this.m_chain = await ci.chain(commandOptions);
        
        this.m_server = new ChainServer(this.m_chain!, this.m_miner);
        this.m_server.init(commandOptions);
        return true;
    }

    public async createGenesis(commandOptions: CommandOptions): Promise<boolean> {
        fs.emptyDirSync(commandOptions.get('dataDir'));

        let cc = await this.create(commandOptions, true);
        if (cc.err) {
            console.error(`create chain for genesis failed! err ${cc.err}`);
            return false;
        }

        let ci = this.m_consensus.get(cc.consensus!);
        if (!ci) {
            console.error(`invalid consensus: ${cc.consensus}`);
            return false;
        }
        let options: any = ci!.create(commandOptions);
        options.txlivetime = commandOptions.has('txlivetime') ? commandOptions.get('txlivetime') : 60 * 60 ;
        
        let minerOptions: ValueMinerOptions = {};
        minerOptions.coinbase = commandOptions.get('coinbase');
        this.m_miner = ci.miner(minerOptions, commandOptions);

        let ct: ChainCreator = new ChainCreator();
        let err = await this.m_miner!.create(ct, commandOptions, options);
        
        console.log(`create genesis finished with error code: ${err}`);
        return !err;
    }

    protected async create(commandOptions: CommandOptions, bGenesis: boolean): Promise<{ err: ErrorCode, consensus?: string }> {
        if (!bGenesis) {
            if (commandOptions.get('net')) {
                let ni = this.m_net.get(commandOptions.get('net'));
                if (!ni) {
                    console.error('invalid net');
                    return { err: ErrorCode.RESULT_INVALID_PARAM };
                }
                commandOptions.set('node', ni(commandOptions));
            }
            if (!commandOptions.get('node')) {
                console.error('no net');
                return { err: ErrorCode.RESULT_INVALID_PARAM };
            }
        }

        if (!this._loadHandler(commandOptions.get('handler'))) {
            console.error(`load handler error`);
            return { err: ErrorCode.RESULT_INVALID_PARAM };
        }

        commandOptions.set('handler', handler);
        let consensus = null;
        if (bGenesis) {
            consensus = commandOptions.get('consensus');
        } else {
            let config: GlobalConfig = new GlobalConfig(initLogger({loggerOptions: {console: true}}));
            let configPath;
            if (commandOptions.has('forceClean') || !fs.pathExistsSync(commandOptions.get('dataDir'))) {
                if (!commandOptions.get('genesis')) {
                    console.error('no genesis param with forceClean or invalid dataDir');
                    return {err: ErrorCode.RESULT_INVALID_PARAM};
                }
                configPath = commandOptions.get('genesis');
            } else {
                configPath = commandOptions.get('dataDir');
            }

            let err = await config.loadConfig(configPath, ValueChain.kvConfig, ValueChain.s_dbFile);
            if (err) {
                console.error(`loadConfig from ${configPath} error, err ${err}`);
                return {err: ErrorCode.RESULT_INVALID_PARAM};
            }

            consensus = config.getConfig('consensus');
        }

        if (!consensus) {
            console.error('no consensus');
            return {err: ErrorCode.RESULT_INVALID_PARAM};
        }
        return {err: ErrorCode.RESULT_OK, consensus};
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

    protected m_chain?: ValueChain;
    protected m_miner?: ValueMiner;
    protected m_server?: ChainServer;
}

export = new ChainHost();