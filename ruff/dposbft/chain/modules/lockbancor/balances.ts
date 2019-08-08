import { DposViewContext, Chain, BigNumber, isValidAddress } from "../../../../../src/core";
import { MAX_QUERY_NUM } from "../scoop";


export async function funcGetLockBancorTokenBalances(context: DposViewContext, params: any): Promise<any> {

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

    let balancekv = (await context.storage.getReadableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase()));

    if (balancekv.err) {
        return [];
    }

    let resultLst: { address: string, balance: any }[] = [];

    // check token type
    let rtnType = await balancekv.kv!.get('type');

    context.logger.info(JSON.stringify(rtnType));

    if (rtnType.err || rtnType.value !== 'lock_bancor_token') {
        context.logger.error('wrong type');
        return {};
    }
    // addresses loop over
    for (let i = 0; i < obj.length && i <= MAX_QUERY_NUM; i++) {
        if (!isValidAddress(obj[i])) {
            return [];
        }

        // let dbToken = (await context.storage.getReadableDatabase(Chain.dbToken))
        let hret = await balancekv.kv!.hgetall(obj[i]);
        if (hret.err) {
            context.logger.error('It is empty');
            return {};
        }

        if (hret.value!.length === 0) {
            resultLst.push({ address: obj[i], balance: { amount: 0 } });
            continue;
        }

        // return await getTokenBalance(balancekv.kv!, params.address);
        let out = Object.create(null);
        let curBlock = context.getCurBlock();

        for (let p of hret.value!) {
            let dueBlock = p.key;
            let value = p.value;

            let duetime = await context.getTimeFromBlock(parseInt(dueBlock));
            if (duetime < 0) {
                context.logger.error('get time from block fail');
                return {}
            }

            if (dueBlock === '0') {
                out.amount = value;
            } else {
                out.amountLock = value;
                out.dueBlock = dueBlock;
                out.curBlock = curBlock;
                out.dueTime = context.getTimeFromBlock(parseInt(dueBlock));
            }
        }
        resultLst.push({ address: obj[i], balance: out });

    }

    return resultLst;
}
