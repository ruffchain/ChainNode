import {Chain} from '../chain/chain';
import * as TX from '../chain/transaction';
import * as Handler from '../executor/handler';
import * as BlockModule from '../chain/block';
import {IReadableKeyValue, IReadWritableKeyValue, Storage, IReadWritableStorage} from '../storage/storage';
import {ErrorCode} from '../error_code';
import { closeSync } from 'fs';
import * as EventEmitter from 'events';


class BaseExecutor {
    protected async prepareContext(blockHeader: BlockModule.BlockHeader, storage: Storage, externContext: any): Promise<any> {
        let kv =  (await storage.getReadWritableKeyValue(Chain.kvUser)).kv!;
        let context = Object.create(externContext);
        
        // context.getNow = (): number => {
        //     return blockHeader.timestamp;
        // };

        Object.defineProperty(
            context, 'now', {
                writable: false,
                value: blockHeader.timestamp
            } 
        );
        
        // context.getHeight = (): number => {
        //     return blockHeader.number;
        // };

        Object.defineProperty(
            context, 'height', {
                writable: false,
                value: blockHeader.number
            } 
        );

        // context.getStorage = (): IReadWritableKeyValue => {
        //     return kv;
        // }

        Object.defineProperty(
            context, 'storage', {
                writable: false,
                value: kv
            } 
        );

        return context;
    }
}

export class MethExecutor extends BaseExecutor 
{
    protected m_listener: Handler.TxListener;
    protected m_tx: TX.Transaction;
    protected m_logs: TX.EventLog[] = [];

    constructor(listener: Handler.TxListener, tx: TX.Transaction) {
        super();
        this.m_listener = listener;
        this.m_tx = tx;
    }

    protected async _dealNonce(tx: TX.Transaction, storage: Storage): Promise<ErrorCode> {
        //检查nonce
        let kvr = await storage.getReadWritableKeyValue(Chain.kvNonce);
        if (kvr.err !== ErrorCode.RESULT_OK) {
            return kvr.err;
        }
        let nonce: number = -1;
        let nonceInfo = await kvr.kv!.get(tx.address!);
        if (nonceInfo.err === ErrorCode.RESULT_OK) {
           nonce = nonceInfo.value as number;
        }
        if (tx.nonce !== nonce+1) {
            return ErrorCode.RESULT_ERROR_NONCE_IN_TX;
        }
        await kvr.kv!.set(tx.address!, tx.nonce);
        return ErrorCode.RESULT_OK;
    }

    public async execute(blockHeader: BlockModule.BlockHeader, storage: Storage, externContext: any): Promise<{err: ErrorCode, receipt?: TX.Receipt}> {
        let nonceErr = await this._dealNonce(this.m_tx, storage);
        if (nonceErr !== ErrorCode.RESULT_OK) {
            return {err: nonceErr};
        }
        let context = await this.prepareContext(blockHeader, storage, externContext);
        let receipt: TX.Receipt = new TX.Receipt();
        let work = await storage.beginTransaction();
        if (work.err) {
            return {err: work.err};
        }
        receipt.returnCode = await this._execute(context, this.m_tx.input);
        receipt.transactionHash = this.m_tx.hash;
        if (receipt.returnCode) {
            await work.value!.rollback();
        } else {
            let err = await work.value!.commit();
            if (err) {
                return {err};
            }
            receipt.eventLogs = this.m_logs;
        }
        
        return {err: ErrorCode.RESULT_OK, receipt};
    }

    protected async _execute(env: any, input: any): Promise<ErrorCode> {
        try {
            return await this.m_listener(env, this.m_tx.input);
        } catch (e) {
            return ErrorCode.RESULT_EXECUTE_ERROR;
        }
    }

    protected async prepareContext(blockHeader: BlockModule.BlockHeader, storage: Storage, externContext: any): Promise<any> {
        let context = await super.prepareContext(blockHeader, storage, externContext);

        //执行上下文
        context.emit = (name:string, param?: any) => {
            let log: TX.EventLog = new TX.EventLog();
            log.name = name;
            log.param = param;
            this.m_logs.push(log);
        };
        // context.getCaller = ():string =>{
        //     return this.m_tx.address!;
        // };

        Object.defineProperty(
            context, 'caller', {
                writable: false,
                value: this.m_tx.address!
            } 
        );

        return context;
    }
}

export class EventExecutor extends BaseExecutor {
    protected m_listener: Handler.BlockHeightListener;
    protected m_bBeforeBlockExec = true;

    constructor(listener: Handler.BlockHeightListener, bBeforeBlockExec: boolean) {
        super();
        this.m_listener = listener;
        this.m_bBeforeBlockExec = bBeforeBlockExec;
    }

    public async execute(blockHeader: BlockModule.BlockHeader, storage: Storage, externalContext: any): Promise<{err: ErrorCode, returnCode?: ErrorCode}> {
        let context: any = await this.prepareContext(blockHeader, storage, externalContext);
        let work = await storage.beginTransaction();
        if (work.err) {
            return {err: work.err};
        }
        let returnCode: ErrorCode;
        try {
            returnCode = await this.m_listener(context, this.m_bBeforeBlockExec);
        } catch (e) {
            returnCode = ErrorCode.RESULT_EXCEPTION;
        }

        if (returnCode === ErrorCode.RESULT_OK) {
            let err = await work.value.commit();
            if (err) {
                return {err};
            }
        } else {
            await work.value.rollback();
        }
       
        return {err: ErrorCode.RESULT_OK, returnCode};
    }
}
