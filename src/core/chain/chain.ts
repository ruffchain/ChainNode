import * as assert from 'assert';
import {EventEmitter} from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sqlite from 'sqlite';
import * as sqlite3 from 'sqlite3';

import {ErrorCode} from '../error_code';
import {LoggerInstance, initLogger, LoggerOptions} from '../lib/logger_util';

import {NodeConnection} from '../net/node';

import { HeaderStorage, VERIFY_STATE } from './header_storage'; 
import { BlockStorage } from './block_storage';
import { StorageManager, Storage, StorageDumpSnapshot, IReadableStorage, StorageManagerOptions } from '../storage/storage_manager';
import * as SqliteStorage from '../storage_sqlite/storage';
import { IReadWritableKeyValue, IReadableKeyValue } from '../storage/storage';

import {Transaction, Receipt} from './transaction';
import {BlockHeader, Block} from './block';
import {PendingTransactions} from './pending';

import {BlockExecutor} from '../executor/block';
import {ViewExecutor} from '../executor/view';
import {BaseHandler} from '../executor/handler';

import {ChainNodeOptions, ChainNode, HeadersEventParams, BlocksEventParams, BAN_LEVEL} from './chain_node';

import {Lock} from '../lib/Lock';


export type ExecutorContext = {
    now: number;
    height: number;
};

export type TransactionContext = {
    caller: string;
    storage: IReadWritableKeyValue;
    emit: (name:string, param?: any)=>void;
} & ExecutorContext;

export type EventContext = {
    storage: IReadWritableKeyValue;
} & ExecutorContext;

export type ViewContext = {
    storage: IReadableKeyValue;
} & ExecutorContext;


enum ChainState {
    none = 0,
    syncing = 1,
    synced = 2,
}

export type ChainOptions = {
    dataDir: string;
    handler: BaseHandler;
    initializePeerCount?: number;
    headerReqLimit?: number;
    confirmDepth?: number;
} & ChainNodeOptions & LoggerOptions;


type SyncConnection = {
    conn: NodeConnection,
    state: ChainState,
    lastRequestHeader?: string,
    lastRecvHeader?: BlockHeader,
    moreHeaders?: boolean
}

export class Chain extends EventEmitter {
    /**
     * @param options.dataDir
     * @param options.blockHeaderType
     * @param options.node
     */
    constructor(options: ChainOptions) {
        super();
        this.m_options = Object.create(options);
        this.m_logger = initLogger(options);

        this.m_initializePeerCount = options.initializePeerCount ? options.initializePeerCount : 1;
        this.m_headerReqLimit = options.headerReqLimit ? options.headerReqLimit : 2000;
        this.m_confirmDepth = options.confirmDepth ? options.confirmDepth : 6;
    }

    // 存储address入链的tx的最大nonce
    public static kvNonce: string = '__nonce'; // address<--->nonce
    public static kvUser: string = '__user';

    on(event: 'tipBlock', listener: (chain: Chain, block: BlockHeader) => void): this;
    on(event: string, listener: any): this  {
        return super.on(event, listener);
    }
    
    once(event: 'tipBlock', listener: (chain: Chain, block: Block) => void): this;
    once(event: string, listener: any): this {
        return super.on(event, listener);
    }   

    protected m_options: ChainOptions;
    private m_state: ChainState = ChainState.none;
    private m_tip?: BlockHeader;
    private m_db?: sqlite.Database;
    private m_headerStorage?: HeaderStorage;
    private m_blockStorage?: BlockStorage;
    private m_storageManager?: StorageManager;
    private m_pending?: PendingTransactions;
    protected m_logger: LoggerInstance;
    private m_pendingHeaders: Array<HeadersEventParams> = new Array();
    private m_pendingBlocks:{
        hashes: Set<string>
        sequence: Array<BlocksEventParams>
        adding?: BlocksEventParams
    }  = {
        hashes: new Set(),
        sequence: new Array()
    };
    private m_node?: ChainNode;
    protected m_callGetLock: Lock = new Lock();

    private s_dbFile: string = 'database';
    // 初始化时，一次请求的最大header数目
    private m_headerReqLimit: number; 
    // confirm数目，当块的depth超过这个值时，认为时绝对安全的；分叉超过这个depth的两个fork，无法自动合并回去
    private m_confirmDepth: number;
    // 初始化时，要同步的peer数目，与这个数目的peer完成同步之后，才开始接收tx，挖矿等等
    private m_initializePeerCount: number;
    
    protected m_connSyncMap: Map<string, SyncConnection> = new Map();


    get pending(): PendingTransactions {
        return this.m_pending!;
    }

    get storageManager(): StorageManager {
        return this.m_storageManager!;
    }

    get blockStorage(): BlockStorage {
        return this.m_blockStorage!;
    }

    get logger(): LoggerInstance {
        return this.m_logger;
    }

    get node(): ChainNode {
        return this.m_node!;
    }

    get peerid(): string {
        return this.m_node!.peerid;
    }

    get handler(): BaseHandler {
        return this.m_options.handler;
    }

    public async initComponents(): Promise<ErrorCode> {
        if (this.m_db) {
            return ErrorCode.RESULT_OK;
        }
        fs.mkdirpSync(this.m_options.dataDir);
        
        this.m_blockStorage = new BlockStorage({
            path: this.m_options.dataDir, 
            blockHeaderType: this._getBlockHeaderType(),
            transactionType: this._getTransactionType()});
        await this.m_blockStorage.init();

        this.m_db = await sqlite.open(this.m_options.dataDir + '/' + this.s_dbFile, { mode: sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE });
        this.m_headerStorage = new HeaderStorage({
            logger: this.m_logger,
            blockHeaderType: this._getBlockHeaderType(),
            db: this.m_db, 
            blockStorage: this.m_blockStorage!});

        let err;
        err = await this.m_headerStorage.init();
        if (err) {
            return err;
        }

        this.m_storageManager = new StorageManager({
            path: path.join(this.m_options.dataDir, 'storage'),
            storageType: SqliteStorage.Storage,
            logger: this.m_logger,
            headerStorage: this.m_headerStorage!,
            recycleHandler: async (blockHash: string): Promise<{err: ErrorCode, recycle?: boolean}> =>{
                return {err: ErrorCode.RESULT_OK, recycle: false};
            }
        });
        this.m_pending = new PendingTransactions({storageManager: this.m_storageManager,logger: this.m_logger});

        err = await this.m_storageManager.init();
        if (err) {
            return err;
        }

        this.m_node = new ChainNode({
            node: this.m_options.node,
            blockHeaderType: this._getBlockHeaderType(),
            transactionType: this._getTransactionType(),
            blockStorage: this.m_blockStorage!,
            headerStorage: this.m_headerStorage!,
            logger: this.m_logger,
            minOutbound: this.m_options.minOutbound,
            blockTimeout: this.m_options.blockTimeout,
            dataDir: this.m_options.dataDir
        });

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
        return ErrorCode.RESULT_OK;
    }

    public async initialize(): Promise<ErrorCode> {
        this.m_state = ChainState.syncing;
        let err = await this.initComponents();
        if (err) {
            return err;
        }
        err = await this._loadChain();
        if (err) {
            return err;
        }

        //init chainnode
        await this.m_node!.init();

        err = await this._initialBlockDownload();
        if (err) {
            return err;
        }
        err = await new Promise<ErrorCode>(async (resolve) => {
            this.prependOnceListener('tipBlock', ()=>{
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
        // TODO: 必须同步完成， 或者加上同步，或者去掉tipStorage，否则可能出现tipBlock和tipStorage 不一致的问题
        this.m_tip = tip;
        let err = await this.m_pending!.updateTipBlock(tip);
        if (err) {
            return err;
        }
        return ErrorCode.RESULT_OK;
    }

    get tipBlockHeader(): BlockHeader|undefined {
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
        //TODO: 广播要排除tx的来源 
        if (!err) {
            this.m_node!.broadcast([tx]);
        }
        return err;
    }


    protected async _compareWork(left: BlockHeader, right: BlockHeader): Promise<{err: ErrorCode, result?: number}> {
        // TODO: pow 用height并不安全， 因为大bits高height的工作量可能低于小bits低height 的工作量
        return {err: ErrorCode.RESULT_OK, result: left.number - right.number};
    }

    protected async _addPendingHeaders(params: HeadersEventParams) {
        // TODO: 这里可以和pending block一样优化，去重已经有的
        this.m_pendingHeaders.push(params);
        if (this.m_pendingHeaders.length === 1) {
            while (this.m_pendingHeaders.length) {
                let params = this.m_pendingHeaders[0];
                await this._addHeaders(params);
                this.m_pendingHeaders.shift();
            }
        }
    }

    protected async _addPendingBlocks(params: BlocksEventParams, head: boolean=false) {
        let pendingBlocks = this.m_pendingBlocks;
        if (pendingBlocks.hashes.has(params.block.hash)) {
            return ;
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
                let {block, remote, storage} = pendingBlocks.adding;
                await this._addBlock(block, {remote, storage});
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
                ++ hi;
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
                ++ bi;
            }
        }
    }

    protected _banConnection(remote: string|SyncConnection, level: BAN_LEVEL): ErrorCode {
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

    protected async _continueSyncWithConnection(from: string|SyncConnection): Promise<ErrorCode> {
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
            this.m_node!.requestHeaders(connSync.conn, {from: connSync.lastRecvHeader!.hash, limit: this.m_headerReqLimit});
        } else {
            connSync.state = ChainState.synced;
            delete connSync.moreHeaders;

            if (this.m_state === ChainState.syncing) {
                let syncedCount = 0;
                let out = this.m_node!.node.getOutbounds();
                for (let conn of out) {
                    let connSync = this.m_connSyncMap.get(conn.getRemote());
                    if (connSync && connSync.state === ChainState.synced) {
                        ++ syncedCount;
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

    protected _createSyncedConnection(from: string): {err: ErrorCode, connSync?: SyncConnection} {
        let conn = this.m_node!.node.getConnection(from);
        if (!conn) {
            return {err: ErrorCode.RESULT_NOT_FOUND};
        }
        let connSync = {state: ChainState.synced, conn};
        this.m_connSyncMap.set(from, connSync);
        return {err: ErrorCode.RESULT_OK, connSync};
    }

    protected _beginSyncWithConnection(from: string|SyncConnection, fromHeader: string): ErrorCode {
        let connSync;
        if (typeof from === 'string') {
            connSync = this.m_connSyncMap.get(from);
            if (!connSync) {
                let conn = this.m_node!.node.getConnection(from);
                if (!conn) {
                    return ErrorCode.RESULT_NOT_FOUND;
                }
                connSync = {state: ChainState.syncing, conn};
                this.m_connSyncMap.set(from, connSync);
            }
        } else {
            connSync = from;
        }
        connSync.state = ChainState.syncing;
        connSync.lastRequestHeader = fromHeader;
        this.m_node!.requestHeaders(connSync.conn, {from: fromHeader, limit: this.m_headerReqLimit});
        return ErrorCode.RESULT_OK;
    }

    protected async _verifyAndSaveHeaders(headers: BlockHeader[]): Promise<{err: ErrorCode, toRequest?: BlockHeader[]}> {
        assert(this.m_headerStorage);
        let hr = await this.m_headerStorage!.loadHeader(headers[0].preBlockHash);
        if (hr.err) {
            return {err: hr.err};
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
                    return {err: result.err};
                }
            } else if (result.verified === VERIFY_STATE.notVerified) {
                // 已经认证过的block就不要再请求了
                toRequest.push(header);
            }
        }
        toRequest.push(...toSave);
        
        assert(this.m_tip);
        for (let header of toSave) {
            let valid = await header.verify(this);
            if (!valid) {
                return {err: ErrorCode.RESULT_INVALID_BLOCK};
            }
            let err = await this.m_headerStorage!.saveHeader(header);
            if (err) {
                return {err};
            } 
        }

        return {err: ErrorCode.RESULT_OK, toRequest};
    }

    protected async _addHeaders(params: HeadersEventParams): Promise<ErrorCode> {
        let {remote, headers, request, error} = params;
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
                    this.m_logger.info(`get headers [${headers[0].hash}, ${headers[headers.length-1].hash}] from ${remote} at syncing`);
                    let vsh = await this._verifyAndSaveHeaders(headers);
                    // 找不到的header， 或者验证header出错， 都干掉
                    if (vsh.err === ErrorCode.RESULT_NOT_FOUND || vsh.err === ErrorCode.RESULT_INVALID_BLOCK) {
                        this._banConnection(remote,BAN_LEVEL.forever);
                        return ErrorCode.RESULT_OK;
                    } else if (vsh.err) {
                        // TODO：本地出错，可以重新请求？
                        return vsh.err;
                    }
                    connSync!.lastRecvHeader = headers[headers.length - 1];
                    connSync!.moreHeaders = (headers.length === this.m_headerReqLimit);
                    if (vsh.toRequest!.length) {
                        // 请求block
                        this.m_node!.requestBlocks({headers: vsh.toRequest!}, remote);
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
                    return this._beginSyncWithConnection(connSync, hsr.header!.hash);
                } else {
                    assert(false, `get header with syncing from ${remote} with err ${error}`);
                }
            } else if (!request) {
                // 广播来的直接忽略
            } else {
                this.m_logger.error(`invalid header request ${request} response when syncing with ${remote}`);
                this._banConnection(remote,BAN_LEVEL.forever);
            }
        } else if (connSync.state === ChainState.synced) {
            if (!request) {
                this.m_logger.info(`get headers [${headers[0].hash}, ${headers[headers.length-1].hash}] from ${remote} at synced`);
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
                    return this._beginSyncWithConnection(connSync, hsr.header!.hash);
                } else if (vsh.err) {
                    // TODO：本地出错，可以重新请求？
                    return vsh.err;
                }
                connSync!.lastRecvHeader = headers[headers.length - 1];
                this.m_node!.requestBlocks({headers: vsh.toRequest!}, remote);
            } else {
                // 不是广播来来的都不对
                this.m_logger.error(`invalid header request ${request} response when synced with ${remote}`);
                this._banConnection(remote, BAN_LEVEL.forever);
            }
        }
        
        return ErrorCode.RESULT_OK;
    }

    protected async _addBlock(block: Block, options: {remote?: string, storage?: StorageDumpSnapshot}): Promise<ErrorCode> {
        // try{
        assert(this.m_headerStorage);
        this.m_logger.info(`begin adding block number: ${block.number}  hash: ${block.hash} to chain `);
        let err = ErrorCode.RESULT_OK;

        if (options.storage) {
            //mine from local miner
            let err = await this._addVerifiedBlock(block, options.storage);
            if (err) {
                return err;
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
    
            let vbr = await this._verifyBlock(block);
            if (vbr.err) {
                this.m_logger.error(`add block failed for verify failed for ${vbr.err}`);
                return vbr.err;
            }
            if (!vbr.verified) {
                if (options.remote) {
                    this._banConnection(options.remote!, BAN_LEVEL.day);
                }
                let err = await this.m_headerStorage!.updateVerified(block.header, VERIFY_STATE.invalid);
                if (err) {
                    return err;
                }
            } else {
                let err = await this._addVerifiedBlock(block, vbr.storage!);
                if (err) {
                    return err;
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
                let hr = await this.getHeader(this.m_tip!, -this.m_confirmDepth);
                if (hr.err) {
                    return hr.err;
                }
                assert(hr.headers);
                if (hr.headers![0].number === 0) {
	                hr.headers = hr.headers!.slice(1);
                }
                this.m_node!.broadcast(hr.headers!, {filter: (conn: NodeConnection) => {return !broadcastExcept.has(conn.getRemote())}});
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
            let block = this.m_blockStorage!.get(result.header.hash);
            if (block) {
                this.m_logger.info(`next block hash ${result.header.hash} is ready`);
                this._addPendingBlocks({block}, true);
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

    public newBlockHeader(): BlockHeader {
        return this.m_node!.newBlockHeader();
    }

    public newBlock(header?: BlockHeader): Block {
        return this.m_node!.newBlock(header);
    }

    public async newBlockExecutor(block: Block, storage: Storage): Promise<{err: ErrorCode, executor?: BlockExecutor}> {
        let executor = new BlockExecutor({block, storage, handler: this.m_options.handler, externContext: {}});
        return {err: ErrorCode.RESULT_OK, executor};
    }

    public async newViewExecutor(header: BlockHeader, storage: IReadableStorage, method: string, param: any): Promise<{err: ErrorCode, executor?: ViewExecutor}> {
        let executor = new ViewExecutor({header, storage, method, param, handler: this.m_options.handler, externContext: {}});
        return {err: ErrorCode.RESULT_OK, executor};
    }

    public async getHeader(arg1: any, arg2?: any): Promise<{err: ErrorCode, header?: BlockHeader, headers?: BlockHeader[]}> {
        return await this.m_node!.getHeader(arg1, arg2);    
    }

    protected async _initialBlockDownload(): Promise<ErrorCode> {
        assert(this.m_node);
        let err = await this.m_node!.initialOutbounds();
        if (err) {
            if (err === ErrorCode.RESULT_SKIPPED) {
                this.m_state = ChainState.synced;
                setImmediate(()=>{this.emit('tipBlock', this, this.m_tip!);});
                return ErrorCode.RESULT_OK;
            } 
            return err;
        }
        this.m_node!.on('outbound', async (conn: NodeConnection)=>{
            let syncPeer = conn;
            assert(syncPeer);
            let hr = await this.m_headerStorage!.loadHeader((this.m_tip!.number>this.m_confirmDepth)?(this.m_tip!.number-this.m_confirmDepth):0);
            if (hr.err) {
                return hr.err;
            }
            assert(hr.header);
            return this._beginSyncWithConnection(conn.getRemote(), hr.header!.hash);
        });
        
        return ErrorCode.RESULT_OK;
    }   

    protected async _verifyBlock(block: Block): Promise<{ err: ErrorCode, verified?: boolean, storage?: StorageDumpSnapshot }> {
        this.m_logger.info(`begin verify block number: ${block.number} hash: ${block.hash} `);
        let sr = await this.m_storageManager!.createStorage('verify', block.header.preBlockHash);
        if (sr.err) {
            this.m_logger.warn(`verify block failed for recover storage to previous block's failed for ${sr.err}`);
            return { err: sr.err };
        }
        let result;
        do {
            let nber = await this.newBlockExecutor(block, sr.storage!);
            if (nber.err) {
                result = {err: nber.err};
                break;
            }
            let vr = await nber.executor!.verify();
            if (vr.err) {
                result = {err: vr.err};
                break;
            }
            if (vr.valid) {
                this.m_logger.info(`block verified`);
                let csr = await this.m_storageManager!.createSnapshot(sr.storage!, block.hash);
                if (csr.err) {
                    result = {err: csr.err};
                } else {
                    result = { err: ErrorCode.RESULT_OK, verified: true, storage: csr.snapshot! };
                }
            } else {
                this.m_logger.info(`block invalid`);
                result = { err: ErrorCode.RESULT_OK, verified: false };
            }
            
            await nber.executor!.uninit();
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
            this._addPendingBlocks({block, storage});
        }
    }

    public async create(genesis: Block, storage: StorageDumpSnapshot): Promise<ErrorCode> {
        // assert(genesis.header.storageHash === (await storage.messageDigest()).value);
        assert(genesis.number === 0);
        if (genesis.number !== 0) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        let err = await this.initComponents();
        if (err) {
            return err;
        }
        let ret = await this.getHeader(0);
        if (ret.err === ErrorCode.RESULT_OK && ret.header) {
            return ErrorCode.RESULT_OK;
        }
        assert(this.m_headerStorage && this.m_blockStorage);
        this.m_blockStorage!.add(genesis);
        return await this.m_headerStorage!.createGenesis(genesis.header);
    }

    public async callGet<T>(arg: string | number | 'latest', methodname: string, param: any): Promise<{ err: ErrorCode, value?: T | null }> {
        let retInfo: any = { err: ErrorCode.RESULT_FAILED };
        await this.m_callGetLock.enter();
        let storageView: IReadableStorage|undefined;
        while (true) {
            let hr = await this.getHeader(arg);
            if (hr.err !== ErrorCode.RESULT_OK) {
                retInfo = { err: hr.err };
                break;
            }
            let header = hr.header!;
            let svr = await this.m_storageManager!.getSnapshotView(header.hash);
            if (svr.err !== ErrorCode.RESULT_OK) {
                retInfo = { err: svr.err };
                break;
            }
            storageView = svr.storage!;

            let nver = await this.newViewExecutor(header, storageView, methodname, param);
            if (nver.err) {
                retInfo = {err: nver.err};
                this.m_storageManager!.releaseSnapshotView(header.hash);
                break;
            }
            let ret1 = await nver.executor!.execute();
            this.m_storageManager!.releaseSnapshotView(header.hash);
            if (ret1.err === ErrorCode.RESULT_OK) {
                retInfo = { err: ErrorCode.RESULT_OK, value: ret1.value as T };
                break;
            }
            retInfo = { err: ret1.err };
            break;
        }
        await this.m_callGetLock.leave();
        return retInfo;
    }

    public async getNonce(s: string) {
        return await this.m_pending!.getStorageNonce(s);
    }

    public async getTransaction(s: string): Promise<{err: ErrorCode, tx?: {blocknumber: Number, blockhash: string, nonce: number}}> {
        let ret = await this.m_headerStorage!.txview.get(s);
        if (ret.err !== ErrorCode.RESULT_OK) {
            return { err: ret.err };
        }

        let block = this.getBlock(ret.blockhash!);
        if (!block) {
            return { err: ErrorCode.RESULT_NOT_FOUND };
        }

        let tx: Transaction | null = block.content.getTransaction(s);
        if (tx) {
            return { err: ErrorCode.RESULT_OK, tx: { blocknumber: block.header.number, blockhash: block.header.hash, nonce: tx.nonce } };
        }
        
        return {err: ErrorCode.RESULT_NOT_FOUND};
    }

    public async getTransactionReceipt(s: string): Promise<{err: ErrorCode, receipt?: Receipt}>  {
        let ret = await this.m_headerStorage!.txview.get(s);
        if (ret.err !== ErrorCode.RESULT_OK) {
            return { err: ret.err };
        }

        let block = this.getBlock(ret.blockhash!);
        if (!block) {
            return { err: ErrorCode.RESULT_NOT_FOUND };
        }

        let receipt: Receipt | undefined = block.content.getReceipt(s);
        if (receipt) {
            return { err: ErrorCode.RESULT_OK, receipt: receipt };
        }

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
