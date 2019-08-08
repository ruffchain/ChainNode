import { DposTransactionContext, ErrorCode, Chain, BigNumber } from "../../../../../src/core";
import { strAmountPrecision, BANCOR_TOKEN_PRECISION, getTokenBalance } from "../scoop";

export async function funcSellBancorToken(context: DposTransactionContext, params: any): Promise<ErrorCode> {
    context.cost(context.fee);

    context.logger.info('params:', JSON.stringify(params));

    // 参数检查
    if (!params.tokenid) {
        return ErrorCode.RESULT_INVALID_PARAM;
    }

    let tokenIdUpperCase = params.tokenid.toUpperCase();

    // get F
    let kvFactor = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvFactor);
    if (kvFactor.err) {
        return kvFactor.err;
    }
    let retFactor = await kvFactor.kv!.get(tokenIdUpperCase);
    if (retFactor.err) {
        return retFactor.err;
    }
    let F = new BigNumber(retFactor.value);
    context.logger.debug('F: ', F.toString());

    // get S
    let kvSupply = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvSupply);
    if (kvSupply.err) { return kvSupply.err; }

    let retSupply = await kvSupply.kv!.get(tokenIdUpperCase);
    if (retSupply.err) { return retSupply.err; }

    let S = new BigNumber(retSupply.value);
    context.logger.debug('S:', S.toString());

    // get R
    let kvReserve = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvReserve);
    if (kvReserve.err) { return kvReserve.err; }

    let retReserve = await kvReserve.kv!.get(tokenIdUpperCase);
    if (retReserve.err) { return retReserve.err; }

    let R = new BigNumber(retReserve.value);
    context.logger.debug('R:', R.toString());

    // do computation
    let strAmount = strAmountPrecision(params.amount, BANCOR_TOKEN_PRECISION);
    let e = new BigNumber(strAmount);
    let out: BigNumber;

    // Dont know if it will happen ever
    if (S.lt(e)) {
        return ErrorCode.RESULT_NOT_ENOUGH;
    }

    out = e.dividedBy(S);
    out = new BigNumber(1).minus(out);
    let temp1 = out.toNumber();
    out = new BigNumber(Math.pow(temp1, 1 / F.toNumber()));
    out = new BigNumber(1).minus(out);
    out = out.multipliedBy(R);

    // Update system R,S;
    R = R.minus(out);
    S = S.minus(e);

    context.logger.debug('reserve minus:', out.toString());
    context.logger.debug('supply minus:', e.toString());

    let kvRet = await kvReserve.kv!.set(tokenIdUpperCase, R);
    if (kvRet.err) { return kvRet.err; }

    kvRet = await kvSupply.kv!.set(tokenIdUpperCase, S);
    if (kvRet.err) { return kvRet.err; }

    // Update User account
    let kvToken = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, tokenIdUpperCase);
    if (kvToken.err) { return kvToken.err; }

    let fromTotal = await getTokenBalance(kvToken.kv!, context.caller);
    if (fromTotal.lt(new BigNumber(params.amount))) {
        context.logger.error('less than token account');
        return ErrorCode.RESULT_NOT_ENOUGH;
    }

    let retToken = await kvToken.kv!.set(context.caller, fromTotal.minus(new BigNumber(params.amount)));
    if (retToken.err) { return retToken.err; }

    // Update User's SYS account, directly change account?
    const err = await context.transferTo(context.caller, out);
    if (!err) {
        context.emit('transfer', { from: '0', to: context.caller, value: out });
    } else {
        return err;
    }

    return ErrorCode.RESULT_OK;
}
