import { DposTransactionContext, ErrorCode, Chain, BigNumber, isValidAddress } from "../../../../../src/core";
import { strAmountPrecision, BANCOR_TOKEN_PRECISION, MAX_TO_MULTI_NUM } from "../scoop";

export async function funcTransferLockBancorTokenToMulti(context: DposTransactionContext, params: any): Promise<ErrorCode> {
  context.cost(context.fee);

  console.log('Yang-- ', params)

  let tokenkv = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());

  if (tokenkv.err) {
    return tokenkv.err;
  }

  // check token type
  let rtnType = await tokenkv.kv!.get('type');

  console.log(rtnType);

  if (rtnType.err || rtnType.value !== 'lock_bancor_token') {
    console.log('wrong type');
    return ErrorCode.RESULT_NOT_SUPPORT;
  }

  let hret = await tokenkv.kv!.hgetall(context.caller);
  if (hret.err || hret.value!.length === 0) {
    console.log('It is empty');
    return ErrorCode.RESULT_DB_TABLE_FAILED;
  }
  let hret2 = context.getCurBlock();
  if (hret2.eq(0)) {
    return ErrorCode.RESULT_FAILED;
  }
  let curBlock = hret2.toNumber();

  let fromTotal = new BigNumber(0);
  for (let p of hret.value!) {
    console.log('item:')
    console.log(p);
    let dueBlock = p.key;
    let value = p.value;

    if (dueBlock === '0') {
      fromTotal = fromTotal.plus(value);
    } else if (curBlock > parseInt(dueBlock)) {
      fromTotal = fromTotal.plus(value);
      let hret3 = await tokenkv.kv!.hdel(context.caller, dueBlock);
      if (hret3.err) { return hret3.err; }
    }
  }

  // get all toAccounts
  if (params.length === undefined || params.length > MAX_TO_MULTI_NUM) {
    return ErrorCode.RESULT_WRONG_ARG;
  }
  let newParams = [];
  let neededAmount = new BigNumber(0);
  for (let i = 0; i < params.length; i++) {
    let address = params[i].address;

    if (!isValidAddress(address)) {
      return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
    }
    // Added by Yang Jun 2019-3-29
    let strAmount = strAmountPrecision(params[i].amount, BANCOR_TOKEN_PRECISION);
    let bnAmount = new BigNumber(strAmount);
    neededAmount = neededAmount.plus(bnAmount);
    newParams.push({ address, amount: bnAmount });
  }

  if (fromTotal.lt(neededAmount)) {
    console.log('Yang-- less than amount', neededAmount);
    return ErrorCode.RESULT_NOT_ENOUGH;
  }

  let hret4 = await (tokenkv.kv!.hset(context.caller, '0', fromTotal.minus(neededAmount)));
  if (hret4.err) { return hret4.err; }

  for (let i = 0; i < newParams.length; i++) {
    let hretTo = await tokenkv.kv!.hget(params[i].address, '0');
    if (hretTo.err === ErrorCode.RESULT_EXCEPTION) { return hretTo.err; }

    let hretTransfer;
    if (hretTo.err === ErrorCode.RESULT_NOT_FOUND) {
      hretTransfer = await tokenkv.kv!.hset(params.to, '0', params[i].amount);
    } else {
      hretTransfer = await tokenkv.kv!.hset(params.to, '0', hretTo.value!.plus(params[i].amount));
    }

    if (hretTransfer.err) { return hretTransfer.err; }
  }

  return ErrorCode.RESULT_OK;
}
