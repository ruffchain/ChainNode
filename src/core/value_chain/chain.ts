import { BigNumber } from 'bignumber.js';

import { ErrorCode } from '../error_code';

import {Storage, IReadableStorage, IReadWritableKeyValue, IReadableKeyValue} from '../storage/storage';
import {ViewExecutor} from '../executor/view';
import * as BaseChain from '../chain/chain';
import { Block } from '../chain/block';

import { BlockHeader } from './block';
import {Transaction} from './transaction';
import { ValueContext, ValueViewContext, BlockExecutor} from './executor';

export type TransactionContext = {
    value: BigNumber;
    getBalance: (address: string)=> Promise<BigNumber>;
    transferTo: (address: string, amount: BigNumber)=> Promise<ErrorCode>;
} & BaseChain.TransactionContext;

export type EventContext = {
    getBalance: (address: string)=> Promise<BigNumber>;
    transferTo: (address: string, amount: BigNumber)=> Promise<ErrorCode>;
} & BaseChain.EventContext;

export type ViewContext = {
    getBalance: (address: string)=> Promise<BigNumber>;
} & BaseChain.ViewContext;


export type ChainOptions = BaseChain.ChainOptions

export class Chain extends BaseChain.Chain {
    constructor(options: ChainOptions) {
        super(options);
    }

    public async newBlockExecutor(block: Block, storage: Storage): Promise<{err: ErrorCode, executor?: BlockExecutor}> {
        let kvBalance = (await storage.getReadWritableKeyValue(Chain.kvBalance)).kv!;
        let ve = new ValueContext(kvBalance);
        let externContext = Object.create(null);
        externContext.getBalance = (address: string): Promise<BigNumber> => {
            return ve.getBalance(address);
        };
        externContext.transferTo = (address: string, amount: BigNumber): Promise<ErrorCode> => {
            return ve.transferTo(Chain.sysAddress, address, amount);
        };
        let executor = new BlockExecutor({block, storage, handler: this.m_options.handler, externContext});
        return {err: ErrorCode.RESULT_OK, executor};
    }

    public async newViewExecutor(header: BlockHeader, storage: IReadableStorage, method: string, param: Buffer|string|number|undefined,): Promise<{err: ErrorCode, executor?: ViewExecutor}> {
        let kvBalance = (await storage.getReadableKeyValue(Chain.kvBalance)).kv!;
        let ve = new ValueViewContext(kvBalance);
        let externContext = Object.create(null);
        externContext.getBalance = (address: string): Promise<BigNumber> => {
            return ve.getBalance(address);
        };
        let executor = new ViewExecutor({header, storage, method, param, handler: this.m_options.handler, externContext});
        return {err: ErrorCode.RESULT_OK, executor};
    }

    protected _getBlockHeaderType(): new () => BlockHeader {
        return BlockHeader;
    }
    
    protected _getTransactionType(): new () => Transaction {
        return Transaction;
    }

    // 存储每个address的money，其中有一个默认的系统账户
    public static kvBalance: string = '__balance'; //address<--->blance

    public static sysAddress: string = '0';
}