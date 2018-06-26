import {ErrorCode} from '../error_code';
import * as BaseMiner from '../chain/miner';
import {Block} from '../chain/block';
import {Storage} from '../storage/storage_manager';
import {Chain, ChainOptions} from './chain';
import {BlockHeader} from './block';
import {BigNumber} from 'bignumber.js';
export {Chain} from './chain';
export {MinerState} from '../chain/miner';


export type MinerOptions = {coinbase?: string} & BaseMiner.MinerOptions & ChainOptions;

export class Miner extends BaseMiner.Miner {
    constructor(options: MinerOptions) {
        super(options);
        if (options.coinbase) {
            this.m_coinbase = options.coinbase;
        }
    }

    set coinbase(address: string|undefined) {
        this.m_coinbase = address;
    }

    get coinbase(): string|undefined {
        return this.m_coinbase;
    }

    protected m_coinbase?: string;

    protected _chainInstance(options: ChainOptions) {
        return new Chain(options);
    }

    get chain(): Chain {
        return <Chain>this.m_chain;
    }

    protected async _decorateBlock(block: Block) {
        (<BlockHeader>block.header).coinbase = this.m_coinbase!;
        return ErrorCode.RESULT_OK;
    }

    protected async _createGenesisBlock(block: Block, storage: Storage, options?: any): Promise<ErrorCode> {
        let err = await super._createGenesisBlock(block, storage, options);
        if (err) {
            return err;
        } 
        let kvr = await storage.createKeyValue(Chain.kvBalance);
        //在这里给用户加钱
        if (options && options.preBalances) {
            //这里要给几个账户放钱
            let kvBalance = kvr.kv!;
            for (let index = 0; index < options.preBalances.length; index++) {
                //按照address和amount预先初始化钱数
                await kvBalance.set(options.preBalances[index].address, new BigNumber(options.preBalances[index].amount).toString());
            }
        }
        return kvr.err;
    }
}