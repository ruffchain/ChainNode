import {BigNumber} from 'bignumber.js';
import {ErrorCode} from '../error_code';

import {Transaction, BlockHeader, Receipt, BlockExecutor, TxListener, TransactionExecutor, Storage, IReadableKeyValue, IReadWritableKeyValue} from '../chain';
import {Context, ViewContext} from './context';
import {ValueHandler} from './handler';
import {ValueTransaction} from './transaction';
import {ValueBlockHeader} from './block';
import {ValueChain} from './chain';
import { LoggerInstance } from '../lib/logger_util';

// TODO: 这里的错误处理还非常不完善！！！！

export class ValueViewContext {
    constructor(protected kvBalance: IReadableKeyValue) {
        
    }

    async getBalance(address: string): Promise<BigNumber> {
        let retInfo = await this.kvBalance.get(address);
        return retInfo.err === ErrorCode.RESULT_OK ? new BigNumber(retInfo.value as string) : new BigNumber(0);
    }
}

export class ValueContext extends ValueViewContext {
    constructor(kvBalance: IReadWritableKeyValue) {
        super(kvBalance);
    }

    async transferTo(from: string, to: string, amount: BigNumber): Promise<ErrorCode> {
        let fromTotal = await this.getBalance(from);
        if (fromTotal.lt(amount)) {
            return ErrorCode.RESULT_NOT_ENOUGH;
        }
        await (this.kvBalance as IReadWritableKeyValue).set(from, fromTotal.minus(amount).toString());
        await (this.kvBalance as IReadWritableKeyValue).set(to, (await this.getBalance(to)).plus(amount).toString());
        return ErrorCode.RESULT_OK;
    }

    async issue(to: string, amount: BigNumber): Promise<ErrorCode> {
        let sh = await (this.kvBalance as IReadWritableKeyValue).set(to, (await this.getBalance(to)).plus(amount).toString());
        return ErrorCode.RESULT_OK;
    }
}

export class ValueBlockExecutor extends BlockExecutor {
    protected _newTransactionExecutor(l: TxListener, tx: ValueTransaction): TransactionExecutor {
        return new ValueTransactionExecutor(l, tx, this.m_logger);
    }

    protected async _executeEvent(bBeforeBlock: boolean): Promise<ErrorCode> {
        if (bBeforeBlock) {
            let l = (this.m_handler as ValueHandler).getMinerWageListener();
            let wage = await l(this.m_block.number);
            let kvBalance = (await this.m_storage.getReadWritableKeyValue(ValueChain.kvBalance)).kv!;
            let ve = new Context(kvBalance);
            await ve.issue((this.m_block.header as ValueBlockHeader).coinbase, wage);
        }
        return await super._executeEvent(bBeforeBlock);
    }    
}

export class ValueTransactionExecutor extends TransactionExecutor {
    protected m_toAddress: string = '';
    constructor(listener: TxListener, tx: Transaction, logger: LoggerInstance) {
        super(listener, tx, logger);
    }

    protected async prepareContext(blockHeader: BlockHeader, storage: Storage, externContext: any): Promise<any> {
        let context = await super.prepareContext(blockHeader, storage, externContext);
        
        Object.defineProperty(
            context, 'value', {
                writable: false,
                value: (this.m_tx as ValueTransaction).value
            } 
        );

        return context;
    }

    public async execute(blockHeader: BlockHeader, storage: Storage, externContext: any): Promise<{err: ErrorCode, receipt?: Receipt}> {
        let nonceErr = await this._dealNonce(this.m_tx, storage);
        if (nonceErr !== ErrorCode.RESULT_OK) {
            return {err:  nonceErr};
        }

        let kvBalance = (await storage.getReadWritableKeyValue(ValueChain.kvBalance)).kv!;
        let fromAddress: string = this.m_tx.address!;
        let nToValue: BigNumber = (this.m_tx as ValueTransaction).value;
        let nFee: BigNumber = (this.m_tx as ValueTransaction).fee;
        
        let ve = new Context(kvBalance);
        if ((await ve.getBalance(fromAddress)).lt(nToValue.plus(nFee))) {
            return {err: ErrorCode.RESULT_NOT_ENOUGH};
        }
        
        let context: any = await this.prepareContext(blockHeader, storage, externContext);

        let receipt: Receipt = new Receipt();
        let work = await storage.beginTransaction();
        if (work.err) {
            return {err: work.err};
        }
        let err = await ve.transferTo(fromAddress, ValueChain.sysAddress, nToValue);
        if (err) {
            await work.value!.rollback();
            return {err};
        }
        receipt.returnCode = await this._execute(context, this.m_tx.input);
        receipt.transactionHash = this.m_tx.hash;
        if (receipt.returnCode) {
            await work.value!.rollback();
        } else {
            receipt.eventLogs = this.m_logs;
            err = await work.value!.commit();
        }
        err = await ve.transferTo(fromAddress, (blockHeader as ValueBlockHeader).coinbase, nFee);
        if (err) {
            return {err};
        }
        return {err: ErrorCode.RESULT_OK, receipt};
    }
}
