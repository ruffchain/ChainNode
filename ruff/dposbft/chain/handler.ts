import { ErrorCode, BigNumber, DposViewContext, DposTransactionContext, ValueHandler, IReadableKeyValue, MapToObject, Chain, isValidAddress } from '../../../src/host';
import { createScript } from 'ruff-vm';

import {
    SYS_TOKEN_PRECISION, strAmountPrecision, bCheckTokenid, BANCOR_TOKEN_PRECISION,
    bCheckTokenPrecision, MAX_QUERY_NUM, bCheckDBName, bCheckMethodName, SYS_MORTGAGE_PRECISION, IfRegisterOption,
    bCheckRegisterOption, IfBancorTokenItem, isANumber, configObj, readConfigFile
} from './modules/scoop';
import { funcCreateToken } from './modules/token/create';
import { funcTransferLockBancorTokenTo } from './modules/lockbancor/transferlockbancortokento';
import { funcBuyLockBancorToken } from './modules/lockbancor/buylockbancortoken';
import { funcSellLockBancorToken } from './modules/lockbancor/selllockbancortoken';
import { funcCreateLockBancorToken } from './modules/lockbancor/createlockbancortoken';
import { funcGetLockBancorTokenBalance } from './modules/lockbancor/getlockbancortokenbalance';
import { getUserCode, getUserTableValue, setUserCode, runUserMethod } from './modules/usercode';
import { funcTransferTokenTo } from './modules/token/transfer';
import { funcCreateBancorToken } from './modules/bancor/create';
import { funcTransferBancorTokenTo } from './modules/bancor/transfer';
import { funcBuyBancorToken } from './modules/bancor/buy';
import { funcSellBancorToken } from './modules/bancor/sell';
import { funcGetBancorTokenParams } from './modules/bancor/params';
import { funcGetBalances } from './modules/sys/balances';
import { funcGetTokenBalances } from './modules/token/balances';
import { funcGetBancorTokenBalances } from './modules/bancor/balances';
import { funcTransferTo } from './modules/sys/transfer';
import { funcGetCandidateInfo } from './modules/vote/candidate';
import { funcTransferLockBancorTokenToMulti } from './modules/lockbancor/transfermulti';
import { funcGetLockBancorTokenBalances } from './modules/lockbancor/balances';

export interface IfConfigGlobal {
    handler: string;
    type: {
        consensus: string;
        features: any[]
    };

    global: {
        minCreateor: number;
        maxCreateor: number;
        reSelectionBlocks: number;
        blockInterval: number;
        timeOffsetToLastBlock: number;
        timeBan: number;
        unbanBlocks: number;
        dposVoteMaxProducers: number;
        maxBlockIntervalOffset: number;
        depositAmount: number;
        depositPeriod: number;
        mortgagePeriod: number;
    };
}

readConfigFile();

export function registerHandler(handler: ValueHandler) {
    handler.genesisListener = async (context: DposTransactionContext) => {
        // await context.storage.createKeyValue('bid');
        // await context.storage.createKeyValue('bidInfo');
        await context.storage.createKeyValue('userCode');
        return ErrorCode.RESULT_OK;
    };

    async function getTokenBalance(balanceKv: IReadableKeyValue, address: string): Promise<BigNumber> {
        let retInfo = await balanceKv.get(address);
        return retInfo.err === ErrorCode.RESULT_OK ? retInfo.value : new BigNumber(0);
    }
    //////////////////
    // smart contract
    //////////////////
    handler.addTX('setUserCode', setUserCode);

    handler.addViewMethod('getUserCode', getUserCode);

    handler.addViewMethod('getUserTableValue', getUserTableValue);

    handler.addTX('runUserMethod', runUserMethod);

    ////////////////
    // token about
    ////////////////
    handler.addTX('createToken', funcCreateToken);

    handler.addTX('transferTokenTo', funcTransferTokenTo);

    handler.addViewMethod('getTokenBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {
        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
        return await getTokenBalance(balancekv.kv!, params.address);
    });

    handler.addViewMethod('getTokenBalances', funcGetTokenBalances);

    //////////////
    // sys about
    /////////////
    handler.defineEvent('transfer', { indices: ['from', 'to'] });
    handler.addTX('transferTo', funcTransferTo);

    handler.addViewMethod('getBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {
        return await context.getBalance(params.address);
    });
    handler.addViewMethod('getZeroBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {

        return await context.getBalance('0');
    });
    // feed back is never an object
    handler.addViewMethod('getBalances', funcGetBalances);

    // Added by Yang Jun 2019-2-21
    // Added by Yang Jun 2019-2-20
    /**
     * context's storage is storage_sqlite/storage.ts SqliteReadWritableDatabase
     */
    // token

    /////////////////////
    // bancor token
    /////////////////////
    // handler.addTX('createBancorToken', funcCreateBancorToken);
    // Added by Yang Jun 2019-2-21
    // handler.addTX('transferBancorTokenTo', funcTransferBancorTokenTo);
    // Added by Yang Jun 2019-2-21
    // handler.addTX('buyBancorToken', funcBuyBancorToken);
    // Added by Yang Jun 2019-2-21
    // handler.addTX('sellBancorToken', funcSellBancorToken);
    // Added by Yang Jun 2019-2-21
    //handler.addViewMethod('getBancorTokenBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {
    //     let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
    //     return await getTokenBalance(balancekv.kv!, params.address);
    // });
    handler.addViewMethod('getBancorTokenFactor', async (context: DposViewContext, params: any): Promise<BigNumber> => {

        if (!params.tokenid) {
            return new BigNumber(0);
        }

        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvFactor);
        return await getTokenBalance(balancekv.kv!, params.tokenid.toUpperCase());
    });
    handler.addViewMethod('getBancorTokenReserve', async (context: DposViewContext, params: any): Promise<BigNumber> => {

        if (!params.tokenid) {
            return new BigNumber(0);
        }

        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvReserve);
        return await getTokenBalance(balancekv.kv!, params.tokenid.toUpperCase());
    });

    handler.addViewMethod('getBancorTokenSupply', async (context: DposViewContext, params: any): Promise<BigNumber> => {

        if (!params.tokenid) {
            return new BigNumber(0);
        }

        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvSupply);
        return await getTokenBalance(balancekv.kv!, params.tokenid.toUpperCase());
    });
    // Add getBancorTokenNonliquidity,
    handler.addViewMethod('getBancorTokenNonliquidity', async (context: DposViewContext, params: any): Promise<BigNumber> => {

        if (!params.tokenid) {
            return new BigNumber(0);
        }

        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvNonliquidity);
        return await getTokenBalance(balancekv.kv!, params.tokenid.toUpperCase());
    });
    // Yang Jun 2019-4-10
    handler.addViewMethod('getBancorTokenParams', funcGetBancorTokenParams);


    //////////////////////
    // lock bancor token
    //////////////////////
    handler.addTX('createBancorToken', funcCreateLockBancorToken);
    // Added by Yang Jun 2019-2-21
    handler.addTX('transferBancorTokenTo', funcTransferLockBancorTokenTo);

    // Added by Yang Jun 2019-5-31
    handler.addTX('transferBancorTokenToMulti', funcTransferLockBancorTokenToMulti);

    handler.addTX('buyBancorToken', funcBuyLockBancorToken);

    handler.addTX('sellBancorToken', funcSellLockBancorToken);

    // Added by Yang Jun 2019-2-21
    handler.addViewMethod('getBancorTokenBalance', funcGetLockBancorTokenBalance);

    // Added by Yang Jun 2019-6-3
    handler.addViewMethod('getBancorTokenBalances', funcGetLockBancorTokenBalances);

    /////////////////////
    //  vote
    ////////////////////
    handler.addViewMethod('getVote', async (context: DposViewContext, params: any): Promise<any> => {
        let v: Map<string, BigNumber> = await context.getVote();
        return MapToObject(v);
    });
    // Added by Yang Jun 2019-5-22
    handler.addViewMethod('getTicket', async (context: DposViewContext, params: any): Promise<any> => {
        let v: any = await context.getTicket(params);
        return v;
    });

    handler.addViewMethod('getStake', async (context: DposViewContext, params: any): Promise<BigNumber> => {
        return await context.getStake(params.address);
    });
    // api_getcandidates
    handler.addViewMethod('getCandidates', async (context: DposViewContext, params: any): Promise<any> => {
        return await context.getCandidates();
    });

    handler.addViewMethod('getMiners', async (context: DposViewContext, params: any): Promise<string[]> => {
        return await context.getMiners();
    });
    // Yang Jun 2019-5-31
    handler.addViewMethod('getCandidateInfo', funcGetCandidateInfo);

    // Yang Jun 2019-4-9
    //////////////////////////////////////////////////////////////

    // api_vote
    handler.addTX('vote', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        context.cost(context.fee);
        let objJson: any;
        try {
            objJson = JSON.parse(JSON.stringify(params));
        } catch (e) {
            return ErrorCode.RESULT_WRONG_ARG;
        }
        if (!objJson.length || objJson.length <= 0 || objJson.length > configObj.global.dposVoteMaxProducers) {
            return ErrorCode.RESULT_WRONG_ARG;
        }
        return await context.vote(context.caller, params);
    });

    handler.addTX('mortgage', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        context.cost(context.fee);
        console.log('Yang Jun - mortgage, handler.ts');

        // if value is differnt from params
        if (!context.value.eq(new BigNumber(params))) {
            return ErrorCode.RESULT_WRONG_ARG;
        }

        let strAmount = strAmountPrecision(context.value.toString(), SYS_MORTGAGE_PRECISION);

        let bnAmount = new BigNumber(strAmount);

        let balance: BigNumber = await context.getBalance(context.caller);
        if (balance.lt(bnAmount)) {
            return ErrorCode.RESULT_NOT_ENOUGH;
        }

        return await context.mortgage(context.caller, bnAmount);
    });

    handler.addTX('unmortgage', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        context.cost(context.fee);
        // context.cost(SYSTEM_TX_FEE_BN);
        console.log('Yang Jun - unmortgage, handler.ts');
        let strAmount = strAmountPrecision(params, SYS_MORTGAGE_PRECISION);

        console.log('amount:', strAmount);
        let bnAmount = new BigNumber(strAmount);
        let hret = await context.unmortgage(context.caller, bnAmount);
        if (hret) {
            return hret;
        }
        return context.transferTo(context.caller, bnAmount);
    });
    // api_register
    handler.addTX('register', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        context.cost(context.fee);
        let bnThreshold = new BigNumber(configObj.global.depositAmount);
        if (!context.value.eq(bnThreshold)) {
            return ErrorCode.RESULT_NOT_ENOUGH;
        }
        let paramsNew: any;
        try {
            paramsNew = JSON.parse(JSON.stringify(params));
        } catch (e) {
            return ErrorCode.RESULT_WRONG_ARG;
        }
        if (!bCheckRegisterOption(paramsNew)) {
            return ErrorCode.RESULT_WRONG_ARG;
        }
        return await context.register(context.caller, paramsNew as IfRegisterOption);
    });
    handler.addTX('unregister', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        context.cost(context.fee);
        if (params !== context.caller) {
            return ErrorCode.RESULT_WRONG_ARG;
        }
        const ret = await context
            .transferTo(context.caller, new BigNumber(configObj.global.depositAmount));

        if (ret) {
            console.log('unregister , transferTo failed');
            return ret;
        }

        return await context.unregister(context.caller);
    });

    // 拍卖
    // handler.addTX('publish', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
    //     context.cost(context.fee);
    //     // params.name: 发布的name, name不能相同
    //     // context.value: 最低出价, BigNumber
    //     // params.duation: 持续时间，单位是block

    //     // 暂时没有对发布方有value的要求，可以加上发布方要扣除一定数量币的功能
    //     if (isNullOrUndefined(params.name) || !params.duation || params.duation <= 0 || !(params.lowest instanceof BigNumber)) {
    //         return ErrorCode.RESULT_INVALID_PARAM;
    //     }

    //     let bidKV = (await context.storage.getReadWritableKeyValue('bid')).kv!;
    //     let ret = await bidKV.get(params.name);
    //     if (ret.err === ErrorCode.RESULT_OK) {
    //         return ErrorCode.RESULT_ALREADY_EXIST;
    //     }
    //     let bidInfoKV = (await context.storage.getReadWritableKeyValue('bidInfo')).kv!;
    //     await bidInfoKV.hset('biding', params.name, { publisher: context.caller, finish: context.height + params.duation });
    //     await bidKV.set(params.name, { caller: context.caller, value: context.value });
    //     await bidKV.rpush((context.height + params.duation).toString(), params.name);
    //     return ErrorCode.RESULT_OK;
    // });

    // 出价
    // handler.addTX('bid', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
    //     context.cost(context.fee);
    //     // params.name: 发布的name, name不能相同
    //     // context.value: 最低出价, BigNumber
    //     let bidKV = (await context.storage.getReadWritableKeyValue('bid')).kv!;
    //     let ret = await bidKV.get(params.name);
    //     if (ret.err !== ErrorCode.RESULT_OK) {
    //         return ret.err;
    //     }
    //     // 如果本次出价不高于上次，则无效
    //     if ((ret.value!.value as BigNumber).gte(new BigNumber(context.value))) {
    //         return ErrorCode.RESULT_NOT_ENOUGH;
    //     }
    //     // 把上一次的出价还给出价者
    //     await context.transferTo(ret.value!.caller, ret.value!.value);
    //     // 更新新的出价
    //     await bidKV.set(params.name, { caller: context.caller, value: context.value });
    //     return ErrorCode.RESULT_OK;
    // });

    // 在块后事件中处理拍卖结果
    // handler.addPostBlockListener(async (height: number): Promise<boolean> => true,
    //     async (context: DposEventContext): Promise<ErrorCode> => {
    //         context.logger.info(`on BlockHeight ${context.height}`);
    //         let bidKV = (await context.storage.getReadWritableKeyValue('bid')).kv!;
    //         let bidInfoKV = (await context.storage.getReadWritableKeyValue('bidInfo')).kv!;
    //         do {
    //             let ret = await bidKV.rpop(context.height.toString());
    //             if (ret.err === ErrorCode.RESULT_OK) {
    //                 const name = ret.value;
    //                 let info = (await bidInfoKV.hget('biding', name)).value!;
    //                 const lastBid = (await bidKV.get(name)).value;
    //                 if (lastBid.caller !== info.publisher) {    //  否则流标
    //                     await context.transferTo(info.publisher, lastBid.value);
    //                     // 存储本次拍卖的结果
    //                     info.owner = lastBid.caller;
    //                     info.value = lastBid.value;
    //                 }
    //                 await bidInfoKV.hdel('biding', name);
    //                 await bidInfoKV.hset('finish', name, info);
    //                 // 清理掉不需要的数据
    //                 await bidKV.hclean(name);
    //             } else {
    //                 break;
    //             }
    //         } while (true);
    //         return ErrorCode.RESULT_OK;
    //     });

    // 查询指定name的拍卖信息
    // handler.addViewMethod('GetBidInfo', async (context: DposViewContext, params: any): Promise<any> => {
    //     let value: any = {};
    //     let bidInfoKV = (await context.storage.getReadableKeyValue('bidInfo')).kv!;
    //     let bidKV = (await context.storage.getReadableKeyValue('bid')).kv!;
    //     let bid = await bidKV.get(params.name);
    //     let bidInfo = await bidInfoKV.hget(bid.err === ErrorCode.RESULT_NOT_FOUND ? 'finish' : 'biding', params.name);
    //     if (bidInfo.err !== ErrorCode.RESULT_OK) {
    //         return;
    //     }
    //     value = bidInfo.value!;
    //     value.name = params.name;
    //     if (!bidInfo.value!.owner) {
    //         value.bidder = bid.value!.caller;
    //         value.bidvalue = bid.value!.value;
    //     }

    //     return value;
    // });

    // 查询所有正在拍卖的name的信息
    // handler.addViewMethod('GetAllBiding', async (context: DposViewContext, params: any): Promise<any[]> => {
    //     let ret: any[] = [];
    //     let bidInfoKV = (await context.storage.getReadableKeyValue('bidInfo')).kv!;
    //     let bidKV = (await context.storage.getReadableKeyValue('bid')).kv!;
    //     let rets = await bidInfoKV.hgetall('biding');
    //     if (rets.err === ErrorCode.RESULT_OK) {
    //         for (const { key, value } of rets.value!) {
    //             let i = value;
    //             i.name = key;
    //             let bid = await bidKV.get(key);
    //             i.bidder = bid.value!.caller;
    //             i.bidvalue = bid.value!.value;
    //             ret.push(i);
    //         }
    //     }
    //     return ret;
    // });

    // 查询所有拍卖完成name的信息
    // handler.addViewMethod('GetAllFinished', async (context: DposViewContext, params: any): Promise<any[]> => {
    //     let ret: any[] = [];
    //     let bidInfoKV = (await context.storage.getReadableKeyValue('bidInfo')).kv!;
    //     let rets = await bidInfoKV.hgetall('finish');
    //     if (rets.err === ErrorCode.RESULT_OK) {
    //         for (const { key, value } of rets.value!) {
    //             let i = value;
    //             i.name = key;
    //             ret.push(i);
    //         }
    //     }
    //     return ret;
    // });
}
