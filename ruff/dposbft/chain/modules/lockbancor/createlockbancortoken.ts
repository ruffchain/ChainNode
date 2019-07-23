import { ErrorCode, DposTransactionContext, Chain, BigNumber, isValidAddress } from "../../../../../src/core";
import { bCheckTokenid, IfBancorTokenItem, isANumber, strAmountPrecision, BANCOR_TOKEN_PRECISION, bCheckBancorTokenFactor, getConfigObj, IfConfigGlobal } from "../scoop";

export async function funcCreateLockBancorToken(context: DposTransactionContext, params: any): Promise<ErrorCode> {
    const configObj: IfConfigGlobal = getConfigObj();
    // context.cost(context.fee);
    context.cost(context.fee);

    // console.log('Yang-- received createBancorToken');
    console.log(params);

    // 参数检查
    if (!params.tokenid || !bCheckTokenid(params.tokenid)) {
        console.log('Yang-- quit becasue tokenid')
        return ErrorCode.RESULT_INVALID_PARAM;
    }
    if (!params.preBalances) {
        console.log('Yang-- quit becasue preBalances')
        return ErrorCode.RESULT_INVALID_PARAM;
    }

    // supply has been incorporated into preBalances
    if (!params.factor || !bCheckBancorTokenFactor(params.factor)) {
        console.log('Yang-- quit becasue factor')
        return ErrorCode.RESULT_INVALID_PARAM;
    }

    // console.log('Yang-- Before context.storage.createKeyValueWithDbname');
    // console.log('Yang-- ', Chain.dbToken, ' ', params.tokenid);

    // put tokenid to uppercase
    let kvRet = await context.storage.createKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
    if (kvRet.err) {
        console.log('Yang-- Quit for context.storage.createKeyValueWithDbname')
        return kvRet.err;
    }

    let kvCreator = await kvRet.kv!.set('creator', context.caller);

    if (kvCreator.err) {
        return kvCreator.err;
    }
    await kvRet.kv!.set('type', 'lock_bancor_token');

    let amountAll = new BigNumber(0);
    if (params.preBalances) {
        for (let index = 0; index < params.preBalances.length; index++) {
            let item: IfBancorTokenItem = params.preBalances[index] as IfBancorTokenItem;
            console.log('------ :', item);
            // 按照address和amount预先初始化钱数
            if (item.amount === undefined
                || item.address === undefined
                || item.lock_amount === undefined
                || item.time_expiration === undefined) {
                console.log('undefined found!');
                return ErrorCode.RESULT_WRONG_ARG;
            }
            if (!isANumber(item.amount)
                || !isANumber(item.lock_amount)
                || !isANumber(item.time_expiration)) {
                console.log('Not a valid number');
                return ErrorCode.RESULT_WRONG_ARG;
            }
            let strAmount: string = strAmountPrecision(item.amount, BANCOR_TOKEN_PRECISION);

            // check address
            if (!isValidAddress(item.address)) {
                console.log('Invalid address:', item.address);
                return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
            }

            let bnAmount = new BigNumber(strAmount);
            console.log('bnAmount:', bnAmount);
            let hret = await kvRet.kv!.hset(item.address, '0', bnAmount);

            if (hret.err) {
                console.log('set bnAmount fail');
                return hret.err;
            }

            //
            let strLockAmount: string = strAmountPrecision(item.lock_amount, BANCOR_TOKEN_PRECISION);
            //
            let bnLockAmount = new BigNumber(strLockAmount);
            console.log('bnLockAmoutn: ', bnLockAmount);

            if (!bnLockAmount.eq(0)) {
                let curBlock = context.getCurBlock();
                console.log('curBlock:', curBlock);
                if (curBlock.eq(0)) {
                    return ErrorCode.RESULT_DB_RECORD_EMPTY;
                }
                let dueBlock: number = curBlock.toNumber() + parseInt(item.time_expiration) * 60 / configObj.global.blockInterval;

                console.log('dueblock: ', dueBlock);

                hret = await kvRet.kv!.hset(item.address, dueBlock.toString(), bnLockAmount);

                if (hret.err) {
                    return hret.err;
                }
            }

            amountAll = amountAll.plus(bnAmount).plus(bnLockAmount);
        }
    }

    console.log('amountAll:', amountAll);

    // Setting bancor parameters
    // set Factor
    let tokenIdUpperCase = params.tokenid.toUpperCase();

    kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvFactor);
    if (kvRet.err) {
        return kvRet.err;
    }
    kvRet = await kvRet.kv!.set(tokenIdUpperCase, new BigNumber(params.factor)); // number type
    if (kvRet.err) {
        return kvRet.err;
    }

    // set Reserve
    kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvReserve);
    if (kvRet.err) {
        return kvRet.err;
    }
    kvRet = await kvRet.kv!.set(tokenIdUpperCase, context.value);
    if (kvRet.err) {
        return kvRet.err;
    }

    // set Supply
    kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvSupply);
    if (kvRet.err) {
        return kvRet.err;
    }
    kvRet = await kvRet.kv!.set(tokenIdUpperCase, amountAll);
    if (kvRet.err) {
        return kvRet.err;
    }

    // set Nonliquidity
    kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvNonliquidity);
    if (kvRet.err) {
        return kvRet.err;
    }

    // Consider to use nonliquidity or not
    // nonliquidity == 0; no limit for supply
    // nonliquidity !== 0, supply < nonliquidity!!
    if (!params.nonliquidity) {
        kvRet = await kvRet.kv!.set(tokenIdUpperCase, new BigNumber(0));
    } else {
        kvRet = await kvRet.kv!.set(tokenIdUpperCase, new BigNumber(params.nonliquidity).plus(amountAll));
    }

    if (kvRet.err) {
        return kvRet.err;
    }

    return ErrorCode.RESULT_OK;

}
