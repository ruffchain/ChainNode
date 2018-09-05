import {Transaction, BlockHeader} from '../block';
import {Chain} from './chain';
import {ErrorCode} from '../error_code';
import {LoggerInstance} from '../lib/logger_util';
import {StorageManager, IReadableStorage} from '../storage';
import {Lock} from '../lib/Lock';
import { BaseHandler } from '../executor';

export type TransactionWithTime = {tx: Transaction, ct: number};

export class PendingTransactions {
    protected m_transactions: TransactionWithTime[];
    protected m_orphanTx: Map<string, TransactionWithTime[]>;
    protected m_mapNonce: Map<string, number>;
    protected m_logger: LoggerInstance;
    protected m_storageManager: StorageManager;
    protected m_storageView?: IReadableStorage;
    protected m_curHeader?: BlockHeader;
    protected m_txLiveTime: number;
    protected m_pendingLock: Lock;
    protected m_handler: BaseHandler;
    constructor(options: {storageManager: StorageManager, logger: LoggerInstance, txlivetime: number, handler: BaseHandler}) {
        this.m_transactions = [];
        this.m_orphanTx = new Map();
        this.m_mapNonce = new Map<string, number>();
        this.m_logger = options.logger;
        this.m_storageManager = options.storageManager;
        this.m_txLiveTime = options.txlivetime;
        this.m_pendingLock = new Lock();
        this.m_handler = options.handler;
    }

    public async addTransaction(tx: Transaction): Promise<ErrorCode> {
        this.m_logger.debug(`addTransaction, txhash=${tx.hash}, nonce=${tx.nonce}, address=${tx.address}`);
        const checker = this.m_handler.getTxPendingChecker(tx.method);
        if (!checker) {
            this.m_logger.error(`txhash=${tx.hash} method=${tx.method} has no match listener`);
            return ErrorCode.RESULT_TX_CHECKER_ERROR;
        }
        const err = checker(tx);
        if (err) {
            this.m_logger.error(`txhash=${tx.hash} checker error ${err}`);
            return ErrorCode.RESULT_TX_CHECKER_ERROR;
        }
        await this.m_pendingLock.enter();
        // this.m_logger.info('transactions length='+this.m_transactions.length.toString());
        // if (this.m_orphanTx.has(tx.address as string)) {
        //     this.m_logger.info('m_orphanTx length='+(this.m_orphanTx.get(tx.address as string) as Transaction[]).length);
        // }
        if (this.isExist(tx)) {
            this.m_logger.error(`addTransaction failed, tx exist,hash=${tx.hash}`);
            await this.m_pendingLock.leave();
            return ErrorCode.RESULT_TX_EXIST;
        }
        let ret: any = await this._addTx({tx, ct: Date.now()});
        await this.m_pendingLock.leave();
        return ret;
    }

    public popTransaction(): Transaction|null {
        while (true) {
            if (!this.m_transactions.length) {
                return null;
            }
            let txTime: TransactionWithTime = this.m_transactions.shift()!;
            if (this.isTimeout(txTime)) {
                // 当前tx已经超时，那么同一个地址的其他tx(nonce一定大于当前tx的）进行排队等待
                this.m_mapNonce.set(txTime.tx.address as string, txTime.tx.nonce - 1);
                let i = 0;
                while (i < this.m_transactions.length) {
                    if (this.m_transactions[i].tx.address === txTime.tx.address) {
                        let txTemp: TransactionWithTime = (this.m_transactions.splice(i, 1)[0]);
                        this.addToOrphan(txTime.tx.address as string, txTemp);
                    } else {
                        i++;
                    }
                }
            } else {
                return txTime.tx;
            }
        }
    }

    public async updateTipBlock(header: BlockHeader): Promise<ErrorCode> {
        let svr = await this.m_storageManager.getSnapshotView(header.hash);
        if (svr.err) {
            this.m_logger.error(`updateTipBlock getSnapshotView failed, errcode=${svr.err},hash=${header.hash},number=${header.number}`);
            return svr.err;
        }
        if (this.m_curHeader) {
            this.m_storageManager.releaseSnapshotView(this.m_curHeader.hash);
        }
        this.m_curHeader = header;
        this.m_storageView = svr.storage!;
        await this.removeTx();
        return ErrorCode.RESULT_OK;
    }

    public init(): ErrorCode {
        return ErrorCode.RESULT_OK;
    }

    public uninit() {
        if (this.m_curHeader) {
            this.m_storageManager.releaseSnapshotView(this.m_curHeader.hash);
            delete this.m_storageView;
            delete this.m_curHeader;
        }
        this.m_mapNonce.clear();
        this.m_orphanTx.clear();
    }

    protected isExist(tx: Transaction): boolean {
        for (let t of this.m_transactions) {
            if (t.tx.hash === tx.hash) {
                return true;
            }
        }

        if (!this.m_orphanTx.get(tx.address as string)) {
            return false;
        }

        for (let orphan of this.m_orphanTx.get(tx.address as string) as TransactionWithTime[]) {
            if (tx.hash === orphan.tx.hash) {
                return true;
            }
        }
        return false;
    }

    protected async _addTx(txTime: TransactionWithTime): Promise<ErrorCode> {
        let address: string = txTime.tx.address as string;

        let {err, nonce} = await this.getNonce(address);
        if (err) {
            this.m_logger.error(`_addTx getNonce nonce error ${err}`);
            return err;
        }
        if (nonce! + 1 === txTime.tx.nonce) {
            this.addToQueue(txTime);
        } else if (nonce! + 1 < txTime.tx.nonce) {
            this.addToOrphan(address, txTime);
        } else {
            for (let i = 0; i < this.m_transactions.length; i++) {
                if (this.m_transactions[i].tx.address === txTime.tx.address && this.m_transactions[i].tx.nonce === txTime.tx.nonce) {
                    let txOld: Transaction = this.m_transactions[i].tx;
                    if (this.isTimeout(this.m_transactions[i])) {
                        this.m_transactions.splice(i, 1, txTime);
                        await this.onReplaceTx(txTime.tx, txOld);
                        return ErrorCode.RESULT_OK;
                    }

                    let _err = await this.checkSmallNonceTx(txTime.tx, this.m_transactions[i].tx);
                    if (_err === ErrorCode.RESULT_OK) {
                        this.m_transactions.splice(i, 1, txTime);
                        await this.onReplaceTx(txTime.tx, txOld);
                        return ErrorCode.RESULT_OK;
                    }
                    return _err;
                }
            }
            this.m_logger.info(`nonce exist address=${txTime.tx.address}, nonce=${txTime.tx.nonce}, existnonce=${nonce}`);
            return ErrorCode.RESULT_ERROR_NONCE_IN_TX;
        }
        await this.ScanOrphan(address);
        return ErrorCode.RESULT_OK;
    }

    // 同个address的两个相同nonce的tx存在，且先前的也还没有入链
    protected async checkSmallNonceTx(txNew: Transaction, txOld: Transaction): Promise<ErrorCode> {
        return ErrorCode.RESULT_ERROR_NONCE_IN_TX;
    }

    // 获取mem中的nonce值
    protected async getNonce(address: string): Promise<{err: ErrorCode, nonce?: number}> {
        if (this.m_mapNonce.has(address)) {
            return {err: ErrorCode.RESULT_OK, nonce: this.m_mapNonce.get(address) as number};
        } else {
            return await this.getStorageNonce(address);
        }
    }

    public async getStorageNonce(s: string): Promise<{err: ErrorCode, nonce?: number}> {
        try {
            let dbr = await this.m_storageView!.getReadableDataBase(Chain.dbSystem);
            if (dbr.err) {
                this.m_logger.error(`get system database failed ${dbr.err}`);
                return {err: dbr.err};
            }
            let nonceTableInfo = await dbr.value!.getReadableKeyValue(Chain.kvNonce);
            if (nonceTableInfo.err) {
                this.m_logger.error(`getStorageNonce, getReadableKeyValue failed,errcode=${nonceTableInfo.err}`);
                return {err: nonceTableInfo.err};
            }
            let ret = await nonceTableInfo.kv!.get(s);
            if (ret.err) {
                if (ret.err === ErrorCode.RESULT_NOT_FOUND) {
                    return {err: ErrorCode.RESULT_OK, nonce: -1};
                }
                return {err: ret.err};
            }
            return {err: ErrorCode.RESULT_OK, nonce: ret.value as number};
        } catch (error) {
            this.m_logger.error(`getStorageNonce exception, error=${error},address=${s}`);
            return {err: ErrorCode.RESULT_EXCEPTION};
        }
    }

    protected async removeTx() {
        let index: number = 0;
        while (true) {
            if (index === this.m_transactions.length) {
                break;
            }
            let tx: Transaction = this.m_transactions[index].tx;
            let {err, nonce} = await this.getStorageNonce(tx.address as string);
            if (tx.nonce <= nonce!) {
                this.m_transactions.splice(index, 1);
                if (this.m_mapNonce.has(tx.address as string)) {
                    if ((this.m_mapNonce.get(tx.address as string) as number) <= nonce!) {
                        this.m_mapNonce.delete(tx.address  as string);
                    }
                }
            } else {
                index++;
            }
        }

        for (let [address, l] of this.m_orphanTx) {
            while (true) {
                if (l.length === 0) {
                    break;
                }
                let {err, nonce} = await this.getStorageNonce(l[0].tx.address as string);
                if (l[0].tx.nonce <= nonce!) {
                    l.shift();
                } else {
                    break;
                }
            }
        }
        let keys: string[] = [...this.m_orphanTx.keys()];
        for (let address of keys) {
            await this.ScanOrphan(address);
        }
    }

    protected addToOrphan(s: string, txTime: TransactionWithTime) {
        let l: TransactionWithTime[];
        if (this.m_orphanTx.has(s)) {
            l = this.m_orphanTx.get(s) as TransactionWithTime[];
        } else {
            l = new Array<TransactionWithTime>();
            this.m_orphanTx.set(s, l);
        }
        if (l.length === 0) {
            l.push(txTime);
        } else {
            for (let i = 0; i < l.length; i++) {
                if (txTime.tx.nonce < l[i].tx.nonce) {
                    l.splice(i, 0, txTime);
                    break;
                }
            }
        }
    }

    protected async ScanOrphan(s: string) {
        if (!this.m_orphanTx.has(s)) {
            return;
        }

        let l: TransactionWithTime[] = this.m_orphanTx.get(s) as TransactionWithTime[];

        let {err, nonce} = await this.getNonce(s);
        while (true) {
            if (l.length === 0) {
                this.m_orphanTx.delete(s);
                break;
            }

            if (this.isTimeout(l[0])) {
                l.shift();
                break;
            }

            if (nonce! + 1 !== l[0].tx.nonce) {
                break;
            }

            this.addToQueue(l.shift() as TransactionWithTime);
            nonce!++;
        }
    }

    protected isTimeout(txTime: TransactionWithTime): boolean {
        return Date.now() >= txTime.ct + this.m_txLiveTime * 1000;
    }

    protected addToQueue(txTime: TransactionWithTime) {
        this.m_transactions.push(txTime);
        this.m_mapNonce.set(txTime.tx.address as string, txTime.tx.nonce);
    }

    protected async onReplaceTx(txNew: Transaction, txOld: Transaction): Promise<void> {

    }
}