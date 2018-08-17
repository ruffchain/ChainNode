import assert = require('assert');

import {ErrorCode} from '../error_code';
import {Block, Transaction, Receipt, Storage} from '../chain';
import {BaseHandler, TxListener, BlockHeightListener} from './handler';
import {EventExecutor, TransactionExecutor} from './transaction';
import { LoggerInstance } from '../lib/logger_util';

export type BlockExecutorOptions = {
    storage: Storage, 
    block: Block,
    handler: BaseHandler, 
    logger: LoggerInstance,
    externContext: any,
    globalOptions: any
};

export class BlockExecutor {
    protected m_storage: Storage;
    protected m_handler: BaseHandler;
    protected m_block: Block;
    protected m_externContext: any;
    protected m_logger: LoggerInstance;
    protected m_globalOptions: any;
    constructor(options: BlockExecutorOptions) {
        this.m_storage = options.storage;
        this.m_handler = options.handler;
        this.m_block = options.block;
        this.m_externContext = options.externContext;
        this.m_logger = options.logger;
        Object.defineProperty(
            this.m_externContext, 'logger', {
                writable: false,
                value: this.m_logger
            }
        );
        this.m_globalOptions = options.globalOptions;
    }

    public get externContext(): any {
        return this.m_externContext;
    }

    protected _newTransactionExecutor(l: TxListener, tx: Transaction): TransactionExecutor {
        return new TransactionExecutor(l, tx, this.m_logger);
    }
    
    protected _newEventExecutor(l: BlockHeightListener): EventExecutor {
        return new EventExecutor(l, this.m_logger);
    }
 
    public async execute(): Promise<ErrorCode> {      
        return await this._execute(this.m_block);
    }

    public async verify(): Promise<{err: ErrorCode, valid?: boolean}> {
        let oldBlock = this.m_block;
        this.m_block = this.m_block.clone();
        let err = await this.execute();
        if (err) {
            return {err};
        }
        return {err: ErrorCode.RESULT_OK, 
            valid: this.m_block.hash === oldBlock.hash};
    } 

    protected async _execute(block: Block): Promise<ErrorCode> {
        this.m_logger.info(`begin execute block ${block.number}`);
        this.m_storage.createLogger();
        let err = await this._executePreBlockEvent();
        if (err) {
            this.m_logger.error(`blockexecutor execute begin_event failed,errcode=${err},blockhash=${block.hash}`);
            return err;
        }
        let ret = await this._executeTx();
        if (ret.err) {
            this.m_logger.error(`blockexecutor execute method failed,errcode=${ret.err},blockhash=${block.hash}`);
            return ret.err;
        }
        err = await this._executePostBlockEvent();
        if (err) {
            this.m_logger.error(`blockexecutor execute end_event failed,errcode=${err},blockhash=${block.hash}`);
            return err;
        }

        let receipts: Receipt[] = ret.value!;
        // 票据
        block.content.setReceipts(receipts);
        // 更新块信息
        await this.updateBlock(block);

        return ErrorCode.RESULT_OK;
    }

    protected async _executePreBlockEvent(): Promise<ErrorCode> {
        if (this.m_block.number === 0) {
            // call initialize
            if (this.m_handler.genesisListener) {
                let exec = this._newEventExecutor(this.m_handler.genesisListener);
                let ret = await exec.execute(this.m_block.header, this.m_storage, this.m_externContext);
                if (ret.err || ret.returnCode) {
                    this.m_logger.error(`handler's genesisListener execute failed`);
                    return ErrorCode.RESULT_EXCEPTION;
                }
            }
        }
        let listeners = await this.m_handler.getPreBlockListeners(this.m_block.number);
        for (let l of listeners) {
            let exec = this._newEventExecutor(l);
            let ret = await exec.execute(this.m_block.header, this.m_storage, this.m_externContext);
            if (ret.err) {
                return ret.err;
            }
        }
        return ErrorCode.RESULT_OK;
    }

    protected async _executePostBlockEvent(): Promise<ErrorCode> {
        let listeners = await this.m_handler.getPostBlockListeners(this.m_block.number);
        for (let l of listeners) {
            let exec = this._newEventExecutor(l);
            let ret = await exec.execute(this.m_block.header, this.m_storage, this.m_externContext);
            if (ret.err) {
                return ret.err;
            }
        }
        return ErrorCode.RESULT_OK;
    }

    protected async _executeTx(): Promise<{ err: ErrorCode, value?: Receipt[] }> {
        let receipts: Receipt[] = [];
        // 执行tx
        for (let tx of this.m_block.content.transactions) {
            let listener: TxListener|undefined = this.m_handler.getListener(tx.method);
            if (!listener) {
                this.m_logger.error(`not find listener,method name=${tx.method}`);
                return {err: ErrorCode.RESULT_NOT_SUPPORT};
            }
            let exec = this._newTransactionExecutor(listener!, tx);
            let ret = await exec.execute(this.m_block.header, this.m_storage, this.m_externContext);
            if (ret.err) {
                return {err: ret.err};
            }
            receipts.push(ret.receipt as Receipt);
        }
        return { err: ErrorCode.RESULT_OK, value: receipts };
    }

    protected async updateBlock(block: Block) {
        // 写回数据库签名
        block.header.storageHash = (await this.m_storage.messageDigest()).value;
        block.header.updateContent(block.content);
        block.header.updateHash();
    }
}