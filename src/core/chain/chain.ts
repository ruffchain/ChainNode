import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as sqlite from 'sqlite';
import * as sqlite3 from 'sqlite3';

import { ErrorCode } from '../error_code';
import { LoggerInstance, initLogger, LoggerOptions } from '../lib/logger_util';

import { INode, NodeConnection } from '../net/node';

import { HeaderStorage, VERIFY_STATE, BlockStorage, Transaction, Receipt, BlockHeader, Block } from '../block';
import { StorageManager, Storage, StorageDumpSnapshot, IReadableStorage, IReadableDatabase, IReadWritableDatabase, StorageLogger } from '../storage';
import { SqliteStorage } from '../storage_sqlite/storage';

import { PendingTransactions } from './pending';

import { BlockExecutor, ViewExecutor, BaseHandler } from '../executor';

import { ChainNodeOptions, ChainNode, HeadersEventParams, BlocksEventParams, BAN_LEVEL } from './chain_node';

import { Lock } from '../lib/Lock';
import { isNullOrUndefined } from 'util';

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
    txlivetime: number;
};

export type ChainInstanceOptions = {
    initializePeerCount?: number;
    headerReqLimit?: number;
    confirmDepth?: number;
    // 不用excutor校验block, 而是通过redo log; 默认为0,即使用excutor
    ignoreVerify?: number; 
} & ChainNodeOptions;

type SyncConnection = {
    conn: NodeConnection,
    state: ChainState,
    lastRequestHeader?: string,
    lastRecvHeader?: BlockHeader,
    reqLimit: number,
    moreHeaders?: boolean
};

export class Chain extends EventEmitter {
    /**
     * @param options.dataDir
     * @param options.blockHeaderType
     * @param options.node
     */
    constructor(options: LoggerOptions) {
        super();
        this.m_logger = initLogger(options);
        this.m_initializePeerCount = 1; // options.initializePeerCount ? options.initializePeerCount : 1;
        this.m_headerReqLimit = 2000; // options.headerReqLimit ? options.headerReqLimit : 2000;
        this.m_confirmDepth = 6; // options.confirmDepth ? options.confirmDepth : 6;
        this.m_broadcastDepth = this.m_confirmDepth;
        this.m_ignoreVerify = 0;
    }

    // 存储address入链的tx的最大nonce
    public static dbSystem: string = '__system';
    public static kvNonce: string = 'nonce'; // address<--->nonce
    public static kvConfig: string = 'config';

    public static dbUser: string = '__user';

    public static s_dbFile: string = 'database';

    on(event: 'tipBlock', listener: (chain: Chain, block: BlockHeader) => void): this;
    on(event: string, listener: any): this {
        return super.on(event, listener);
    }

    once(event: 'tipBlock', listener: (chain: Chain, block: Block) => void): this;
    once(event: string, listener: any): this {
        return super.on(event, listener);
    }

    protected m_dataDir?: string;
    protected m_handler?: BaseHandler; 
    protected m_instanceOptions?: ChainInstanceOptions;
    protected m_globalOptions?: ChainGlobalOptions;
    private m_state: ChainState = ChainState.none;
    private m_tip?: BlockHeader;
    private m_refSnapshots: string[] = [];
    private m_constSnapshots: string[] = [];
    protected m_db?: sqlite.Database;
    private m_headerStorage?: HeaderStorage;
    private m_blockStorage?: BlockStorage;
    private m_storageManager?: StorageManager;
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
    private m_ignoreVerify: number = 0;
    private m_node?: ChainNode;
    protected m_callGetLock: Lock = new Lock();

    // 初始化时，一次请求的最大header数目
    private m_headerReqLimit: number;
    // confirm数目，当块的depth超过这个值时，认为时绝对安全的；分叉超过这个depth的两个fork，无法自动合并回去
    private m_confirmDepth: number;
    // 初始化时，要同步的peer数目，与这个数目的peer完成同步之后，才开始接收tx，挖矿等等
    private m_initializePeerCount: number;
    // broadcast数目，广播header时会同时广播tip到这个深度的header
    protected m_broadcastDepth: number;

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

    get peerid(): string {
        return this.m_node!.peerid;
    }

    get handler(): BaseHandler {
        return this.m_handler!;
    }

    get confirmDepth(): number {
        return this.m_confirmDepth;
    }

    get headerStorage(): HeaderStorage {
        return this.m_headerStorage!;
    }

    public async initComponents(dataDir: string, handler: BaseHandler): Promise<ErrorCode> {
        if (this.m_state >= ChainState.init) {

            return ErrorCode.RESULT_OK;
        }
        this.m_dataDir = dataDir;
        this.m_handler = handler;

        this.m_blockStorage = new BlockStorage({
            logger: this.m_logger!,
            path: dataDir,
            blockHeaderType: this._getBlockHeaderType(),
            transactionType: this._getTransactionType()
        });
        await this.m_blockStorage.init();

        this.m_db = await sqlite.open(dataDir + '/' + Chain.s_dbFile, { mode: sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE });
        this.m_headerStorage = new HeaderStorage({
            logger: this.m_logger!,
            blockHeaderType: this._getBlockHeaderType(),
            db: this.m_db,
            blockStorage: this.m_blockStorage!
        });

        let err;
        err = await this.m_headerStorage.init();
        if (err) {
            return err;
        }

        this.m_storageManager = new StorageManager({
            path: path.join(dataDir, 'storage'),
            storageType: SqliteStorage,
            logger: this.m_logger!,
            headerStorage: this.m_headerStorage!
        });

        err = await this.m_storageManager.init();
        if (err) {
            return err;
        }
        this.m_state = ChainState.init;
        return ErrorCode.RESULT_OK;
    }

    protected _onCheckTypeOptions(typeOptions: ChainTypeOptions): boolean {
        return true;
    }

    onCheckGlobalOptions(globalOptions: ChainGlobalOptions): boolean {
        if (isNullOrUndefined(globalOptions.txlivetime)) {
            globalOptions.txlivetime = 60 * 60;
        }
        return true;
    }

    public parseInstanceOptions(node: INode, instanceOptions: Map<string, any>): {err: ErrorCode, value?: ChainInstanceOptions} {
        let value = Object.create(null);
        value.node = node;
        return {err: ErrorCode.RESULT_OK, value};
    }

    public async initialize(instanceOptions: ChainInstanceOptions): Promise<ErrorCode> {
        if (this.m_state !== ChainState.init) {
            this.m_logger.error(`chain initialize failed for hasn't initComponent`);
            return ErrorCode.RESULT_INVALID_STATE;
        }

        let genesis = await this.m_headerStorage!.loadHeader(0);
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
        let globalOptions = Object.create(null);
        for (let e of kvgr.value!) {
            globalOptions[e.key] = e.value;
        }
        if (!this.onCheckGlobalOptions(globalOptions)) {
            this.m_logger.error(`chain initialize failed for check global options failed`);
            return ErrorCode.RESULT_INVALID_BLOCK;
        }
        this.m_globalOptions = globalOptions;

        this.m_state = ChainState.syncing;
        this.m_instanceOptions = Object.create(instanceOptions);
        this.m_initializePeerCount = instanceOptions.initializePeerCount ? instanceOptions.initializePeerCount : this.m_initializePeerCount;
        this.m_headerReqLimit = instanceOptions.headerReqLimit ? instanceOptions.headerReqLimit : this.m_headerReqLimit;
        this.m_confirmDepth = instanceOptions.confirmDepth ? instanceOptions.confirmDepth : this.m_confirmDepth;
        this.m_broadcastDepth = this.m_confirmDepth;
        this.m_ignoreVerify = instanceOptions.ignoreVerify ? instanceOptions.ignoreVerify : this.m_ignoreVerify;

        this.m_pending = new PendingTransactions({ storageManager: this.m_storageManager!, logger: this.logger, txlivetime: this.m_globalOptions!.txlivetime});

        let ccn = await this._createChainNode();
        if (ccn.err) {
            this.logger.error(`createChainNode error`);
            return ccn.err;
        }

        this.m_node = ccn.node!;

        this.m_node.on('blocks', (params: BlocksEventParams) => {
            this._addPendingBlocks(params);
        });
        this.m_node.on('headers', (params: HeadersEventParams) => {
            this._addPendingHeaders(params);
        });
        this.m_node.on('transactions', (conn: NodeConnection, transactions: Transaction[]) => {
            for (let tx of transactions) {
                this._addTransaction(tx);
            }
        });
        this.m_node.on('ban', (remote: string) => {
            this._onConnectionError(remote);
        });
        this.m_node.node.on('error', (conn: NodeConnection) => {
            this._onConnectionError(conn.getRemote());
        });

        let err = await this._loadChain();
        if (err) {
            return err;
        }

        // init chainnode
        await this.m_node!.init();

        err = await this._initialBlockDownload();
        if (err) {
            return err;
        }
        err = await new Promise<ErrorCode>(async (resolve) => {
            this.prependOnceListener('tipBlock', () => {
                this.m_logger.info(`chain initialized success, tip number: ${this.m_tip!.number} hash: ${this.m_tip!.hash}`);
                resolve(ErrorCode.RESULT_OK);
            });
        });
        if (err) {
            return err;
        }
        // 初始化完成之后开始监听，这样初始化中的节点不会被作为初始化的sync 节点
        err = await this.m_node!.listen();
        if (err) {
            return err;
        }
        return ErrorCode.RESULT_OK;
    }

    protected async _createChainNode(): Promise<{err: ErrorCode, node?: ChainNode}> {
        let node = new ChainNode({
            node: this.m_instanceOptions!.node,
            blockHeaderType: this._getBlockHeaderType(),
            transactionType: this._getTransactionType(),
            blockStorage: this.m_blockStorage!,
            headerStorage: this.m_headerStorage!,
            storageManager: this.m_storageManager!,
            logger: this.m_logger,
            minOutbound: this.m_instanceOptions!.minOutbound,
            blockTimeout: this.m_instanceOptions!.blockTimeout,
            dataDir: this.m_dataDir!,
        });

        return {err: ErrorCode.RESULT_OK, node};
    }

    protected async _loadChain(): Promise<ErrorCode> {
        assert(this.m_headerStorage);
        assert(this.m_blockStorage);
        let result = await this.m_headerStorage!.loadHeader('latest');
        let err = result.err;
        if (err || !result.header) {
            return err;
        }
        err = await this._updateTip(result.header);
        if (err) {
            return err;
        }
        this.m_logger.info(`load chain tip from disk, height:${this.m_tip!.number}, hash:${this.m_tip!.hash}`);
        return ErrorCode.RESULT_OK;
    }

    protected async _updateTip(tip: BlockHeader): Promise<ErrorCode> {
        this.m_tip = tip;
        for (let blockHash of this.m_refSnapshots) {
            this.m_storageManager!.releaseSnapshotView(blockHash);
        }
        this.m_refSnapshots = [];

        let gsv = await this.m_storageManager!.getSnapshotView(tip.hash);
        if (gsv.err) {
            return gsv.err;
        }
        this.m_refSnapshots.push(tip.hash);
        let mork = tip.number - 2 * this.m_confirmDepth;
        mork = mork >= 0 ? mork : 0;
        if (mork !== tip.number) {
            let hr = await this.m_node!.getHeader(mork);
            if (hr.err) {
                return hr.err;
            }
            gsv = await this.m_storageManager!.getSnapshotView(hr.header!.hash);
            if (gsv.err) {
                return gsv.err;
            }
            this.m_refSnapshots.push(hr.header!.hash);
        } 
        this.m_storageManager!.recycleSnapShot();
        let err = await this.m_pending!.updateTipBlock(tip);
        if (err) {
            return err;
        }
        return ErrorCode.RESULT_OK;
    }

    get tipBlockHeader(): BlockHeader | undefined {
        return this.m_tip;
    }

    public getBlock(hash: string) {
        return this.m_blockStorage!.get(hash);
    }

    protected async _addTransaction(tx: Transaction): Promise<ErrorCode> {
        if (this.m_state !== ChainState.synced) {
            return ErrorCode.RESULT_INVALID_STATE;
        }
        let err = await this.m_pending!.addTransaction(tx);
        // TODO: 广播要排除tx的来源 
        if (!err) {
            this.m_node!.broadcast([tx]);
        }
        return err;
    }

    protected async _compareWork(left: BlockHeader, right: BlockHeader): Promise<{ err: ErrorCode, result?: number }> {
        // TODO: pow 用height并不安全， 因为大bits高height的工作量可能低于小bits低height 的工作量
        return { err: ErrorCode.RESULT_OK, result: left.number - right.number };
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
                let { block, remote, storage, redoLog } = pendingBlocks.adding;
                await this._addBlock(block, { remote, storage, redoLog });
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
            if (this.m_pendingHeaders[hi].remote === remote) {
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
            let params = pendingBlocks.sequence[hi];
            if (params.remote === remote) {
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
            this.m_node!.banConnection(connSync.conn.getRemote(), level);
        }
        return ErrorCode.RESULT_OK;
    }

    protected async _continueSyncWithConnection(from: string | SyncConnection): Promise<ErrorCode> {
        let connSync;
        if (typeof from === 'string') {
            connSync = this.m_connSyncMap.get(from);
            if (!connSync) {
                return ErrorCode.RESULT_NOT_FOUND;
            }
        } else {
            connSync = from;
        }
        if (connSync.moreHeaders) {
            connSync.lastRequestHeader = connSync.lastRecvHeader!.hash;
            let limit = await this._calcuteReqLimit(connSync.lastRequestHeader, this.m_headerReqLimit);
            connSync.reqLimit = limit;
            this.m_node!.requestHeaders(connSync.conn, { from: connSync.lastRecvHeader!.hash, limit});
        } else {
            connSync.state = ChainState.synced;
            delete connSync.moreHeaders;

            if (this.m_state === ChainState.syncing) {
                let syncedCount = 0;
                let out = this.m_node!.node.getOutbounds();
                for (let conn of out) {
                    let _connSync = this.m_connSyncMap.get(conn.getRemote());
                    if (_connSync && _connSync.state === ChainState.synced) {
                        ++syncedCount;
                    }
                }
                if (syncedCount >= this.m_initializePeerCount) {
                    this.m_state = ChainState.synced;
                    this.emit('tipBlock', this, this.m_tip!);
                }
            }
        }
        return ErrorCode.RESULT_OK;
    }

    protected _createSyncedConnection(from: string): { err: ErrorCode, connSync?: SyncConnection } {
        let conn = this.m_node!.node.getConnection(from);
        if (!conn) {
            return { err: ErrorCode.RESULT_NOT_FOUND };
        }
        let connSync = { state: ChainState.synced, conn, reqLimit: this.m_headerReqLimit };
        this.m_connSyncMap.set(from, connSync);
        return { err: ErrorCode.RESULT_OK, connSync };
    }

    protected async _beginSyncWithConnection(from: string | SyncConnection, fromHeader: string): Promise<ErrorCode> {
        let connSync: SyncConnection | undefined;
        if (typeof from === 'string') {
            connSync = this.m_connSyncMap.get(from);
            if (!connSync) {
                let conn = this.m_node!.node.getConnection(from);
                if (!conn) {
                    return ErrorCode.RESULT_NOT_FOUND;
                }
                connSync = { state: ChainState.syncing, conn, reqLimit: this.m_headerReqLimit };
                this.m_connSyncMap.set(from, connSync);
            }
        } else {
            connSync = from;
        }
        connSync.state = ChainState.syncing;
        connSync.lastRequestHeader = fromHeader;
        let limit = await this._calcuteReqLimit(fromHeader, this.m_headerReqLimit);
        connSync.reqLimit = limit;
        this.m_node!.requestHeaders(connSync.conn, { from: fromHeader, limit});
        return ErrorCode.RESULT_OK;
    }

    protected async _calcuteReqLimit(fromHeader: string, limit: number) {
        return limit;
    }

    protected async _verifyAndSaveHeaders(headers: BlockHeader[]): Promise<{ err: ErrorCode, toRequest?: BlockHeader[] }> {
        assert(this.m_headerStorage);
        let hr = await this.m_headerStorage!.loadHeader(headers[0].preBlockHash);
        if (hr.err) {
            return { err: hr.err };
        }
        let toSave: BlockHeader[] = [];
        let toRequest: BlockHeader[] = [];
        for (let ix = 0; ix < headers.length; ++ix) {
            let header = headers[ix];
            let result = await this.m_headerStorage!.loadHeader(header.hash);
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
                return {err: ErrorCode.RESULT_INVALID_BLOCK};
            }
        }
        toRequest.push(...toSave);

        assert(this.m_tip);
        for (let header of toSave) {
            let {err, valid} = await header.verify(this);
            if (err) {
                return {err};
            }
            if (!valid) {
                return { err: ErrorCode.RESULT_INVALID_BLOCK };
            }
            let saveRet = await this.m_headerStorage!.saveHeader(header);
            if (saveRet) {
                return { err: saveRet };
            }
        }

        return { err: ErrorCode.RESULT_OK, toRequest };
    }

    protected async _addHeaders(params: HeadersEventParams): Promise<ErrorCode> {
        let { remote, headers, request, error } = params;
        let connSync = this.m_connSyncMap.get(remote);
        if (request && !connSync) {
            // 非广播的headers一定请求过
            return ErrorCode.RESULT_NOT_FOUND;
        }
        if (!connSync) {
            // 广播过来的可能没有请求过header，此时创建conn sync
            let cr = this._createSyncedConnection(remote);
            if (cr.err) {
                return cr.err;
            }
            connSync = cr.connSync!;
        }
        if (connSync.state === ChainState.syncing) {
            if (request && request.from) {
                if (request.from !== connSync.lastRequestHeader!) {
                    this.m_logger.error(`request ${connSync.lastRequestHeader!} from ${remote} while got headers from ${request.from}`);
                    this._banConnection(remote, BAN_LEVEL.forever);
                    return ErrorCode.RESULT_OK;
                }
                if (error === ErrorCode.RESULT_OK) {
                    // 现有机制下，不可能ok并返回空，干掉
                    if (!headers.length) {
                        this._banConnection(remote, BAN_LEVEL.forever);
                        return ErrorCode.RESULT_OK;
                    }
                    this.m_logger.info(`get headers [${headers[0].hash}, ${headers[headers.length - 1].hash}] from ${remote} at syncing`);
                    let vsh = await this._verifyAndSaveHeaders(headers);
                    // 找不到的header， 或者验证header出错， 都干掉
                    if (vsh.err === ErrorCode.RESULT_NOT_FOUND || vsh.err === ErrorCode.RESULT_INVALID_BLOCK) {
                        this._banConnection(remote, BAN_LEVEL.forever);
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
                        this.m_node!.requestBlocks({ 
                            headers: vsh.toRequest!,
                            redoLog: this.m_ignoreVerify,
                        }, remote);
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
                    let hsr = await this.getHeader(connSync!.lastRequestHeader!, -this.m_headerReqLimit);
                    if (hsr.err) {
                        return hsr.err;
                    }
                    return await this._beginSyncWithConnection(connSync, hsr.header!.hash);
                } else {
                    assert(false, `get header with syncing from ${remote} with err ${error}`);
                }
            } else if (!request) {
                // 广播来的直接忽略
            } else {
                this.m_logger.error(`invalid header request ${request} response when syncing with ${remote}`);
                this._banConnection(remote, BAN_LEVEL.forever);
            }
        } else if (connSync.state === ChainState.synced) {
            if (!request) {
                this.m_logger.info(`get headers [${headers[0].hash}, ${headers[headers.length - 1].hash}] from ${remote} at synced`);
                let vsh = await this._verifyAndSaveHeaders(headers);
                // 验证header出错干掉
                if (vsh.err === ErrorCode.RESULT_INVALID_BLOCK) {
                    this._banConnection(remote, BAN_LEVEL.day);
                    return ErrorCode.RESULT_OK;
                } else if (vsh.err === ErrorCode.RESULT_NOT_FOUND) {
                    // 找不到可能是因为落后太久了，先从当前tip请求吧
                    let hsr = await this.getHeader(this.m_tip!, -this.m_confirmDepth + 1);
                    if (hsr.err) {
                        return hsr.err;
                    }
                    return await this._beginSyncWithConnection(connSync, hsr.header!.hash);
                } else if (vsh.err) {
                    // TODO：本地出错，可以重新请求？
                    return vsh.err;
                }
                connSync!.lastRecvHeader = headers[headers.length - 1];
                this.m_node!.requestBlocks({ headers: vsh.toRequest! }, remote);
            } else {
                // 不是广播来来的都不对
                this.m_logger.error(`invalid header request ${request} response when synced with ${remote}`);
                this._banConnection(remote, BAN_LEVEL.forever);
            }
        }

        return ErrorCode.RESULT_OK;
    }

    protected async _addBlock(block: Block, options: { remote?: string, storage?: StorageDumpSnapshot, redoLog?: StorageLogger }): Promise<ErrorCode> {
        // try{
        assert(this.m_headerStorage);
        this.m_logger.info(`begin adding block number: ${block.number}  hash: ${block.hash} to chain `);
        let err = ErrorCode.RESULT_OK;

        if (options.storage) {
            // mine from local miner
            let _err = await this._addVerifiedBlock(block, options.storage);
            if (_err) {
                return _err;
            }
        } else {
            do {
                // 加入block之前肯定已经有header了
                let headerResult = await this.m_headerStorage!.loadHeader(block.hash);
                if (headerResult.err) {
                    this.m_logger.warn(`ignore block for header missing`);
                    err = headerResult.err;
                    if (err === ErrorCode.RESULT_NOT_FOUND) {
                        err = ErrorCode.RESULT_INVALID_BLOCK;
                    }
                    break;
                }
                assert(headerResult.header && headerResult.verified !== undefined);
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
                headerResult = await this.m_headerStorage!.loadHeader(block.header.preBlockHash);
                if (headerResult.err) {
                    this.m_logger.warn(`ignore block for previous header hash: ${block.header.preBlockHash} missing`);
                    err = headerResult.err;
                    break;
                }
                assert(headerResult.header && headerResult.verified !== undefined);
                if (headerResult.verified === VERIFY_STATE.notVerified) {
                    this.m_logger.info(`ignore block for previous header hash: ${block.header.preBlockHash} hasn't been verified`);
                    err = ErrorCode.RESULT_SKIPPED;
                    break;
                } else if (headerResult.verified === VERIFY_STATE.invalid) {
                    this.m_logger.info(`ignore block for previous block has been verified as invalid`);
                    this.m_headerStorage!.updateVerified(block.header, VERIFY_STATE.invalid);
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

            // 校验block
            // 如果options.redoLog对象 不为空，就通过redo, 而不是通过tx校验
            let vbr = await this.verifyBlock(block, options.redoLog);
            if (vbr.err) {
                this.m_logger.error(`add block failed for verify failed for ${vbr.err}`);
                return vbr.err;
            }
            if (!vbr.verified) {
                if (options.remote) {
                    this._banConnection(options.remote!, BAN_LEVEL.day);
                }
                let _err = await this.m_headerStorage!.updateVerified(block.header, VERIFY_STATE.invalid);
                if (_err) {
                    return _err;
                }
            } else {
                let _err = await this._addVerifiedBlock(block, vbr.storage!);
                if (_err) {
                    return _err;
                }
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
                this.emit('tipBlock', this, this.m_tip!);
                // 在broadcast之前执行一次recycleSnapShot
                this.m_storageManager!.recycleSnapShot();
                let hr = await this.getHeader(this.m_tip!, -this.m_broadcastDepth);
                if (hr.err) {
                    return hr.err;
                }
                assert(hr.headers);
                if (hr.headers![0].number === 0) {
                    hr.headers = hr.headers!.slice(1);
                }
                this.m_node!.broadcast(hr.headers!, { filter: (conn: NodeConnection) => { 
                    this.m_logger.info(`broadcast to ${conn.getRemote()}: ${!broadcastExcept.has(conn.getRemote())}`);
                    return !broadcastExcept.has(conn.getRemote()); 
                } });
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

    protected async _addVerifiedBlock(block: Block, storage: StorageDumpSnapshot): Promise<ErrorCode> {
        this.m_logger.info(`begin add verified block to chain`);
        assert(this.m_headerStorage);
        assert(this.m_tip);
        let cr = await this._compareWork(block.header, this.m_tip!);
        if (cr.err) {
            return cr.err;
        }
        if (cr.result! > 0) {
            this.m_logger.info(`begin extend chain's tip`);
            let err = await this.m_headerStorage!.changeBest(block.header);
            if (err) {
                this.m_logger.info(`extend chain's tip failed for save to header storage failed for ${err}`);
                return err;
            }
            err = await this._onVerifiedBlock(block); 
            err = await this._updateTip(block.header);
            if (err) {
                return err;
            }
        } else {
            let err = await this.m_headerStorage!.updateVerified(block.header, VERIFY_STATE.verified);
            if (err) {
                this.m_logger.error(`add verified block to chain failed for update verify state to header storage failed for ${err}`);
                return err;
            }
        }
        return ErrorCode.RESULT_OK;
    }

    protected async _onVerifiedBlock(block: Block): Promise<ErrorCode> {
        return ErrorCode.RESULT_OK;
    }

    public newBlockHeader(): BlockHeader {
        return new (this._getBlockHeaderType())();
    }

    public newBlock(header?: BlockHeader): Block {
        let block = new Block({
            header,
            headerType: this._getBlockHeaderType(), 
            transactionType: this._getTransactionType()});
        return block;
    }

    public async newBlockExecutor(block: Block, storage: Storage): Promise<{ err: ErrorCode, executor?: BlockExecutor }> {
        let executor = new BlockExecutor({logger: this.m_logger, block, storage, handler: this.m_handler!, externContext: {}, globalOptions: this.m_globalOptions! });
        return { err: ErrorCode.RESULT_OK, executor };
    }

    public async newViewExecutor(header: BlockHeader, storage: IReadableStorage, method: string, param: any): Promise<{ err: ErrorCode, executor?: ViewExecutor }> {
        let executor = new ViewExecutor({logger: this.m_logger, header, storage, method, param, handler: this.m_handler!, externContext: {} });
        return { err: ErrorCode.RESULT_OK, executor };
    }

    public async getHeader(arg1: any, arg2?: any): Promise<{ err: ErrorCode, header?: BlockHeader, headers?: BlockHeader[] }> {
        return await this.m_node!.getHeader(arg1, arg2);
    }

    protected async _initialBlockDownload(): Promise<ErrorCode> {
        assert(this.m_node);
        let err = await this.m_node!.initialOutbounds();
        if (err) {
            if (err === ErrorCode.RESULT_SKIPPED) {
                this.m_state = ChainState.synced;
                setImmediate(() => { this.emit('tipBlock', this, this.m_tip!); });
                return ErrorCode.RESULT_OK;
            }
            return err;
        }
        this.m_node!.on('outbound', async (conn: NodeConnection) => {
            let syncPeer = conn;
            assert(syncPeer);
            let hr = await this.m_headerStorage!.loadHeader((this.m_tip!.number > this.m_confirmDepth) ? (this.m_tip!.number - this.m_confirmDepth) : 0);
            if (hr.err) {
                return hr.err;
            }
            assert(hr.header);
            return await this._beginSyncWithConnection(conn.getRemote(), hr.header!.hash);
        });

        return ErrorCode.RESULT_OK;
    }

    public async verifyBlock(block: Block, redoLog?: StorageLogger): Promise<{ err: ErrorCode, verified?: boolean, storage?: StorageDumpSnapshot }> {
        this.m_logger.info(`begin verify block number: ${block.number} hash: ${block.hash} `);

        let sr = await this.m_storageManager!.createStorage('verify', block.header.preBlockHash);
        if (sr.err) {
            this.m_logger.warn(`verify block failed for recover storage to previous block's failed for ${sr.err}`);
            return { err: sr.err };
        }
        let result;
        do {
            let verifyResult: {err: ErrorCode, valid?: boolean};
        
            // 通过redo log 来添加block的内容
            if ( redoLog ) {
                this.m_logger.info(`redo log, block[${block.number}, ${block.hash}]`);
                
                // 把通过网络请求拿到的redoLog 先保存到本地
                this.m_storageManager!.writeRedoLog(block.hash, redoLog!);
                
                // 执行redolog
                let redoError = await redoLog.redoOnStorage(sr.storage!);
                if (redoError) {
                    this.m_logger.info(`redo error ${redoError}`);
                    result = { err: redoError };
                    break;
                }

                // 获得storage的hash值
                let digestResult = await sr.storage!.messageDigest();
                if ( digestResult.err ) {
                    this.m_logger.info(`redo log get storage messageDigest error`);
                    result = { err: digestResult.err };
                    break;
                }
                // 当前的storage hash和header上的storageHash 比较 
                // 设置verify 结果, 后续流程需要使用 res.valid
                verifyResult = {err: ErrorCode.RESULT_OK, valid: digestResult.value === block.header.storageHash};
            } else {
                let nber = await this.newBlockExecutor(block, sr.storage!);
                if (nber.err) {
                    result = { err: nber.err };
                    break;
                }
                verifyResult = await nber.executor!.verify();
            }

            if (verifyResult.err) {
                result = { err: verifyResult.err };
            } else if ( verifyResult.valid ) {
                this.m_logger.info(`block verified`);
                let csr = await this.m_storageManager!.createSnapshot(sr.storage!, block.hash);
                if (csr.err) {
                    result = { err: csr.err };
                } else {
                    result = { err: ErrorCode.RESULT_OK, verified: true, storage: csr.snapshot! };
                }
            } else {
                this.m_logger.info(`block invalid`);
                result = { err: ErrorCode.RESULT_OK, verified: false };
            }
        } while (false);
        await sr.storage!.remove();
        return result;
    }

    public async addMinedBlock(block: Block, storage: StorageDumpSnapshot) {
        this.m_blockStorage!.add(block);
        this.m_logger.info(`miner mined block number:${block.number} hash:${block.hash}`);
        assert(this.m_headerStorage);
        let err = await this.m_headerStorage!.saveHeader(block.header);
        if (!err) {
            this._addPendingBlocks({ block, storage });
        }
    }

    public async create(genesis: Block, storage: StorageDumpSnapshot): Promise<ErrorCode> {
        // assert(genesis.header.storageHash === (await storage.messageDigest()).value);
        assert(genesis.number === 0);
        if (genesis.number !== 0) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        assert(this.m_headerStorage && this.m_blockStorage);
        this.m_blockStorage!.add(genesis);
        let err = await this.m_headerStorage!.createGenesis(genesis.header);
        if (err) {
            return err;
        }
        await this._onVerifiedBlock(genesis);
        return ErrorCode.RESULT_OK;
    }

    public async view<T>(arg: string | number | 'latest', methodname: string, param: any): Promise<{ err: ErrorCode, value?: T | null }> {
        let retInfo: any = { err: ErrorCode.RESULT_FAILED };
        await this.m_callGetLock.enter();
        let storageView: IReadableStorage | undefined;
        while (true) {
            let hr = await this.getHeader(arg);
            if (hr.err !== ErrorCode.RESULT_OK) {
                this.m_logger!.error(`view ${methodname} failed for load header ${arg} failed for ${hr.err}`);
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
                retInfo = { err: ErrorCode.RESULT_OK, value: ret1.value as T };
                break;
            }
            this.m_logger!.error(`view ${methodname} failed for create view executor failed for ${ret1.err}`);
            retInfo = { err: ret1.err };
            break;
        }
        await this.m_callGetLock.leave();
        return retInfo;
    }

    public async getNonce(s: string) {
        return await this.m_pending!.getStorageNonce(s);
    }

    public async getTransactionReceipt(s: string): Promise<{ err: ErrorCode, block?: BlockHeader, tx?: Transaction, receipt?: Receipt }> {
        let ret = await this.m_headerStorage!.txview.get(s);
        if (ret.err !== ErrorCode.RESULT_OK) {
            this.logger.error(`get transaction receipt ${s} failed for ${ret.err}`);
            return { err: ret.err };
        }

        let block = this.getBlock(ret.blockhash!);
        if (!block) {
            this.logger.error(`get transaction receipt failed for get block ${ret.blockhash!} failed`);
            return { err: ErrorCode.RESULT_NOT_FOUND };
        }
        let tx: Transaction | null = block.content.getTransaction(s);
        let receipt: Receipt | undefined = block.content.getReceipt(s);
        if (tx && receipt) {
            return { err: ErrorCode.RESULT_OK, block: block.header, tx, receipt };
        }
        assert(false, `transaction ${s} declared in ${ret.blockhash!} but not found in block`);
        return { err: ErrorCode.RESULT_NOT_FOUND };
    }

    public addTransaction(tx: Transaction): Promise<ErrorCode> {
        return this._addTransaction(tx);
    }

    protected _getBlockHeaderType(): new () => BlockHeader {
        return BlockHeader;
    }

    protected _getTransactionType(): new () => Transaction {
        return Transaction;
    }
}
