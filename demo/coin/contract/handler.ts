import {ErrorCode, BigNumber} from '../../../src/client/types';
import {ViewContext, EventContext, TransactionContext} from '../../../src/client/pow/types';
import handler = require('../../../src/client/handler');

handler.addViewMethod('getBalance', async (context: ViewContext, params: any): Promise<any> => {
    return context.getBalance(params.address);
});

handler.addTX('transferTo', async (context: TransactionContext, params: any): Promise<ErrorCode> => {
    return context.transferTo(params.to, new BigNumber(params.amount));
});