import { DposTransactionContext, ErrorCode, Chain, BigNumber, isValidAddress } from "../../../../../src/core";
import { getTokenBalance, strAmountPrecision } from "../scoop";


export async function funcTransferTokenTo(context: DposTransactionContext, params: any): Promise<ErrorCode> {
  context.cost(context.fee);

  let tokenkv = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());

  if (tokenkv.err) {
    return tokenkv.err;
  }

  let fromTotal = await getTokenBalance(tokenkv.kv!, context.caller);

  // Added by Yang Jun 2019-3-28
  // if (typeof params.amount !== 'number') {
  //     return ErrorCode.RESULT_INVALID_TYPE;
  // }
  let precision = await tokenkv.kv!.get('precision');

  if (precision.err) {
    context.logger.error('precision not found , transferTokenTo');

    return precision.err;
  }

  let strAmount: string = strAmountPrecision(params.amount, parseInt(precision.value.replace('s', '')));
  let amount = new BigNumber(strAmount);

  if (!isValidAddress(params.to)) {
    return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
  }

  if (fromTotal.lt(amount)) {
    return ErrorCode.RESULT_NOT_ENOUGH;
  }
  await (tokenkv.kv!.set(context.caller, fromTotal.minus(amount)));
  await (tokenkv.kv!.set(params.to, (await getTokenBalance(tokenkv.kv!, params.to)).plus(amount)));
  return ErrorCode.RESULT_OK;
}

