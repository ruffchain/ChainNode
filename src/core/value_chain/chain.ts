import { BigNumber } from 'bignumber.js';
import { ErrorCode } from '../error_code';
import { LoggerInstance, initLogger, LoggerOptions } from '../lib/logger_util';

import { Storage } from '../storage';
import { TransactionContext, EventContext, ViewContext, ChainInstanceOptions, ChainGlobalOptions, Chain, Block, BlockHeader, IReadableStorage, BlockExecutor, ViewExecutor} from '../chain';
import { ValueBlockHeader } from './block';
import { ValueTransaction } from './transaction';
import { ValueBlockExecutor} from './executor';
import * as ValueContext from './context';

export type ValueTransactionContext = {
    value: BigNumber;
    getBalance: (address: string) => Promise<BigNumber>;
    transferTo: (address: string, amount: BigNumber) => Promise<ErrorCode>;
} & TransactionContext;

export type ValueEventContext = {
    getBalance: (address: string) => Promise<BigNumber>;
    transferTo: (address: string, amount: BigNumber) => Promise<ErrorCode>;
} & EventContext;

export type ValueViewContext = {
    getBalance: (address: string) => Promise<BigNumber>;
} & ViewContext;

export type ValueChainGlobalOptions = ChainGlobalOptions;
export type ValueChainInstanceOptions = ChainInstanceOptions;

export class ValueChain extends Chain {
    constructor(options: LoggerOptions) {
        super(options);
    }

    public async newBlockExecutor(block: Block, storage: Storage): Promise<{err: ErrorCode, executor?: BlockExecutor}> {
        let kvBalance = (await storage.getKeyValue(Chain.dbSystem, ValueChain.kvBalance)).kv!;
        let ve = new ValueContext.Context(kvBalance);
        let externContext = Object.create(null);
        externContext.getBalance = (address: string): Promise<BigNumber> => {
            return ve.getBalance(address);
        };
        externContext.transferTo = (address: string, amount: BigNumber): Promise<ErrorCode> => {
            return ve.transferTo(ValueChain.sysAddress, address, amount);
        };
        let executor = new ValueBlockExecutor({logger: this.logger, block, storage, handler: this.handler, externContext, globalOptions: this.m_globalOptions!});
        return {err: ErrorCode.RESULT_OK, executor};
    }

    public async newViewExecutor(header: BlockHeader, storage: IReadableStorage, method: string, param: Buffer|string|number|undefined): Promise<{err: ErrorCode, executor?: ViewExecutor}> {
        let dbSystem = (await storage.getReadableDataBase(Chain.dbSystem)).value!;
        let kvBalance = (await dbSystem.getReadableKeyValue(ValueChain.kvBalance)).kv!;
        let ve = new ValueContext.ViewContext(kvBalance);
        let externContext = Object.create(null);
        externContext.getBalance = (address: string): Promise<BigNumber> => {
            return ve.getBalance(address);
        };
        let executor = new ViewExecutor({logger: this.logger, header, storage, method, param, handler: this.handler, externContext});
        return {err: ErrorCode.RESULT_OK, executor};
    }

    protected _getBlockHeaderType(): new () => BlockHeader {
        return ValueBlockHeader;
    }
    
    protected _getTransactionType() {
        return ValueTransaction;
    }

    // 存储每个address的money，其中有一个默认的系统账户
    public static kvBalance: string = 'balance'; // address<--->blance

    public static sysAddress: string = '0';
}