import { ErrorCode, DposTransactionContext, Chain, BigNumber, isValidAddress } from "../../../../../src/core";
import { bCheckTokenid, IfBancorTokenItem, isANumber, strAmountPrecision, BANCOR_TOKEN_PRECISION, bCheckBancorTokenFactor, getConfigObj, IfConfigGlobal, bCheckRedundantAddr } from "../scoop";

export async function funcCreateLockBancorToken(context: DposTransactionContext, params: any): Promise<ErrorCode> {
    const configObj: IfConfigGlobal = getConfigObj();
    // context.cost(context.fee);
    context.cost(context.fee);

    context.logger.info('createBancoToken:', JSON.stringify(params));

    // 参数检查
    if (!params.tokenid || !bCheckTokenid(params.tokenid)) {
        context.logger.error('quit becasue tokenid')
        return ErrorCode.RESULT_INVALID_PARAM;
    }
    if (!params.preBalances) {
        context.logger.error('quit becasue preBalances')
        return ErrorCode.RESULT_INVALID_PARAM;
    }

    // supply has been incorporated into preBalances
    if (!params.factor || !bCheckBancorTokenFactor(params.factor)) {
        context.logger.error('quit becasue factor')
        return ErrorCode.RESULT_INVALID_PARAM;
    }

    // put tokenid to uppercase
    let kvRet = await context.storage.createKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
    if (kvRet.err) {
        context.logger.error('Quit for context.storage.createKeyValueWithDbname')
        return kvRet.err;
    }

    let kvCreator = await kvRet.kv!.set('creator', context.caller);

    if (kvCreator.err) {
        context.logger.error('Set creator failure');
        return kvCreator.err;
    }
    await kvRet.kv!.set('type', 'lock_bancor_token');

    let amountAll = new BigNumber(0);
    if (params.preBalances) {
        // if redundant names
        if (!bCheckRedundantAddr(params.preBalances)) {
            return ErrorCode.RESULT_WRONG_ARG;
        }

        for (let index = 0; index < params.preBalances.length; index++) {
            let item: IfBancorTokenItem = params.preBalances[index] as IfBancorTokenItem;
            context.logger.debug('------ :', item);
            // 按照address和amount预先初始化钱数
            if (item.amount === undefined
                || item.address === undefined
                || item.lock_amount === undefined
                || item.time_expiration === undefined) {
                context.logger.error('undefined found!');
                return ErrorCode.RESULT_WRONG_ARG;
            }
            if (!isANumber(item.amount)
                || !isANumber(item.lock_amount)
                || !isANumber(item.time_expiration)) {
                context.logger.error('Not a valid number');
                return ErrorCode.RESULT_WRONG_ARG;
            }
            let strAmount: string = strAmountPrecision(item.amount, BANCOR_TOKEN_PRECISION);

            // check address
            if (!isValidAddress(item.address)) {
                context.logger.error('Invalid address:', item.address);
                return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
            }

            let bnAmount = new BigNumber(strAmount);
            context.logger.debug('bnAmount:', bnAmount);
            let hret = await kvRet.kv!.hset(item.address, '0', bnAmount);

            if (hret.err) {
                context.logger.error('set bnAmount fail');
                return hret.err;
            }

            //
            let strLockAmount: string = strAmountPrecision(item.lock_amount, BANCOR_TOKEN_PRECISION);
            //
            let bnLockAmount = new BigNumber(strLockAmount);
            context.logger.debug('bnLockAmoutn: ', bnLockAmount);

            if (!bnLockAmount.eq(0)) {
                let curBlock = context.getCurBlock();
                context.logger.debug('curBlock:', curBlock);
                if (curBlock.eq(0)) {
                    return ErrorCode.RESULT_DB_RECORD_EMPTY;
                }
                let dueBlock: number = curBlock.toNumber() + parseInt(item.time_expiration) * 60 / configObj.global.blockInterval;

                context.logger.debug('dueblock: ', dueBlock);

                hret = await kvRet.kv!.hset(item.address, dueBlock.toString(), bnLockAmount);

                if (hret.err) {
                    return hret.err;
                }
            }

            amountAll = amountAll.plus(bnAmount).plus(bnLockAmount);
        }
    }

    context.logger.debug('amountAll:', amountAll);

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
