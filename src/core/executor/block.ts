import assert = require('assert');

import {ErrorCode} from '../error_code';

import {StorageManager} from '../storage/storage_manager';
import * as BlockModule from '../chain/block';
import * as TX from '../chain/transaction';
import {Storage} from '../storage/storage';
import * as Handler from '../executor/handler';
import {EventExecutor, MethExecutor} from './transaction';


export type BlockExecutorOptions = {
    storage: Storage, 
    block: BlockModule.Block,
    handler: Handler.BaseHandler, 
    externContext: any
};

export class BlockExecutor {
    protected m_storage: Storage;
    protected m_handler: Handler.BaseHandler;
    protected m_block:BlockModule.Block;
    protected m_externContext: any;
    constructor(options: BlockExecutorOptions) {
        this.m_storage = options.storage;
        this.m_handler = options.handler;
        this.m_block = options.block;
        this.m_externContext = options.externContext;
    }

    // public async init(): Promise<ErrorCode> {
    //     return ErrorCode.RESULT_OK;
    // }


    public async uninit(): Promise<void> {
        
    }

    public get externContext():any {
        return this.m_externContext;
    }

    protected _newMethExecutor(l: Handler.TxListener, tx: TX.Transaction): MethExecutor {
        return new MethExecutor(l, tx);
    }
    
    protected _newEventExecutor(l: Handler.BlockHeightListener, b: boolean): EventExecutor {
        return new EventExecutor(l, b);
    }
 
    public async execute(): Promise<ErrorCode>{      
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

    protected async _execute(block: BlockModule.Block): Promise<ErrorCode>{
        this.m_storage.createLogger();
        let err = await this._executeEvent(true);
        if (err) {
            return err;
        }
        let ret = await this._executeTx();
        if (ret.err) {
            return ret.err;
        }
        err = await this._executeEvent(false);
        if (err) {
            return err;
        }

        let receipts: TX.Receipt[] = ret.value!;
        //票据
        block.content.setReceipts(receipts);
        //更新块信息
        await this.updateBlock(block);

        return ErrorCode.RESULT_OK;
    }

    protected async _executeEvent(bBeforeBlock: boolean): Promise<ErrorCode> {
        let listeners = await this.m_handler.getBlockHeightListeners(this.m_block.number);
        for (let l of listeners) {
            let exec = this._newEventExecutor(l!, bBeforeBlock);
            let ret = await exec.execute(this.m_block.header, this.m_storage, this.m_externContext);
            if (ret.err) {
                return ret.err;
            }
        }
        return ErrorCode.RESULT_OK;
    }

    protected async _executeTx(): Promise<{ err: ErrorCode, value?: TX.Receipt[] }> {
        let receipts: TX.Receipt[] = [];
        //执行tx
        for (let tx of this.m_block.content.transactions) {
            let listener: Handler.TxListener|undefined = this.m_handler.getListener(tx.method);
            if (!listener) {
                return {err: ErrorCode.RESULT_NOT_SUPPORT};
            }
            let exec = this._newMethExecutor(listener!, tx);
            let ret = await exec.execute(this.m_block.header, this.m_storage, this.m_externContext);
            if (ret.err) {
                return {err: ret.err};
            }
            receipts.push(ret.receipt as TX.Receipt);
        }
        return { err: ErrorCode.RESULT_OK, value: receipts };
    }

    protected async updateBlock(block: BlockModule.Block) {
        //写回数据库签名
        block.header.storageHash = (await this.m_storage.messageDigest()).value;
        block.header.updateContent(block.content);
        block.header.updateHash();
    }
}