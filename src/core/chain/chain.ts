import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as sqlite from 'better-sqlite3';
import * as fs from 'fs-extra';
import { isNumber, isBoolean, isString, isNullOrUndefined, isArray, isObject } from 'util';

import { ErrorCode, stringifyErrorCode } from '../error_code';
import { LoggerInstance, initLogger, LoggerOptions } from '../lib/logger_util';
import { TmpManager } from '../lib/tmp_manager';
import { MapFromObject } from '../serializable';

import { INode, NodeConnection } from '../net/node';
import { IHeaderStorage, HeaderStorage, VERIFY_STATE, BlockStorage, Transaction, Receipt, BlockHeader, Block, Network, BAN_LEVEL, NetworkInstanceOptions, NetworkCreator } from '../block';
import { StorageManager, Storage, StorageDumpSnapshot, IReadableStorage, IReadableDatabase, IReadWritableDatabase, StorageLogger } from '../storage';
import { SqliteStorage } from '../storage_sqlite/storage';
import { BlockExecutor, ViewExecutor, BaseHandler, BlockExecutorExternParam, BlockExecutorExternParamCreator } from '../executor';

import { PendingTransactions } from './pending';
import { ChainNode, HeadersEventParams, BlocksEventParams } from './chain_node';
import { IBlockExecutorRoutineManager, BlockExecutorRoutine } from './executor_routine';
import { IConsistency } from '../block/consistency';
import { getMonitor } from '../../../ruff/dposbft/chain/modules/monitor';

export type ExecutorContext = {
    now: number;
    height: number;
    logger: LoggerInstance;
};

export type TransactionContext = {
    caller: string;
    storage: IReadWritableDatabase;
    emit: (name: string, param?: any) => void;
} & ExecutorContext;

export type EventContext = {
    storage: IReadWritableDatabase;
} & ExecutorContext;

export type ViewContext = {
    storage: IReadableDatabase;
} & ExecutorContext;

enum ChainState {
    none = 0,
    init = 1,
    syncing = 2,
    synced = 3,
}

export type ChainTypeOptions = {
    consensus: string;
    features: string[];
};

export type ChainGlobalOptions = {
};

export type ChainInstanceOptions = {
    networks: Network[];
    routineManagerType: new (chain: Chain) => IBlockExecutorRoutineManager;
    initializePeerCount?: number;
    minOutbound?: number;
    connectionCheckCycle?: number;
    headerReqLimit?: number;
    confirmDepth?: number;
    // 不用excutor校验block, 而是通过redo log; 默认为0,即使用excutor
    ignoreVerify?: boolean;
    ignoreBan?: boolean;
    saveMismatch?: boolean;

    pendingOvertime?: number;
    maxPendingCount?: number;
    warnPendingCount?: number;
};

type SyncConnection = {
    conn: NodeConnection,
    state: ChainState,
    lastRequestHeader?: string,
    lastRecvHeader?: BlockHeader,
    reqLimit: number,
    moreHeaders?: boolean
};

export type ChainContructOptions = LoggerOptions & {
    dataDir: string,
    handler: BaseHandler,
    globalOptions: any,
    networkCreator: NetworkCreator,
};

export class Chain extends EventEmitter implements IConsistency {
    public static dataDirValid(dataDir: string): boolean {
        if (!fs.pathExistsSync(dataDir)) {
            return false;
        }
        if (!fs.pathExistsSync(path.join(dataDir, Chain.s_dbFile))) {
            return false;
        }
        return true;
    }

    /**
     * @param options.dataDir
     * @param options.blockHeaderType
     * @param options.node
     */
    constructor(options: ChainContructOptions) {
        super();
        this.m_logger = initLogger(options);
        this.m_dataDir = options.dataDir;
        this.m_handler = options.handler;
        this.m_globalOptions = Object.create(null);
        Object.assign(this.m_globalOptions, options.globalOptions);
        this.m_tmpManager = new TmpManager({ root: this.m_dataDir, logger: this.logger });
        this.m_networkCreator = options.networkCreator;
        this.m_executorParamCreator = new BlockExecutorExternParamCreator({ logger: this.m_logger });
    }

    // 存储address入链的tx的最大nonce
    public static dbSystem: string = '__system';
    public static kvNonce: string = 'nonce'; // address<--->nonce
    public static kvConfig: string = 'config';

    // Added by Yang Jun 2019-2-25
    public static kvBalance: string = 'balance';

    public static dbUser: string = '__user';

    // Added by Yang Jun 2019-2-20
    public static dbToken: string = '__token';
    public static dbBancor: string = '__bancor';
    public static kvFactor: string = 'factor';
    public static kvReserve: string = 'reserve';
    public static kvSupply: string = 'supply';
    public static kvNonliquidity: string = 'nonliquidity';

    // Added by Yang Jun 2019-5-17
    // to summarize the vote result
    public static dbVote: string = '__vote';
    public static kvVoteCandidate: string = 'vote';
    public static kvVoteLasttime: string = 'last';

    // to summarize the SVT token result
    public static dbSVT: string = '__svt';
    public static kvSVTDeposit: string = 'deposit';
    public static kvSVTVote: string = 'vote';
    public static kvSVTFree: string = 'free';
    public static kvSVTInfo: string = 'info';


    ///////////////////////////////////////////////

    public static s_dbFile: string = 'database';

    on(event: 'tipBlock', listener: (chain: Chain, block: BlockHeader) => void): this;
    on(event: string, listener: any): this {
        return super.on(event, listener);
    }

    prependListener(event: 'tipBlock', listener: (chain: Chain, block: BlockHeader) => void): this;
    prependListener(event: string, listener: any): this {
        return super.prependListener(event, listener);
    }

    once(event: 'tipBlock', listener: (chain: Chain, block: Block) => void): this;
    once(event: string, listener: any): this {
        return super.once(event, listener);
    }

    prependOnceListener(event: 'tipBlock', listener: (chain: Chain, block: BlockHeader) => void): this;
    prependOnceListener(event: string, listener: any): this {
        return super.prependOnceListener(event, listener);
    }

    protected m_readonly?: boolean;
    protected m_dataDir: string;
    protected m_tmpManager: TmpManager;
    protected m_handler: BaseHandler;
    protected m_instanceOptions?: ChainInstanceOptions;
    protected m_globalOptions: ChainGlobalOptions;
    private m_state: ChainState = ChainState.none;
    protected m_tip?: BlockHeader;
    private m_constSnapshots: string[] = [];
    protected m_db?: sqlite.Database;
    protected m_headerStorage?: IHeaderStorage;
    private m_blockStorage?: BlockStorage;
    protected m_storageManager?: StorageManager;
    private m_pending?: PendingTransactions;
    protected m_logger: LoggerInstance;
    private m_pendingHeaders: Array<HeadersEventParams> = new Array();
    private m_pendingBlocks: {
        hashes: Set<string>
        sequence: Array<BlocksEventParams>
        adding?: BlocksEventParams
    } = {
            hashes: new Set(),
            sequence: new Array()
        };
    private m_node?: ChainNode;
    private m_executorParamCreator: BlockExecutorExternParamCreator;
    private m_routineManager?: IBlockExecutorRoutineManager;
    private m_networkCreator: NetworkCreator;

    private m_refSnapshots: Set<string> = new Set();
    private m_storageMorkRequests: {
        morking?: Set<string>,
        pending?: Set<string>
    } = {};

    // broadcast数目，广播header时会同时广播tip到这个深度的header
    protected get _broadcastDepth(): number {
        return 1;
    }

    protected get _headerReqLimit(): number {
        return this.m_instanceOptions!.headerReqLimit!;
    }

    protected get _initializePeerCount(): number {
        return this.m_instanceOptions!.initializePeerCount!;
    }

    protected get _ignoreVerify(): boolean {
        return this.m_instanceOptions!.ignoreVerify!;
    }

    protected get _saveMismatch(): boolean {
        return this.m_logger.level === 'debug';
    }

    protected m_connSyncMap: Map<string, SyncConnection> = new Map();

    get globalOptions(): any {
        const c = this.m_globalOptions;
        return c;
    }

    get logger(): LoggerInstance {
        return this.m_logger;
    }

    get pending(): PendingTransactions {
        return this.m_pending!;
    }

    get storageManager(): StorageManager {
        return this.m_storageManager!;
    }

    get blockStorage(): BlockStorage {
        return this.m_blockStorage!;
    }

    get dataDir(): string {
        return this.m_dataDir!;
    }

    get node(): ChainNode {
        return this.m_node!;
    }

    get handler(): BaseHandler {
        return this.m_handler!;
    }

    get headerStorage(): IHeaderStorage {
        return this.m_headerStorage!;
    }

    get routineManager(): IBlockExecutorRoutineManager {
        return this.m_routineManager!;
    }

    get tmpManager(): TmpManager {
        return this.m_tmpManager;
    }

    get executorParamCreator(): BlockExecutorExternParamCreator {
        return this.m_executorParamCreator;
    }

    protected async _loadGenesis(): Promise<ErrorCode> {
        let genesis = await this.m_headerStorage!.getHeader(0);
        if (genesis.err) {
            return genesis.err;
        }
        // 生成一个 snapshot view
        let gsv = await this.m_storageManager!.getSnapshotView(genesis.header!.hash);
        if (gsv.err) {
            this.m_logger.error(`chain initialize failed for load genesis snapshot failed ${gsv.err}`);
            return gsv.err;
        }
        this.m_constSnapshots.push(genesis.header!.hash);

        let dbr = await gsv.storage!.getReadableDataBase(Chain.dbSystem);
        if (dbr.err) {
            this.m_logger.error(`chain initialize failed for load system database failed ${dbr.err}`);
            return dbr.err;
        }
        let kvr = await dbr.value!.getReadableKeyValue(Chain.kvConfig);
        if (kvr.err) {
            this.m_logger.error(`chain initialize failed for load global config failed ${kvr.err}`);
            return kvr.err;
        }
        let typeOptions: ChainTypeOptions = Object.create(null);
        let kvgr = await kvr.kv!.get('consensus');
        if (kvgr.err) {
            this.m_logger.error(`chain initialize failed for load global config consensus failed ${kvgr.err}`);
            return kvgr.err;
        }
        typeOptions.consensus = kvgr.value! as string;
        kvgr = await kvr.kv!.lrange('features', 1, -1);
        if (kvgr.err === ErrorCode.RESULT_OK) {
            typeOptions.features = kvgr.value! as string[];
        } else if (kvgr.err === ErrorCode.RESULT_NOT_FOUND) {
            typeOptions.features = [];
        } else {
            this.m_logger.error(`chain initialize failed for load global config features failed ${kvgr.err}`);
            return kvgr.err;
        }
        if (!this._onCheckTypeOptions(typeOptions)) {
            this.m_logger.error(`chain initialize failed for check type options failed`);
            return ErrorCode.RESULT_INVALID_BLOCK;
        }

        kvgr = await kvr.kv!.hgetall('global');
        if (kvgr.err) {
            this.m_logger.error(`chain initialize failed for load global config global failed ${kvgr.err}`);
            return kvgr.err;
        }

        // 将hgetall返回的数组转换成对象
        if (Array.isArray(kvgr.value)) {
            kvgr.value = kvgr.value.reduce((obj, item) => {
                const { key, value } = item;
                obj[key] = value;
                return obj;
            }, {});
        }

        // TODO: compare with globalOptions
        return ErrorCode.RESULT_OK;
    }

    public newNetwork(options: { node: INode, netType?: string } & any): { err: ErrorCode, network?: Network } {
        let parsed = Object.create(this._defaultNetworkOptions());
        parsed.dataDir = this.m_dataDir;
        parsed.headerStorage = this.headerStorage;
        parsed.blockHeaderType = this._getBlockHeaderType();
        parsed.transactionType = this._getTransactionType();
        parsed.receiptType = this._getReceiptType();
        parsed.node = options.node;
        parsed.logger = this.m_logger;

        if (options.netType) {
            parsed.nettype = options.netType;
        }
        const cr = this.m_networkCreator.create({ parsed, origin: new Map() });
        if (cr.err) {
            return { err: cr.err };
        }
        cr.network!.setInstanceOptions(options);
        return cr;
    }

    public async initComponents(options?: { readonly?: boolean }): Promise<ErrorCode> {
        // 上层保证await调用别重入了, 不加入中间状态了
        if (this.m_state >= ChainState.init) {
            return ErrorCode.RESULT_OK;
        }
        if (!await this._onCheckGlobalOptions(this.m_globalOptions)) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        const readonly = options && options.readonly;
        this.m_readonly = readonly;

        let err;
        err = this.m_tmpManager.init({ clean: !this.m_readonly });
        if (err) {
            this.m_logger.error(`chain init faield for tmp manager init failed `, err);
            return err;
        }

        this.m_blockStorage = new BlockStorage({
            logger: this.m_logger!,
            path: this.m_dataDir,
            blockHeaderType: this._getBlockHeaderType(),
            transactionType: this._getTransactionType(),
            receiptType: this._getReceiptType(),
            readonly
        });
        await this.m_blockStorage.init();

        try {
            let dbPath = path.join(this.m_dataDir, Chain.s_dbFile);
            if (readonly) {
                this.m_db = new sqlite(dbPath, { readonly: true });
            } else {
                this.m_db = new sqlite(dbPath);
            }
            this.m_db!.pragma('journal_mode = WAL');
        } catch (e) {
            this.m_logger.error(`open database failed`, e);
            return ErrorCode.RESULT_EXCEPTION;
        }

        this.m_headerStorage = new HeaderStorage({
            logger: this.m_logger!,
            blockHeaderType: this._getBlockHeaderType(),
            db: this.m_db!,
            blockStorage: this.m_blockStorage!,
            readonly
        });

        err = await this.m_headerStorage.init();
        if (err) {
            this.m_logger.error(`chain init faield for header storage init failed `, err);
            return err;
        }

        this.m_storageManager = new StorageManager({
            path: path.join(this.m_dataDir, 'storage'),
            tmpManager: this.m_tmpManager,
            storageType: SqliteStorage,
            logger: this.m_logger!,
            headerStorage: this.m_headerStorage!,
            readonly
        });

        err = await this.m_storageManager.init();
        if (err) {
            return err;
        }
        this.m_state = ChainState.init;
        return ErrorCode.RESULT_OK;
    }

    public async uninitComponents(): Promise<void> {
        // 上层保证await调用别重入了, 不加入中间状态了
        if (this.m_state !== ChainState.init) {
            return;
        }
        this.m_storageManager!.uninit();
        delete this.m_storageManager;

        this.m_headerStorage!.uninit();
        delete this.m_headerStorage;

        await this.m_db!.close();
        delete this.m_db;

        this.m_blockStorage!.uninit();
        delete this.m_blockStorage;

        delete this.m_handler;
        delete this.m_dataDir;

        this.m_state = ChainState.none;
    }

    protected _onCheckTypeOptions(typeOptions: ChainTypeOptions): boolean {
        return true;
    }

    protected _onCheckGlobalOptions(globalOptions: ChainGlobalOptions): boolean {
        return true;
    }

    public parseInstanceOptions(options: {
        parsed: any,
        origin: Map<string, any>
    }): { err: ErrorCode, value?: ChainInstanceOptions } {
        let value = Object.create(null);
        value.routineManagerType = options.parsed.routineManagerType;
        value.saveMismatch = options.origin.get('saveMismatch');
        const ops = [];
        if (options.origin.get('net')) {
            ops.push({
                parsed: this._defaultNetworkOptions(),
                origin: options.origin
            });
        } else if (options.origin.get('netConfig')) {
            let _path = options.origin.get('netConfig');
            if (!path.isAbsolute(_path)) {
                _path = path.join(process.cwd(), _path);
            }
            let netConfig;
            try {
                netConfig = fs.readJsonSync(_path);
            } catch (e) {
                this.m_logger.error(`read net config ${_path} failed `, e);
                return { err: ErrorCode.RESULT_INVALID_PARAM };
            }
            if (!isArray(netConfig) || !netConfig[0] || !isObject(netConfig[0])) {
                this.m_logger.error(`read net config ${_path} must contain array of config `);
                return { err: ErrorCode.RESULT_INVALID_PARAM };
            }
            ops.push({
                parsed: this._defaultNetworkOptions(),
                origin: MapFromObject(netConfig[0])
            });
            for (let c of netConfig.slice(1)) {
                ops.push({
                    parsed: {},
                    origin: MapFromObject(c)
                });
            }
        } else {
            this.m_logger.error(`config should has net or netConfig`);
            return { err: ErrorCode.RESULT_INVALID_PARAM };
        }
        value.networks = [];
        for (let o of ops) {
            const pnr = this._parseNetwork(o);
            if (pnr.err) {
                return { err: pnr.err };
            }
            value.networks.push(pnr.network!);
        }

        value.pendingOvertime = options.origin.get('pendingOvertime');
        value.maxPendingCount = options.origin.get('maxPendingCount');
        value.warnPendingCount = options.origin.get('warnPendingCount');

        return { err: ErrorCode.RESULT_OK, value };
    }

    public async initialize(instanceOptions: ChainInstanceOptions): Promise<ErrorCode> {
        // 上层保证await调用别重入了, 不加入中间状态了
        if (this.m_state !== ChainState.init) {
            this.m_logger.error(`chain initialize failed for hasn't initComponent`);
            return ErrorCode.RESULT_INVALID_STATE;
        }

        let err = await this._loadGenesis();
        if (err) {
            this.m_logger.error(`chain initialize failed for load genesis ${err}`);
            return err;
        }

        this.m_state = ChainState.syncing;
        let _instanceOptions = Object.create(null);
        Object.assign(_instanceOptions, instanceOptions);

        // 初始化时，要同步的peer数目，与这个数目的peer完成同步之后，才开始接收tx，挖矿等等
        _instanceOptions.initializePeerCount = !isNullOrUndefined(instanceOptions.initializePeerCount) ? instanceOptions.initializePeerCount : 1;
        // 初始化时，一次请求的最大header数目
        _instanceOptions.headerReqLimit = !isNullOrUndefined(instanceOptions.headerReqLimit) ? instanceOptions.headerReqLimit : 2000;
        // confirm数目，当块的depth超过这个值时，认为时绝对安全的；分叉超过这个depth的两个fork，无法自动合并回去
        _instanceOptions.confirmDepth = !isNullOrUndefined(instanceOptions.confirmDepth) ? instanceOptions.confirmDepth : 6;

        _instanceOptions.ignoreVerify = !isNullOrUndefined(instanceOptions.ignoreVerify) ? instanceOptions.ignoreVerify : false;

        _instanceOptions.pendingOvertime = !isNullOrUndefined(instanceOptions.pendingOvertime) ? instanceOptions.pendingOvertime : 60 * 60;
        _instanceOptions.maxPendingCount = !isNullOrUndefined(instanceOptions.maxPendingCount) ? instanceOptions.maxPendingCount : 10000;
        _instanceOptions.warnPendingCount = !isNullOrUndefined(instanceOptions.warnPendingCount) ? instanceOptions.warnPendingCount : 5000;

        this.m_instanceOptions = _instanceOptions;

        this.m_pending = this._createPending();
        this.m_pending.on('txAdded', (tx: Transaction, connAddr: string) => {
            this.logger.debug(`broadcast transaction txhash=${tx.hash}, nonce=${tx.nonce}, address=${tx.address}`);
            // this.m_node!.broadcast([tx]);
            this.m_node!.broadcastTx(tx, connAddr);
        });
        this.m_pending.init();

        this.m_routineManager = new instanceOptions.routineManagerType(this);

        let node = new ChainNode({
            networks: _instanceOptions.networks,
            logger: this.m_logger,
            blockStorage: this.m_blockStorage!,
            storageManager: this.m_storageManager!,
            blockWithLog: !!this._ignoreVerify
        });

        this.m_node = node!;

        this.m_node.on('blocks', (params: BlocksEventParams) => {
            // Add by Yang Jun, 2019-8-27
            this.node.txBuffer.beginBlock();

            this._addPendingBlocks(params);

            this.node.txBuffer.endBlock();
        });
        this.m_node.on('headers', (params: HeadersEventParams) => {
            // Add by Yang Jun, 2019-8-27
            this.node.txBuffer.beginHeaders();

            this._addPendingHeaders(params);

            this.node.txBuffer.endHeaders();
        });
        this.m_node.on('transactions', async (conn: NodeConnection, transactions: Transaction[]) => {
            for (let tx of transactions) {
                if (conn.fullRemote === undefined) {
                    this.logger.error('Undefined conn');
                    return;
                }

                const _err = await this._addTransaction(tx, conn.fullRemote.split('^')[1]);

                if (_err === ErrorCode.RESULT_TX_CHECKER_ERROR) {
                    this._banConnection(conn.fullRemote, BAN_LEVEL.forever);
                    break;
                }
            }
        });
        this.m_node.on('ban', (remote: string) => {
            this._onConnectionError(remote);
        });
        this.m_node.on('error', (remote: string) => {
            this._onConnectionError(remote);
        });

        err = await this._loadChain();
        if (err) {
            this.m_logger.error(`chain initialize failed for load chain ${err}`);
            return err;
        }

        // init chainnode in _initialBlockDownload
        err = await this._initialBlockDownload();
        if (err) {
            this.m_logger.error(`chain initialize failed for initial block download ${err}`);
            return err;
        }
        err = await new Promise<ErrorCode>(async (resolve) => {
            this.prependOnceListener('tipBlock', () => {
                this.m_logger.info(`chain initialized success, tip number: ${this.m_tip!.number} hash: ${this.m_tip!.hash}`);
                resolve(ErrorCode.RESULT_OK);
            });
        });
        if (err) {
            this.m_logger.error(`chain initialize failed for first tip ${err}`);
            return err;
        }
        // 初始化完成之后开始监听，这样初始化中的节点不会被作为初始化的sync 节点


        err = await this.m_node!.listen();
        if (err) {
            this.m_logger.error(`chain initialize failed for listen ${err}`);
            return err;
        }
        return ErrorCode.RESULT_OK;
    }

    async uninitialize(): Promise<any> {
        // 上层保证await调用别重入了, 不加入中间状态了
        if (this.m_state <= ChainState.init) {
            return;
        }
        await this.m_node!.uninit();
        delete this.m_node;
        this.m_pending!.uninit();
        delete this.m_pending;
        delete this.m_instanceOptions;
        for (let s of this.m_constSnapshots) {
            this.m_storageManager!.releaseSnapshotView(s);
        }
        this.m_state = ChainState.init;

    }

    protected _createPending(): PendingTransactions {
        return new PendingTransactions({
            storageManager: this.m_storageManager!,
            logger: this.logger,
            overtime: this.m_instanceOptions!.pendingOvertime!,
            handler: this.m_handler!,
            maxCount: this.m_instanceOptions!.maxPendingCount!,
            warnCount: this.m_instanceOptions!.warnPendingCount!
        });
    }

    protected _defaultNetworkOptions(): any {
        return { netType: 'random' };
    }

    protected _parseNetwork(options: {
        parsed: any,
        origin: Map<string, any>
    }): { err: ErrorCode, network?: Network } {
        let parsed = Object.create(options.parsed);
        parsed.dataDir = this.m_dataDir;
        parsed.headerStorage = this.headerStorage;
        parsed.blockHeaderType = this._getBlockHeaderType();
        parsed.transactionType = this._getTransactionType();
        parsed.receiptType = this._getReceiptType();
        parsed.logger = this.m_logger;

        const ncr = this.m_networkCreator.create({ parsed, origin: options.origin });
        if (ncr.err) {
            return { err: ncr.err };
        }

        const por = ncr.network!.parseInstanceOptions(options);
        if (por.err) {
            return { err: por.err };
        }

        ncr.network!.setInstanceOptions(por.value!);

        return { err: ErrorCode.RESULT_OK, network: ncr.network };
    }

    protected async _loadChain(): Promise<ErrorCode> {
        assert(this.m_headerStorage);
        assert(this.m_blockStorage);
        let result = await this.m_headerStorage!.getHeader('latest');
        let err = result.err;
        if (err || !result.header) {
            return err;
        }
        err = await this._onUpdateTip(result.header);
        if (err) {
            return err;
        }
        this.m_logger.info(`load chain tip from disk, height:${this.m_tip!.number}, hash:${this.m_tip!.hash}`);
        return ErrorCode.RESULT_OK;
    }

    protected async _morkSnapshot(hashes: Set<string>) {
        this.m_logger.debug(`request to mork storage `, hashes);
        if (this.m_storageMorkRequests.morking) {
            if (this.m_storageMorkRequests.pending) {
                this.m_logger.debug(`ignore pending mork storage request`, this.m_storageMorkRequests.pending);
            }
            this.m_storageMorkRequests.pending = new Set(hashes.values());
            return;
        }
        this.m_storageMorkRequests.morking = new Set(hashes.values());

        const doMork = async () => {
            const morking = this.m_storageMorkRequests.morking!;
            this.m_logger.debug(`begin to mork storage `, morking);

            let toMork: string[] = [];
            for (const blockHash of morking) {
                if (!this.m_refSnapshots.has(blockHash)) {
                    toMork.push(blockHash);
                }
            }
            let toRelease: string[] = [];
            for (const blockHash of this.m_refSnapshots) {
                if (!morking.has(blockHash)) {
                    toRelease.push(blockHash);
                }
            }
            this.m_logger.debug(`morking toMork snapshots `, toMork);
            let morked: string[] = [];
            for (const blockHash of toMork) {
                this.logger.debug(`=============_updateTip get 2, hash=${blockHash}`);
                const gsv = await this.m_storageManager!.getSnapshotView(blockHash);
                this.logger.debug(`=============_updateTip get 2 1,hash=${blockHash}`);
                if (gsv.err) {
                    this.m_logger.error(`mork ${blockHash}'s storage failed`);
                    continue;
                }
                morked.push(blockHash);
            }
            this.m_logger.debug(`morking toRelease snapshots `, toRelease);
            for (const hash of toRelease) {
                this.m_storageManager!.releaseSnapshotView(hash);
                this.m_refSnapshots.delete(hash);
            }
            this.m_logger.debug(`morking add ref snapshots `, morked);

            for (const hash of morked) {
                this.m_refSnapshots.add(hash);
            }

            this.m_logger.debug(`recycle snapshots`);
            this.m_storageManager!.recycleSnapshot();
        };

        while (this.m_storageMorkRequests.morking) {
            await doMork();
            delete this.m_storageMorkRequests.morking;

            // Yang Jun remove it for BP restart infinite loop problem 2019-6-11
            // this.m_storageMorkRequests.morking = this.m_storageMorkRequests.pending;
            this.m_logger.debug('In morking loop, .pending ->', this.m_storageMorkRequests.pending);
        }
    }

    protected async _onUpdateTip(tip: BlockHeader): Promise<ErrorCode> {
        this.m_tip = tip;
        let toMork = new Set([tip.hash]);
        const msr = await this._onMorkSnapshot({ tip, toMork });
        if (msr.err) {
            this.m_logger.error(`on mork snapshot failed for ${stringifyErrorCode(msr.err)}`);
        }
        this._morkSnapshot(toMork);
        let err = await this.m_pending!.updateTipBlock(tip);
        if (err) {
            return err;
        }
        return ErrorCode.RESULT_OK;
    }

    protected async _onMorkSnapshot(options: { tip: BlockHeader, toMork: Set<string> }): Promise<{ err: ErrorCode }> {
        return { err: ErrorCode.RESULT_OK };
    }

    get tipBlockHeader(): BlockHeader | undefined {
        return this.m_tip;
    }

    public getBlock(hash: string) {
        return this.m_blockStorage!.get(hash);
    }

    protected async _addTransaction(tx: Transaction, connAddr: string): Promise<ErrorCode> {
        if (this.m_state !== ChainState.synced) {
            return ErrorCode.RESULT_INVALID_STATE;
        }
        let err = await this.m_pending!.addTransaction(tx, connAddr);
        return err;
    }

    protected async _compareWork(comparedHeader: BlockHeader, bestChainTip: BlockHeader): Promise<{ err: ErrorCode, result?: number }> {
        // TODO: pow 用height并不安全， 因为大bits高height的工作量可能低于小bits低height 的工作量
        return { err: ErrorCode.RESULT_OK, result: comparedHeader.number - bestChainTip.number };
    }

    protected async _addPendingHeaders(params: HeadersEventParams) {
        // TODO: 这里可以和pending block一样优化，去重已经有的

        this.m_pendingHeaders.push(params);

        if (this.m_pendingHeaders.length === 1) {
            while (this.m_pendingHeaders.length) {
                let _params = this.m_pendingHeaders[0];
                await this._addHeaders(_params);
                this.m_pendingHeaders.shift();
            }
        }
    }

    protected async _addPendingBlocks(params: BlocksEventParams, head: boolean = false) {
        let pendingBlocks = this.m_pendingBlocks;
        if (pendingBlocks.hashes.has(params.block.hash)) {
            return;
        }
        if (head) {
            pendingBlocks.sequence.unshift(params);
        } else {
            pendingBlocks.sequence.push(params);
        }
        pendingBlocks.hashes.add(params.block.hash);
        if (!pendingBlocks.adding) {
            while (pendingBlocks.sequence.length) {
                pendingBlocks.adding = pendingBlocks.sequence.shift()!;
                let { block, from, storage, redoLog } = pendingBlocks.adding;
                await this._addBlock(block, { remote: from, storage, redoLog });
                pendingBlocks.hashes.delete(block.hash);
                delete pendingBlocks.adding;
            }
        }
    }

    protected _onConnectionError(remote: string) {
        this.m_connSyncMap.delete(remote);
        let hi = 1;
        while (true) {
            if (hi >= this.m_pendingHeaders.length) {
                break;
            }
            const ph = this.m_pendingHeaders[hi];
            if (ph.from === remote) {
                this.m_pendingHeaders.splice(hi, 1);
            } else {
                ++hi;
            }
        }
        let bi = 1;
        let pendingBlocks = this.m_pendingBlocks;
        while (true) {
            if (bi >= pendingBlocks.sequence.length) {
                break;
            }
            let params = pendingBlocks.sequence[bi];
            if (params.from === remote) {
                pendingBlocks.sequence.splice(bi, 1);
                pendingBlocks.hashes.delete(params.block.hash);
            } else {
                ++bi;
            }
        }
    }

    protected _banConnection(remote: string | SyncConnection, level: BAN_LEVEL): ErrorCode {
        let connSync;
        if (typeof remote === 'string') {
            connSync = this.m_connSyncMap.get(remote);
            if (!connSync) {
                return ErrorCode.RESULT_NOT_FOUND;
            }
            this.m_node!.banConnection(remote, level);
        } else {
            connSync = remote;
            this.m_node!.banConnection(connSync.conn.fullRemote, level);
        }
        return ErrorCode.RESULT_OK;
    }

    protected async _continueSyncWithConnection(connSync: SyncConnection): Promise<ErrorCode> {
        if (connSync.moreHeaders) {
            connSync.lastRequestHeader = connSync.lastRecvHeader!.hash;
            let limit = await this._calcuteReqLimit(connSync.lastRequestHeader, this._headerReqLimit);
            connSync.reqLimit = limit;
            this.m_node!.requestHeaders(connSync.conn, { from: connSync.lastRecvHeader!.hash, limit });
        } else {
            connSync.state = ChainState.synced;
            delete connSync.moreHeaders;

            if (this.m_state === ChainState.syncing) {
                let syncedCount = 0;
                let out = this.m_node!.getOutbounds();
                for (let conn of out) {
                    let _connSync = this.m_connSyncMap.get(conn.fullRemote);
                    if (_connSync && _connSync.state === ChainState.synced) {
                        ++syncedCount;
                    }
                }
                if (syncedCount >= this._initializePeerCount) {
                    this.m_state = ChainState.synced;
                    this.logger.debug(`emit tipBlock with ${this.m_tip!.hash} ${this.m_tip!.number}`);
                    this.emit('tipBlock', this, this.m_tip!);
                }
            }
        }
        return ErrorCode.RESULT_OK;
    }

    protected _createSyncedConnection(from: string): { err: ErrorCode, connSync?: SyncConnection } {
        let conn = this.m_node!.getConnection(from);
        if (!conn) {
            return { err: ErrorCode.RESULT_NOT_FOUND };
        }
        let connSync = { state: ChainState.synced, conn, reqLimit: this._headerReqLimit };
        this.m_connSyncMap.set(from, connSync);
        return { err: ErrorCode.RESULT_OK, connSync };
    }

    protected async _beginSyncWithConnection(from: { conn?: NodeConnection, connSync?: SyncConnection }, fromHeader: string): Promise<ErrorCode> {
        let connSync: SyncConnection | undefined;
        if (from.connSync) {
            connSync = from.connSync;
        } else {
            const conn = from.conn!;
            connSync = this.m_connSyncMap.get(conn.fullRemote);
            if (!connSync) {
                connSync = { state: ChainState.syncing, conn, reqLimit: this._headerReqLimit };
                this.m_connSyncMap.set(conn.fullRemote, connSync);
            }
        }
        connSync.state = ChainState.syncing;
        connSync.lastRequestHeader = fromHeader;
        let limit = await this._calcuteReqLimit(fromHeader, this._headerReqLimit);
        connSync.reqLimit = limit;
        this.m_node!.requestHeaders(connSync.conn, { from: fromHeader, limit });
        return ErrorCode.RESULT_OK;
    }

    protected async _calcuteReqLimit(fromHeader: string, limit: number) {
        return limit;
    }

    protected async _verifyAndSaveHeaders(headers: BlockHeader[]): Promise<{ err: ErrorCode, toRequest?: BlockHeader[] }> {
        assert(this.m_headerStorage);
        let hr = await this.m_headerStorage!.getHeader(headers[0].preBlockHash);
        if (hr.err) {
            return { err: hr.err };
        }
        let toSave: BlockHeader[] = [];
        let toRequest: BlockHeader[] = [];
        for (let ix = 0; ix < headers.length; ++ix) {
            let header = headers[ix];
            let result = await this.m_headerStorage!.getHeader(header.hash);
            if (result.err) {
                if (result.err === ErrorCode.RESULT_NOT_FOUND) {
                    toSave = headers.slice(ix);
                    break;
                } else {
                    return { err: result.err };
                }
            } else if (result.verified === VERIFY_STATE.notVerified) {
                // 已经认证过的block就不要再请求了
                toRequest.push(header);
            } else if (result.verified === VERIFY_STATE.invalid) {
                // 如果这个header已经判定为invalid，那么后续的header也不用被加入了
                return { err: ErrorCode.RESULT_INVALID_BLOCK };
            }
        }
        toRequest.push(...toSave);

        assert(this.m_tip);
        for (let header of toSave) {
            let { err, valid } = await header.verify(this);
            if (err) {
                return { err };
            }
            if (!valid) {
                return { err: ErrorCode.RESULT_INVALID_BLOCK };
            }
            let saveRet = await this.m_headerStorage!.saveHeader(header);
            if (saveRet != ErrorCode.RESULT_OK) {
                return { err: saveRet };
            }
        }

        return { err: ErrorCode.RESULT_OK, toRequest };
    }

    protected async _addHeaders(params: HeadersEventParams): Promise<ErrorCode> {
        let { from, headers, request, error } = params;
        let connSync = this.m_connSyncMap.get(from);

        if (request && !connSync) {
            // 非广播的headers一定请求过
            return ErrorCode.RESULT_NOT_FOUND;
        }
        if (!connSync) {
            // 广播过来的可能没有请求过header，此时创建conn sync
            let cr = this._createSyncedConnection(from);
            if (cr.err) {
                this.m_logger.error(`receive broadcast header,but create synced conn failed, from ${from},err=${cr.err}`);
                return cr.err;
            }
            connSync = cr.connSync!;
        }

        if (connSync.state === ChainState.syncing) {
            if (request && request.from) {
                if (request.from !== connSync.lastRequestHeader!) {
                    this.m_logger.error(`request ${connSync.lastRequestHeader!} from ${from} while got headers from ${request.from}`);
                    this._banConnection(from, BAN_LEVEL.forever);
                    return ErrorCode.RESULT_OK;
                }
                if (error === ErrorCode.RESULT_OK) {
                    // 现有机制下，不可能ok并返回空，干掉
                    if (!headers.length) {
                        this._banConnection(from, BAN_LEVEL.forever);
                        return ErrorCode.RESULT_OK;
                    }
                    this.m_logger.info(`syncing get headers [${headers[0].hash}, ${headers[headers.length - 1].hash}] from ${from} at syncing`);
                    let vsh = await this._verifyAndSaveHeaders(headers);
                    // 找不到的header， 或者验证header出错， 都干掉
                    if (vsh.err === ErrorCode.RESULT_NOT_FOUND || vsh.err === ErrorCode.RESULT_INVALID_BLOCK) {
                        this._banConnection(from, BAN_LEVEL.forever);
                        return ErrorCode.RESULT_OK;
                    } else if (vsh.err) {
                        // TODO：本地出错，可以重新请求？
                        return vsh.err;
                    }
                    connSync!.lastRecvHeader = headers[headers.length - 1];
                    connSync!.moreHeaders = (headers.length === connSync.reqLimit);
                    if (vsh.toRequest!.length) {
                        // 向conn 发出block请求
                        // 如果options.redoLog=1 同时也请求redo log内容, redo log 会随着block package 一起返回
                        this.m_node!.requestBlocks(from, {
                            headers: vsh.toRequest!,
                            redoLog: this._ignoreVerify ? 1 : 0,
                        });
                    } else {
                        // 继续同步header回来
                        return await this._continueSyncWithConnection(connSync!);
                    }
                } else if (error === ErrorCode.RESULT_SKIPPED) {
                    // 没有更多了
                    connSync!.moreHeaders = false;
                    // 继续同步header回来
                    return await this._continueSyncWithConnection(connSync!);
                } else if (error === ErrorCode.RESULT_NOT_FOUND) {
                    // 上次请求的没有获取到，那么朝前回退limit再请求
                    let hsr = await this.getHeader(connSync!.lastRequestHeader!, -this._headerReqLimit);
                    if (hsr.err) {
                        return hsr.err;
                    }
                    return await this._beginSyncWithConnection(connSync, hsr.header!.hash);
                } else {
                    assert(false, `get header with syncing from ${from} with err ${error}`);
                }
            } else if (!request) {
                // 广播来的直接忽略
            } else {
                this.m_logger.error(`invalid header request ${request} response when syncing with ${from}`);
                this._banConnection(from, BAN_LEVEL.forever);
            }
        } else if (connSync.state === ChainState.synced) {
            if (!request) {
                this.m_logger.info(`synced get headers [${headers[0].hash}, ${headers[headers.length - 1].hash}] from ${from} at synced`);
                let vsh = await this._verifyAndSaveHeaders(headers);
                // 验证header出错干掉
                if (vsh.err === ErrorCode.RESULT_INVALID_BLOCK) {
                    this._banConnection(from, BAN_LEVEL.day);
                    return ErrorCode.RESULT_OK;
                } else if (vsh.err === ErrorCode.RESULT_NOT_FOUND) {
                    // 找不到可能是因为落后太久了，先从当前tip请求吧
                    let hsr = await this.getHeader(this.getLIB().number);
                    if (hsr.err) {
                        return hsr.err;
                    }
                    return await this._beginSyncWithConnection(connSync, hsr.header!.hash);
                } else if (vsh.err) {
                    // TODO：本地出错，可以重新请求？
                    this.m_logger.error(`vsh error ${vsh.err} when _verifyAndSaveHeaders`);
                    return vsh.err;
                }
                connSync!.lastRecvHeader = headers[headers.length - 1];
                this.m_node!.requestBlocks(from, { headers: vsh.toRequest! });
            } else {
                // 不是广播来来的都不对
                this.m_logger.error(`invalid header request ${request} response when synced with ${from}`);
                this._banConnection(from, BAN_LEVEL.forever);
            }
        }

        return ErrorCode.RESULT_OK;
    }

    protected async _addBlock(block: Block, options: { remote?: string, storage?: StorageDumpSnapshot, redoLog?: StorageLogger }): Promise<ErrorCode> {
        // try{
        assert(this.m_headerStorage);
        this.m_logger.info(`begin adding block number: ${block.number}  hash: ${block.hash} to chain `);
        let err = ErrorCode.RESULT_OK;

        // Yang Jun 2018-8-15
        getMonitor()!.updateBlock(block.content.transactions.length);

        if (options.storage) {
            // mine from local miner
            let _err = await this._addVerifiedBlock(block, options.storage);
            if (_err) {
                return _err;
            }
        } else {
            do {
                // 加入block之前肯定已经有header了
                let headerResult = await this.m_headerStorage!.getHeader(block.hash);
                if (headerResult.err) {
                    this.m_logger.warn(`ignore block for header missing`);
                    err = headerResult.err;
                    if (err === ErrorCode.RESULT_NOT_FOUND) {
                        err = ErrorCode.RESULT_INVALID_BLOCK;
                    }
                    break;
                }
                assert(headerResult.header && headerResult.verified !== undefined);
                let headerResult1 = await this.m_headerStorage!.getHeader(block.header.preBlockHash);
                if (options && options.remote) {
                    if (!headerResult1.err) {
                        this.m_node!.requestBlocks(options.remote, { headers: [headerResult.header!] });
                    }
                }
                if (headerResult.verified === VERIFY_STATE.verified
                    || headerResult.verified === VERIFY_STATE.invalid) {
                    this.m_logger.info(`ignore block for block has been verified as ${headerResult.verified}`);
                    if (headerResult.verified === VERIFY_STATE.invalid) {
                        err = ErrorCode.RESULT_INVALID_BLOCK;
                    } else {
                        err = ErrorCode.RESULT_SKIPPED;
                    }
                    break;
                }
                headerResult = await this.m_headerStorage!.getHeader(block.header.preBlockHash);
                if (headerResult.err) {
                    this.m_logger.warn(`ignore block for previous header hash: ${block.header.preBlockHash} missing`);
                    err = headerResult.err;
                    break;
                }
                assert(headerResult.header && headerResult.verified !== undefined);
                if (headerResult.verified === VERIFY_STATE.notVerified) {
                    this.m_logger.info(`ignore block for previous header hash: ${block.header.preBlockHash} hasn't been verified`);
                    if (options && options.remote) {
                        this.m_logger.info(`before send request to ${options.remote} with block ${block.header.preBlockHash}`);
                        let headerResult = await this.m_headerStorage!.getHeader(block.header.preBlockHash);
                        if (!headerResult.err) {
                            this.m_node!.requestBlocks(options.remote, { headers: [headerResult.header!] });
                        }
                    }
                    err = ErrorCode.RESULT_SKIPPED;
                    break;
                } else if (headerResult.verified === VERIFY_STATE.invalid) {
                    this.m_logger.info(`ignore block for previous block has been verified as invalid`);
                    await this.m_headerStorage!.updateVerified(block.header, VERIFY_STATE.invalid);
                    err = ErrorCode.RESULT_INVALID_BLOCK;
                    break;
                }
            } while (false);

            if (err === ErrorCode.RESULT_INVALID_BLOCK) {
                if (options.remote) {
                    this._banConnection(options.remote!, BAN_LEVEL.day);
                }
                return err;
            } else if (err !== ErrorCode.RESULT_OK) {
                return err;
            }
            const name = `${block.hash}${Date.now()}`;
            let rr = await this.verifyBlock(name, block, { redoLog: options.redoLog });
            if (rr.err) {
                this.m_logger.error(`add block failed for verify failed for ${rr.err}`);
                return rr.err;
            }
            const routine = rr.routine!;
            const vbr = await rr.next!();

            if (vbr.valid === ErrorCode.RESULT_OK) {
                this.m_logger.info(`${routine.name} block verified`);
                assert(routine.storage, `${routine.name} verified ok but storage missed`);
                let csr = await this.m_storageManager!.createSnapshot(routine.storage!, block.hash, true);
                if (csr.err) {
                    this.m_logger.error(`${name} verified ok but save snapshot failed`);
                    return csr.err;
                }
                let _err = await this._addVerifiedBlock(block, csr.snapshot!);
                if (_err) {
                    return _err;
                }
            } else {
                this.m_logger.info(`${routine.name} block invalid for `, stringifyErrorCode(vbr.valid!));
                if (options.remote) {
                    this._banConnection(options.remote!, BAN_LEVEL.day);
                }
                let _err = await this.m_headerStorage!.updateVerified(block.header, VERIFY_STATE.invalid);
                if (_err) {
                    return _err;
                }
                return ErrorCode.RESULT_OK;
            }
        }

        let syncing: boolean = false;
        let synced: boolean = false;
        let broadcastExcept: Set<string> = new Set();

        for (let remote of this.m_connSyncMap.keys()) {
            let connSync = this.m_connSyncMap.get(remote)!;
            if (connSync.state === ChainState.syncing) {
                if (connSync.lastRecvHeader && connSync.lastRecvHeader!.hash === block.hash) {
                    await this._continueSyncWithConnection(connSync);
                    syncing = true;
                }
                broadcastExcept.add(remote);
            } else {
                if (connSync.lastRecvHeader && connSync.lastRecvHeader!.hash === block.hash) {
                    synced = true;
                    broadcastExcept.add(remote);
                }
            }
        }

        if (options.storage || (!syncing && synced)) {
            if (this.m_tip!.hash === block.header.hash) {
                this.logger.debug(`emit tipBlock with ${this.m_tip!.hash} ${this.m_tip!.number}`);
                this.emit('tipBlock', this, this.m_tip!);
                let hr = await this.getHeader(this.m_tip!, -this._broadcastDepth);
                if (hr.err) {
                    return hr.err;
                }
                assert(hr.headers);
                if (hr.headers![0].number === 0) {
                    hr.headers = hr.headers!.slice(1);
                }
                this.m_node!.broadcast(hr.headers!, {
                    filter: (conn: NodeConnection) => {
                        this.m_logger.debug(`broadcast to ${conn.fullRemote}: ${!broadcastExcept.has(conn.fullRemote)}`);
                        return !broadcastExcept.has(conn.fullRemote);
                    }
                });
                this.m_logger.info(`broadcast tip headers from number: ${hr.headers![0].number} hash: ${hr.headers![0].hash} to number: ${this.m_tip!.number} hash: ${this.m_tip!.hash}`);
            }
        }

        let nextResult = await this.m_headerStorage!.getNextHeader(block.header.hash);
        if (nextResult.err) {
            if (nextResult.err === ErrorCode.RESULT_NOT_FOUND) {
                return ErrorCode.RESULT_OK;
            } else {
                return nextResult.err;
            }
        }

        assert(nextResult.results && nextResult.results.length);

        for (let result of nextResult.results!) {
            let _block = this.m_blockStorage!.get(result.header.hash);
            if (_block) {
                this.m_logger.info(`next block hash ${result.header.hash} is ready`);
                this._addPendingBlocks({ block: _block }, true);
            }
        }
        return ErrorCode.RESULT_OK;
        // } catch (e) {
        //     console.error(e);
        //     return ErrorCode.RESULT_OK;
        // }
    }

    public async beginConsistency(): Promise<void> {
        await this.m_headerStorage!.beginConsistency();
    }

    public async commitConsistency(): Promise<void> {
        await this.m_headerStorage!.commitConsistency();
    }

    public async rollbackConsistency(): Promise<void> {
        await this.m_headerStorage!.rollbackConsistency();
    }

    protected async _begin(): Promise<ErrorCode> {
        try {
            this.m_db!.prepare('BEGIN;').run();
            await this.beginConsistency();
            return ErrorCode.RESULT_OK;
        } catch (e) {
            this.logger.error(`chain begin transaction exception, e=${e}`);
            return ErrorCode.RESULT_EXCEPTION;
        }
    }

    protected async _commit(): Promise<ErrorCode> {
        try {
            this.m_db!.prepare('COMMIT;').run();
            await this.commitConsistency();
            return ErrorCode.RESULT_OK;
        } catch (e) {
            this.logger.error(`chain commit transaction exception, e=${e}`);
            // 让它崩溃
            assert(false, 'commit failed');
            return ErrorCode.RESULT_EXCEPTION;
        }
    }

    protected async _rollback(): Promise<ErrorCode> {
        try {
            this.m_db!.prepare('ROLLBACK;').run();
            await this.rollbackConsistency();
            return ErrorCode.RESULT_OK;
        } catch (e) {
            this.logger.error(`chain rollback transaction exception, e=${e}`);
            // 让它崩溃
            assert(false, 'rollback failed');
            return ErrorCode.RESULT_EXCEPTION;
        }
    }

    protected async _addVerifiedBlock(block: Block, storage: StorageDumpSnapshot): Promise<ErrorCode> {
        this.m_logger.info(`begin add verified block to chain ${block.number} ${block.hash}`);
        assert(this.m_headerStorage);
        assert(this.m_tip);

        let cr = await this._compareWork(block.header, this.m_tip!);
        if (cr.err) {
            return cr.err;
        }
        if (cr.result! > 0) {
            let err = await this._begin();
            if (err) {
                return err;
            }
            err = await this._onBestBlock(block.header);
            if (err) {
                await this._rollback();
                this.m_logger.error(`onBestBlock ${block.number} ${block.hash} failed for ${stringifyErrorCode(err)}`);
                return err;
            }
            this.m_logger.info(`begin extend chain's tip`);
            err = await this.m_headerStorage!.changeBest(block.header);
            if (err) {
                await this._rollback();
                this.m_logger.error(`extend chain's tip failed for save to header storage failed for ${err}`);
                return err;
            }
            await this._commit();

            err = await this._onUpdateTip(block.header);
            if (err) {
                return err;
            }
        } else {
            let err = await this._onForkBlock(block.header);
            if (err) {
                this.m_logger.error(`onForkBlock ${block.number} ${block.hash} failed for ${stringifyErrorCode(err)}`);
                return err;
            }
            err = await this.m_headerStorage!.updateVerified(block.header, VERIFY_STATE.verified);
            if (err) {
                this.m_logger.error(`add verified block to chain failed for update verify state to header storage failed for ${err}`);
                return err;
            }
        }
        return ErrorCode.RESULT_OK;
    }

    // 需要保持database一致性的操作放这个里面执行，其他的放_onUpdateTip去执行
    protected async _onBestBlock(header: BlockHeader): Promise<ErrorCode> {
        return ErrorCode.RESULT_OK;
    }

    protected async _onForkBlock(header: BlockHeader): Promise<ErrorCode> {
        return ErrorCode.RESULT_OK;
    }

    public newBlockHeader(): BlockHeader {
        return new (this._getBlockHeaderType())();
    }

    public newBlock(header?: BlockHeader): Block {
        let block = new Block({
            header,
            headerType: this._getBlockHeaderType(),
            transactionType: this._getTransactionType(),
            receiptType: this._getReceiptType()
        });
        return block;
    }

    async newBlockExecutor(options: { block: Block, storage: Storage, externParams?: BlockExecutorExternParam[] }): Promise<{ err: ErrorCode, executor?: BlockExecutor }> {
        let { block, storage, externParams } = options;
        if (!externParams) {
            const ppr = await this.prepareExternParams(block, storage);
            if (ppr.err) {
                return { err: ppr.err };
            }
            externParams = ppr.params!;
        }
        return this._newBlockExecutor(block, storage, externParams);
    }

    async prepareExternParams(block: Block, storage: Storage): Promise<{ err: ErrorCode, params?: BlockExecutorExternParam[] }> {
        return { err: ErrorCode.RESULT_OK, params: [] };
    }

    protected async _newBlockExecutor(block: Block, storage: Storage, externParams: BlockExecutorExternParam[]): Promise<{ err: ErrorCode, executor?: BlockExecutor }> {
        let executor = new BlockExecutor({
            logger: this.m_logger,
            block,
            storage,
            handler: this.m_handler,
            externContext: {},
            globalOptions: this.m_globalOptions,
            externParams: []
        });
        return { err: ErrorCode.RESULT_OK, executor };
    }

    public async newViewExecutor(header: BlockHeader, storage: IReadableStorage, method: string, param: any): Promise<{ err: ErrorCode, executor?: ViewExecutor }> {
        let executor = new ViewExecutor({ logger: this.m_logger, header, storage, method, param, handler: this.m_handler, externContext: {} });
        return { err: ErrorCode.RESULT_OK, executor };
    }

    public async getHeader(arg1: any, arg2?: any): Promise<{ err: ErrorCode, header?: BlockHeader, headers?: BlockHeader[] }> {
        return await this.m_headerStorage!.getHeader(arg1, arg2);
    }

    protected async _initialBlockDownload(): Promise<ErrorCode> {
        assert(this.m_node);
        let err = await this.m_node!.init();
        if (err) {
            if (err === ErrorCode.RESULT_SKIPPED) {
                this.m_state = ChainState.synced;
                this.logger.debug(`emit tipBlock with ${this.m_tip!.hash} ${this.m_tip!.number}`);
                const tip = this.m_tip!;
                setImmediate(() => {
                    this.emit('tipBlock', this, tip);
                });
                return ErrorCode.RESULT_OK;
            }
            return err;
        }
        this.m_node!.on('outbound', async (conn: NodeConnection) => {
            let syncPeer = conn;
            assert(syncPeer);
            return await this._beginSyncWithConnection({ conn }, this.getLIB().hash);
        });

        return ErrorCode.RESULT_OK;
    }

    public async verifyBlock(name: string, block: Block, options?: { redoLog?: StorageLogger }): Promise<{
        err: ErrorCode,
        routine?: BlockExecutorRoutine,
        next?: () => Promise<{ err: ErrorCode, valid?: ErrorCode }>;
    }> {
        this.m_logger.info(`begin verify block number: ${block.number} hash: ${block.hash} `);

        let sr = await this.m_storageManager!.createStorage(name, block.header.preBlockHash);
        if (sr.err) {
            this.m_logger.warn(`verify block failed for recover storage to previous block's failed for ${sr.err}`);
            return { err: sr.err };
        }
        const storage = sr.storage!;
        storage.createLogger();
        let crr: { err: ErrorCode, routine?: BlockExecutorRoutine };
        // 通过redo log 来添加block的内容
        if (this._ignoreVerify && options && options.redoLog) {
            crr = {
                err: ErrorCode.RESULT_OK, routine: new VerifyBlockWithRedoLogRoutine({
                    name,
                    block,
                    storage,
                    redoLog: options.redoLog,
                    logger: this.logger
                })
            };
        } else {
            crr = this.m_routineManager!.create({ name, block, storage });
        }
        if (crr.err) {
            await storage.remove();
            return { err: crr.err };
        }

        const routine = crr.routine!;
        const next = async (): Promise<{ err: ErrorCode, valid?: ErrorCode }> => {
            const rr = await routine.verify();
            if (rr.err || rr.result!.err) {
                await storage.remove();
                return { err: rr.err };
            }
            if (rr.result!.valid !== ErrorCode.RESULT_OK) {
                if (!(this._saveMismatch && rr.result!.valid === ErrorCode.RESULT_VERIFY_NOT_MATCH)) {
                    await storage.remove();
                }
            }
            return rr.result!;
        };
        return { err: ErrorCode.RESULT_OK, routine, next };
    }

    public async addMinedBlock(block: Block, storage: StorageDumpSnapshot) {
        this.m_blockStorage!.add(block);
        this.m_logger.info(`miner mined block number:${block.number} hash:${block.hash}`);
        assert(this.m_headerStorage);
        let err = await this.m_headerStorage!.saveHeader(block.header);
        if (!err) {
            this._addPendingBlocks({ block, storage });
            // Add by Yang Jun 2019-9-3
            getMonitor()!.updateBlocksMined(1);
        }
    }

    /**
     * virtual
     * @param block
     */
    async onCreateGenesisBlock(block: Block, storage: Storage, genesisOptions?: any): Promise<ErrorCode> {
        let dbr = await storage.createDatabase(Chain.dbUser);
        if (dbr.err) {
            this.m_logger.error(`miner create genensis block failed for create user table to storage failed ${dbr.err}`);

            return dbr.err;
        }

        // Added by Yang Jun 2019-2-20
        dbr = await storage.createDatabase(Chain.dbToken);
        if (dbr.err) {
            this.m_logger.error(`miner create genensis block failed for create token table to storage failed ${dbr.err}`);

            return dbr.err;
        }

        dbr = await storage.createDatabase(Chain.dbBancor);
        if (dbr.err) {
            this.m_logger.error(`miner create genensis block failed for create bancor table to storage failed ${dbr.err}`);

            return dbr.err;
        }

        let kvHandle = await dbr.value!.createKeyValue(Chain.kvFactor);
        if (kvHandle.err) {
            this.m_logger.error(`miner create genensis block failed for create factor table to storage failed ${kvHandle.err}`);
            return kvHandle.err;
        }

        kvHandle = await dbr.value!.createKeyValue(Chain.kvReserve);
        if (kvHandle.err) {
            this.m_logger.error(`miner create genensis block failed for create reserve table to storage failed ${kvHandle.err}`);
            return kvHandle.err;
        }

        kvHandle = await dbr.value!.createKeyValue(Chain.kvSupply);
        if (kvHandle.err) {
            this.m_logger.error(`miner create genensis block failed for create supply table to storage failed ${kvHandle.err}`);
            return kvHandle.err;
        }

        kvHandle = await dbr.value!.createKeyValue(Chain.kvNonliquidity);
        if (kvHandle.err) {
            this.m_logger.error(`miner create genensis block failed for create nonliquidity table to storage failed ${kvHandle.err}`);
            return kvHandle.err;
        }

        // Added by Yang Jun 2019-5-17
        let dbVote = await storage.createDatabase(Chain.dbVote);
        if (dbVote.err) {
            this.m_logger.error(`miner create genensis block failed for create vote table to storage failed ${dbr.err}`);

            return dbVote.err;
        }

        kvHandle = await dbVote.value!.createKeyValue(Chain.kvVoteCandidate);
        if (kvHandle.err) {
            this.m_logger.error(`miner create genensis block failed for create vote#vote table to storage failed ${kvHandle.err}`);
            return kvHandle.err;
        }
        // Added by Yang Jun 2019-5-22
        kvHandle = await dbVote.value!.createKeyValue(Chain.kvVoteLasttime);
        if (kvHandle.err) {
            this.m_logger.error(`miner create genensis block failed for create vote#last table to storage failed ${kvHandle.err}`);
            return kvHandle.err;
        }

        let dbSVT = await storage.createDatabase(Chain.dbSVT);
        if (dbSVT.err) {
            this.m_logger.error(`miner create genensis block failed for create svt db to storage failed ${dbr.err}`);

            return dbSVT.err;
        }

        kvHandle = await dbSVT.value!.createKeyValue(Chain.kvSVTDeposit);
        if (kvHandle.err) {
            this.m_logger.error(`miner create genensis block failed for create svt#deposit table to storage failed ${kvHandle.err}`);
            return kvHandle.err;
        }

        kvHandle = await dbSVT.value!.createKeyValue(Chain.kvSVTVote);
        if (kvHandle.err) {
            this.m_logger.error(`miner create genensis block failed for create svt#vote table to storage failed ${kvHandle.err}`);
            return kvHandle.err;
        }

        kvHandle = await dbSVT.value!.createKeyValue(Chain.kvSVTFree);
        if (kvHandle.err) {
            this.m_logger.error(`miner create genensis block failed for create svt#free table to storage failed ${kvHandle.err}`);
            return kvHandle.err;
        }
        kvHandle = await dbSVT.value!.createKeyValue(Chain.kvSVTInfo);
        if (kvHandle.err) {
            this.m_logger.error(`miner create genensis block failed for create svt#info table to storage failed ${kvHandle.err}`);
            return kvHandle.err;
        }

        ///////////////////////////////

        dbr = await storage.createDatabase(Chain.dbSystem);
        if (dbr.err) {
            return dbr.err;
        }
        let kvr = await dbr.value!.createKeyValue(Chain.kvNonce);
        if (kvr.err) {
            this.m_logger.error(`miner create genensis block failed for create nonce table to storage failed ${kvr.err}`);
            return kvr.err;
        }
        kvr = await dbr.value!.createKeyValue(Chain.kvConfig);
        if (kvr.err) {
            this.m_logger.error(`miner create genensis block failed for create config table to storage failed ${kvr.err}`);
            return kvr.err;
        }

        for (let [key, value] of Object.entries(this.globalOptions)) {
            if (!(isString(value) || isNumber(value) || isBoolean(value))) {
                assert(false, `invalid globalOptions ${key}`);
                this.m_logger.error(`miner create genensis block failed for write global config to storage failed for invalid globalOptions ${key}`);
                return ErrorCode.RESULT_INVALID_FORMAT;
            }
            let { err } = await kvr.kv!.hset('global', key, value as string | number | boolean);
            if (err) {
                this.m_logger.error(`miner create genensis block failed for write global config to storage failed ${err}`);
                return err;
            }
        }

        return ErrorCode.RESULT_OK;
    }

    public async onPostCreateGenesis(genesis: Block, storage: StorageDumpSnapshot): Promise<ErrorCode> {
        // assert(genesis.header.storageHash === (await storage.messageDigest()).value);
        assert(genesis.number === 0);
        if (genesis.number !== 0) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        assert(this.m_headerStorage && this.m_blockStorage);
        this.m_blockStorage!.add(genesis);
        let err = await this._begin();
        if (err) {
            return err;
        }
        err = await this.m_headerStorage!.createGenesis(genesis.header);
        if (err) {
            await this._rollback();
            return err;
        }
        err = await this._onBestBlock(genesis.header);
        if (err) {
            await this._rollback();
            return err;
        }
        await this._commit();
        return ErrorCode.RESULT_OK;
    }

    public async view(from: string | number | 'latest', methodname: string, param: any): Promise<{ err: ErrorCode, value?: any }> {
        let retInfo: any = { err: ErrorCode.RESULT_FAILED };
        let storageView: IReadableStorage | undefined;
        do {
            let hr = await this.getHeader(from);
            if (hr.err !== ErrorCode.RESULT_OK) {
                this.m_logger!.error(`view ${methodname} failed for load header ${from} failed for ${hr.err}`);
                retInfo = { err: hr.err };
                break;
            }
            let header = hr.header!;
            let svr = await this.m_storageManager!.getSnapshotView(header.hash);
            if (svr.err !== ErrorCode.RESULT_OK) {
                this.m_logger!.error(`view ${methodname} failed for get snapshot ${header.hash} failed for ${svr.err}`);
                retInfo = { err: svr.err };
                break;
            }
            storageView = svr.storage!;

            let nver = await this.newViewExecutor(header, storageView, methodname, param);
            if (nver.err) {
                this.m_logger!.error(`view ${methodname} failed for create view executor failed for ${nver.err}`);
                retInfo = { err: nver.err };
                this.m_storageManager!.releaseSnapshotView(header.hash);
                break;
            }
            let ret1 = await nver.executor!.execute();
            this.m_storageManager!.releaseSnapshotView(header.hash);
            if (ret1.err === ErrorCode.RESULT_OK) {
                retInfo = { err: ErrorCode.RESULT_OK, value: ret1.value };
                break;
            }
            this.m_logger!.error(`view ${methodname} failed for view executor execute failed for ${ret1.err}`);
            retInfo = { err: ret1.err };
            break;
        } while (false);
        return retInfo;
    }

    public async getNonce(s: string) {
        return await this.m_pending!.getNonce(s);
    }

    public addTransaction(tx: Transaction, connAddr: string): Promise<ErrorCode> {
        return this._addTransaction(tx, connAddr);
    }

    protected _getBlockHeaderType(): new () => BlockHeader {
        return BlockHeader;
    }

    protected _getTransactionType(): new () => Transaction {
        return Transaction;
    }

    protected _getReceiptType(): new () => Receipt {
        return Receipt;
    }

    getLIB(): { number: number, hash: string } {
        return { number: this.m_tip!.number, hash: this.m_tip!.hash };
    }
}

class VerifyBlockWithRedoLogRoutine extends BlockExecutorRoutine {
    constructor(options: {
        name: string,
        block: Block,
        storage: Storage,
        redoLog: StorageLogger
        logger: LoggerInstance
    }) {
        super({
            name: options.name,
            block: options.block,
            storage: options.storage,
            logger: options.logger
        });
        this.m_redoLog = options.redoLog;
    }
    private m_redoLog: StorageLogger;

    async execute(): Promise<{ err: ErrorCode, result?: { err: ErrorCode } }> {
        return { err: ErrorCode.RESULT_NO_IMP };
    }

    async verify(): Promise<{ err: ErrorCode, result?: { err: ErrorCode, valid?: ErrorCode } }> {
        this.m_logger.info(`redo log, block[${this.block.number}, ${this.block.hash}]`);
        // 执行redolog
        let redoError = await this.m_redoLog.redoOnStorage(this.storage);
        if (redoError) {
            this.m_logger.error(`redo error ${redoError}`);
            return { err: ErrorCode.RESULT_OK, result: { err: redoError } };
        }

        // 获得storage的hash值
        let digestResult = await this.storage!.messageDigest();
        if (digestResult.err) {
            this.m_logger.error(`redo log get storage messageDigest error`);
            return { err: ErrorCode.RESULT_OK, result: { err: digestResult.err } };
        }
        const valid = digestResult.value === this.block.header.storageHash ? ErrorCode.RESULT_OK : ErrorCode.RESULT_VERIFY_NOT_MATCH;
        // 当前的storage hash和header上的storageHash 比较
        // 设置verify 结果, 后续流程需要使用 res.valid
        return { err: ErrorCode.RESULT_OK, result: { err: ErrorCode.RESULT_OK, valid } };
    }

    cancel(): void {
        // do nothing
    }
}
