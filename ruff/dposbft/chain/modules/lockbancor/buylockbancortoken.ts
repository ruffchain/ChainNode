import { DposTransactionContext, ErrorCode, Chain, BigNumber } from "../../../../../src/core";
import { getTokenBalance, SYS_TOKEN_PRECISION } from "../scoop";
import { bLockBancorToken, fetchLockBancorTokenBalance } from "./common";

export async function funcBuyLockBancorToken(context: DposTransactionContext, params: any): Promise<ErrorCode> {
  context.cost(context.fee);

  context.logger.info('buyBancorToken:', JSON.stringify(params));

  // context.value has the money
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
  context.logger.info('factor:', F);

  // get S
  let kvSupply = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvSupply);
  if (kvSupply.err) { return kvSupply.err; }

  let retSupply = await kvSupply.kv!.get(tokenIdUpperCase);
  if (retSupply.err) { return retSupply.err; }

  let S = new BigNumber(retSupply.value);
  context.logger.info('supply:', S);

  // get R
  let kvReserve = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvReserve);
  if (kvReserve.err) { return kvReserve.err; }

  let retReserve = await kvReserve.kv!.get(tokenIdUpperCase);
  if (retReserve.err) { return retReserve.err; }

  let R = new BigNumber(retReserve.value);
  context.logger.info('reserve:', R);

  // get nonliquidity
  let kvNonliquidity = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvNonliquidity);
  if (kvNonliquidity.err) { return kvNonliquidity.err; }

  let retNonliquidity = await kvNonliquidity.kv!.get(tokenIdUpperCase);
  if (retNonliquidity.err) { return retNonliquidity.err; }

  let N = new BigNumber(retNonliquidity.value);
  context.logger.info('N:', N);

  // do computation
  let e = new BigNumber(context.value);
  let out: BigNumber;

  // If F=1, not use the formula
  if (F.eq(1)) {
    out = e;
  } else {
    out = e.dividedBy(R);
    out = out.plus(new BigNumber(1.0));

    let temp1 = out.toNumber();
    context.logger.info('temp1:', temp1);
    context.logger.info('F:', F.toNumber());
    context.logger.info('math.pow:', Math.pow(temp1, F.toNumber()));
    out = new BigNumber(Math.pow(temp1, F.toNumber()));
    out = out.minus(new BigNumber(1));
    out = out.multipliedBy(S);
  }

  context.logger.info('supply plus:', out.toString());
  context.logger.info('reserve plus:', e.toString());

  // Update system R,S; Update User account
  R = R.plus(e);
  S = S.plus(out);

  // Yang Jun 2019-3-15, Nonliquiidty is not zero, S > N
  if ((!N.isZero()) && S.gt(N)) {
    context.logger.error('N is abnormal:', N.toNumber());
    return ErrorCode.BANCOR_TOTAL_SUPPLY_LIMIT;
  }

  let kvRet = await kvReserve.kv!.set(tokenIdUpperCase, R);
  if (kvRet.err) {
    context.logger.error('update reserve failed')
    return kvRet.err;
  }

  kvRet = await kvSupply.kv!.set(tokenIdUpperCase, S);
  if (kvRet.err) {
    context.logger.error('update supply failed')
    return kvRet.err;
  }

  // Update User account
  let kvToken = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, tokenIdUpperCase);
  if (kvToken.err) {
    context.logger.error('update user account failed')
    return kvToken.err;
  }

  // If it's LockBancor
  let testrtn = await bLockBancorToken(kvToken.kv!);
  if (testrtn === false) {
    context.logger.error('not a lockBancorToken');
    return ErrorCode.RESULT_DB_TABLE_GET_FAILED;
  }

  let fromTotal = await fetchLockBancorTokenBalance(kvToken.kv!, context.caller);
  let retToken = await kvToken.kv!.hset(context.caller, '0', fromTotal.plus(out));
  if (retToken.err) {
    context.logger.error('set token back failed')
    return retToken.err;
  }

  return ErrorCode.RESULT_OK;
}
