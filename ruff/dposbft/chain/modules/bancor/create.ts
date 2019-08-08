import { DposTransactionContext, ErrorCode, Chain, BigNumber, isValidAddress } from "../../../../../src/core";
import { bCheckTokenid, strAmountPrecision, BANCOR_TOKEN_PRECISION } from "../scoop";

export async function funcCreateBancorToken(context: DposTransactionContext, params: any): Promise<ErrorCode> {
  context.cost(context.fee);

  context.logger.info('received createBancorToken:', JSON.stringify(params));


  // 参数检查
  if (!params.tokenid || !bCheckTokenid(params.tokenid)) {
    context.logger.error('quit becasue tokenid')
    return ErrorCode.RESULT_INVALID_PARAM;
  }
  if (!params.preBalances) {
    context.logger.error('quit becasue preBalances')
    return ErrorCode.RESULT_INVALID_PARAM;
  }

  // supply has been incorporated into preBalances
  if (!params.factor) {
    context.logger.error('quit becasue factor')
    return ErrorCode.RESULT_INVALID_PARAM;
  }

  // put tokenid to uppercase
  let kvRet = await context.storage.createKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
  if (kvRet.err) {
    context.logger.error('Quit for context.storage.createKeyValueWithDbname')
    return kvRet.err;
  }

  let kvCreator = await kvRet.kv!.set('creator', context.caller);

  if (kvCreator.err) {
    return kvCreator.err;
  }
  await kvRet.kv!.set('type', 'bancor_token');

  let amountAll = new BigNumber(0);
  if (params.preBalances) {
    for (let index = 0; index < params.preBalances.length; index++) {
      // 按照address和amount预先初始化钱数
      let strAmount: string = strAmountPrecision(params.preBalances[index].amount, BANCOR_TOKEN_PRECISION);

      // check address
      if (!isValidAddress(params.preBalances[index].address)) {
        return ErrorCode.RESULT_CHECK_ADDRESS_INVALID;
      }

      await kvRet.kv!.set(params.preBalances[index].address, new BigNumber(strAmount));

      amountAll = amountAll.plus(new BigNumber(strAmount));
    }
  }

  // Setting bancor parameters
  // set Factor
  let tokenIdUpperCase = params.tokenid.toUpperCase();

  kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvFactor);
  if (kvRet.err) {
    return kvRet.err;
  }
  kvRet = await kvRet.kv!.set(tokenIdUpperCase, new BigNumber(params.factor)); // number type
  if (kvRet.err) {
    return kvRet.err;
  }

  // set Reserve
  kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvReserve);
  if (kvRet.err) {
    return kvRet.err;
  }
  kvRet = await kvRet.kv!.set(tokenIdUpperCase, context.value);
  if (kvRet.err) {
    return kvRet.err;
  }

  // set Supply
  kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvSupply);
  if (kvRet.err) {
    return kvRet.err;
  }
  kvRet = await kvRet.kv!.set(tokenIdUpperCase, amountAll);
  if (kvRet.err) {
    return kvRet.err;
  }

  // set Nonliquidity
  kvRet = await context.storage.getReadWritableKeyValueWithDbname(Chain.dbBancor, Chain.kvNonliquidity);
  if (kvRet.err) {
    return kvRet.err;
  }

  // Consider to use nonliquidity or not
  // nonliquidity == 0; no limit for supply
  // nonliquidity !== 0, supply < nonliquidity!!
  if (!params.nonliquidity) {
    kvRet = await kvRet.kv!.set(tokenIdUpperCase, new BigNumber(0));
  } else {
    kvRet = await kvRet.kv!.set(tokenIdUpperCase, new BigNumber(params.nonliquidity).plus(amountAll));
  }

  if (kvRet.err) {
    return kvRet.err;
  }

  return ErrorCode.RESULT_OK;

}
