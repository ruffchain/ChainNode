import { DposViewContext, BigNumber, Chain, isValidAddress } from "../../../../../src/core";
import { MAX_QUERY_NUM, getTokenBalance } from "../scoop";

export async function funcGetTokenBalances (context: DposViewContext, params: any): Promise<{ address: string, balance: BigNumber }[]>  {

        if (!params.addresses) {
            return [];
        }

        let obj: any;
        try {
            obj = JSON.parse(JSON.stringify(params.addresses));
        } catch (e) {
            context.logger.error('getTokenBalances parsing addresses error', params.addresses);
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
            resultLst.push({ address: obj[i], balance: result });
        }

        return resultLst;
    }
