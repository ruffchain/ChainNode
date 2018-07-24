import {ErrorCode} from '../error_code';
import {Miner, MinerOptions, Block, Storage, Chain} from '../chain';
import {ValueBlockHeader} from './block';
import {BigNumber} from 'bignumber.js';
import {ValueChain} from './chain';
import {ChainCreator} from '../chain/chain_creator';

export type ValueMinerOptions = {coinbase?: string} & MinerOptions;

export class ValueMiner extends Miner {
    constructor(options: ValueMinerOptions) {
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

    protected async _chainInstance(chainCreator: ChainCreator, commandOptions: Map<string, any>): Promise<{err: ErrorCode, chain?: Chain}> {
        let cc = await chainCreator.createChain(commandOptions, ValueChain);
        if (cc.err) {
            return {err: cc.err};
        }

        return {err: ErrorCode.RESULT_OK, chain: cc.chain as ValueChain};
    }

    protected async _genesisChainInstance(chainCreator: ChainCreator, commandOptions: Map<string, any>): Promise<{err: ErrorCode, chain?: Chain}> {
        let cc = await chainCreator.createGenesis(commandOptions, ValueChain);
        if (cc.err) {
            return {err: cc.err};
        }

        return {err: ErrorCode.RESULT_OK, chain: cc.chain as ValueChain};
    }

    get chain(): ValueChain {
        return this.m_chain as ValueChain;
    }

    protected async _decorateBlock(block: Block) {
        (block.header as ValueBlockHeader).coinbase = this.m_coinbase!;
        return ErrorCode.RESULT_OK;
    }

    protected async _createGenesisBlock(block: Block, storage: Storage, options?: any): Promise<ErrorCode> {
        let err = await super._createGenesisBlock(block, storage, options);
        if (err) {
            return err;
        } 
        let kvr = await storage.createKeyValue(ValueChain.kvBalance);
        // 在这里给用户加钱
        if (options && options.preBalances) {
            // 这里要给几个账户放钱
            let kvBalance = kvr.kv!;
            for (let index = 0; index < options.preBalances.length; index++) {
                // 按照address和amount预先初始化钱数
                await kvBalance.set(options.preBalances[index].address, new BigNumber(options.preBalances[index].amount).toString());
            }
        }
        return kvr.err;
    }
}