import { DposViewContext, Chain } from "../../../../../src/core";


export async function funcGetLockBancorTokenBalance(context: DposViewContext, params: any): Promise<any> {
    let balancekv = (await context.storage.getReadableKeyValueWithDbname(Chain.dbToken, params.tokenid.toUpperCase()));

    if (balancekv.err) {
        return {};
    }

    // check token type
    let rtnType = await balancekv.kv!.get('type');

    console.log(rtnType);

    if (rtnType.err || rtnType.value !== 'lock_bancor_token') {
        console.log('wrong type');
        return {};
    }

    // let dbToken = (await context.storage.getReadableDatabase(Chain.dbToken))
    let hret = await balancekv.kv!.hgetall(params.address);
    if (hret.err || hret.value!.length === 0) {
        console.log('It is empty');
        return {};
    }

    // return await getTokenBalance(balancekv.kv!, params.address);
    let out = Object.create(null);
    let curBlock = context.getCurBlock();

    for (let p of hret.value!) {
        let dueBlock = p.key;
        let value = p.value;

        let duetime = await context.getTimeFromBlock(parseInt(dueBlock));
        if (duetime < 0) {
            console.log('get time from block fail')
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

    return out;
}

