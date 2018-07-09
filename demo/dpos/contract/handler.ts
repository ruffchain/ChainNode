import {ErrorCode, BigNumber} from '../../../src/client/types';
import {ViewContext, EventContext, TransactionContext} from '../../../src/client/dpos/types';
import handler = require('../../../src/client/handler');

handler.addViewMethod('getBalance', async (context: ViewContext, params: any): Promise<BigNumber> => {
    return await context.getBalance(params.address);
});

handler.addViewMethod('getVote', async (context: ViewContext, params: any): Promise<Map<string, BigNumber> > => {
    return await context.getVote();
});

handler.addViewMethod('getStoke', async (context: ViewContext, params: any): Promise<BigNumber> => {
    return await context.getStoke(params.address);
});

handler.addViewMethod('getCandidates', async (context: ViewContext, params: any): Promise<string[]> => {
    return await context.getCandidates();
});


handler.addTX('transferTo', async (context: TransactionContext, params: any): Promise<ErrorCode> => {
    return context.transferTo(params.to, context.value);
});

handler.addTX('vote', async (context: TransactionContext, params: any): Promise<ErrorCode> => {
    return await context.vote(context.caller, params);
});

handler.addTX('mortgage', async (context: TransactionContext, params: any): Promise<ErrorCode> => {
    return await context.mortgage(context.caller, new BigNumber(params));
});

handler.addTX('unmortgage', async (context: TransactionContext, params: any): Promise<ErrorCode> => {
    return await context.unmortgage(context.caller, new BigNumber(params));
});

handler.addTX('register', async (context: TransactionContext, params: any): Promise<ErrorCode> => {
    return await context.register(context.caller);
});