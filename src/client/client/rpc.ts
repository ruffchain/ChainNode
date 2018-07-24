import {ErrorCode, ValueTransaction, BufferWriter} from '../../core';
import {RPCClient} from '../lib/rpc_client';

export type HostClientOptions = {host: string, port: number};

export class HostClient {
    constructor(options: HostClientOptions) {
        this.m_client = new RPCClient(options.host, options.port);
    }

    async getBlock(params: {which: string|number|'lastest', transactions?: boolean}): Promise<{err: ErrorCode, block?: any}> {
        let cr = await this.m_client.callAsync('getBlock', params);
        if (cr.ret !== 200) {
            return {err: ErrorCode.RESULT_FAILED};
        }
        return JSON.parse(cr.resp!);
    }

    async getTransactionReceipt(params: {tx: string}): Promise<{err: ErrorCode, block?: any, tx?: any, receipt?: any}> {
        let cr = await this.m_client.callAsync('getTransactionReceipt', params);
        if (cr.ret !== 200) {
            return {err: ErrorCode.RESULT_FAILED};
        }
        return JSON.parse(cr.resp!);
    }

    async getNonce(params: {address: string}): Promise<{err: ErrorCode, nonce?: number}> {
        let cr = await this.m_client.callAsync('getNonce', params);
        if (cr.ret !== 200) {
            return {err: ErrorCode.RESULT_FAILED};
        }
        return JSON.parse(cr.resp!);
    }

    async sendTransaction(params: {tx: ValueTransaction}): Promise<ErrorCode> {
        let writer = new BufferWriter();
        params.tx.encode(writer);
        let cr = await this.m_client.callAsync('sendTransaction', {tx: writer.render()});
        if (cr.ret !== 200) {
            return ErrorCode.RESULT_FAILED;
        }
        return JSON.parse(cr.resp!) as ErrorCode;
    } 

    async view(params: {method: string, params: any, from?: number|string|'latest'}): Promise<{err: ErrorCode, value?: any}> {
        let cr = await this.m_client.callAsync('view', params);
        if (cr.ret !== 200) {
            return {err: ErrorCode.RESULT_FAILED};
        }
        return JSON.parse(cr.resp!);
    }

    private m_client: RPCClient;
}