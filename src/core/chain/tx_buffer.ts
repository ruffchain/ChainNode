import { EventEmitter } from "events";
import { NodeConnection } from "../net";
import { DelayPromise } from "../../../ruff/dposbft/chain/modules/monitor/monitor";
import { ErrorCode, LoggerInstance, Transaction } from "../../host";
import { ChainNode } from "./chain_node";
import { RPCServer } from "../../host/lib/rpc_server";

export interface IfTxBufferItem {
    conn: NodeConnection;
    transactions: Transaction[];
}
export interface IfRpcBufferItem {
    func: string;
    args: any;
    resp: any;
}

export class TxBuffer extends EventEmitter {
    static MAX_BUFFER_DEPTH: number = 5000;

    static TIME_INTERVAL: number = 100;
    static MAX_TIME_SLICE: number = 10;
    static MAX_LOAD_TAP: number = 100;
    static MIN_LOAD_TAP: number = 1;
    static TAP_BOUNCE_BACK: number = 5;
    static ENABLE_TAP: boolean = true;
    static DELAY_UNIT = TxBuffer.TIME_INTERVAL / 1000;
    static ENABLE_RPC_TAP: boolean = true;

    static MAX_RPC_LOAD_TAP: number = 100;
    static MIN_RPC_LOAD_TAP: number = 1;


    static TAP_HEADERS: number = 30;
    static TAP_GETHEADER: number = 10;
    static TAP_BLOCK: number = 30;
    static TAP_GETBLOCK: number = 10;
    static TAP_TIPSIGN: number = 30;

    static RPC_TAP_HEADERS: number = 30;
    static RPC_TAP_GETHEADER: number = 10;
    static RPC_TAP_BLOCK: number = 30;
    static RPC_TAP_GETBLOCK: number = 10;
    static RPC_TAP_TIPSIGN: number = 30;

    private m_buffer: IfTxBufferItem[] = [];
    private m_tx_hash: Set<string> = new Set();
    // private m_timer?: NodeJS.Timer;
    private m_logger: LoggerInstance;
    private m_sliceCounter: number = 0;
    private m_slices: number[] = [];
    private m_loadTap: number;

    private m_node?: ChainNode;

    private m_rpcServer?: RPCServer;
    private m_rpcBuffer: IfRpcBufferItem[] = [];
    private m_rpcLoadTap: number;
    private m_rpcCounter: number = 0;
    private m_rpcSlices: number[] = [];


    constructor(logger: LoggerInstance, chainnode?: ChainNode) {
        super();
        this.m_logger = logger;
        this.m_node = chainnode;

        // this.m_buffer = [];
        this.m_sliceCounter = 0;

        for (let i = 0; i < TxBuffer.MAX_TIME_SLICE; i++) {
            this.m_slices.push(0);
        }

        this.m_loadTap = TxBuffer.MAX_LOAD_TAP;
        this.updatePattern(this.m_loadTap);

        for (let i = 0; i < TxBuffer.MAX_TIME_SLICE; i++) {
            this.m_rpcSlices.push(0);
        }
        this.m_rpcLoadTap = TxBuffer.MAX_RPC_LOAD_TAP;
        this.updateRpcPattern(this.m_rpcLoadTap);
    }
    /**
     * 
     * @param tap 1~100
     */
    private updatePattern(tap: number) {
        // design 100 pattern according to tap 
        let div = Math.floor(tap / TxBuffer.MAX_TIME_SLICE);
        let remai = tap % TxBuffer.MAX_TIME_SLICE;
        for (let i = 0; i < TxBuffer.MAX_TIME_SLICE; i++) {
            this.m_slices[i] = div + 1;
        }
        for (let i = 0; i < remai; i++) {
            this.m_slices[i] += 1;
        }
    }
    private updateRpcPattern(tap: number) {
        // design 100 pattern according to tap 
        let div = Math.floor(tap / TxBuffer.MAX_TIME_SLICE);
        let remai = tap % TxBuffer.MAX_TIME_SLICE;
        for (let i = 0; i < TxBuffer.MAX_TIME_SLICE; i++) {
            this.m_rpcSlices[i] = div;
        }
        for (let i = 0; i < remai; i++) {
            this.m_rpcSlices[i] += 1;
        }
    }
    private addLoadTap(delta: number) {
        this.m_loadTap += delta;
        if (this.m_loadTap > TxBuffer.MAX_LOAD_TAP) {
            this.m_loadTap = TxBuffer.MAX_LOAD_TAP;
        }
    }
    private subLoadTap(delta: number) {
        this.m_loadTap -= delta;
        if (this.m_loadTap < TxBuffer.MIN_LOAD_TAP) {
            this.m_loadTap = TxBuffer.MIN_LOAD_TAP;
        }
    }
    private addRpcLoadTap(delta: number) {
        this.m_rpcLoadTap += delta;
        if (this.m_rpcLoadTap > TxBuffer.MAX_RPC_LOAD_TAP) {
            this.m_rpcLoadTap = TxBuffer.MAX_RPC_LOAD_TAP;
        }
    }
    private subRpcLoadTap(delta: number) {
        this.m_rpcLoadTap -= delta;
        if (this.m_rpcLoadTap < TxBuffer.MIN_RPC_LOAD_TAP) {
            this.m_rpcLoadTap = TxBuffer.MIN_RPC_LOAD_TAP;
        }
    }
    private getTxNumToSend(): number {
        let out = this.m_sliceCounter;
        if ((1 + this.m_sliceCounter) >= TxBuffer.MAX_TIME_SLICE) {
            this.m_sliceCounter = 0;
            this.updatePattern(this.m_loadTap);
        } else {
            this.m_sliceCounter++;
        }

        return this.m_slices[out];
    }
    private getRpcNumToSend(): number {
        let out = this.m_rpcCounter;
        if ((1 + this.m_rpcCounter) >= TxBuffer.MAX_TIME_SLICE) {
            this.m_rpcCounter = 0;
            this.updateRpcPattern(this.m_rpcLoadTap);
        } else {
            this.m_rpcCounter++;
        }

        return this.m_rpcSlices[out];
    }
    private sendTx() {

        // this.m_logger.info('TxBuffer send num: ' + num)

        if (this.m_buffer.length <= 0) {
            return;
        } else {
            this.m_logger.info('m_buffer len: ' + this.m_buffer.length);
        }

        // num to be sent in this time slice
        let num = this.getTxNumToSend();

        this.m_logger.info('pattern num: ' + num);

        for (let i = 0; i < num; i++) {
            if (this.m_buffer.length <= 0) {
                break;
            }

            let item = this.m_buffer.shift();

            if (item) {
                this.m_logger.info('TxBuffer emit: ' + i + ' loadTap:' + this.m_loadTap + ' num:' + num)

                // there is only one transaction every time
                this.m_tx_hash.delete(item.transactions[0].hash);

                this.m_node!.emit('transactions', item.conn, item.transactions);
            }
        }
    }
    private sendRpc() {


        if (this.m_rpcBuffer.length <= 0) {
            return;
        } else {
            this.m_logger.info('m_rpcBuffer len: ' + this.m_rpcBuffer.length);
        }

        let num = this.getRpcNumToSend();

        for (let i = 0; i < num; i++) {
            if (this.m_rpcBuffer.length <= 0) {
                break;
            }
            let item = this.m_rpcBuffer.shift();
            if (item) {
                this.m_logger.info('RpcBuffer emit: ', + i + ' rpcLoadTap:' + this.m_rpcLoadTap + ' num:' + num);
                this.m_rpcServer!.emit(item.func, item.args, item.resp);
            }
        }
    }

    public start() {
        // this.m_logger.info('TxBuffer trigure ->' + new Date().getTime())
        // check 

        let func = async () => {
            this.sendTx();

            // await DelayPromise(TxBuffer.DELAY_UNIT);

            this.sendRpc();

            await DelayPromise(TxBuffer.DELAY_UNIT);

            func();
        }

        func();

    }

    public addRpcIf(server: RPCServer) {
        this.m_rpcServer = server;
    }

    public addTxes(connection: NodeConnection, txs: Transaction[]) {
        // this.m_buffer.push({
        //     conn: connection,
        //     transactions: txs
        // })
        if (this.m_buffer.length >= TxBuffer.MAX_BUFFER_DEPTH) {
            console.log('m_buffer full > 5000');
            return;
        }
        for (let item of txs) {

            if (!this.m_tx_hash.has(item.hash)) {
                this.m_buffer.push({
                    conn: connection,
                    transactions: [item]
                })
                this.m_tx_hash.add(item.hash);
            }
        }
    }
    public addRpc(funName: string, args: any, resp: any): boolean {
        if (this.m_rpcBuffer.length >= TxBuffer.MAX_BUFFER_DEPTH) {
            console.warn('rpcBuffer full, > 5000');
            return true;
        }

        this.m_rpcBuffer.push({
            func: funName,
            args: args,
            resp: resp
        })
        return true;
        // if don't want any rpc handling, return false
    }
    // flow control methods
    public beginHeaders() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.subLoadTap(TxBuffer.TAP_HEADERS);

        if (!TxBuffer.ENABLE_RPC_TAP)
            return;
        this.subRpcLoadTap(TxBuffer.RPC_TAP_HEADERS);
    }
    public endHeaders() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.addLoadTap(TxBuffer.TAP_HEADERS + TxBuffer.TAP_BOUNCE_BACK)

        if (!TxBuffer.ENABLE_RPC_TAP)
            return;
        this.addRpcLoadTap(TxBuffer.RPC_TAP_HEADERS + TxBuffer.TAP_BOUNCE_BACK);
    }
    public beginGetHeader() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.subLoadTap(TxBuffer.TAP_GETHEADER);

        if (!TxBuffer.ENABLE_RPC_TAP)
            return;
        this.subRpcLoadTap(TxBuffer.RPC_TAP_GETHEADER);
    }
    public endGetHeader() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.addLoadTap(TxBuffer.TAP_GETHEADER + TxBuffer.TAP_BOUNCE_BACK)

        if (!TxBuffer.ENABLE_RPC_TAP)
            return;
        this.addRpcLoadTap(TxBuffer.RPC_TAP_GETHEADER + TxBuffer.TAP_BOUNCE_BACK);
    }
    public beginBlock() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.subLoadTap(TxBuffer.TAP_BLOCK);

        if (!TxBuffer.ENABLE_RPC_TAP)
            return;
        this.subRpcLoadTap(TxBuffer.RPC_TAP_BLOCK);
    }
    public endBlock() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.addLoadTap(TxBuffer.TAP_BLOCK + TxBuffer.TAP_BOUNCE_BACK)

        if (!TxBuffer.ENABLE_RPC_TAP)
            return;
        this.addRpcLoadTap(TxBuffer.RPC_TAP_BLOCK + TxBuffer.TAP_BOUNCE_BACK);
    }
    public beginGetBlock() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.subLoadTap(TxBuffer.TAP_GETBLOCK);

        if (!TxBuffer.ENABLE_RPC_TAP)
            return;
        this.subRpcLoadTap(TxBuffer.RPC_TAP_GETBLOCK);
    }
    public endGetBlock() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.addLoadTap(TxBuffer.TAP_GETBLOCK + TxBuffer.TAP_BOUNCE_BACK)

        if (!TxBuffer.ENABLE_RPC_TAP)
            return;
        this.addRpcLoadTap(TxBuffer.RPC_TAP_GETBLOCK + TxBuffer.TAP_BOUNCE_BACK);
    }
    public beginTipSign() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.subLoadTap(TxBuffer.TAP_TIPSIGN);

        if (!TxBuffer.ENABLE_RPC_TAP)
            return;
        this.subRpcLoadTap(TxBuffer.RPC_TAP_TIPSIGN);
    }
    public endTipSign() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.addLoadTap(TxBuffer.TAP_TIPSIGN + TxBuffer.TAP_BOUNCE_BACK)

        if (!TxBuffer.ENABLE_RPC_TAP)
            return;
        this.addRpcLoadTap(TxBuffer.RPC_TAP_TIPSIGN + TxBuffer.TAP_BOUNCE_BACK);
    }
}