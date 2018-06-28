import {ErrorCode} from '../types';
import {RPCServer} from '../lib/rpc_server';
import {Options as CommandOptions} from '../lib/simple_command';

import {Chain} from '../../core/value_chain/chain';
import {Miner} from '../../core/value_chain/miner';
import {Transaction} from '../../core/value_chain/transaction';
import { BufferReader } from '../../core/lib/reader';
import { isUndefined } from 'util';
import {stringify} from '../../core/serializable';

function promisify(f: any) {
    return function () {
        let args = Array.prototype.slice.call(arguments);
        return new Promise(function (resolve, reject) {
            args.push(function (err: any, result: any) {
                if (err) reject(err);
                else resolve(result);
            });
            f.apply(null, args);
        });
    }
}

export class ChainServer {
    constructor(chain: Chain, miner?: Miner) {
        this.m_chain = chain;
        this.m_miner = miner;
    }

    init(commandOptions: CommandOptions): boolean {
        let host = commandOptions.get('rpchost');
        if (!host) {
            return false;
        }
        let port =commandOptions.get('rpcport');
        if (!port) {
            return false;
        }
        this.m_server = new RPCServer(host, parseInt(port));
        this._initMethods();
        this.m_server.start();
        return true;
    }

    _initMethods() {
        this.m_server!.on('sendTransaction', async (params: {tx: any}, resp)=>{
            let tx = new Transaction();
            let err = tx.decode(new BufferReader(Buffer.from(params.tx, 'hex')));
            if (err) {
                await promisify(resp.write.bind(resp)(JSON.stringify(err)));
            } else {
                err = await this.m_chain.addTransaction(tx);
                await promisify(resp.write.bind(resp)(JSON.stringify(err)));
            }
            await promisify(resp.end.bind(resp)());
        });

        this.m_server!.on('getTransaction', ()=>{
            
        });

        this.m_server!.on('getTransactionReceipt', ()=>{

        });

        this.m_server!.on('getNonce', async (params: {address: string}, resp)=>{
            let nonce = await this.m_chain.getNonce(params.address);
            await promisify(resp.write.bind(resp)(JSON.stringify(nonce)));
            await promisify(resp.end.bind(resp)());
        });

        this.m_server!.on('view', async (params: {method: string, params: any, from?: number|string|'latest'}, resp)=>{
            let cr = await this.m_chain.callGet(isUndefined(params.from) ? 'latest' : params.from , params.method, params.params);
            if (cr.err) {
                await promisify(resp.write.bind(resp)(JSON.stringify({err: cr.err})));
            } else {
                let s;
                try {
                    s = stringify(cr.value!);
                    cr.value = s;
                } catch(e) {
                    cr.err = ErrorCode.RESULT_INVALID_FORMAT;
                    delete cr.value;
                }
                await promisify(resp.write.bind(resp)(JSON.stringify(cr)));
            }
            await promisify(resp.end.bind(resp)());
        });

        this.m_server!.on('getBlock', async (params: {which: number|string|'latest', transactions?:boolean}, resp)=>{
            let hr = await this.m_chain.getHeader(params.which);
            if (hr.err) {
                await promisify(resp.write.bind(resp)(JSON.stringify({err: hr.err})));
            } else {
                if (params.transactions) {
                
                } else {
                    await promisify(resp.write.bind(resp)(JSON.stringify({err: ErrorCode.RESULT_OK, block: hr.header!.stringify()})));
                    return ;
                }
            }
            await promisify(resp.end.bind(resp))();
        });
    }

    private m_chain: Chain;
    private m_miner?: Miner;
    private m_server?: RPCServer;
}