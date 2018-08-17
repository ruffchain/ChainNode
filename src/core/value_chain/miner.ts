import {ErrorCode} from '../error_code';
import {Miner, Block, Storage, Chain, MinerInstanceOptions, INode} from '../chain';
import {ValueBlockHeader} from './block';
import {BigNumber} from 'bignumber.js';
import {ValueChain} from './chain';
import { LoggerOptions } from '../lib/logger_util';
import {isValidAddress} from '../address';
const assert = require('assert');

export type ValueMinerInstanceOptions = {coinbase?: string} & MinerInstanceOptions;

export class ValueMiner extends Miner {
    constructor(options: LoggerOptions) {
        super(options);
    }

    set coinbase(address: string|undefined) {
        this.m_coinbase = address;
    }

    get coinbase(): string|undefined {
        return this.m_coinbase;
    }

    protected m_coinbase?: string;

    protected _chainInstance(): Chain {
        return new ValueChain({logger: this.m_logger!});
    }

    get chain(): ValueChain {
        return this.m_chain as ValueChain;
    }

    public parseInstanceOptions(node: INode, instanceOptions: Map<string, any>): {err: ErrorCode, value?: any} {
        let {err, value} = super.parseInstanceOptions(node, instanceOptions);
        if (err) {
            return {err};
        }
        value.coinbase = instanceOptions.get('coinbase');
        return {err: ErrorCode.RESULT_OK, value};
    }

    public async initialize(options: ValueMinerInstanceOptions): Promise<ErrorCode> {
        if (options.coinbase) {
            this.m_coinbase = options.coinbase;
        }
        return super.initialize(options);
    }

    protected async _decorateBlock(block: Block) {
        (block.header as ValueBlockHeader).coinbase = this.m_coinbase!;
        return ErrorCode.RESULT_OK;
    }

    protected async _createGenesisBlock(block: Block, storage: Storage, globalOptions: any, genesisOptions?: any): Promise<ErrorCode> {
        let err = await super._createGenesisBlock(block, storage, globalOptions, genesisOptions);
        if (err) {
            return err;
        } 
        let dbr = await storage.getReadWritableDatabase(Chain.dbSystem);
        if (dbr.err) {
            assert(false, `value chain create genesis failed for no system database`);
            return dbr.err;
        }
        const dbSystem = dbr.value!;
        let gkvr = await dbSystem.getReadWritableKeyValue(Chain.kvConfig);
        if (gkvr.err) {
            return gkvr.err;
        }
        let rpr = await gkvr.kv!.rpush('features', 'value');
        if (rpr.err) {
            return rpr.err;
        }
        if (!genesisOptions || !isValidAddress(genesisOptions.coinbase)) {
            this.m_logger.error(`create genesis failed for genesisOptioins should has valid coinbase`);
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        (block.header as ValueBlockHeader).coinbase = genesisOptions.coinbase;
        let kvr = await dbSystem.createKeyValue(ValueChain.kvBalance);
        // 在这里给用户加钱
        if (genesisOptions && genesisOptions.preBalances) {
            // 这里要给几个账户放钱
            let kvBalance = kvr.kv!;
            for (let index = 0; index < genesisOptions.preBalances.length; index++) {
                // 按照address和amount预先初始化钱数
                await kvBalance.set(genesisOptions.preBalances[index].address, new BigNumber(genesisOptions.preBalances[index].amount));
            }
        }
        return kvr.err;
    }
}