import {BigNumber} from 'bignumber.js';
import {ErrorCode} from '../error_code';
import {isValidAddress} from '../address';

import {Transaction, BlockHeader, Receipt, BlockExecutor, TxListener, TransactionExecutor, Storage, IReadableKeyValue, IReadWritableKeyValue, Chain, TransactionExecuteflag} from '../chain';
import {Context} from './context';
import {ValueHandler} from './handler';
import {ValueTransaction} from './transaction';
import {ValueBlockHeader} from './block';
import {ValueChain} from './chain';
import { LoggerInstance } from '../lib/logger_util';
import { isNumber } from 'util';

const assert = require('assert');

export class ValueBlockExecutor extends BlockExecutor {
    protected _newTransactionExecutor(l: TxListener, tx: ValueTransaction): TransactionExecutor {
        return new ValueTransactionExecutor(l, tx, this.m_logger);
    }

    async executeMinerWageEvent(): Promise<ErrorCode> {
        let l = (this.m_handler as ValueHandler).getMinerWageListener();
        let wage = await l(this.m_block.number);
        let kvBalance = (await this.m_storage.getKeyValue(Chain.dbSystem, ValueChain.kvBalance)).kv!;
        let ve = new Context(kvBalance);
        let coinbase = (this.m_block.header as ValueBlockHeader).coinbase;
        assert(isValidAddress(coinbase), `block ${this.m_block.hash} has no coinbase set`);
        if (!isValidAddress(coinbase)) {
            coinbase = ValueChain.sysAddress;
        }
        return await ve.issue(coinbase, wage);
    }

    protected async _executePreBlockEvent(): Promise<ErrorCode> {
        const err = await this.executeMinerWageEvent();
        if (err) {
            return err;
        }
        return await super._executePreBlockEvent();
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

    public async execute(blockHeader: BlockHeader, storage: Storage, externContext: any, flag?: TransactionExecuteflag): Promise<{err: ErrorCode, receipt?: Receipt}> {
        if (!(flag && flag.ignoreNoce)) {
            let nonceErr = await this._dealNonce(this.m_tx, storage);
            if (nonceErr !== ErrorCode.RESULT_OK) {
                return {err:  nonceErr};
            }
        } 
        let kvBalance = (await storage.getKeyValue(Chain.dbSystem, ValueChain.kvBalance)).kv!;
        let fromAddress: string = this.m_tx.address!;
        let nToValue: BigNumber = (this.m_tx as ValueTransaction).value;
        let nFee: BigNumber = (this.m_tx as ValueTransaction).fee;

        let receipt: Receipt = new Receipt(); 
        let ve = new Context(kvBalance);
        if ((await ve.getBalance(fromAddress)).lt(nToValue.plus(nFee))) {
            receipt.returnCode = ErrorCode.RESULT_NOT_ENOUGH;
            receipt.transactionHash = this.m_tx.hash; 
            return {err: ErrorCode.RESULT_OK, receipt};
        }
        
        let context: any = await this.prepareContext(blockHeader, storage, externContext);

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
        assert(isNumber(receipt.returnCode), `invalid handler return code ${receipt.returnCode}`);
        if (!isNumber(receipt.returnCode)) {
            this.m_logger.error(`methodexecutor failed for invalid handler return code type, return=`, receipt.returnCode);
            return {err: ErrorCode.RESULT_INVALID_PARAM};
        }
        receipt.transactionHash = this.m_tx.hash;
        if (receipt.returnCode) {
            await work.value!.rollback();
        } else {
            receipt.eventLogs = this.m_logs;
            err = await work.value!.commit();
        }
        let coinbase = (blockHeader as ValueBlockHeader).coinbase;
        assert(isValidAddress(coinbase), `block ${blockHeader.hash} has no coinbase set`);
        if (!isValidAddress(coinbase)) {
            coinbase = ValueChain.sysAddress;
        }
        err = await ve.transferTo(fromAddress, coinbase, nFee);
        if (err) {
            return {err};
        }
        return {err: ErrorCode.RESULT_OK, receipt};
    }
}
