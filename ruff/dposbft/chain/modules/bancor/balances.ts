import { DposViewContext, BigNumber, Chain, isValidAddress } from "../../../../../src/core";
import { MAX_QUERY_NUM, getTokenBalance, strAmountPrecision, BANCOR_TOKEN_PRECISION } from "../scoop";

export async function funcGetBancorTokenBalances(context: DposViewContext, params: any): Promise<{ address: string, balance: BigNumber }[]> {

  if (!params.addresses) {
    return [];
  }

  let obj: any;
  try {
    obj = JSON.parse(JSON.stringify(params.addresses));
  } catch (e) {
    context.logger.error('getBancorTokenBalances parsing addresses error', params.addresses);
    return [];
  }

  let balancekv = await context.storage.getReadableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase());
  // return await ;
  let resultLst: { address: string, balance: BigNumber }[] = [];

  for (let i = 0; i < obj.length && i <= MAX_QUERY_NUM; i++) {
    if (!isValidAddress(obj[i])) {
      return [];
    }

    let result = await getTokenBalance(balancekv.kv!, obj[i]);
    let strAmount = strAmountPrecision(result.toNumber().toString(), BANCOR_TOKEN_PRECISION);
    let e: BigNumber = new BigNumber(strAmount);
    resultLst.push({ address: obj[i], balance: e });
  }

  return resultLst;
}
