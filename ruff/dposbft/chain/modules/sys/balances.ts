import { DposViewContext, BigNumber, isValidAddress } from "../../../../../src/core";
import { MAX_QUERY_NUM } from "../scoop";

export async function funcGetBalances(context: DposViewContext, params: any): Promise<{ address: string, balance: BigNumber }[]>  {

  if (!params.addresses) {
      return [];
  }

  let obj: any;
  try {
      // context.logger.error('getbalances');
      // console.log(params.addresses);
      // console.log(typeof params.addresses)
      obj = JSON.parse(JSON.stringify(params.addresses));
  } catch (e) {
      context.logger.error('getBalances parsing addresses error', params.addresses);
      return [];
  }
  let resultLst: { address: string, balance: BigNumber }[] = [];

  for (let i = 0; i < obj.length && i <= MAX_QUERY_NUM; i++) {
      if (!isValidAddress(obj[i])) {
          return [];
      }

      let result = await context.getBalance(obj[i]);
      resultLst.push({ address: obj[i], balance: result });
  }

  return resultLst;
}
