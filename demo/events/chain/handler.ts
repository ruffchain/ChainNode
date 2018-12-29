import { ErrorCode, BigNumber, ValueViewContext, ValueTransactionContext, ValueHandler } from '../../../src/client';

export function registerHandler(handler: ValueHandler) {
    handler.addViewMethod('getBalance', async (context: ValueViewContext, params: any): Promise<any> => {
        return await context.getBalance(params.address);
    });

    handler.defineEvent('transfer', {indices: ['from', 'to']});
    handler.addTX('transferTo', async (context: ValueTransactionContext, params: any): Promise<ErrorCode> => {
        const err = await context.transferTo(params.to, context.value);
        if (!err) {
            context.emit('transfer', {from: context.caller, to: params.to, value: context.value});
        }
        return err;
    });

    handler.onMinerWage(async (): Promise<BigNumber> => {
        return new BigNumber(10000);
    });
}