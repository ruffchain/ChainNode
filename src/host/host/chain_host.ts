
import * as path from 'path';
import * as fs from 'fs-extra';

import { Options as CommandOptions } from '../../common/simple_command';

import { INode, initChainCreator, initLogger, Chain, Miner, IBlockExecutorRoutineManager, InprocessRoutineManager, InterprocessRoutineManager, ErrorCode } from '../../core';
import { HostChainContext } from '../context/context';
import { ChainServer } from './rpc';
import { ChainEvent } from '../event/element';
import { TxStorage } from '../tx/element';
import { startMinerMonitor, startPeerMonitor } from '../../../ruff/dposbft/chain/modules/monitor';

export class ChainHost {
    constructor() {

    }

    protected async _initContextServer(options: { chain: Chain, commandOptions: CommandOptions }): Promise<{ err: ErrorCode, chainContext?: HostChainContext }> {
        let eNames: string[] = [];
        if (options.commandOptions.has('eventsServer')) {
            eNames.push(ChainEvent.ElementName);
        }
        if (options.commandOptions.has('txServer')) {
            eNames.push(TxStorage.ElementName);
        }
        if (!eNames.length) {
            console.info('chain_host _initContextServer not need support');
            return { err: ErrorCode.RESULT_OK };
        }

        let chainContext = new HostChainContext({ chain: options.chain });
        const err = await chainContext.init(eNames);
        if (err) {
            return { err };
        }
        return { err: ErrorCode.RESULT_OK, chainContext };
    }

    public async initMiner(commandOptions: CommandOptions): Promise<{ ret: boolean, miner?: Miner }> {
        let dataDir = this._parseDataDir(commandOptions);
        if (!dataDir) {
            console.error('chain_host initMiner fail _parseDataDir');
            return { ret: false };
        }
        let logger = this._parseLogger(dataDir, commandOptions);

        let creator = initChainCreator({ logger });
        let cr = await creator.createMinerInstance(dataDir);
        if (cr.err) {
            console.error('chain_host initMiner fail createMinerInstance');
            return { ret: false };
        }

        // start performance monitor
        startMinerMonitor(logger, cr.miner!.chain, commandOptions, cr.globalOptions);


        let routineManagerType = this._parseExecutorRoutine(cr.miner!.chain, commandOptions);
        if (!routineManagerType) {
            console.error('chain_host initMiner fail _parseExecutorRoutine');
            return { ret: false };
        }
        let pr = cr.miner!.parseInstanceOptions({ parsed: { routineManagerType }, origin: commandOptions });
        if (pr.err) {
            console.error('chain_host initMiner fail parseInstanceOptions');
            return { ret: false };
        }
        let err = await cr.miner!.initialize(pr.value!);
        if (err) {
            console.error('chain_host initMiner fail initialize');
            return { ret: false };
        }
        const iesr = await this._initContextServer({ chain: cr.miner!.chain, commandOptions });
        if (iesr.err) {
            console.error('init context server fail parseInstanceOptions');
            return { ret: false };
        }
        this.m_server = new ChainServer(logger, cr.miner!.chain!, iesr.chainContext, cr.miner!);
        this.m_server.init(commandOptions);
        return { ret: true, miner: cr.miner };
    }

    public async initPeer(commandOptions: CommandOptions): Promise<{ ret: boolean, chain?: Chain }> {
        let dataDir = this._parseDataDir(commandOptions);
        if (!dataDir) {
            return { ret: false };
        }
        let logger = this._parseLogger(dataDir, commandOptions);

        let creator = initChainCreator({ logger });
        let cr = await creator.createChainInstance(dataDir, { initComponents: true });
        if (cr.err) {
            return { ret: false };
        }

        // start performance monitor, by Yang Jun 2019-8-9
        startPeerMonitor(logger, cr.chain!, commandOptions, cr.globalOptions);

        let routineManagerType = this._parseExecutorRoutine(cr.chain!, commandOptions);
        if (!routineManagerType) {
            console.error('chain_host initPeer fail _parseExecutorRoutine');
            return { ret: false };
        }
        let pr = cr.chain!.parseInstanceOptions({ parsed: { routineManagerType }, origin: commandOptions });
        if (pr.err) {
            return { ret: false };
        }
        let err = await cr.chain!.initialize(pr.value!);
        if (err) {
            return { ret: false };
        }
        const iesr = await this._initContextServer({ chain: cr.chain!, commandOptions });
        if (iesr.err) {
            console.error('init context server fail parseInstanceOptions');
            return { ret: false };
        }
        this.m_server = new ChainServer(logger, cr.chain!, iesr.chainContext);
        this.m_server.init(commandOptions);
        return { ret: true, chain: cr.chain };
    }

    private static CREATE_TIP = `command: create --package [packageDir] --dataDir [dataDir] --[genesisConfig] [genesisConfig] --[externalHandler]`;

    public async createGenesis(commandOptions: CommandOptions): Promise<boolean> {
        if (!commandOptions.get('package')) {
            console.error(ChainHost.CREATE_TIP);
            return false;
        }
        let _package = commandOptions.get('package');
        if (!path.isAbsolute(_package)) {
            _package = path.join(process.cwd(), _package);
        }
        if (!commandOptions.get('dataDir')) {
            console.error(ChainHost.CREATE_TIP);
            return false;
        }
        let dataDir = commandOptions.get('dataDir');
        if (!path.isAbsolute(dataDir)) {
            dataDir = path.join(process.cwd(), dataDir);
        }
        if (!fs.existsSync(dataDir)) {
            fs.ensureDirSync(dataDir);
        } else {
            fs.removeSync(dataDir);
        }
        let logger = this._parseLogger(dataDir, commandOptions);
        let creator = initChainCreator({ logger });
        let genesisOptions;
        if (commandOptions.get('genesisConfig')) {
            let _path = commandOptions.get('genesisConfig');
            if (!path.isAbsolute(_path)) {
                _path = path.join(process.cwd(), _path);
            }
            genesisOptions = fs.readJsonSync(_path);
        }
        let cr = await creator.createGenesis(_package, dataDir, genesisOptions, commandOptions.get('externalHandler'));
        if (cr.err) {
            return false;
        }
        return true;
    }

    protected _parseLogger(dataDir: string, commandOptions: CommandOptions): any {
        let loggerOptions = Object.create(null);
        loggerOptions.console = false;
        loggerOptions.level = 'error';
        loggerOptions.dumpStack = false;

        if (commandOptions.get('loggerConsole')) {
            loggerOptions.console = true;
        }
        if (commandOptions.get('loggerLevel')) {
            loggerOptions.level = commandOptions.get('loggerLevel');
        }
        if (commandOptions.get('loggerDumpStack')) {
            loggerOptions.dumpStack = commandOptions.get('loggerDumpStack');
        }
        let loggerPath = path.join(dataDir, 'log');
        fs.ensureDir(loggerPath);
        loggerOptions.file = { root: loggerPath };
        return initLogger({ loggerOptions });
    }

    protected _parseExecutorRoutine(chain: Chain, commandOptions: CommandOptions): new (chain: Chain) => IBlockExecutorRoutineManager | undefined {
        if (commandOptions.has('executor')) {
            if (commandOptions.get('executor') === 'inprocess') {
                return InprocessRoutineManager;
            } else if (commandOptions.get('executor') === 'interprocess') {
                return InterprocessRoutineManager;
            }
        }
        return InprocessRoutineManager;
    }

    protected _parseDataDir(commandOptions: CommandOptions): string | undefined {
        let dataDir = commandOptions.get('dataDir');
        if (!dataDir) {
            return undefined;
        }
        if (!path.isAbsolute(dataDir)) {
            dataDir = path.join(process.cwd(), dataDir);
        }
        if (commandOptions.has('forceClean')) {
            fs.removeSync(dataDir);
        }

        if (Chain.dataDirValid(dataDir)) {
            return dataDir;
        } else {
            fs.ensureDirSync(dataDir);
        }

        if (!commandOptions.get('genesis')) {
            console.error('no genesis');
            return undefined;
        }
        let _path = commandOptions.get('genesis');
        if (!path.isAbsolute(_path)) {
            _path = path.join(process.cwd(), _path);
        }
        fs.copySync(_path, dataDir);

        return dataDir;
    }
    protected m_server?: ChainServer;

    public getLogger() {
        return this.m_server!.getLogger();
    }
}
