import assert = require('assert');

import {ErrorCode} from '../error_code';
import {Block, Transaction, Receipt, Storage, ReceiptSourceType} from '../chain';
import {BaseHandler, TxListener, BlockHeightListener} from './handler';
import {EventExecutor, TransactionExecutor, TransactionExecuteflag} from './transaction';
import {BlockExecutorExternParam} from './external_param';
import { LoggerInstance } from '../lib/logger_util';

export type BlockExecutorOptions = {
    storage: Storage, 
    block: Block,
    handler: BaseHandler, 
    logger: LoggerInstance,
    externContext: any,
    globalOptions: any,
    // 额外参数
    externParams: BlockExecutorExternParam[],
};

export class BlockExecutor {
    protected m_storage: Storage;
    protected m_handler: BaseHandler;
    protected m_block: Block;
    protected m_externContext: any;
    protected m_logger: LoggerInstance;
    protected m_globalOptions: any;
    protected m_externParams: any;

    constructor(options: BlockExecutorOptions) {
        this.m_storage = options.storage;
        this.m_handler = options.handler;
        this.m_block = options.block;
        this.m_externContext = options.externContext;
        this.m_logger = options.logger;
        this.m_externParams = options.externParams.slice(0);
        Object.defineProperty(
            this.m_externContext, 'logger', {
                writable: false,
                value: this.m_logger
            }
        );
        this.m_globalOptions = options.globalOptions;
    }

    public finalize() {
        for (const ep of this.m_externParams) {
            ep.finalize();
        }
    }

    public get externContext(): any {
        return this.m_externContext;
    }

    protected _newTransactionExecutor(l: TxListener, tx: Transaction): TransactionExecutor {
        return new TransactionExecutor(this.m_handler, l, tx, this.m_logger);
    }
    
    protected _newEventExecutor(l: BlockHeightListener): EventExecutor {
        return new EventExecutor(this.m_handler, l, this.m_logger);
    }
 
    public async execute(): Promise<ErrorCode> {
        let t1: number = Date.now();
        let ret = await this._execute(this.m_block);
        let t2: number = Date.now();
        this.m_logger.info(`runblock time====${t2 - t1}, count=${this.m_block.content.transactions.length}`);
        return ret;
    }

    public async verify(): Promise<{err: ErrorCode, valid?: ErrorCode}> {
        let oldBlock = this.m_block;
        this.m_block = this.m_block.clone();
        let err = await this.execute();
        if (err) {
            if (err === ErrorCode.RESULT_TX_CHECKER_ERROR) {
                return {err: ErrorCode.RESULT_OK, valid: ErrorCode.RESULT_TX_CHECKER_ERROR};
            } else {
                return {err};
            }
        }
        if (this.m_block.hash !== oldBlock.hash) {
            this.m_logger.error(`block ${oldBlock.number} hash mismatch!! 
            except storage hash ${oldBlock.header.storageHash}, actual ${this.m_block.header.storageHash}
            except hash ${oldBlock.hash}, actual ${this.m_block.hash}
            `);
        }
        if (this.m_block.hash === oldBlock.hash) {
            return {err: ErrorCode.RESULT_OK, valid: ErrorCode.RESULT_OK}; 
        } else {
            return {err: ErrorCode.RESULT_OK, valid: ErrorCode.RESULT_VERIFY_NOT_MATCH};
        }
    } 

    protected async _execute(block: Block): Promise<ErrorCode> {
        this.m_logger.info(`begin execute block ${block.number}`);
        let receipts = [];
        let ebr = await this.executePreBlockEvent();
        if (ebr.err) {
            this.m_logger.error(`blockexecutor execute begin_event failed,errcode=${ebr.err},blockhash=${block.hash}`);
            return ebr.err;
        }
        receipts.push(...ebr.receipts!);
        ebr = await this._executeTransactions();
        if (ebr.err) {
            this.m_logger.error(`blockexecutor execute method failed,errcode=${ebr.err},blockhash=${block.hash}`);
            return ebr.err;
        }
        receipts.push(...ebr.receipts!);
        ebr = await this.executePostBlockEvent();
        if (ebr.err) {
            this.m_logger.error(`blockexecutor execute end_event failed,errcode=${ebr.err},blockhash=${block.hash}`);
            return ebr.err;
        }
        receipts.push(...ebr.receipts!);
        
        // 票据
        block.content.setReceipts(receipts);
        // 更新块信息
        return await this._updateBlock(block);
    }

    public async executeBlockEvent(listener: BlockHeightListener): Promise<{err: ErrorCode, receipt?: Receipt}> {
        let exec = this._newEventExecutor(listener);
        let ret = await exec.execute(this.m_block.header, this.m_storage, this.m_externContext);
        if (ret.err) {
            this.m_logger.error(`block event execute failed`);
        }
        return ret;
    }

    public async executePreBlockEvent(): Promise<{err: ErrorCode, receipts?: Receipt[]}> {
        if (this.m_block.number === 0) {
            // call initialize
            if (this.m_handler.genesisListener) {
                const eber = await this.executeBlockEvent(this.m_handler.genesisListener); 
                if (eber.err || eber.receipt!.returnCode) {
                    this.m_logger.error(`handler's genesisListener execute failed`);
                    return {err: ErrorCode.RESULT_EXCEPTION};
                }
            }
        }
        let receipts = [];
        let listeners = await this.m_handler.getPreBlockListeners(this.m_block.number);
        for (const l of listeners) {
            const eber = await this.executeBlockEvent(l.listener); 
            if (eber.err) {
                return {err: eber.err};
            }
            eber.receipt!.setSource({sourceType: ReceiptSourceType.preBlockEvent, eventIndex: l.index});
            receipts.push(eber.receipt!);
        }
        return {err: ErrorCode.RESULT_OK, receipts};
    }

    public async executePostBlockEvent(): Promise<{err: ErrorCode, receipts?: Receipt[]}> {
        let receipts = [];
        let listeners = await this.m_handler.getPostBlockListeners(this.m_block.number);
        for (const l of listeners) {
            const eber = await this.executeBlockEvent(l.listener); 
            if (eber.err) {
                return {err: eber.err};
            }
            eber.receipt!.setSource({sourceType: ReceiptSourceType.postBlockEvent, eventIndex: l.index});
            receipts.push(eber.receipt!);
        }
        return {err: ErrorCode.RESULT_OK, receipts};
    }

    protected async _executeTransactions(): Promise<{ err: ErrorCode, receipts?: Receipt[] }> {
        let receipts: Receipt[] = [];
        // 执行tx
        for (let tx of this.m_block.content.transactions) {
            const ret = await this.executeTransaction(tx);
            if (ret.err) {
                return {err: ret.err};
            }
            receipts.push(ret.receipt as Receipt);
        }
        return { err: ErrorCode.RESULT_OK, receipts };
    }

    public async executeTransaction(tx: Transaction, flag?: TransactionExecuteflag): Promise<{err: ErrorCode, receipt?: Receipt}> {
        const checker = this.m_handler.getTxPendingChecker(tx.method);
        if (!checker || checker(tx)) {
            this.m_logger.error(`verfiy block failed for tx ${tx.hash} ${tx.method} checker failed`);
            return {err: ErrorCode.RESULT_TX_CHECKER_ERROR};
        }
        let listener: TxListener|undefined = this.m_handler.getTxListener(tx.method);
        assert(listener, `no listener for ${tx.method}`);
        if (!listener) {
            return {err: ErrorCode.RESULT_NOT_SUPPORT};
        }
        let exec = this._newTransactionExecutor(listener!, tx);
        let ret = await exec.execute(this.m_block.header, this.m_storage, this.m_externContext, flag);
        return ret;
    }

    protected async _updateBlock(block: Block): Promise<ErrorCode> {
        // 写回数据库签名
        const mdr = await this.m_storage.messageDigest();
        if (mdr.err) {
            return mdr.err;
        }
        block.header.storageHash = mdr.value!;
        block.header.updateContent(block.content);
        block.header.updateHash();
        return ErrorCode.RESULT_OK;
    }
}