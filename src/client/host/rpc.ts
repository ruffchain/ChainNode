import {RPCServer} from '../lib/rpc_server';
import {Options as CommandOptions} from '../lib/simple_command';

import {ErrorCode, ValueChain, INode, GlobalConfig, ChainCreator, ValueMinerOptions, ValueMiner, ValueTransaction, BufferReader, stringify} from '../../core';

import { isUndefined } from 'util';

function promisify(f: any) {
    return () => {
        let args = Array.prototype.slice.call(arguments);
        return new Promise((resolve, reject) => {
            args.push((err: any, result: any) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
            f.apply(null, args);
        });
    };
}

export class ChainServer {
    constructor(chain: ValueChain, miner?: ValueMiner) {
        this.m_chain = chain;
        this.m_miner = miner;
    }

    init(commandOptions: CommandOptions): boolean {
        let host = commandOptions.get('rpchost');
        if (!host) {
            return false;
        }
        let port = commandOptions.get('rpcport');
        if (!port) {
            return false;
        }
        this.m_server = new RPCServer(host, parseInt(port, 10));
        this._initMethods();
        this.m_server.start();
        return true;
    }

    _initMethods() {
        this.m_server!.on('sendTransaction', async (params: {tx: any}, resp) => {
            let tx = new ValueTransaction();
            let err = tx.decode(new BufferReader(Buffer.from(params.tx, 'hex')));
            if (err) {
                await promisify(resp.write.bind(resp)(JSON.stringify(err)));
            } else {
                err = await this.m_chain.addTransaction(tx);
                await promisify(resp.write.bind(resp)(JSON.stringify(err)));
            }
            await promisify(resp.end.bind(resp)());
        });

        this.m_server!.on('getTransactionReceipt', async (params: {tx: string}, resp) => {
            let cr = await this.m_chain.getTransactionReceipt(params.tx);
            if (cr.err) {
                await promisify(resp.write.bind(resp)(JSON.stringify({err: cr.err})));
            } else {
                await promisify(resp.write.bind(resp)(JSON.stringify({
                    err: ErrorCode.RESULT_OK,
                    block: cr.block!.stringify(),
                    tx: cr.tx!.stringify(),
                    receipt: cr.receipt!.stringify()
                })));
            }
            await promisify(resp.end.bind(resp)());
        });

        this.m_server!.on('getNonce', async (params: {address: string}, resp) => {
            let nonce = await this.m_chain.getNonce(params.address);
            await promisify(resp.write.bind(resp)(JSON.stringify(nonce)));
            await promisify(resp.end.bind(resp)());
        });

        this.m_server!.on('view', async (params: {method: string, params: any, from?: number|string|'latest'}, resp) => {
            let cr = await this.m_chain.view(isUndefined(params.from) ? 'latest' : params.from , params.method, params.params);
            if (cr.err) {
                await promisify(resp.write.bind(resp)(JSON.stringify({err: cr.err})));
            } else {
                let s;
                try {
                    s = stringify(cr.value!);
                    cr.value = s;
                } catch (e) {
                    cr.err = ErrorCode.RESULT_INVALID_FORMAT;
                    delete cr.value;
                }
                await promisify(resp.write.bind(resp)(JSON.stringify(cr)));
            }
            await promisify(resp.end.bind(resp)());
        });

        this.m_server!.on('getBlock', async (params: {which: number|string|'latest', transactions?: boolean}, resp) => {
            let hr = await this.m_chain.getHeader(params.which);
            if (hr.err) {
                await promisify(resp.write.bind(resp)(JSON.stringify({err: hr.err})));
            } else {
                if (params.transactions) {
                    
                } else {
                    await promisify(resp.write.bind(resp)(JSON.stringify({err: ErrorCode.RESULT_OK, block: hr.header!.stringify()})));
                }
            }
            await promisify(resp.end.bind(resp))();
        });
    }

    private m_chain: ValueChain;
    private m_miner?: ValueMiner;
    private m_server?: RPCServer;
}