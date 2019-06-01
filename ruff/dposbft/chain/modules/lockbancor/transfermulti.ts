import { DposTransactionContext, ErrorCode, Chain, BigNumber, isValidAddress } from "../../../../../src/core";
import { strAmountPrecision, BANCOR_TOKEN_PRECISION, MAX_TO_MULTI_NUM } from "../scoop";

export async function funcTransferLockBancorTokenToMulti(context: DposTransactionContext, params: any): Promise<ErrorCode> {
  context.cost(context.fee);

  context.logger.info('Yang-- ', params);

  let tokenkv = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());

  if (tokenkv.err) {
    return tokenkv.err;
  }
  let paramsObj: any;
  try {
    paramsObj = JSON.parse(JSON.stringify(params.to));
  } catch (e) {
    context.logger.error('wrong params.to json parsing');
    return ErrorCode.RESULT_WRONG_ARG;
  }

  // check token type
  let rtnType = await tokenkv.kv!.get('type');

  context.logger.info(JSON.stringify(rtnType));

  if (rtnType.err || rtnType.value !== 'lock_bancor_token') {
    context.logger.info('wrong type');
    return ErrorCode.RESULT_NOT_SUPPORT;
  }

  // check caller is the creator?
  let rtnCreator = await tokenkv.kv!.get('creator');

  if (rtnCreator.err) {
    context.logger.error('Can not find creator in lockbancor token');
    return rtnCreator.err;
  }

  if (rtnCreator.value! !== context.caller) {
    context.logger.error('Wrong creator');
    return ErrorCode.RESULT_DB_TABLE_GET_FAILED;
  }
  ///////////////////////////////

  let hret = await tokenkv.kv!.hgetall(context.caller);
  if (hret.err || hret.value!.length === 0) {
    context.logger.info('It is empty');
    return ErrorCode.RESULT_DB_TABLE_FAILED;
  }
  let hret2 = context.getCurBlock();
  if (hret2.eq(0)) {
    return ErrorCode.RESULT_FAILED;
  }
  let curBlock = hret2.toNumber();

  let fromTotal = new BigNumber(0);
  for (let p of hret.value!) {
    context.logger.info('item:');
    context.logger.info(JSON.stringify(p));
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
  context.logger.info('params:');
  context.logger.info(JSON.stringify(params));

  // get all toAccounts
  if (paramsObj.length === undefined || paramsObj.length > MAX_TO_MULTI_NUM || paramsObj.length <= 0) {
    context.logger.error('paramsObj wrong format');
    return ErrorCode.RESULT_WRONG_ARG;
  }
  let newParams = [];
  let neededAmount = new BigNumber(0);
  for (let i = 0; i < paramsObj.length; i++) {
    let address = paramsObj[i].address;

    if (!isValidAddress(address)) {
      return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
    }
    // Added by Yang Jun 2019-3-29
    let strAmount = strAmountPrecision(paramsObj[i].amount, BANCOR_TOKEN_PRECISION);
    let bnAmount = new BigNumber(strAmount);
    neededAmount = neededAmount.plus(bnAmount);
    newParams.push({ address, amount: bnAmount });
  }

  if (fromTotal.lt(neededAmount)) {
    context.logger.info('Yang-- less than amount', neededAmount);
    return ErrorCode.RESULT_NOT_ENOUGH;
  }

  let hret4 = await (tokenkv.kv!.hset(context.caller, '0', fromTotal.minus(neededAmount)));
  if (hret4.err) { return hret4.err; }

  for (let i = 0; i < newParams.length; i++) {
    context.logger.info('Transfer:' + newParams[i].address + ' ' + newParams[i].amount)
    let hretTo = await tokenkv.kv!.hget(newParams[i].address, '0');
    if (hretTo.err === ErrorCode.RESULT_EXCEPTION) { return hretTo.err; }

    let hretTransfer;
    if (hretTo.err === ErrorCode.RESULT_NOT_FOUND) {
      hretTransfer = await tokenkv.kv!.hset(newParams[i].address, '0', newParams[i].amount);
    } else {
      hretTransfer = await tokenkv.kv!.hset(newParams[i].address, '0', hretTo.value!.plus(newParams[i].amount));
    }

    if (hretTransfer.err) { return hretTransfer.err; }
  }

  return ErrorCode.RESULT_OK;
}
