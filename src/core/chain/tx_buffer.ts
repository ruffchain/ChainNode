import { EventEmitter } from "events";
import { NodeConnection } from "../net";
import { DelayPromise } from "../../../ruff/dposbft/chain/modules/monitor/monitor";
import { ErrorCode, LoggerInstance, Transaction } from "../../host";
import { ChainNode } from "./chain_node";

export interface IfTxBufferItem {
    conn: NodeConnection;
    transactions: Transaction[];
}

export class TxBuffer extends EventEmitter {
    static TIME_INTERVAL: number = 100;
    static MAX_TIME_SLICE: number = 10;
    static MAX_LOAD_TAP: number = 100;
    static MIN_LOAD_TAP: number = 1;
    static TAP_BOUNCE_BACK: number = 2;
    static ENABLE_TAP: boolean = true;

    static TAP_HEADERS: number = 80;
    static TAP_GETHEADER: number = 80;
    static TAP_BLOCK: number = 80;
    static TAP_GETBLOCK: number = 80;
    static TAP_TIPSIGN: number = 80;

    private m_buffer: IfTxBufferItem[] = [];
    private m_timer?: NodeJS.Timer;
    private m_logger: LoggerInstance;
    private m_sliceCounter: number = 0;
    private m_slices: number[] = [];
    private m_loadTap: number;
    private m_node?: ChainNode;

    constructor(logger: LoggerInstance, chainnode?: ChainNode) {
        super();
        this.m_logger = logger;
        this.m_node = chainnode;

        this.m_buffer = [];
        this.m_sliceCounter = 0;

        for (let i = 0; i < TxBuffer.MAX_TIME_SLICE; i++) {
            this.m_slices.push(0);
        }

        this.m_loadTap = TxBuffer.MAX_LOAD_TAP;
        this.updatePattern(this.m_loadTap);
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
            this.m_slices[i] = div;
        }
        for (let i = 0; i < remai; i++) {
            this.m_slices[i] += 1;
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
    private sendTx() {
        // num to be sent in this time slice
        let num = this.getTxNumToSend();
        // this.m_logger.info('TxBuffer send num: ' + num)
        for (let i = 0; i < num; i++) {
            let item = this.m_buffer.shift();
            if (item) {
                this.m_logger.info('TxBuffer emit: ' + i + ' loadTap:' + this.m_loadTap + ' num:' + num)
                this.m_node!.emit('transactions', item.conn, item.transactions);
            }
        }
    }

    public async start(): Promise<ErrorCode> {
        // this.m_logger.info('TxBuffer trigure ->' + new Date().getTime())
        // check 
        this.sendTx();

        await DelayPromise(TxBuffer.TIME_INTERVAL / 1000);
        this.start();
        return ErrorCode.RESULT_OK;
    }
    public addTxes(connection: NodeConnection, txs: Transaction[]) {
        this.m_buffer.push({
            conn: connection,
            transactions: txs
        })
    }
    public beginHeaders() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.subLoadTap(TxBuffer.TAP_HEADERS);
    }
    public endHeaders() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.addLoadTap(TxBuffer.TAP_HEADERS + TxBuffer.TAP_BOUNCE_BACK)
    }
    public beginGetHeader() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.subLoadTap(TxBuffer.TAP_GETHEADER);
    }
    public endGetHeader() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.addLoadTap(TxBuffer.TAP_GETHEADER + TxBuffer.TAP_BOUNCE_BACK)
    }
    public beginBlock() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.subLoadTap(TxBuffer.TAP_BLOCK);
    }
    public endBlock() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.addLoadTap(TxBuffer.TAP_BLOCK + TxBuffer.TAP_BOUNCE_BACK)
    }
    public beginGetBlock() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.subLoadTap(TxBuffer.TAP_GETBLOCK);
    }
    public endGetBlock() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.addLoadTap(TxBuffer.TAP_GETBLOCK + TxBuffer.TAP_BOUNCE_BACK)
    }
    public beginTipSign() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.subLoadTap(TxBuffer.TAP_TIPSIGN);
    }
    public endTipSign() {
        if (!TxBuffer.ENABLE_TAP)
            return;
        this.addLoadTap(TxBuffer.TAP_TIPSIGN + TxBuffer.TAP_BOUNCE_BACK)
    }
}