import { DposTransactionContext, ErrorCode, isValidAddress, BigNumber } from "../../../../../src/core";
import { SYS_TOKEN_PRECISION } from "../scoop";

export async function funcTransferTo(context: DposTransactionContext, params: any): Promise<ErrorCode> {
  context.cost(context.fee);

  // Added by Yang Jun 2019-3-28
  let val: number = context.value.toNumber();
  let val2: string = val.toFixed(SYS_TOKEN_PRECISION);

  if (!isValidAddress(params.to)) {
    return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
  }

  const err = await context.transferTo(params.to, new BigNumber(val2));

  if (!err) {
    context.emit('transfer', { from: context.caller, to: params.to, value: new BigNumber(val2) });
  }
  return err;
}
