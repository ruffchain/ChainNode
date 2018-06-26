import * as assert from 'assert';
import {EventEmitter} from 'events';

import {ErrorCode} from '../error_code';
import {LoggerInstance, initLogger, LoggerOptions} from '../lib/logger_util';

import {Transaction} from './transaction';
import {BlockContent, BlockHeader, Block} from './block';
import { BlockStorage } from './block_storage';
import { VERIFY_STATE, HeaderStorage } from './header_storage';

import { BufferReader } from '../lib/reader';
import { BufferWriter } from '../lib/writer';
import {INode, NodeConnection, PackageStreamWriter, Package, CMD_TYPE} from '../net/node';
import { hash } from '../lib/digest';
import { StorageDumpSnapshot } from '../storage/dump_snapshot';
import {NodeStorage,NodeStorageOptions} from './node_storage';

export enum SYNC_CMD_TYPE {
    getHeader = CMD_TYPE.userCmd + 0,
    header = CMD_TYPE.userCmd + 1,
    getBlock = CMD_TYPE.userCmd + 2,
    block = CMD_TYPE.userCmd + 3,
    tx = CMD_TYPE.userCmd + 5
}


export type ChainNodeOptions = {
    node: INode;
    initBlockWnd?: number;
    blockTimeout?: number;
    headersTimeout?: number;
    minOutbound?: number;
    nodeCacheSize?: number;
    dataDir: string;
}


type RequestingBlockConnection = {
    hashes: Set<string>, 
    wnd: number, 
    conn: NodeConnection
}


export type HeadersEventParams = {
    remote: string;
    headers: BlockHeader[]; 
    request: any;
    error: ErrorCode;
};

export type BlocksEventParams = {
    remote?: string;
    block: Block;
    storage?: StorageDumpSnapshot;
};

export enum BAN_LEVEL {
    minute = 1,
    hour = 60,
    day = 24*60,
    month = 30*24*60,
    forever=0,
}

export class ChainNode extends EventEmitter {
    constructor(options: ChainNodeOptions & {
        blockHeaderType: new () => BlockHeader;
        transactionType: new () => Transaction;
        blockStorage: BlockStorage, 
        headerStorage: HeaderStorage, 
        logger: LoggerInstance}) {
        super();
        this.m_node = options.node;
        this.m_blockStorage = options.blockStorage;
        this.m_headerStorage = options.headerStorage;
        this.m_blockHeaderType = options.blockHeaderType;
        this.m_transactionType = options.transactionType;
        this.m_logger = options.logger;

        this.m_minOutbound = options.minOutbound ? options.minOutbound : 8;
        this.m_initBlockWnd = options.initBlockWnd ? options.initBlockWnd : 10;
        this.m_node.on('error', (conn: NodeConnection, err: ErrorCode) => {
            this._onConnectionError(conn.getRemote());
        });
        this.m_blockTimeout = options.blockTimeout ? options.blockTimeout : 10000;
        this.m_headersTimeout = options.headersTimeout ? options.headersTimeout : 30000;
        this.m_reqTimeoutTimer = setInterval(()=>{
            this._onReqTimeoutTimer(Date.now() / 1000);
        }, 1000);
        this.m_nodeStorage = new NodeStorage({
            count: options.nodeCacheSize? options.nodeCacheSize : 50, 
            dataDir: options.dataDir, 
            logger: this.m_logger});
    }
    private m_node: INode;
    private m_headerStorage: HeaderStorage;
    private m_blockStorage: BlockStorage;
    private m_blockHeaderType: new () => BlockHeader;
    private m_transactionType: new () => Transaction;
    private m_logger: LoggerInstance;
    private m_minOutbound: number;
    private m_connectingCount: number = 0;
    private m_connectingPeerids: string[] = [];
    private m_checkOutboundTimer: any;
    private m_nodeStorage: NodeStorage;


    on(event: 'blocks', listener: (params: BlocksEventParams) => any): this;
    on(event: 'headers', listener: (params: HeadersEventParams) => any): this;
    on(event: 'transactions', listener: (conn: NodeConnection, tx: Transaction[]) => any): this;
    on(event: 'ban', listener: (remote: string) => any): this;
    on(event: 'outbound', listener: (conn: NodeConnection) => any): this;
    on(event: string, listener: any): this {
        return super.on(event, listener);
    }

    once(event: 'blocks', listener: (params: BlocksEventParams) => any): this;
    once(event: 'headers', listener: (params: HeadersEventParams) => any): this;
    once(event: 'transactions', listener: (conn: NodeConnection, tx: Transaction[]) => any): this;
    once(event: 'ban', listener: (remote: string) => any): this;
    once(event: 'outbound', listener: (conn: NodeConnection) => any): this;
    once(event: string, listener: any): this {
        return super.on(event, listener);
    }   

    public async init() {
        await this.m_node.init();
    }

    public get node(): INode {
        return this.m_node;
    }

    public get peerid(): string {
        return this.m_node.peerid;
    }

    public async initialOutbounds(): Promise<ErrorCode> {
        let err = await this._newOutbounds(this.m_minOutbound);
        if (err) {
            return err;
        }
        this.m_checkOutboundTimer = setInterval(()=>{
            let next = this.m_minOutbound - (this.m_connectingCount + this.m_node.getOutbounds().length);
            if (next > 0) {
                this._newOutbounds(next);
            }
        }, 1000);
        return ErrorCode.RESULT_OK;
    }

    protected async _newOutbounds(count: number, callback?: (count: number) => void): Promise<ErrorCode> {
        let willConnPeerids: string[] = [];

        let canUse: (peerid: string)=>boolean = (peerid: string): boolean => {
            if (this.m_nodeStorage.isBan(peerid)) {
                return false;
            }

            let outConns: NodeConnection[] = this.m_node.getOutbounds();
            for (let outConn of outConns) {
                if (outConn.getRemote() === peerid) {
                    return false;
                }
            }

            for (let pid of this.m_connectingPeerids) {
                if (pid === peerid) {
                    return false;
                }
            }
            for (let pid of willConnPeerids) {
                return false;
            }

            return true;
        }
        let peerids: string[] = this.m_nodeStorage.get('all');
        for (let pid of peerids) {
            if (canUse(pid)) {
                willConnPeerids.push(pid);
                if (willConnPeerids.length === count) {
                    break;
                }
            }
        }
        if (willConnPeerids.length < count) {
            let result = await this.m_node.randomPeers(count);
            if (result.err === ErrorCode.RESULT_OK) {
                for (let pid of result.peers) {
                    if (canUse(pid)) {
                        willConnPeerids.push(pid);
                        if (willConnPeerids.length === count) {
                            break;
                        }
                    }
                }
            } else {
                return result.err;
            }
        }
        if (willConnPeerids.length === 0) {
            return ErrorCode.RESULT_OK;
        }
 
        this.m_connectingCount += willConnPeerids.length;
        let ops = [];
        for (let peer of willConnPeerids) {
            this.m_connectingPeerids.push(peer);
            ops.push(this.m_node.connectTo(peer));
        }
        let deleteFrom: (pid: string, pidArray: string[])=>void = (pid: string, pidArray: string[]) => {
            for (let i=0; i< pidArray.length; i++) {
                if (pidArray[i] === pid) {
                    pidArray.splice(i, 1);
                    return;
                }
            }
        }
        Promise.all(ops).then((results)=>{
            this.m_connectingCount -= willConnPeerids.length;
            let connCount = 0;
            for (let r of results) {
                deleteFrom(r.peerid, this.m_connectingPeerids);
                if (r.conn) {
                    this.m_nodeStorage.add(r.conn.getRemote());
                    this._beginSyncWithNode(r.conn);
                    this.emit('outbound', r.conn);
                    ++ connCount;
                } else {
                    this.m_nodeStorage.remove(r.peerid);
                    if (r.err === ErrorCode.RESULT_VER_NOT_SUPPORT) {
                        this.m_nodeStorage.ban(r.peerid, BAN_LEVEL.month);
                    } else {
                        //禁用1分钟，防止random的时候又找到它
                        this.m_nodeStorage.ban(r.peerid, BAN_LEVEL.minute);
                    }
                }
            }
            if (callback) {
                callback(connCount);
            }
        });
        return ErrorCode.RESULT_OK;
    }

    public async listen(): Promise<ErrorCode> {
        this.m_node.on('inbound', (inbound: NodeConnection)=>{
            if (this.m_nodeStorage.isBan(inbound.getRemote())) {
                this.m_node.closeConnection(inbound);
            } else {
                this._beginSyncWithNode(inbound);
            }
        });
        return await this.m_node.listen();
    }

    
    public broadcast(content: BlockHeader[]|Transaction[], options?: {count?: number, filter?: (conn: NodeConnection) => boolean}): ErrorCode {
        if (!content.length) {
            return ErrorCode.RESULT_OK;
        }
        let pwriter: PackageStreamWriter|undefined;
        if (content[0] instanceof BlockHeader) {
            let hwriter = new BufferWriter();
            for (let header of content) {
                header.encode(hwriter);
            }
            let raw = hwriter.render();
            pwriter = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.header, {count: content.length}, raw.length);
            pwriter.writeData(raw);
        } else if (content[0] instanceof Transaction) {
            let hwriter = new BufferWriter();
            for (let tx of content) {
                tx.encode(hwriter);
            }
            let raw = hwriter.render();
            pwriter = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.tx, {count: content.length}, raw.length);
            pwriter.writeData(raw);
        }
        assert(pwriter);
        this.m_node.broadcast(pwriter!, options);
        return ErrorCode.RESULT_OK;
    }


    protected _beginSyncWithNode(conn: NodeConnection) {
        // TODO: node 层也要做封禁，比如发送无法解析的pkg， 过大， 过频繁的请求等等
        conn.on('pkg', async (pkg: Package) => {
            if (pkg.header.cmdType === SYNC_CMD_TYPE.tx) {
                let buffer = pkg.copyData();
                let txReader = new BufferReader(buffer);
                let txes: Transaction[] = [];
                let err = ErrorCode.RESULT_OK;
                for (let ix = 0; ix < pkg.body.count; ++ix) {
                    let tx = this.newTransaction();
                    if (tx.decode(txReader) !== ErrorCode.RESULT_OK) {
                        err = ErrorCode.RESULT_INVALID_PARAM;
                        break;
                    }
                    if (!tx.verifySignature()) {
                        err = ErrorCode.RESULT_INVALID_TOKEN;
                        break;
                    }
                    txes.push(tx);
                }
                if (err) {
                    this.banConnection(conn.getRemote(), BAN_LEVEL.forever);
                } else {
                    if (txes.length) {
                        this.emit('transactions', conn, txes);
                    }
                }
            } else if (pkg.header.cmdType === SYNC_CMD_TYPE.header) {
                let time = Date.now() / 1000;
                let buffer = pkg.copyData();
                let headerReader = new BufferReader(buffer);
                let headers = [];
                if (!pkg.body.error) {
                    let err = ErrorCode.RESULT_OK;
                    let preHeader: BlockHeader|undefined;
                    for (let ix = 0; ix < pkg.body.count; ++ix) {
                        let header = this.newBlockHeader();
                        if (header.decode(headerReader) !== ErrorCode.RESULT_OK) {
                            err = ErrorCode.RESULT_INVALID_BLOCK;
                            break;
                        }
                        if (!pkg.body.request || pkg.body.request.from) {
                            // 广播或者用from请求的header必须连续
                            if (preHeader) {
                                if (!preHeader.isPreBlock(header)) {
                                    err = ErrorCode.RESULT_INVALID_BLOCK;
                                    break;
                                }
                            }
                            preHeader = header;
                        }
                        headers.push(header); 
                    }
                    if (err) {
                        // 发错的header的peer怎么处理
                        this.banConnection(conn.getRemote(), BAN_LEVEL.forever);
                        return;
                    }
                    // 用from请求的返回的第一个跟from不一致
                    if (headers.length && pkg.body.request && headers[0].preBlockHash !== pkg.body.request.from) {
                        this.banConnection(conn.getRemote(), BAN_LEVEL.forever);
                        return;
                    }
                    // 任何返回 gensis 的都不对
                    if (headers.length) {
                        if (headers[0].number === 0) {
                            this.banConnection(conn.getRemote(), BAN_LEVEL.forever);
                            return;
                        }
                    }
                } else if (pkg.body.error === ErrorCode.RESULT_NOT_FOUND) {
                    let ghr = await this.m_headerStorage!.loadHeader(0);
                    if (ghr.err) {
                        return;
                    }
                    // from用gensis请求的返回没有
                    if (pkg.body.request && pkg.body.request.from === ghr.header!.hash) {
                        this.banConnection(conn.getRemote(), BAN_LEVEL.forever);
                        return ;
                    }
                }

                if (!this._onRecvHeaders(conn.getRemote(), time, pkg.body.request)) {
                    return ;
                }
                this.emit('headers', {remote: conn.getRemote(), headers, request: pkg.body.request, error: pkg.body.error});
            } else if (pkg.header.cmdType === SYNC_CMD_TYPE.getHeader) {
                this._responseHeaders(conn, pkg.body);
            } else if (pkg.header.cmdType === SYNC_CMD_TYPE.block) {
                let buffer = pkg.copyData();
                let blockReader = new BufferReader(buffer);
                let blocks = [];
                if (pkg.body.err === ErrorCode.RESULT_NOT_FOUND) {
                    // 请求的block肯定已经从header里面确定remote有，直接禁掉
                    this.banConnection(conn.getRemote(), BAN_LEVEL.forever);
                    return ;
                }
                let block = this.newBlock();
                if (block.decode(blockReader) !== ErrorCode.RESULT_OK) {
                    // TODO: 发坏的peer咋处理
                    this.banConnection(conn.getRemote(), BAN_LEVEL.forever);
                    return;
                }
                if (!block.verify()) {
                    // TODO: 发坏的peer咋处理 
                    this.banConnection(conn.getRemote(), BAN_LEVEL.day); //可能分叉？
                    return;
                }
                let err = this._onRecvBlock(block, conn.getRemote());
                if (err) {
                    return ;
                }
                this.emit('blocks', {remote: conn.getRemote(), block});
            } else if (pkg.header.cmdType === SYNC_CMD_TYPE.getBlock) {
                this._responseBlocks(conn, pkg.body);
            }
        });
    }


    public requestHeaders(from: NodeConnection|string, options: {from?: string, limit?: number}): ErrorCode {
        let conn;
        if (typeof from === 'string') {
            let connRequesting = this._getConnRequesting(from);
            if (!connRequesting) {
                return ErrorCode.RESULT_NOT_FOUND;
            }
            conn = connRequesting.conn;
        } else {
            conn = from;
        }
        if (this.m_requestingHeaders.get(conn.getRemote())) {
            this.m_logger.warn(`request headers ${options} from ${conn.getRemote()} skipped for former headers request existing`);
            return ErrorCode.RESULT_ALREADY_EXIST;
        }
        this.m_requestingHeaders.set(conn.getRemote(), {
            time: Date.now() / 1000,
            req: Object.assign(Object.create(null), options)
        });
        let writer = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.getHeader, options);
        conn.addPendingWriter(writer);
        return ErrorCode.RESULT_OK;
    }

    // 这里必须实现成同步的
    public requestBlocks(options: {headers?: BlockHeader[]}, from: string): ErrorCode {
        let connRequesting = this._getConnRequesting(from);
        if (!connRequesting) {
            return ErrorCode.RESULT_NOT_FOUND;
        }
        let requests: string[] = [];
        let addRequesting = (header: BlockHeader): boolean => {
            if (this.m_blockStorage.has(header.hash)) {
                let block = this.m_blockStorage.get(header.hash);
                setImmediate(()=>{this.emit('blocks', {block})});
                return false;
            }
            let sources = this.m_blockFromMap.get(header.hash);
            if (!sources) {
                sources = new Set();
                this.m_blockFromMap.set(header.hash, sources);
            } 
            if (sources.has(from)) {
                return false;
            }
            sources.add(from);
            if (this.m_requestingBlock.hashMap.has(header.hash)) {
                return false;
            }
            requests.push(header.hash);
            return true;
        }
        
        if (options.headers) {
            for (let header of options.headers) {
                addRequesting(header);
            }
        } else {
            assert(false, `invalid block request ${options}`);
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        
        for (let hash of requests) {
            if (connRequesting.wnd - connRequesting.hashes.size > 0) {
                this._requestBlockFromConnection(hash, connRequesting);
                if (this.m_pendingBlock.hashes.has(hash)) {
                    this.m_pendingBlock.hashes.delete(hash);
                    this.m_pendingBlock.sequence.splice(this.m_pendingBlock.sequence.indexOf(hash), 1);
                }
            } else if (!this.m_pendingBlock.hashes.has(hash)) {
                this.m_pendingBlock.hashes.add(hash);
                this.m_pendingBlock.sequence.push(hash);
            }
        }
        return ErrorCode.RESULT_OK;
    }

    public banConnection(remote: string, level: BAN_LEVEL) {
        this.m_nodeStorage.ban(remote, level);
        this.m_node.banConnection(remote);
        this._onRemoveConnection(remote);
        this.emit('ban', remote);
    }
    

    protected m_initBlockWnd: number;
    protected m_requestingBlock: {
        connMap: Map<string, RequestingBlockConnection>,
        hashMap: Map<string, {from: string, time: number}>
     } = {
         connMap: new Map(),
         hashMap: new Map()
     };
    protected m_pendingBlock: {hashes: Set<string>, sequence: Array<string>} = {hashes: new Set(), sequence: new Array()};
    protected m_blockFromMap: Map<string, Set<string>> = new Map(); 
    protected m_requestingHeaders: Map<string, {
        time: number;
        req: any;
    }> = new Map();
    protected m_reqTimeoutTimer: any;
    protected m_blockTimeout: number;
    protected m_headersTimeout: number;

    protected m_cc = {
        onRecvBlock(node: ChainNode, block: Block, from: RequestingBlockConnection) {
            from.wnd += 1; 
            from.wnd > 3 * node.m_initBlockWnd ? 3 * node.m_initBlockWnd : from.wnd;
        },
        onBlockTimeout(node: ChainNode, hash: string, from: RequestingBlockConnection) {
            from.wnd = Math.floor(from.wnd / 2);
        }
    };

    protected _getConnRequesting(remote: string): RequestingBlockConnection|undefined  {
        let connRequesting = this.m_requestingBlock.connMap.get(remote);
        if (!connRequesting) {
            let conn = this.m_node.getConnection(remote);
            // TODO: 取不到这个conn的时候要处理
            assert(conn, `no connection to ${remote}`);
            if (!conn) {
                return ;
            }
            connRequesting =  {hashes: new Set(), wnd: this.m_initBlockWnd, conn: conn!};
            this.m_requestingBlock.connMap.set(remote, connRequesting);
        }
        return connRequesting;
    }

    protected _requestBlockFromConnection(hash: string, from: string|RequestingBlockConnection): ErrorCode {
        let connRequesting;
        if (typeof from === 'string') {
            connRequesting = this._getConnRequesting(from);
            if (!connRequesting) {
                return ErrorCode.RESULT_NOT_FOUND;
            }
        } else {
            connRequesting = from;
        }
        this.m_logger.debug(`request block ${hash} from ${connRequesting.conn.getRemote()}`);
        let writer = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.getBlock, { hash });
        connRequesting.conn.addPendingWriter(writer);
        connRequesting.hashes.add(hash);
        this.m_requestingBlock.hashMap.set(hash, {from: connRequesting.conn.getRemote(), time: Date.now() / 1000});
        return ErrorCode.RESULT_OK;
    }

    protected _onFreeBlockWnd(connRequesting: RequestingBlockConnection) {
        let pending = this.m_pendingBlock;
        let index = 0;
        do {
            if (!pending.sequence.length) {
                break;
            }
            let hash = pending.sequence[index];
            let sources = this.m_blockFromMap.get(hash);
            assert(sources, `to request block ${hash} from unknown source`);
            if (!sources) {
                return ErrorCode.RESULT_EXCEPTION;
            }
            if (sources.has(connRequesting.conn.getRemote())) {
                this._requestBlockFromConnection(hash, connRequesting);
                pending.sequence.splice(index, 1);
                pending.hashes.delete(hash);
                if (connRequesting.wnd <= connRequesting.hashes.size) {
                    break;
                } else {
                    continue;
                }
            } 
            ++index;
        } while (true);
    }

    protected _onRecvHeaders(from: string, time: number, request?: any): boolean {
        let valid = true;
        if (request) {
            // 返回没有请求过的headers， 要干掉
            let rh = this.m_requestingHeaders.get(from);
            if (rh) {
                for (let key of Object.keys(request)) {
                    if (request![key] !== rh.req[key]) {
                        valid = false;
                        break;
                    }
                }
            } else {
                valid = false;
            }

            if (valid) {
                this.m_requestingHeaders.delete(from);
            }
        } else {
            // TODO: 过频繁的广播header, 要干掉
        }
        if (!valid) {
            this.banConnection(from, BAN_LEVEL.forever);
        }
        return valid;
    }

    protected _onRecvBlock(block: Block, from: string): ErrorCode {
        let stub = this.m_requestingBlock.hashMap.get(block.hash);
        assert(stub, `recv block ${block.hash} from ${from} that never request`);
        if (!stub) {
            this.banConnection(from, BAN_LEVEL.day);
            return ErrorCode.RESULT_INVALID_BLOCK;
        }
        this.m_logger.debug(`recv block hash: ${block.hash} number: ${block.number} from ${from}`);
        this.m_blockStorage!.add(block);
        assert(stub!.from === from, `request ${block.hash} from ${stub!.from} while recv from ${from}`);
        this.m_requestingBlock.hashMap.delete(block.hash);
        let connRequesting = this.m_requestingBlock.connMap.get(stub!.from);
        assert(connRequesting, `requesting info on ${stub!.from} missed`);
        if (!connRequesting) {
            return ErrorCode.RESULT_EXCEPTION;
        }
        connRequesting.hashes.delete(block.hash);
        this.m_blockFromMap.delete(block.hash);
        this.m_cc.onRecvBlock(this, block, connRequesting);
        this._onFreeBlockWnd(connRequesting);
        return ErrorCode.RESULT_OK;
    }

    protected _onConnectionError(remote: string) {
        this._onRemoveConnection(remote);
    }

    protected _onRemoveConnection(remote: string) {
        let connRequesting = this.m_requestingBlock.connMap.get(remote);
        if (connRequesting) {
            let toPending = new Array();
            for (let hash of connRequesting.hashes) {
                this.m_pendingBlock.hashes.add(hash);   
                toPending.push(hash);
                this.m_requestingBlock.hashMap.delete(hash);
            }
            this.m_pendingBlock.sequence.unshift(...toPending);
        }
        this.m_requestingBlock.connMap.delete(remote);
        for (let hash of this.m_blockFromMap.keys()) {
            let sources = this.m_blockFromMap.get(hash)!;
            if (sources.has(remote)) {
                sources.delete(remote);
                if (!sources.size) {
                    this.m_pendingBlock.sequence.splice(this.m_pendingBlock.sequence.indexOf(hash), 1);
                } else {
                    for (let from of sources) {
                        let fromRequesting = this.m_requestingBlock.connMap.get(from);
                        assert(fromRequesting, `block requesting connection ${from} not exists`);
                        if (fromRequesting!.hashes.size < fromRequesting!.wnd) {
                            this._requestBlockFromConnection(hash, fromRequesting!);
                        }
                    }
                }
            }
        }
        this.m_requestingHeaders.delete(remote);
    }

    protected _onReqTimeoutTimer(now: number) {
        for (let hash of this.m_requestingBlock.hashMap.keys()) {
            let stub = this.m_requestingBlock.hashMap.get(hash)!;
            let fromRequesting = this.m_requestingBlock.connMap.get(stub.from)!;
            if (now - stub.time > this.m_blockTimeout) {
                this.m_cc.onBlockTimeout(this, hash, fromRequesting);
                // close it 
                if (fromRequesting.wnd < 1) {
                    this.banConnection(stub.from, BAN_LEVEL.hour);
                }
            }
        }
        // 返回headers超时
        for (let remote of this.m_requestingHeaders.keys()) {
            let rh = this.m_requestingHeaders.get(remote)!;
            if (now - rh.time > this.m_headersTimeout) {
                this.banConnection(remote, BAN_LEVEL.hour);
            }
        }
    }

    public newTransaction(): Transaction {
        return new this.m_transactionType();
    }

    public newBlockHeader(): BlockHeader {
        return new this.m_blockHeaderType();
    }

    public newBlock(header?: BlockHeader): Block {
        let block = new Block({
            header,
            headerType: this.m_blockHeaderType, 
            transactionType: this.m_transactionType});
        return block;
    }

    protected async _responseBlocks(conn: NodeConnection, req: any): Promise<ErrorCode> {
        assert(this.m_headerStorage);
        assert(this.m_blockStorage);
        this.m_logger.info(`receive block request from ${conn.getRemote()} with ${JSON.stringify(req)}`);
        let bwriter = new BufferWriter();
        let block = this.m_blockStorage!.get(req.hash);
        if (!block) {
            this.m_logger.crit(`cannot get Block ${req.hash} from blockStorage`);
            assert(false, `${this.m_node.peerid} cannot get Block ${req.hash} from blockStorage`);
            return ErrorCode.RESULT_OK;
        }
        block.encode(bwriter);
        let rawBlocks = bwriter.render();
        let pwriter = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.block, null, rawBlocks.length);
        conn.addPendingWriter(pwriter);
        pwriter.writeData(rawBlocks);
        return ErrorCode.RESULT_OK;
    }


    public async getHeader(arg1: string|number|'latest'): Promise<{err: ErrorCode, header?: BlockHeader}>;
    public async getHeader(arg1: string|BlockHeader, arg2: number): Promise<{err: ErrorCode, header?: BlockHeader, headers?: BlockHeader[]}>;
    public async getHeader(arg1: string|number|'latest'|BlockHeader, arg2?: number): Promise<{err: ErrorCode, header?: BlockHeader, headers?: BlockHeader[]}> {
        let header: BlockHeader|undefined;
        assert(this.m_headerStorage);
        if (arg2 === undefined || arg2 === undefined) {
            if (arg1 instanceof BlockHeader) {
                assert(false);
                return {err: ErrorCode.RESULT_INVALID_PARAM};
            }
            return await this.m_headerStorage!.loadHeader(arg1);
        } else {
            let fromHeader: BlockHeader;
            if (arg1 instanceof BlockHeader) {
                fromHeader = arg1;
            } else {
                let hr = await this.m_headerStorage!.loadHeader(arg1);
                if (hr.err) {
                    return hr;
                }
                fromHeader = hr.header!;
            }
            let headers: BlockHeader[] = []; 
            headers.push(fromHeader);
            if (arg2 > 0) {
                assert(false);
                return {err: ErrorCode.RESULT_INVALID_PARAM};
            } else {
                if (fromHeader.number + arg2 < 0) {
                    arg2 = -fromHeader.number;
                }
                for (let ix = 0; ix < -arg2; ++ix) {
                    let hr = await this.m_headerStorage!.loadHeader(fromHeader.preBlockHash);
                    if (hr.err) {
                        return hr;
                    }
                    fromHeader = hr.header!;
                    headers.push(fromHeader);
                }
                headers = headers.reverse();
                return {err: ErrorCode.RESULT_OK, header: headers[0], headers};
            }
        }
    }

    protected async _responseHeaders(conn: NodeConnection, req: any): Promise<ErrorCode> {
        assert(this.m_headerStorage);
        this.m_logger.info(`receive header request from ${conn.getRemote()} with ${JSON.stringify(req)}`);
        if (req.from) {
            let hwriter = new BufferWriter();
            let respErr = ErrorCode.RESULT_OK;
            let headerCount = 0;
            do {
                let tipResult = await this.m_headerStorage.loadHeader('latest');
                if (tipResult.err) {
                    return tipResult.err;
                }
                let heightResult = await this.m_headerStorage!.getHeightOnBest(req.from);
                if (heightResult.err === ErrorCode.RESULT_NOT_FOUND) {
                    respErr = ErrorCode.RESULT_NOT_FOUND;
                    break;
                }
                assert(tipResult.header);
                if (tipResult.header!.hash === req.from) {
                    // 没有更多了
                    respErr = ErrorCode.RESULT_SKIPPED;
                    break;
                }
     
                if (!req.limit || heightResult.height! + req.limit > tipResult.header!.number) {
                    headerCount = tipResult.header!.number - heightResult.height!;
                } else {
                    headerCount = req.limit;
                }
                
                let hr = await this.getHeader(heightResult.height! + headerCount);
                if (hr.err) {
                    // 中间changeBest了，返回not found
                    if (hr.err === ErrorCode.RESULT_NOT_FOUND) {
                        respErr = ErrorCode.RESULT_NOT_FOUND;
                        break;
                    } else {
                        return hr.err;
                    }
                }

                let hsr = await this.getHeader(hr.header!.hash, -headerCount + 1);
                if (hsr.err) {
                    return hsr.err;
                }
                if (hsr.headers![0].preBlockHash !== req.from) {
                    // 中间changeBest了，返回not found
                    respErr = ErrorCode.RESULT_NOT_FOUND;
                    break;
                }
                for (let h of hsr.headers!) {
                    h.encode(hwriter);
                }
            } while (false);
            
            let rawHeaders = hwriter.render();
            let pwriter = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.header, {count: headerCount, request: req, error: respErr}, rawHeaders.length);
            conn.addPendingWriter(pwriter);
            pwriter.writeData(rawHeaders);
            return ErrorCode.RESULT_OK;
        } else {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
    }
    
}