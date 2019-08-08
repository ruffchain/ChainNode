import { DposTransactionContext, ErrorCode, Chain, BigNumber, isValidAddress } from "../../../../../src/core";
import { strAmountPrecision, BANCOR_TOKEN_PRECISION } from "../scoop";

export async function funcTransferLockBancorTokenTo(context: DposTransactionContext, params: any): Promise<ErrorCode> {
  context.cost(context.fee);

  context.logger.info('TransferLockBancorTokento', JSON.stringify(params));

  let tokenkv = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());

  if (tokenkv.err) {
    return tokenkv.err;
  }

  // check token type
  let rtnType = await tokenkv.kv!.get('type');

  context.logger.info(JSON.stringify(rtnType));

  if (rtnType.err || rtnType.value !== 'lock_bancor_token') {
    context.logger.error('wrong type');
    return ErrorCode.RESULT_NOT_SUPPORT;
  }

  let hret = await tokenkv.kv!.hgetall(context.caller);
  if (hret.err || hret.value!.length === 0) {
    context.logger.error('It is empty');
    return ErrorCode.RESULT_DB_TABLE_FAILED;
  }
  let hret2 = context.getCurBlock();
  if (hret2.eq(0)) {
    return ErrorCode.RESULT_FAILED;
  }
  let curBlock = hret2.toNumber();

  let fromTotal = new BigNumber(0);
  for (let p of hret.value!) {
    context.logger.debug('item:', JSON.stringify(p))

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

  // Added by Yang Jun 2019-3-29
  let strAmount = strAmountPrecision(params.amount, BANCOR_TOKEN_PRECISION);
  let amount = new BigNumber(strAmount);

  if (!isValidAddress(params.to)) {
    return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
  }

  if (fromTotal.lt(amount)) {
    context.logger.error('less than amount:', amount);
    return ErrorCode.RESULT_NOT_ENOUGH;
  }

  let hret4 = await (tokenkv.kv!.hset(context.caller, '0', fromTotal.minus(amount)));
  if (hret4.err) { return hret4.err; }

  let hretTo = await tokenkv.kv!.hget(params.to, '0');
  if (hretTo.err === ErrorCode.RESULT_EXCEPTION) { return hretTo.err; }

  let hretTransfer;
  if (hretTo.err === ErrorCode.RESULT_NOT_FOUND) {
    hretTransfer = await tokenkv.kv!.hset(params.to, '0', amount);
  } else {
    hretTransfer = await tokenkv.kv!.hset(params.to, '0', hretTo.value!.plus(amount));
  }

  if (hretTransfer.err) { return hretTransfer.err; }

  return ErrorCode.RESULT_OK;
}
