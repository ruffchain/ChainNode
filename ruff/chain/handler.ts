import { ErrorCode, BigNumber, DposViewContext, DposTransactionContext, ValueHandler } from '../../src/client';
import { IReadableKeyValue } from '../../src/core';

export function registerHandler(handler: ValueHandler) {
    async function getTokenBalance(balanceKv: IReadableKeyValue, address: string): Promise<BigNumber> {
        let retInfo = await balanceKv.get(address);
        return retInfo.err === ErrorCode.RESULT_OK ? new BigNumber(retInfo.value as string) : new BigNumber(0);
    }

    handler.addViewMethod('getBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {
        return await context.getBalance(params.address);
    });

    handler.addViewMethod('getVote', async (context: DposViewContext, params: any): Promise<Map<string, BigNumber>> => {
        return await context.getVote();
    });

    handler.addViewMethod('getStoke', async (context: DposViewContext, params: any): Promise<BigNumber> => {
        return await context.getStoke(params.address);
    });

    handler.addViewMethod('getCandidates', async (context: DposViewContext, params: any): Promise<string[]> => {
        return await context.getCandidates();
    });

    handler.addViewMethod('getTokenBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {
        let balancekv = await context.storage.getReadableKeyValue(params.tokenid);
        return await getTokenBalance(balancekv.kv!, params.address);
    });

    handler.addTX('transferTo', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        return context.transferTo(params.to, context.value);
    });

    handler.addTX('vote', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        return await context.vote(context.caller, params);
    });

    handler.addTX('mortgage', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        return await context.mortgage(context.caller, new BigNumber(params));
    });

    handler.addTX('createToken', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        // 这里是不是会有一些检查什么的，会让任何人都随便创建Token么?

        // 必须要有tokenid，一条链上tokenid不能重复
        if (!params.tokenid) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        let kvRet = await context.storage.createKeyValue(params.tokenid);
        if (kvRet.err) {
            return kvRet.err;
        }

        kvRet.kv!.set('creator', context.caller);

        if (params.preBalances) {
            for (let index = 0; index < params.preBalances.length; index++) {
                // 按照address和amount预先初始化钱数
                await kvRet.kv!.set(params.preBalances[index].address, new BigNumber(params.preBalances[index].amount).toString());
            }
        }
        return ErrorCode.RESULT_OK;
    });

    handler.addTX('transferTokenTo', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        let tokenkv = await context.storage.getReadWritableKeyValue(params.tokenid);
        if (tokenkv.err) {
            return tokenkv.err;
        }

        let fromTotal = await getTokenBalance(tokenkv.kv!, context.caller);
        let amount = new BigNumber(params.amount);
        if (fromTotal.lt(amount)) {
            return ErrorCode.RESULT_NOT_ENOUGH;
        }
        await (tokenkv.kv!.set(context.caller, fromTotal.minus(amount).toString()));
        await (tokenkv.kv!.set(params.to, (await getTokenBalance(tokenkv.kv!, params.to)).plus(amount).toString()));
        return ErrorCode.RESULT_OK;
    });

    handler.addTX('unmortgage', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        let err = await context.transferTo(context.caller, new BigNumber(params));
        if (err) {
            return err;
        }
        return await context.unmortgage(context.caller, new BigNumber(params));
    });

    handler.addTX('register', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
        return await context.register(context.caller);
    });
}