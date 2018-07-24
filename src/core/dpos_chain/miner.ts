import * as assert from 'assert';

import { ErrorCode } from '../error_code';
import { addressFromSecretKey } from '../address';

import {ValueMinerOptions, ValueMiner, Chain, Block, Storage} from '../value_chain';
import { DposBlockHeader } from './block';
import {ChainCreator} from '../chain/chain_creator';
import {DposChain} from './chain';
import * as consensus from './consensus';

export type DposMinerOptions = {minerSecret: Buffer} & ValueMinerOptions;

export class DposMiner extends ValueMiner {
    private m_secret: Buffer;
    private m_address!: string;
    private m_timer?: NodeJS.Timer;
    protected m_runTxPending: any = [];
    protected m_currTx: any = null;
    constructor(options: DposMinerOptions) {
        super(options);
        this.m_secret = options.minerSecret;
        this.m_address = addressFromSecretKey(this.m_secret)!;
        if (!this.coinbase) {
            this.coinbase = this.m_address;
        }
        assert(this.coinbase, `secret key failed`);
    }

    protected async _chainInstance(chainCreator: ChainCreator, commandOptions: Map<string, any>): Promise<{err: ErrorCode, chain?: Chain}> {
        let cc = await chainCreator.createChain(commandOptions, DposChain);
        if (cc.err) {
            return {err: cc.err};
        }

        return {err: ErrorCode.RESULT_OK, chain: cc.chain};
    }

    protected async _genesisChainInstance(chainCreator: ChainCreator, commandOptions: Map<string, any>): Promise<{err: ErrorCode, chain?: Chain}> {
        let cc = await chainCreator.createGenesis(commandOptions, DposChain);
        if (cc.err) {
            return {err: cc.err};
        }

        return {err: ErrorCode.RESULT_OK, chain: cc.chain as Chain};
    }

    get chain(): DposChain {
        return this.m_chain as DposChain;
    }

    get address(): string {
        return this.m_address;
    }

    public async initialize(chainCreator: ChainCreator, commandOptions: Map<string, any>): Promise<ErrorCode> {
        if (!this.m_address) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        let err = await super.initialize(chainCreator, commandOptions);
        if (err) {
            return err;
        }
        this.m_logger.info(`begin Mine...`);
        this._resetTimer();

        return ErrorCode.RESULT_OK;
    }

    protected async _resetTimer(): Promise<ErrorCode> {
        let tr = await this._nextBlockTimeout();
        if (tr.err) {
            return tr.err;
        }

        if (this.m_timer) {
            clearTimeout(this.m_timer);
            delete this.m_timer; 
        }
        
        this.m_timer = setTimeout(async () => {
            delete this.m_timer;
            let now = Date.now() / 1000;
            let tip = this.m_chain!.tipBlockHeader! as DposBlockHeader;
            let blockHeader = new DposBlockHeader();
            blockHeader.setPreBlock(tip);
            blockHeader.timestamp = now;
            let dmr = await blockHeader.getDueMiner(this.m_chain as Chain);
            if (dmr.err) {
                return ;
            }
            this.m_logger.info(`calcuted block ${blockHeader.number} creator: ${dmr.miner}`);
            if (!dmr.miner) {
                assert(false, 'calcuted undefined block creator!!');
                process.exit(1);
            }
            if (this.m_address === dmr.miner) {
                await this._createBlock(blockHeader);
            }
            this._resetTimer();
        }, tr.timeout!);
        return ErrorCode.RESULT_OK;
    }
    
    protected async _mineBlock(block: Block): Promise<ErrorCode> {
        // 只需要给block签名
        this.m_logger.info(`${this.peerid} create block, sign ${this.m_address}`);
        (block.header as DposBlockHeader).signBlock(this.m_secret);
        block.header.updateHash();
        return ErrorCode.RESULT_OK;
    }

    protected async _nextBlockTimeout(): Promise<{err: ErrorCode, timeout?: number}> {
        let hr = await this.m_chain!.getHeader(0);
        if (hr.err) {
            return {err: hr.err};
        }
        let now = Date.now() / 1000;
        let blockInterval = this.m_chain!.globalConfig.getConfig('blockInterval');
        let nextTime = (Math.floor((now - hr.header!.timestamp) / blockInterval) + 1) * blockInterval;

        return {err: ErrorCode.RESULT_OK, timeout: (nextTime + hr.header!.timestamp - now) * 1000};
    }

    protected async _createGenesisBlock(block: Block, storage: Storage, options: any): Promise<ErrorCode> {
        let err = await super._createGenesisBlock(block, storage, options);
        if (err) {
            return err;
        }

        // storage的键值对要在初始化的时候就建立好
        await storage.createKeyValue(consensus.ViewContext.kvDPOS);
        let denv = new consensus.Context(this.m_chain!.globalConfig, this.m_logger);

        let ir = await denv.init(storage, options.candidates, options.miners);
        if (ir.err) {
            return ir.err;
        }
        let kvr = await storage.getReadWritableKeyValue(Chain.kvConfig);
        if (kvr.err) {
            return kvr.err;
        }

        assert(options.consensus, 'options must have consensus');

        await kvr.kv!.set('minCreateor', options.consensus.minCreateor);
        await kvr.kv!.set('maxCreateor', options.consensus.maxCreateor);
        await kvr.kv!.set('reSelectionBlocks', options.consensus.reSelectionBlocks);
        await kvr.kv!.set('blockInterval', options.consensus.blockInterval);
        await kvr.kv!.set('timeOffsetToLastBlock', options.consensus.timeOffsetToLastBlock);
        await kvr.kv!.set('timeBan', options.consensus.timeBan);
        await kvr.kv!.set('unbanBlocks', options.consensus.unbanBlocks);
        await kvr.kv!.set('dposVoteMaxProducers', options.consensus.dposVoteMaxProducers);
        await kvr.kv!.set('maxBlockIntervalOffset', options.consensus.maxBlockIntervalOffset);

        return ErrorCode.RESULT_OK;
    }
}