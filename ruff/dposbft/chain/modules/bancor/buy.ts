import { DposTransactionContext, ErrorCode, Chain, BigNumber } from "../../../../../src/core";
import { getTokenBalance, SYS_TOKEN_PRECISION } from "../scoop";

export async function funcBuyBancorToken(context: DposTransactionContext, params: any): Promise<ErrorCode>  {
  context.cost(context.fee);

  console.log('Yang-- buyBancorToken:', params);

  // context.value has the money
  // 参数检查
  if (!params.tokenid) {
      return ErrorCode.RESULT_INVALID_PARAM;
  }

  let tokenIdUpperCase = params.tokenid.toUpperCase();

  // If context.value lt sys value
  let syskv = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbSystem, Chain.kvBalance);
  if (syskv.err) {
      console.log('Yang-- not exist balance');
      return syskv.err;
  }
  let fromTotalSys = await getTokenBalance(syskv.kv!, context.caller);

  let strAmount = context.value.toFixed(SYS_TOKEN_PRECISION);
  let amount = new BigNumber(strAmount);

  if (fromTotalSys.lt(amount)) {
      console.log('Yang-- not enough balance');
      return ErrorCode.RESULT_NOT_ENOUGH;
  }

  // get F
  let kvFactor = await context.storage.getReadableKeyValueWithDbname(Chain.dbBancor, Chain.kvFactor);
  if (kvFactor.err) {
      return kvFactor.err;
  }
  let retFactor = await kvFactor.kv!.get(tokenIdUpperCase);
  if (retFactor.err) {
      return retFactor.err;
  }
  console.log('Yang-- factor:', retFactor.value.toString());
  let F = new BigNumber(retFactor.value);

  // get S
  let kvSupply = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvSupply);
  if (kvSupply.err) { return kvSupply.err; }

  let retSupply = await kvSupply.kv!.get(tokenIdUpperCase);
  if (retSupply.err) { return retSupply.err; }

  console.log('Yang-- supply:', retSupply.value.toString());
  let S = new BigNumber(retSupply.value);

  // get R
  let kvReserve = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvReserve);
  if (kvReserve.err) { return kvReserve.err; }

  let retReserve = await kvReserve.kv!.get(tokenIdUpperCase);
  if (retReserve.err) { return retReserve.err; }

  console.log('Yang-- reserve:', retReserve.value.toString());
  let R = new BigNumber(retReserve.value);

  // get nonliquidity
  let kvNonliquidity = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvNonliquidity);
  if (kvNonliquidity.err) { return kvNonliquidity.err; }

  let retNonliquidity = await kvNonliquidity.kv!.get(tokenIdUpperCase);
  if (retNonliquidity.err) { return retNonliquidity.err; }

  let N = new BigNumber(retNonliquidity.value);

  // do computation
  let e = new BigNumber(context.value);
  let out: BigNumber;

  out = e.dividedBy(R);
  out = out.plus(new BigNumber(1.0));
  let temp1 = out.toNumber();
  console.log('temp1:', temp1);
  console.log('F:', F.toNumber());
  console.log('math.pow:', Math.pow(temp1, F.toNumber()));

  out = new BigNumber(Math.pow(temp1, F.toNumber()));

  out = out.minus(new BigNumber(1));
  out = out.multipliedBy(S);

  console.log('Yang-- supply plus:', out.toString());
  console.log('Yang-- reserve plus:', e.toString());

  // Update system R,S; Update User account
  R = R.plus(e);
  S = S.plus(out);

  // Yang Jun 2019-3-15, Nonliquiidty is not zero, S > N
  if ((!N.isZero()) && S.gt(N)) {
      return ErrorCode.BANCOR_TOTAL_SUPPLY_LIMIT;
  }

  let kvRet = await kvReserve.kv!.set(tokenIdUpperCase, R);
  if (kvRet.err) {
      console.log('Yang-- update reserve failed')
      return kvRet.err;
  }

  kvRet = await kvSupply.kv!.set(tokenIdUpperCase, S);
  if (kvRet.err) {
      console.log('Yang-- update supply failed')
      return kvRet.err;
  }

  // Update User account
  let kvToken = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, tokenIdUpperCase);
  if (kvToken.err) {
      console.log('Yang-- update user account failed')
      return kvToken.err;
  }

  let fromTotal = await getTokenBalance(kvToken.kv!, context.caller);
  let retToken = await kvToken.kv!.set(context.caller, fromTotal.plus(out));
  if (retToken.err) { return retToken.err; }

  return ErrorCode.RESULT_OK;
}
