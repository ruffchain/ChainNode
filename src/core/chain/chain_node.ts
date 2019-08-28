import * as assert from 'assert';
import { EventEmitter } from 'events';
import { isString, isNullOrUndefined } from 'util';
import { ErrorCode } from '../error_code';
import { LoggerInstance, } from '../lib/logger_util';
import { StorageManager, StorageLogger, StorageDumpSnapshot, JStorageLogger } from '../storage';

import { Transaction, BlockHeader, Block, BlockStorage, Network, BAN_LEVEL, NetworkBroadcastStrategy } from '../block';

import { BufferReader } from '../lib/reader';
import { BufferWriter } from '../lib/writer';

import { INode, NodeConnection, PackageStreamWriter, Package, CMD_TYPE } from '../net';
import { getMonitor } from '../../../ruff/dposbft/chain/modules/monitor';
import { TxBuffer } from './tx_buffer';

export enum SYNC_CMD_TYPE {
    getHeader = CMD_TYPE.userCmd + 0,
    header = CMD_TYPE.userCmd + 1,
    getBlock = CMD_TYPE.userCmd + 2,
    block = CMD_TYPE.userCmd + 3,
    tx = CMD_TYPE.userCmd + 5,
    end = CMD_TYPE.userCmd + 6,
}

export type ChainNodeOptions = {
    networks: Network[];
    logger: LoggerInstance;
    initBlockWnd?: number;
    blockTimeout?: number;
    headersTimeout?: number;
    blockStorage: BlockStorage;
    storageManager: StorageManager;
    blockWithLog: boolean;
};

type RequestingBlockConnection = {
    hashes: Set<string>,
    wnd: number,
    conn: NodeConnection
};

export type HeadersEventParams = {
    from: string;
    headers: BlockHeader[];
    request: any;
    error: ErrorCode;
};

export type BlocksEventParams = {
    from?: string;
    block: Block;
    storage?: StorageDumpSnapshot;
    redoLog?: StorageLogger;
};

export class ChainNode extends EventEmitter {
    constructor(options: ChainNodeOptions) {
        super();
        // net/node
        this.m_logger = options.logger;
        this.m_networks = options.networks.slice();
        this.m_blockStorage = options.blockStorage;
        this.m_storageManager = options.storageManager;
        this.m_blockWithLog = options.blockWithLog;

        this.m_initBlockWnd = options.initBlockWnd ? options.initBlockWnd : 10;

        this.m_blockTimeout = options.blockTimeout ? options.blockTimeout : 10000;
        this.m_headersTimeout = options.headersTimeout ? options.headersTimeout : 30000;
        this.m_reqTimeoutTimer = setInterval(() => {
            this._onReqTimeoutTimer(Date.now() / 1000);
        }, 1000);

        this.m_txBuffer = new TxBuffer(options.logger, this);
        this.m_txBuffer.start();
    }

    private m_logger: LoggerInstance;
    private m_networks: Network[];
    private m_blockStorage: BlockStorage;
    private m_storageManager: StorageManager;
    private m_blockWithLog: boolean;
    // Yang Jun 2019-8-26
    private m_txBuffer: TxBuffer;

    on(event: 'blocks', listener: (params: BlocksEventParams) => any): this;
    on(event: 'headers', listener: (params: HeadersEventParams) => any): this;
    on(event: 'transactions', listener: (conn: NodeConnection, tx: Transaction[]) => any): this;
    on(event: 'ban', listener: (remote: string) => any): this;
    on(event: 'error', listener: (remote: string) => any): this;
    on(event: 'outbound', listener: (conn: NodeConnection) => any): this;
    on(event: 'inbound', listener: (conn: NodeConnection) => any): this;
    on(event: string, listener: any): this {
        return super.on(event, listener);
    }

    once(event: 'blocks', listener: (params: BlocksEventParams) => any): this;
    once(event: 'headers', listener: (params: HeadersEventParams) => any): this;
    once(event: 'transactions', listener: (conn: NodeConnection, tx: Transaction[]) => any): this;
    once(event: 'ban', listener: (remote: string) => any): this;
    once(event: 'error', listener: (remote: string) => any): this;
    once(event: 'outbound', listener: (conn: NodeConnection) => any): this;
    once(event: 'inbound', listener: (conn: NodeConnection) => any): this;
    once(event: string, listener: any): this {
        return super.once(event, listener);
    }

    public async init(): Promise<ErrorCode> {
        let inits = [];

        for (const network of this.m_networks) {
            network.on('inbound', (conn: NodeConnection) => {
                this._beginSyncWithNode(network, conn);
                this.emit('inbound', conn);
            });
            network.on('outbound', (conn: NodeConnection) => {
                this._beginSyncWithNode(network, conn);
                this.emit('outbound', conn);
            });
            network.on('error', (remote: string, id: string, err: ErrorCode) => {
                const fullRemote = INode.fullPeerid(network.name, remote);
                this._onConnectionError(fullRemote, id);
                this.emit('error', fullRemote);
            });
            network.on('ban', (remote: string) => {
                const fullRemote = INode.fullPeerid(network.name, remote);
                this._onRemoveConnection(fullRemote);
                this.emit('ban', fullRemote);
            });

            inits.push(network.init());
        }
        let results = await Promise.all(inits);
        if (results[0]) {
            return results[0];
        }

        let initOutbounds = [];
        for (const network of this.m_networks) {
            initOutbounds.push(network.initialOutbounds());
        }

        results = await Promise.all(initOutbounds);
        return results[0];
    }

    uninit(): Promise<any> {
        this.removeAllListeners('blocks');
        this.removeAllListeners('headers');
        this.removeAllListeners('transactions');
        let uninits = [];
        for (const network of this.m_networks) {
            uninits.push(network.uninit());
        }
        return Promise.all(uninits);
    }

    // Add by Yang Jun 2019-8-27
    public get txBuffer(): TxBuffer {
        return this.m_txBuffer;
    }

    public get logger(): LoggerInstance {
        return this.m_logger;
    }

    public async listen(): Promise<ErrorCode> {
        let listens = [];
        for (const network of this.m_networks) {
            listens.push(network.listen());
        }
        const results = await Promise.all(listens);
        for (const err of results) {
            if (err) {
                return err;
            }
        }
        return ErrorCode.RESULT_OK;
    }

    public getNetwork(_network?: string): Network | undefined {
        if (_network) {
            for (const network of this.m_networks) {
                if (network.name === _network) {
                    return network;
                }
            }
            return undefined;
        } else {
            return this.m_networks[0];
        }
    }

    public getConnection(fullremote: string): NodeConnection | undefined {
        const { network, peerid } = INode.splitFullPeerid(fullremote)!;
        const node = this.getNetwork(network);
        if (!node) {
            return;
        }
        return node.node.getConnection(peerid);
    }

    public getOutbounds(): NodeConnection[] {
        let arr = [];
        for (const network of this.m_networks) {
            arr.push(...network.node.getOutbounds());
        }
        return arr;
    }

    public broadcast(content: BlockHeader[] | Transaction[], options?: {
        count?: number,
        filter?: (conn: NodeConnection) => boolean
    }): ErrorCode {
        if (!content.length) {
            return ErrorCode.RESULT_OK;
        }
        let pwriter: PackageStreamWriter | undefined;
        let strategy;
        if (content[0] instanceof BlockHeader) {
            let hwriter = new BufferWriter();
            for (let header of content) {
                let err = header.encode(hwriter);
                if (err) {
                    this.logger.error(`encode header ${header.hash} failed`);
                    return err;
                }

            }
            // Yang Jun 2019-8-15
            getMonitor()!.updateSendHeaders(content.length);

            let raw = hwriter.render();
            pwriter = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.header, { count: content.length }, raw.length);
            pwriter.writeData(raw);
            strategy = NetworkBroadcastStrategy.headers;
        } else if (content[0] instanceof Transaction) {
            let hwriter = new BufferWriter();
            for (let tx of content) {
                let err = tx.encode(hwriter);
                if (err) {
                    this.logger.error(`encode transaction ${tx.hash} failed`);
                    return err;
                }

            }
            // Yang Jun 2019-8-15
            getMonitor()!.updateSendTxs(content.length);

            let raw = hwriter.render();
            pwriter = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.tx, { count: content.length }, raw.length);
            pwriter.writeData(raw);
            strategy = NetworkBroadcastStrategy.transaction;
        }
        assert(pwriter);
        for (const network of this.m_networks) {
            const opt = Object.create(options ? options : null);
            opt.strategy = strategy;
            network.broadcast(pwriter!, opt);
        }
        return ErrorCode.RESULT_OK;
    }

    protected _beginSyncWithNode(network: Network, conn: NodeConnection) {
        // TODO: node 层也要做封禁，比如发送无法解析的pkg， 过大， 过频繁的请求等等
        conn.on('pkg', async (pkg: Package) => {
            if (pkg.header.cmdType === SYNC_CMD_TYPE.tx) {
                let buffer = pkg.copyData();
                let txReader = new BufferReader(buffer);
                let txes: Transaction[] = [];
                let err = ErrorCode.RESULT_OK;
                for (let ix = 0; ix < pkg.body.count; ++ix) {
                    let tx = network.newTransaction();
                    if (tx.decode(txReader) !== ErrorCode.RESULT_OK) {
                        this.logger.warn(`receive invalid format transaction from ${conn.fullRemote}`);
                        err = ErrorCode.RESULT_INVALID_PARAM;
                        break;
                    }
                    if (!tx.verifySignature()) {
                        this.logger.warn(`receive invalid signature transaction ${tx.hash} from ${conn.fullRemote}`);
                        err = ErrorCode.RESULT_INVALID_TOKEN;
                        break;
                    }
                    txes.push(tx);

                    // Yang Jun 2019-8-15
                    getMonitor()!.updateRecvTxs(1);
                }
                if (err) {
                    network.banConnection(conn.remote!, BAN_LEVEL.forever);
                } else {
                    if (txes.length) {
                        let hashs: string[] = [];
                        for (let tx of txes) {
                            hashs.push(tx.hash);
                        }
                        this.logger.debug(`receive transaction from ${conn.fullRemote} ${JSON.stringify(hashs)}`);

                        // Yang Jun 2019-8-27
                        // this.emit('transactions', conn, txes);
                        this.m_txBuffer.addTxes(conn, txes);
                    }
                }
            } else if (pkg.header.cmdType === SYNC_CMD_TYPE.header) {
                let time = Date.now() / 1000;
                let buffer = pkg.copyData();
                let headerReader = new BufferReader(buffer);
                let headers = [];
                this.logger.debug(`receive headers from ${conn.fullRemote} err ${pkg.body.error} request `, pkg.body.request);
                if (!pkg.body.error) {
                    let err = ErrorCode.RESULT_OK;
                    let preHeader: BlockHeader | undefined;
                    for (let ix = 0; ix < pkg.body.count; ++ix) {
                        let header = network.newBlockHeader();
                        if (header.decode(headerReader) !== ErrorCode.RESULT_OK) {
                            this.logger.warn(`receive invalid format header from ${conn.fullRemote}`);
                            err = ErrorCode.RESULT_INVALID_BLOCK;
                            break;
                        }
                        if (!pkg.body.request || pkg.body.request.from) {
                            // 广播或者用from请求的header必须连续
                            if (preHeader) {
                                if (!preHeader.isPreBlock(header)) {
                                    this.logger.warn(`receive headers not in sequence from ${conn.fullRemote}`);
                                    err = ErrorCode.RESULT_INVALID_BLOCK;
                                    break;
                                }
                            }
                            preHeader = header;
                        }
                        headers.push(header);
                        // Yang Jun 2019-8-15
                        getMonitor()!.updateRecvHeaders(1);
                    }
                    if (err) {
                        // 发错的header的peer怎么处理
                        network.banConnection(conn.remote!, BAN_LEVEL.forever);
                        return;
                    }
                    // 用from请求的返回的第一个跟from不一致
                    if (headers.length && pkg.body.request && headers[0].preBlockHash !== pkg.body.request.from) {
                        this.logger.warn(`receive headers ${headers[0].preBlockHash} not match with request ${pkg.body.request.from} from ${conn.fullRemote}`);
                        network.banConnection(conn.remote!, BAN_LEVEL.forever);
                        return;
                    }
                    // 任何返回 gensis 的都不对
                    if (headers.length) {
                        if (headers[0].number === 0) {
                            this.logger.warn(`receive genesis header from ${conn.fullRemote}`);
                            network.banConnection(conn.remote!, BAN_LEVEL.forever);
                            return;
                        }
                    }
                } else if (pkg.body.error === ErrorCode.RESULT_NOT_FOUND) {
                    let ghr = await network.headerStorage.getHeader(0);
                    if (ghr.err) {
                        return;
                    }
                    // from用gensis请求的返回没有
                    if (pkg.body.request && pkg.body.request.from === ghr.header!.hash) {
                        this.logger.warn(`receive can't get genesis header ${pkg.body.request.from} from ${conn.fullRemote}`);
                        network.banConnection(conn.remote!, BAN_LEVEL.forever);
                        return;
                    }
                }

                if (!this._onRecvHeaders(conn.fullRemote, time, pkg.body.request)) {
                    return;
                }
                this.emit('headers', { from: conn.fullRemote, headers, request: pkg.body.request, error: pkg.body.error });
            } else if (pkg.header.cmdType === SYNC_CMD_TYPE.getHeader) {
                // Add by Yang Jun 2019-8-27
                this.txBuffer.beginGetHeader();

                this._responseHeaders(conn, pkg.body);

                this.txBuffer.endGetHeader();
            } else if (pkg.header.cmdType === SYNC_CMD_TYPE.block) {
                this._handlerBlockPackage(network, conn, pkg);
            } else if (pkg.header.cmdType === SYNC_CMD_TYPE.getBlock) {
                // Add by Yang Jun 2019-8-27
                this.txBuffer.beginGetBlock();

                this._responseBlocks(conn, pkg.body);

                this.txBuffer.endGetBlock();
            }
        });
    }

    // 处理通过网络请求获取的block package
    // 然后emit到chain层
    // @param conn 网络连接
    // @param pgk  block 数据包
    private _handlerBlockPackage(network: Network, conn: NodeConnection, pkg: Package) {
        let buffer = pkg.copyData();
        let blockReader;
        let redoLogReader;
        let redoLog;

        // check body buffer 中是否包含了redoLog
        // 如果包含了redoLog 需要切割buffer
        if (pkg.body.redoLog) {
            // 由于在传输时, redolog和block都放在package的data属性里（以合并buffer形式）
            // 所以需要根据body中的length 分配redo和block的buffer
            let blockBuffer = buffer.slice(0, pkg.body.blockLength);
            let redoLogBuffer = buffer.slice(pkg.body.blockLength, buffer.length);
            // console.log(pkg.body.blockLength, blockBuffer.length, pkg.body.redoLogLength, redoLogBuffer.length)
            // console.log('------------------')
            blockReader = new BufferReader(blockBuffer);
            redoLogReader = new BufferReader(redoLogBuffer);
            // 构造redo log 对象
            redoLog = new JStorageLogger();
            let redoDecodeError = redoLog.decode(redoLogReader);
            if (redoDecodeError) {
                return;
            }
        } else {
            blockReader = new BufferReader(buffer);
        }

        if (pkg.body.err === ErrorCode.RESULT_NOT_FOUND) {
            // 请求的block肯定已经从header里面确定remote有，直接禁掉
            network.banConnection(conn.remote!, BAN_LEVEL.forever);
            return;
        }

        // 构造block对象
        let block = network.newBlock();
        if (block.decode(blockReader) !== ErrorCode.RESULT_OK) {
            this.logger.warn(`receive block invalid format from ${conn.fullRemote}`);
            network.banConnection(conn.remote!, BAN_LEVEL.forever);
            return;
        }

        if (!block.verify()) {
            this.logger.warn(`receive block not match header ${block.header.hash} from ${conn.fullRemote}`);
            network.banConnection(conn.remote!, BAN_LEVEL.day); // 可能分叉？
            return;
        }
        const eventParams = { from: conn.fullRemote, block, redoLog };
        let err = this._onRecvBlock(eventParams);
        if (err) {
            return;
        }
        // 数据emit 到chain层
        this.emit('blocks', eventParams);

        // Yang Jun 2018-9-15
        getMonitor()!.updateRecvBlocks(1);
    }

    public requestHeaders(from: NodeConnection, options: { from?: string, limit?: number }): ErrorCode {
        this.logger.debug(`request headers from  with options ${from.fullRemote}`, options);
        if (this.m_requestingHeaders.get(from.fullRemote)) {
            this.logger.warn(`request headers ${options} from ${from.fullRemote} skipped for former headers request existing`);
            return ErrorCode.RESULT_ALREADY_EXIST;
        }
        this.m_requestingHeaders.set(from.fullRemote, {
            time: Date.now() / 1000,
            req: Object.assign(Object.create(null), options)
        });
        let writer = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.getHeader, options);
        from.addPendingWriter(writer);
        return ErrorCode.RESULT_OK;
    }

    // 这里必须实现成同步的
    public requestBlocks(from: string, options: { headers?: BlockHeader[], redoLog?: number }): ErrorCode {
        this.logger.debug(`request blocks from ${from} with options `, options);
        let connRequesting = this._getConnRequesting(from);
        if (!connRequesting) {
            this.logger.debug(`request blocks from ${from} skipped for connection not found with options `, options);
            return ErrorCode.RESULT_NOT_FOUND;
        }
        let requests: string[] = [];
        let addRequesting = (header: BlockHeader): boolean => {
            if (this.m_blockStorage.has(header.hash)) {
                let block = this.m_blockStorage.get(header.hash);
                assert(block, `block storage load block ${header.hash} failed while file exists`);
                if (block) {
                    if (this.m_blockWithLog) {
                        if (this.m_storageManager.hasRedoLog(header.hash)) {
                            let redoLog = this.m_storageManager.getRedoLog(header.hash);
                            if (redoLog) {
                                setImmediate(() => {
                                    this.emit('blocks', { block, redoLog });
                                });
                            } else {
                                setImmediate(() => {
                                    this.emit('blocks', { block });
                                });
                            }
                        } else {
                            setImmediate(() => {
                                this.emit('blocks', { block });
                            });
                        }
                    } else {
                        setImmediate(() => {
                            this.emit('blocks', { block });
                        });
                    }
                    return false;
                }
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
        };

        if (options.headers) {
            for (let header of options.headers) {
                addRequesting(header);
            }
        } else {
            assert(false, `invalid block request ${options}`);
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        for (let hash of requests) {
            this._addToPendingBlocks(hash);
        }
        this._onFreeBlockWnd(connRequesting);
        return ErrorCode.RESULT_OK;
    }

    private _tryRequestBlockFromConnection(hash: string, from: RequestingBlockConnection) {
        if (from.wnd - from.hashes.size > 0) {
            this._requestBlockFromConnection(hash, from);
            this._removeFromPendingBlocks(hash);
            return true;
        }
        return false;
    }

    private _addToPendingBlocks(hash: string, head: boolean = false) {
        if (!this.m_pendingBlock.hashes.has(hash)) {
            this.m_pendingBlock.hashes.add(hash);
            if (head) {
                this.m_pendingBlock.sequence.unshift(hash);
            } else {
                this.m_pendingBlock.sequence.push(hash);
            }
        }
    }

    private _removeFromPendingBlocks(hash: string) {
        if (this.m_pendingBlock.hashes.has(hash)) {
            this.m_pendingBlock.hashes.delete(hash);
            this.m_pendingBlock.sequence.splice(this.m_pendingBlock.sequence.indexOf(hash), 1);
        }
    }

    protected m_initBlockWnd: number;
    protected m_requestingBlock: {
        connMap: Map<string, RequestingBlockConnection>,
        hashMap: Map<string, { remote: string, time: number }>
    } = {
            connMap: new Map(),
            hashMap: new Map()
        };
    protected m_pendingBlock: { hashes: Set<string>, sequence: Array<string> } = { hashes: new Set(), sequence: new Array() };
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
            from.wnd = from.wnd > 3 * node.m_initBlockWnd ? 3 * node.m_initBlockWnd : from.wnd;
        },
        onBlockTimeout(node: ChainNode, hash: string, from: RequestingBlockConnection) {
            from.wnd = Math.floor(from.wnd / 2);
        }
    };

    protected _getConnRequesting(fpid: string): RequestingBlockConnection | undefined {
        let connRequesting = this.m_requestingBlock.connMap.get(fpid);
        if (!connRequesting) {
            const { network, peerid } = INode.splitFullPeerid(fpid)!;
            const node = this.getNetwork(network);
            if (!node) {
                return;
            }
            let conn = node.node.getConnection(peerid);
            // TODO: 取不到这个conn的时候要处理
            // assert(conn, `no connection to ${remote}`);
            this.logger.error(`non connection to ${fpid}`);
            if (!conn) {
                return;
            }
            connRequesting = { hashes: new Set(), wnd: this.m_initBlockWnd, conn: conn! };
            this.m_requestingBlock.connMap.set(fpid, connRequesting);
        }
        return connRequesting;
    }

    protected _requestBlockFromConnection(hash: string, connRequesting: RequestingBlockConnection): ErrorCode {
        this.logger.debug(`request block ${hash} from ${connRequesting.conn.fullRemote}`);
        let writer = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.getBlock, { hash, redoLog: this.m_blockWithLog ? 1 : 0 });
        connRequesting.conn.addPendingWriter(writer);
        connRequesting.hashes.add(hash);
        this.m_requestingBlock.hashMap.set(hash, { remote: connRequesting.conn.fullRemote, time: Date.now() / 1000 });
        return ErrorCode.RESULT_OK;
    }

    protected _onFreeBlockWnd(connRequesting: RequestingBlockConnection) {
        let pending = this.m_pendingBlock;
        let index = 0;
        do {
            if (!pending.sequence.length
                || index >= pending.sequence.length) {
                break;
            }
            let hash = pending.sequence[index];
            let sources = this.m_blockFromMap.get(hash);
            assert(sources, `to request block ${hash} from unknown source`);
            if (!sources) {
                return ErrorCode.RESULT_EXCEPTION;
            }
            if (sources.has(connRequesting.conn.fullRemote)) {
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

    protected _onRecvHeaders(fpid: string, time: number, request?: any): boolean {
        let valid = true;
        if (request) {
            // 返回没有请求过的headers， 要干掉
            let rh = this.m_requestingHeaders.get(fpid);
            if (rh) {
                for (let key of Object.keys(request)) {
                    if (request![key] !== rh.req[key]) {
                        valid = false;
                        break;
                    }
                }
            } else {
                // TODO: 如果request header之后connection失效， 会从requesting headers 中移除；
                // 因为回调处理基本都是异步的，可能是会出现同时进入receive header的回调和connection error的回调；
                // 此时这段分支会导致header被置为invalid；相比不停返回header的ddos攻击行为是有区别的；
                // ban的策略也应该有区别；
                valid = false;
            }

            if (valid) {
                this.m_requestingHeaders.delete(fpid);
            }
        } else {
            // TODO: 过频繁的广播header, 要干掉
        }
        if (!valid) {
            this._banConnection(fpid, BAN_LEVEL.forever);
        }
        return valid;
    }

    protected _onRecvBlock(params: BlocksEventParams): ErrorCode {
        let connRequesting = this.m_requestingBlock.connMap.get(params.from!);
        if (!connRequesting) {
            this.logger.error(`requesting info on ${params.from!} missed, skip it`);
            return ErrorCode.RESULT_NOT_FOUND;
        }
        let stub = this.m_requestingBlock.hashMap.get(params.block.hash);
        // assert(stub, `recv block ${params.block.hash} from ${params.from!} that never request`);
        if (!stub) {
            this.logger.error(`recv block ${params.block.hash} from ${params.from!} that never request`);
            this._banConnection(params.from!, BAN_LEVEL.day);
            return ErrorCode.RESULT_INVALID_BLOCK;
        }
        this.logger.debug(`recv block hash: ${params.block.hash} number: ${params.block.number} from ${params.from!}`);
        this.m_blockStorage!.add(params.block);
        if (params.redoLog) {
            this.m_storageManager.addRedoLog(params.block.hash, params.redoLog!);
        }
        assert(stub!.remote === params.from!, `request ${params.block.hash} from ${stub!.remote} while recv from ${params.from!}`);
        this.m_requestingBlock.hashMap.delete(params.block.hash);
        connRequesting.hashes.delete(params.block.hash);
        this.m_blockFromMap.delete(params.block.hash);
        this.m_cc.onRecvBlock(this, params.block, connRequesting);
        this._onFreeBlockWnd(connRequesting);
        return ErrorCode.RESULT_OK;
    }

    protected _onConnectionError(fullRemote: string, id: string) {
        this.logger.warn(`connection ${id} from ${fullRemote} break, close it.`);
        this._onRemoveConnection(fullRemote);
    }

    /*must not async*/
    protected _onRemoveConnection(fullRemote: string) {
        this.logger.info(`removing ${fullRemote} from block requesting source`);
        let connRequesting = this.m_requestingBlock.connMap.get(fullRemote);
        if (connRequesting) {
            for (let hash of connRequesting.hashes) {
                this.logger.debug(`change block ${hash} from requesting to pending`);
                this.m_requestingBlock.hashMap.delete(hash);
                this._addToPendingBlocks(hash, true);
            }
        }
        this.m_requestingBlock.connMap.delete(fullRemote);

        for (let hash of this.m_blockFromMap.keys()) {
            let sources = this.m_blockFromMap.get(hash)!;
            if (sources.has(fullRemote)) {
                sources.delete(fullRemote);
                if (!sources.size) {
                    this.logger.debug(`remove block ${hash} from pending blocks for all source removed`);
                    // this._removeFromPendingBlocks(hash);
                } else {
                    for (let from of sources) {
                        let fromRequesting = this.m_requestingBlock.connMap.get(from);
                        assert(fromRequesting, `block requesting connection ${from} not exists`);
                        if (this._tryRequestBlockFromConnection(hash, fromRequesting!)) {
                            break;
                        }
                    }
                }
            }
        }
        this.m_requestingHeaders.delete(fullRemote);
    }

    banConnection(fullRemote: string, level: BAN_LEVEL) {
        return this._banConnection(fullRemote, level);
    }

    protected _banConnection(fullRemote: string, level: BAN_LEVEL) {
        const { network, peerid } = INode.splitFullPeerid(fullRemote)!;
        const node = this.getNetwork(network);
        if (node) {
            node.banConnection(peerid, level);
        }
    }

    protected _onReqTimeoutTimer(now: number) {
        for (let hash of this.m_requestingBlock.hashMap.keys()) {
            let stub = this.m_requestingBlock.hashMap.get(hash)!;
            let fromRequesting = this.m_requestingBlock.connMap.get(stub.remote)!;
            if (now - stub.time > this.m_blockTimeout) {
                this.m_cc.onBlockTimeout(this, hash, fromRequesting);
                // close it 
                if (fromRequesting.wnd < 1) {
                    this._banConnection(stub.remote, BAN_LEVEL.hour);
                }
            }
        }
        // 返回headers超时
        for (let fullRemote of this.m_requestingHeaders.keys()) {
            let rh = this.m_requestingHeaders.get(fullRemote)!;
            if (now - rh.time > this.m_headersTimeout) {
                this.logger.debug(`header request timeout from ${fullRemote} timeout with options `, rh.req);
                this._banConnection(fullRemote, BAN_LEVEL.hour);
            }
        }
    }

    protected async _responseBlocks(conn: NodeConnection, req: any): Promise<ErrorCode> {
        assert(this.m_blockStorage);
        this.logger.info(`receive block request from ${conn.fullRemote} with ${JSON.stringify(req)}`);
        let bwriter = new BufferWriter();
        let block = this.m_blockStorage!.get(req.hash);
        if (!block) {
            this.logger.crit(`cannot get Block ${req.hash} from blockStorage`);
            const node = this.getNetwork(conn.network!)!;
            assert(false, `${conn.fullRemote} cannot get Block ${req.hash} from blockStorage`);
            return ErrorCode.RESULT_OK;
        }
        let err = block.encode(bwriter);
        if (err) {
            this.logger.error(`encode block ${block.hash} failed`);
            return err;
        }
        let rawBlocks = bwriter.render();

        // Yang JUn 2019-8-15
        getMonitor()!.updateSendBlocks(1);

        let redoLogRaw;
        // 如果请求参数里设置了redoLog,  则读取redoLog, 合并在返回的包里
        if (req.redoLog === 1) {
            do {
                let redoLogWriter = new BufferWriter();
                // 从本地文件中读取redoLog, 处理raw 拼接在block后
                let redoLog = this.m_storageManager.getRedoLog(req.hash);
                if (!redoLog) {
                    this.logger.error(`${req.hash} redo log missing`);
                    break;
                }
                err = redoLog!.encode(redoLogWriter);
                if (err) {
                    this.logger.error(`encode redolog ${req.hash} failed`);
                    break;
                }
                redoLogRaw = redoLogWriter.render();
            } while (false);
        }
        if (redoLogRaw) {
            let dataLength = rawBlocks.length + redoLogRaw.length;
            let pwriter = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.block, {
                blockLength: rawBlocks.length,
                redoLogLength: redoLogRaw.length,
                redoLog: 1,
            }, dataLength);
            pwriter.writeData(rawBlocks);
            pwriter.writeData(redoLogRaw);
            conn.addPendingWriter(pwriter);
        } else {
            let pwriter = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.block, { redoLog: 0 }, rawBlocks.length);
            pwriter.writeData(rawBlocks);
            conn.addPendingWriter(pwriter);
        }
        return ErrorCode.RESULT_OK;
    }

    protected async _responseHeaders(conn: NodeConnection, req: any): Promise<ErrorCode> {
        const node = this.getNetwork(conn.network!)!;
        this.logger.info(`receive header request from ${conn.fullRemote} with ${JSON.stringify(req)}`);
        if (req.from) {
            let hwriter = new BufferWriter();
            let respErr = ErrorCode.RESULT_OK;
            let headerCount = 0;
            do {
                let tipResult = await node.headerStorage.getHeader('latest');
                if (tipResult.err) {
                    return tipResult.err;
                }

                let heightResult = await node.headerStorage!.getHeightOnBest(req.from);
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

                let hr = await node.headerStorage.getHeader(heightResult.height! + headerCount);
                if (hr.err) {
                    // 中间changeBest了，返回not found
                    if (hr.err === ErrorCode.RESULT_NOT_FOUND) {
                        respErr = ErrorCode.RESULT_NOT_FOUND;
                        break;
                    } else {
                        return hr.err;
                    }
                }

                let hsr = await node.headerStorage.getHeader(hr.header!.hash, -headerCount + 1);
                if (hsr.err) {
                    return hsr.err;
                }
                if (hsr.headers![0].preBlockHash !== req.from) {
                    // 中间changeBest了，返回not found
                    respErr = ErrorCode.RESULT_NOT_FOUND;
                    break;
                }
                for (let h of hsr.headers!) {
                    let err = h.encode(hwriter);
                    if (err) {
                        this.logger.error(`encode header ${h.hash} failed`);
                        respErr = ErrorCode.RESULT_NOT_FOUND;
                    }
                }
            } while (false);

            let rawHeaders = hwriter.render();
            let pwriter = PackageStreamWriter.fromPackage(SYNC_CMD_TYPE.header, { count: headerCount, request: req, error: respErr }, rawHeaders.length);
            pwriter.writeData(rawHeaders);
            conn.addPendingWriter(pwriter);

            // Yang Jun
            getMonitor()!.updateSendHeaders(rawHeaders.length);

            return ErrorCode.RESULT_OK;
        } else {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
    }



}
