import {BigNumber} from 'bignumber.js';
import * as LibAddress from '../address';
import {ErrorCode} from '../error_code';

import {Storage, IReadableKeyValue, IReadWritableKeyValue} from '../storage/storage';
import * as TxBase from '../chain/transaction';
import * as BaseBlockExecutor from '../executor/block';
import * as BaseHandler from '../executor/handler';
import * as  BaseTxExecutor from '../executor/transaction';

import {ValueHandler} from './handler';
import {BlockHeader} from './block';
import {Transaction} from './transaction';
import {Chain} from './chain';

// TODO: 这里的错误处理还非常不完善！！！！

export class ValueViewContext {
    constructor(protected kvBalance: IReadableKeyValue) {
        
    }

    async getBalance(address: string): Promise<BigNumber> {
        let retInfo = await this.kvBalance.get(address);
        return retInfo.err === ErrorCode.RESULT_OK? new BigNumber(retInfo.value as string): new BigNumber(0);
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
        await (<IReadWritableKeyValue>this.kvBalance).set(from, fromTotal.minus(amount).toString());
        await (<IReadWritableKeyValue>this.kvBalance).set(to,(await this.getBalance(to)).plus(amount).toString());
        return ErrorCode.RESULT_OK;
    }

    async issue(to: string, amount: BigNumber): Promise<ErrorCode> {
        let sh = await (<IReadWritableKeyValue>this.kvBalance).set(to, (await this.getBalance(to)).plus(amount).toString());
        return ErrorCode.RESULT_OK;
    }
}


export class BlockExecutor extends BaseBlockExecutor.BlockExecutor {
    protected _newMethExecutor(l: BaseHandler.TxListener, tx: TxBase.Transaction): MethExecutor {
        return new MethExecutor(l, tx);
    }

    protected async _executeEvent(bBeforeBlock: boolean): Promise<ErrorCode> {
        if (bBeforeBlock) {
            let l = (<ValueHandler>this.m_handler).getMinerWageListener();
            let wage = await l(this.m_block.number);
            let kvBalance = (await this.m_storage.getReadWritableKeyValue(Chain.kvBalance)).kv!;
            let ve = new ValueContext(kvBalance);
            await ve.issue((<BlockHeader>this.m_block.header).coinbase, wage);
        }
        return await super._executeEvent(bBeforeBlock);
    }    
}


export class MethExecutor extends BaseTxExecutor.MethExecutor {
    protected m_toAddress: string = '';
    constructor(listener: BaseHandler.TxListener, tx: TxBase.Transaction) {
        super(listener, tx);
    }

    protected async prepareContext(blockHeader: BlockHeader, storage: Storage, externContext: any): Promise<any> {
        let context = await super.prepareContext(blockHeader, storage, externContext);
        
        Object.defineProperty(
            context, 'value', {
                writable: false,
                value: (<Transaction>this.m_tx).value
            } 
        );

        return context;
    }

    public async execute(blockHeader: BlockHeader, storage: Storage, externContext: any): Promise<{err: ErrorCode, receipt?: TxBase.Receipt}> {
        let nonceErr = await this._dealNonce(this.m_tx, storage);
        if (nonceErr !== ErrorCode.RESULT_OK) {
            return {err:  nonceErr};
        }

        let kvBalance = (await storage.getReadWritableKeyValue(Chain.kvBalance)).kv!;
        let fromAddress: string = this.m_tx.address!;
        let nToValue: BigNumber = (<Transaction>this.m_tx).value;
        let nFee: BigNumber = (<Transaction>this.m_tx).fee;
        
        let ve = new ValueContext(kvBalance);
        if ((await ve.getBalance(fromAddress)).lt(nToValue.plus(nFee))) {
            return {err: ErrorCode.RESULT_NOT_ENOUGH};
        }
        
        let context: any = await this.prepareContext(blockHeader, storage, externContext);

        let receipt: TxBase.Receipt = new TxBase.Receipt();
        let work = await storage.beginTransaction();
        if (work.err) {
            return {err: work.err};
        }
        let err = await ve.transferTo(fromAddress, Chain.sysAddress, nToValue);
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
        err = await ve.transferTo(fromAddress, blockHeader.coinbase, nFee);
        if (err) {
            return {err};
        }
        return {err: ErrorCode.RESULT_OK, receipt};
    }
}


