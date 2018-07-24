import {ErrorCode, BigNumber, DposViewContext, DposTransactionContext, handler} from '../../../src/client';

handler.addViewMethod('getBalance', async (context: DposViewContext, params: any): Promise<BigNumber> => {
    return await context.getBalance(params.address);
});

handler.addViewMethod('getVote', async (context: DposViewContext, params: any): Promise<Map<string, BigNumber> > => {
    return await context.getVote();
});

handler.addViewMethod('getStoke', async (context: DposViewContext, params: any): Promise<BigNumber> => {
    return await context.getStoke(params.address);
});

handler.addViewMethod('getCandidates', async (context: DposViewContext, params: any): Promise<string[]> => {
    return await context.getCandidates();
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

handler.addTX('unmortgage', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
    let err = context.transferTo(context.caller, new BigNumber(params));
    if (err) {
        return err;
    }
    return await context.unmortgage(context.caller, new BigNumber(params));
});

handler.addTX('register', async (context: DposTransactionContext, params: any): Promise<ErrorCode> => {
    return await context.register(context.caller);
});