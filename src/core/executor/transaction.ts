import {ErrorCode} from '../error_code';
import {Chain, BlockHeader, Storage, Transaction, EventLog, Receipt} from '../chain';
import {TxListener, BlockHeightListener} from './handler';

import { LoggerInstance } from '../lib/logger_util';

class BaseExecutor {
    protected m_logger: LoggerInstance;
    constructor(logger: LoggerInstance) {
        this.m_logger = logger;
    }
    protected async prepareContext(blockHeader: BlockHeader, storage: Storage, externContext: any): Promise<any> {
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

export class TransactionExecutor extends BaseExecutor {
    protected m_listener: TxListener;
    protected m_tx: Transaction;
    protected m_logs: EventLog[] = [];

    constructor(listener: TxListener, tx: Transaction, logger: LoggerInstance) {
        super(logger);
        this.m_listener = listener;
        this.m_tx = tx;
    }

    protected async _dealNonce(tx: Transaction, storage: Storage): Promise<ErrorCode> {
        // 检查nonce
        let kvr = await storage.getReadWritableKeyValue(Chain.kvNonce);
        if (kvr.err !== ErrorCode.RESULT_OK) {
            this.m_logger.error(`methodexecutor, _dealNonce, getReadWritableKeyValue failed`);
            return kvr.err;
        }
        let nonce: number = -1;
        let nonceInfo = await kvr.kv!.get(tx.address!);
        if (nonceInfo.err === ErrorCode.RESULT_OK) {
           nonce = nonceInfo.value as number;
        }
        if (tx.nonce !== nonce + 1) {
            this.m_logger.error(`methodexecutor, _dealNonce, nonce error,nonce should ${nonce + 1}, but ${tx.nonce}, txhash=${tx.hash}`);
            return ErrorCode.RESULT_ERROR_NONCE_IN_TX;
        }
        await kvr.kv!.set(tx.address!, tx.nonce);
        return ErrorCode.RESULT_OK;
    }

    public async execute(blockHeader: BlockHeader, storage: Storage, externContext: any): Promise<{err: ErrorCode, receipt?: Receipt}> {
        let nonceErr = await this._dealNonce(this.m_tx, storage);
        if (nonceErr !== ErrorCode.RESULT_OK) {
            return {err: nonceErr};
        }
        let context = await this.prepareContext(blockHeader, storage, externContext);
        let receipt: Receipt = new Receipt();
        let work = await storage.beginTransaction();
        if (work.err) {
            this.m_logger.error(`methodexecutor, beginTransaction error,storagefile=${storage.filePath}`);
            return {err: work.err};
        }
        receipt.returnCode = await this._execute(context, this.m_tx.input);
        receipt.transactionHash = this.m_tx.hash;
        if (receipt.returnCode) {
            await work.value!.rollback();
        } else {
            let err = await work.value!.commit();
            if (err) {
                this.m_logger.error(`methodexecutor, transaction commit error,storagefile=${storage.filePath}`);
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
            this.m_logger.error(`execute method linstener e=${e}`);
            return ErrorCode.RESULT_EXECUTE_ERROR;
        }
    }

    protected async prepareContext(blockHeader: BlockHeader, storage: Storage, externContext: any): Promise<any> {
        let context = await super.prepareContext(blockHeader, storage, externContext);

        // 执行上下文
        context.emit = (name: string, param?: any) => {
            let log: EventLog = new EventLog();
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
    protected m_listener: BlockHeightListener;
    protected m_bBeforeBlockExec = true;

    constructor(listener: BlockHeightListener, bBeforeBlockExec: boolean, logger: LoggerInstance) {
        super(logger);
        this.m_listener = listener;
        this.m_bBeforeBlockExec = bBeforeBlockExec;
    }

    public async execute(blockHeader: BlockHeader, storage: Storage, externalContext: any): Promise<{err: ErrorCode, returnCode?: ErrorCode}> {
        let context: any = await this.prepareContext(blockHeader, storage, externalContext);
        let work = await storage.beginTransaction();
        if (work.err) {
            this.m_logger.error(`eventexecutor, beginTransaction error,storagefile=${storage.filePath}`);
            return {err: work.err};
        }
        let returnCode: ErrorCode;
        try {
            returnCode = await this.m_listener(context, this.m_bBeforeBlockExec);
        } catch (e) {
            this.m_logger.error(`execute event linstener error, e=${e}`);
            returnCode = ErrorCode.RESULT_EXCEPTION;
        }

        if (returnCode === ErrorCode.RESULT_OK) {
            let err = await work.value.commit();
            if (err) {
                this.m_logger.error(`eventexecutor, transaction commit error,storagefile=${storage.filePath}`);
                return {err};
            }
        } else {
            await work.value.rollback();
        }
       
        return {err: ErrorCode.RESULT_OK, returnCode};
    }
}
