import { DposTransactionContext, ErrorCode, Chain, isValidAddress, BigNumber } from '../../../../../src/core';
import { bCheckTokenid, bCheckTokenPrecision, strAmountPrecision, SYS_TOKEN_PRECISION } from '../scoop';

export async function funcCreateToken(context: DposTransactionContext, params: any): Promise<ErrorCode> {
  context.cost(context.fee);

  // 这里是不是会有一些检查什么的，会让任何人都随便创建Token么?

  // 必须要有tokenid，一条链上tokenid不能重复
  if (!params.tokenid || !bCheckTokenid(params.tokenid)
    || !bCheckTokenPrecision(params.precision)) {
    return ErrorCode.RESULT_INVALID_PARAM;
  }
  // Change tokenid to UpperCase()
  let kvRet = await context.storage.createKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());

  if (kvRet.err) {
    return kvRet.err;
  }

  await kvRet.kv!.set('creator', context.caller);
  await kvRet.kv!.set('type', 'default_token');
  // Added by Yang Jun 2019-4-4
  await kvRet.kv!.set('precision', parseInt(params.precision).toString());

  if (params.preBalances) {
    for (let index = 0; index < params.preBalances.length; index++) {
      // 按照address和amount预先初始化钱数
      let strAmount: string = strAmountPrecision(params.preBalances[index].amount, SYS_TOKEN_PRECISION);

      // check address valid
      if (!isValidAddress(params.preBalances[index].address)) {
        return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
      }
      await kvRet.kv!.set(params.preBalances[index].address, new BigNumber(strAmount));
    }
  }
  return ErrorCode.RESULT_OK;
}
