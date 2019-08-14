import { DposTransactionContext, ErrorCode, isValidAddress, BigNumber } from "../../../../../src/core";
import { SYS_TOKEN_PRECISION } from "../scoop";

export async function funcTransferTo(context: DposTransactionContext, params: any): Promise<ErrorCode> {
  context.cost(context.fee);

  let start = Date.now();
  // Added by Yang Jun 2019-3-28
  let val: BigNumber = context.value.decimalPlaces(SYS_TOKEN_PRECISION, 1); //ROUND_DOWN

  if (!isValidAddress(params.to)) {
    return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
  }

  const err = await context.transferTo(params.to, val);

  if (!err) {
    context.emit('transfer', { from: context.caller, to: params.to, value: val });
  }
  if (Date.now() - start >= 10) {
      context.logger.info('Transfer take', Date.now() - start);
  }
  return err;
}
