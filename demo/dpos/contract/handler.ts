import {ErrorCode, BigNumber} from '../../../src/client/types';
import {ViewContext, EventContext, TransactionContext} from '../../../src/client/dpos/types';
import handler = require('../../../src/client/handler');

handler.addViewMethod('getBalance', async (context: ViewContext, params: any): Promise<any> => {
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
    return await context.transferTo(params.to, new BigNumber(params.amount));
});

handler.addTX('vote', async (context: TransactionContext, params: any): Promise<ErrorCode> => {
    return await context.vote(params.from, params.candiates);
});

handler.addTX('mortgage', async (context: TransactionContext, params: any): Promise<ErrorCode> => {
    return await context.mortgage(params.from, new BigNumber(params.amount));
});

handler.addTX('unmortgage', async (context: TransactionContext, params: any): Promise<ErrorCode> => {
    return await context.unmortgage(params.from, new BigNumber(params.amount));
});