import { DposTransactionContext, ErrorCode, Chain, isValidAddress, BigNumber } from "../../../../../src/core";
import { getTokenBalance, strAmountPrecision, BANCOR_TOKEN_PRECISION } from "../scoop";

export async function funcTransferBancorTokenTo(context: DposTransactionContext, params: any): Promise<ErrorCode> {
  context.cost(context.fee);

  context.logger.info('transferBancorTokento', JSON.stringify(params));

  let tokenkv = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());

  if (tokenkv.err) {
    return tokenkv.err;
  }

  let fromTotal = await getTokenBalance(tokenkv.kv!, context.caller);

  // Added by Yang Jun 2019-3-29
  let strAmount = strAmountPrecision(params.amount, BANCOR_TOKEN_PRECISION);
  let amount = new BigNumber(strAmount);

  if (!isValidAddress(params.to)) {
    return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
  }

  if (fromTotal.lt(amount)) {
    context.logger.error('less than amount', amount);
    return ErrorCode.RESULT_NOT_ENOUGH;
  }

  await (tokenkv.kv!.set(context.caller, fromTotal.minus(amount)));
  await (tokenkv.kv!.set(params.to, (await getTokenBalance(tokenkv.kv!, params.to)).plus(amount)));
  return ErrorCode.RESULT_OK;
}
