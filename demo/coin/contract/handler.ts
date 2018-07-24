import {ErrorCode, BigNumber, ValueViewContext, ValueTransactionContext, handler} from '../../../src/client';

handler.addViewMethod('getBalance', async (context: ValueViewContext, params: any): Promise<any> => {
    return (await context.getBalance(params.address)).toString();
});

handler.addTX('transferTo', async (context: ValueTransactionContext, params: any): Promise<ErrorCode> => {
    return context.transferTo(params.to, context.value);
});

handler.onMinerWage(async (): Promise<BigNumber> => {
    return new BigNumber(10000);
});