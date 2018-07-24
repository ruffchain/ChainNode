import {PendingTransactions, TransactionWithTime} from '../chain';
import { ErrorCode } from '../error_code';
import {ValueTransaction} from './transaction';
import {BigNumber} from 'bignumber.js';
import {ValueChain} from './chain';

export class ValuePendingTransactions extends PendingTransactions {
    protected m_balance: Map<string, BigNumber> = new Map<string, BigNumber>();

    public async addTransaction(tx: ValueTransaction): Promise<ErrorCode> {
        let balance: BigNumber = await this.getBalance(tx.address as string);
        let totalUse: BigNumber = tx.value;
        if (balance.lt(totalUse.plus(tx.fee))) {
            this.m_logger.error(`addTransaction failed, need fee ${tx.fee.toString()} but balance ${balance.toString()}`);
            return ErrorCode.RESULT_NOT_ENOUGH;
        }

        let err = await super.addTransaction(tx);
        if (!err) {
            return err;
        }

        await this.updateBalance(tx.address as string, balance.minus(totalUse));

        return ErrorCode.RESULT_OK;
    }

    protected async getStorageBalance(s: string): Promise<BigNumber> {
        try {
            let kvr = await this.m_storageView!.getReadableKeyValue(ValueChain.kvBalance);
            if (kvr.err !== ErrorCode.RESULT_OK) {
                return new BigNumber(0);
            }
            let ret = await kvr.kv!.get(s);
            if (ret.err !== ErrorCode.RESULT_OK) {
                return new BigNumber(0);
            }
            return new BigNumber(ret.value as string);
        } catch (error) {
            this.m_logger.error(`getStorageBalance error=${error}`);
            return new BigNumber(0);
        }
    }

    // 获取pending中的balance
    protected async getBalance(s: string): Promise<BigNumber> {
        if (this.m_balance.has(s)) {
            return this.m_balance.get(s) as BigNumber;
        }
        return await this.getStorageBalance(s);
    }

    protected async checkSmallNonceTx(txNew: ValueTransaction, txOld: ValueTransaction): Promise<ErrorCode> {
        if (txNew.fee.gt(txOld.fee)) {
            await this.updateBalance(txNew.address as string, (await this.getBalance(txNew.address as string)).plus(txOld.value).minus(txNew.value).plus(txOld.fee).minus(txNew.fee));
            return ErrorCode.RESULT_OK;
        }

        return ErrorCode.RESULT_FEE_TOO_SMALL;
    }

    protected async updateBalance(address: string, v: BigNumber) {
        let b: BigNumber = await this.getStorageBalance(address);
        if (b.isEqualTo(v) && this.m_balance.has(address)) {
            this.m_balance.delete(address);
        } else {
            this.m_balance.set(address, v);
        }
    }

    protected addToQueue(txTime: TransactionWithTime) {
        let pos: number = 0;
        for (let i = 0; i < this.m_transactions.length; i++) {
            if (this.m_transactions[i].tx.address === txTime.tx.address) {
                pos = this.m_transactions[i].tx.nonce < txTime.tx.nonce ? i + 1 : i;
            } else {
                pos = (this.m_transactions[i].tx as ValueTransaction).fee.lt((txTime.tx as ValueTransaction).fee) ? i : i + 1;
            }
        }
        this.m_transactions.splice(pos, 0, txTime);
        this.m_mapNonce.set(txTime.tx.address as string, txTime.tx.nonce);
    }
}
