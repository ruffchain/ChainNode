import {ErrorCode} from '../types';
import {RPCServer} from '../lib/rpc_server';
import {Options as CommandOptions} from '../lib/simple_command';

import {Chain} from '../../core/value_chain/chain';
import {Miner} from '../../core/value_chain/miner';
import {Transaction} from '../../core/value_chain/transaction';
import { BufferReader } from '../../core/lib/reader';
import { isUndefined } from 'util';

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
        this.m_server!.on('sendTransaction', async (params: {tx: Buffer}, resp)=>{
            let tx = new Transaction();
            let err = tx.decode(new BufferReader(params.tx));
            if (err) {
                resp.write(JSON.stringify(err));
                return ;
            }
            err = await this.m_chain.addTransaction(tx);
            resp.write(JSON.stringify(err));
        });

        this.m_server!.on('getTransaction', ()=>{
            
        });

        this.m_server!.on('getTransactionReceipt', ()=>{

        });

        this.m_server!.on('getNonce', async (params: {address: string}, resp)=>{
            let nonce = await this.m_chain.getNonce(params.address);
            resp.write(JSON.stringify(nonce));
        });

        this.m_server!.on('view', async (params: {method: string, params: any, from?: number|string|'latest'}, resp)=>{
            let cr = await this.m_chain.callGet(isUndefined(params.from) ? 'latest' : params.from , params.method, params.params);
            if (cr.err) {
                resp.write(JSON.stringify({err: cr.err}));
                return ;
            }
            resp.write(JSON.stringify(cr));
        });

        this.m_server!.on('getBlock', async (params: {which: number|string|'latest', transactions?:boolean}, resp)=>{
            let hr = await this.m_chain.getHeader(params.which);
            if (hr.err) {
                resp.write(JSON.stringify({err: hr.err}));
                return ;
            }
            if (params.transactions) {
                
            } else {
                resp.write(JSON.stringify({err: ErrorCode.RESULT_OK, block: hr.header!.stringify()}));
                return ;
            }
        });
    }

    private m_chain: Chain;
    private m_miner?: Miner;
    private m_server?: RPCServer;
}