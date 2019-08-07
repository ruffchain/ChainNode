import { ErrorCode, BigNumber, DposViewContext, DposTransactionContext, ValueHandler, IReadableKeyValue, MapToObject, Chain, isValidAddress } from '../../../src/host';
import { ChainGlobalOptions } from '../../../src/core/chain';
import {
    transferToSchema, transferTokenSchema, createTokenSchema, genChecker,
    registerSchema, unregisterSchema, mortgageSchema, voteScheme,
    sellTokenSchema, buyTokenSchema, transferTokenToMultiAccoutSchema,
    createBancorTokenSchema, userCodeSchema,
} from '../../../src/common';
import { createScript } from 'ruff-vm';
import {
    SYS_TOKEN_PRECISION, strAmountPrecision, bCheckTokenid, BANCOR_TOKEN_PRECISION,
    bCheckTokenPrecision, MAX_QUERY_NUM, bCheckDBName, bCheckMethodName, SYS_MORTGAGE_PRECISION, IfRegisterOption,
    bCheckRegisterOption, IfBancorTokenItem, isANumber, setGlobalObjConfig, getConfigObj, IfConfigGlobal
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


export function registerHandler(handler: ValueHandler, globalOption: ChainGlobalOptions) {
    setGlobalObjConfig(globalOption);
    let configObj: IfConfigGlobal = getConfigObj();

    handler.genesisListener = async (context: DposTransactionContext) => {
        let ret = await context.storage.createKeyValue('userCode');
        if (ret.err != ErrorCode.RESULT_OK) {
            return ret.err;
        }
        let userCodeRet = await context.storage.getReadWritableKeyValue('userCode');
        if (userCodeRet.err != ErrorCode.RESULT_OK) {
            return userCodeRet.err;
        }
        ret = await userCodeRet.kv!.set('lastHeight', -1);
        if (ret.err != ErrorCode.RESULT_OK) {
            return ret.err;
        }
        return ErrorCode.RESULT_OK;
    };

    async function getTokenBalance(balanceKv: IReadableKeyValue, address: string): Promise<BigNumber> {
        let retInfo = await balanceKv.get(address);
        return retInfo.err === ErrorCode.RESULT_OK ? retInfo.value : new BigNumber(0);
    }
    //////////////////
    // smart contract
    //////////////////
    handler.addTX('setUserCode', setUserCode, genChecker(userCodeSchema));

    handler.addViewMethod('getUserCode', getUserCode);

    handler.addViewMethod('getUserTableValue', getUserTableValue);

    handler.addTX('runUserMethod', runUserMethod);

    ////////////////
    // token about
    ////////////////
    handler.addTX('createToken', funcCreateToken, genChecker(createTokenSchema));

    handler.addTX('transferTokenTo', funcTransferTokenTo, genChecker(transferTokenSchema));

    handler.addViewMethod('getTokenBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {
        let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
        return await getTokenBalance(balancekv.kv!, params.address);
    });

    handler.addViewMethod('getTokenBalances', funcGetTokenBalances);

    //////////////
    // sys about
    /////////////
    handler.defineEvent('transfer', { indices: ['from', 'to'] });
    handler.addTX('transferTo', funcTransferTo, genChecker(transferToSchema));

    handler.addViewMethod('getBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {
        return await context.getBalance(params.address);
    });
    handler.addViewMethod('getZeroBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {

        return await context.getBalance('0');
    });
    // feed back is never an object
    handler.addViewMethod('getBalances', funcGetBalances);

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
    handler.addTX('createBancorToken', funcCreateLockBancorToken, genChecker(createBancorTokenSchema));
    // Added by Yang Jun 2019-2-21
    handler.addTX('transferBancorTokenTo', funcTransferLockBancorTokenTo, genChecker(transferTokenSchema));

    // Added by Yang Jun 2019-5-31
    handler.addTX('transferBancorTokenToMulti', funcTransferLockBancorTokenToMulti, genChecker(transferTokenToMultiAccoutSchema));

    handler.addTX('buyBancorToken', funcBuyLockBancorToken, genChecker(buyTokenSchema));

    handler.addTX('sellBancorToken', funcSellLockBancorToken, genChecker(sellTokenSchema));

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
    }, genChecker(voteScheme));

    handler.addTX('mortgage', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        context.cost(context.fee);
        context.logger.info('mortgage, handler.ts');

        // if value is differnt from params
        if (!context.value.eq(new BigNumber(params))) {
            return ErrorCode.RESULT_WRONG_ARG;
        }

        let strAmount = strAmountPrecision(context.value.toString(), SYS_MORTGAGE_PRECISION);

        let bnAmount = new BigNumber(strAmount);

        return await context.mortgage(context.caller, bnAmount);
    }, genChecker(mortgageSchema));

    handler.addTX('unmortgage', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        context.cost(context.fee);
        // context.cost(SYSTEM_TX_FEE_BN);
        context.logger.info('unmortgage, handler.ts');
        let strAmount = strAmountPrecision(params, SYS_MORTGAGE_PRECISION);

        context.logger.info('amount:', strAmount);
        let bnAmount = new BigNumber(strAmount);
        let hret = await context.unmortgage(context.caller, bnAmount);
        if (hret) {
            return hret;
        }
        return context.transferTo(context.caller, bnAmount);
    }, genChecker(mortgageSchema));
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
        // Check if name already exists
        return await context.register(context.caller, paramsNew as IfRegisterOption);
    }, genChecker(registerSchema));

    handler.addTX('unregister', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        context.cost(context.fee);
        if (params !== context.caller) {
            return ErrorCode.RESULT_WRONG_ARG;
        }
        const ret = await context
            .transferTo(context.caller, new BigNumber(configObj.global.depositAmount));

        if (ret) {
            context.logger.error('unregister , transferTo failed');
            return ret;
        }

        return await context.unregister(context.caller);
    }, genChecker(unregisterSchema));
}
