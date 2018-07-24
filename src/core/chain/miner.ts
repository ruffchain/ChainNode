import {Chain, ChainOptions} from './chain';
import {Block, BlockHeader} from './block';
import {ErrorCode} from '../error_code';
import * as assert from 'assert';
import {LoggerInstance} from '../lib/logger_util';
import { EventEmitter } from 'events';
import { Storage } from '../storage';
import {ChainCreator} from './chain_creator';

export {Chain} from './chain';

export type MinerOptions = {} ;

export enum MinerState {
    none = 0,
    initializing = 1,
    idle = 2,
    executing = 3,
    mining = 4,
}

export class Miner extends EventEmitter {
    protected m_chain?: Chain;
    // private m_miningBlock?: Block;
    protected m_state: MinerState;
    protected m_logger!: LoggerInstance;
    constructor(options: MinerOptions) {
        super();

        this.m_state = MinerState.none;
    }

    protected async _chainInstance(chainCreator: ChainCreator, param: Map<string, any>): Promise<{err: ErrorCode, chain?: Chain}> {
        return await chainCreator.createChain(param, Chain);
    }

    protected async _genesisChainInstance(chainCreator: ChainCreator, param: Map<string, any>): Promise<{err: ErrorCode, chain?: Chain}> {
        return await chainCreator.createGenesis(param, Chain);
    }

    get chain(): Chain {
        return this.m_chain!;
    }

    get peerid(): string {
        return this.m_chain!.peerid;
    }

    public async initialize(chainCreator: ChainCreator, param: Map<string, any>): Promise<ErrorCode> {
        this.m_state = MinerState.initializing;
        let cc = await this._chainInstance(chainCreator, param);
        if (cc.err) {
            return cc.err;
        }
        this.m_chain = cc.chain!;
        this.m_logger = this.chain.logger;
       
        this.m_chain!.on('tipBlock', (chain: Chain, tipBlock: BlockHeader) => {
            this._onTipBlock(this.m_chain!, tipBlock);
        });
        this.m_state = MinerState.idle;
        return ErrorCode.RESULT_OK;
    }

    public async create(chainCreator: ChainCreator, param: Map<string, any>, options?: any): Promise<ErrorCode> {
        let cc = await this._genesisChainInstance(chainCreator, param);
        if (cc.err) {
            return cc.err;
        }
        this.m_chain = cc.chain!;
        this.m_logger = this.chain.logger;

        let genesis = this.m_chain!.newBlock();
        genesis.header.timestamp = Date.now() / 1000;
        let sr = await this.chain.storageManager.createStorage('genesis');
        if (sr.err) {
            return sr.err;
        }
        let err;

        do {
            err = await this._createGenesisBlock(genesis, sr.storage!, options);
            if (err) {
                break;
            }
            this._decorateBlock(genesis);
            let nber = await this.chain.newBlockExecutor(genesis, sr.storage!);
            if (nber.err) {
                err = nber.err;
                break;
            }
            err = await nber.executor!.execute();
            if (err) {
                break;
            }
            let ssr = await this.chain.storageManager.createSnapshot(sr.storage!, genesis.header.hash);
            if (ssr.err) {
                err = ssr.err;
                break;
            }
            assert(ssr.snapshot);
            err = await this.chain.create(genesis, ssr.snapshot!);
        } while (false);
        await sr.storage!.remove();
        return err;
    }

    /**
     * virtual 
     * @param block 
     */
    protected async _createGenesisBlock(block: Block, storage: Storage, options?: any): Promise<ErrorCode> {
        let kvr = await storage.createKeyValue(Chain.kvUser);
        if (kvr.err) {
            return kvr.err;
        }
        kvr = await storage.createKeyValue(Chain.kvNonce);
        if (kvr.err) {
            return kvr.err;
        }
        kvr = await storage.createKeyValue(Chain.kvConfig);
        if (kvr.err) {
            return kvr.err;
        }

        assert(options!.txlivetime, 'options must have txlivetime');
        assert(options!.consensusname, 'options must have consensusname');

        await kvr.kv!.set('txlivetime', options!.txlivetime);
        await kvr.kv!.set('consensus', options!.consensusname);

        return ErrorCode.RESULT_OK;
    }

    protected async _createBlock(header: BlockHeader): Promise<ErrorCode> {
        let block = this.chain.newBlock(header);
        this.m_state = MinerState.executing;
        let tx = this.chain.pending.popTransaction();
        while (tx) {
            block.content.addTransaction(tx);
            tx = this.chain.pending.popTransaction();
        }
        await this._decorateBlock(block);
        let sr = await this.chain.storageManager.createStorage(header.preBlockHash, block.header.preBlockHash);
        if (sr.err) {
            return sr.err;
        }
        let err: ErrorCode;
        do {
            let nber = await this.chain.newBlockExecutor(block, sr.storage!);
            if (nber.err) {
                err = nber.err;
                break;
            }
            err = await nber.executor!.execute();
            if (err) {
                this.m_logger.error(`${this.chain.node!.node.peerid} execute failed! ret ${err}`);
                break;
            }
            this.m_state = MinerState.mining;
            err = await this._mineBlock(block);
            if (err) {
                this.m_logger.error(`${this.chain.node!.node.peerid} mine block failed! ret ${err}`);
                break;
            }
        } while (false);
        if (err) {
            await sr.storage!.remove();
            return err;
        }
        let ssr = await this.chain.storageManager.createSnapshot(sr.storage!, block.hash, true);
        if (ssr.err) {
            return ssr.err;
        }
        await this.chain.addMinedBlock(block, ssr.snapshot!);
        this.m_state = MinerState.idle;
        this.m_logger.info(`finish mine a block on block hash: ${this.chain.tipBlockHeader!.hash} number: ${this.chain.tipBlockHeader!.number}`);
        return err;
    }

    /**
     * virtual 
     * @param chain 
     * @param tipBlock 
     */
    protected async _onTipBlock(chain: Chain, tipBlock: BlockHeader): Promise<void> {
    }

    /**
     * virtual
     * @param block 
     */
    protected async _mineBlock(block: Block): Promise<ErrorCode> {
        return ErrorCode.RESULT_OK;
    } 

    protected async _decorateBlock(block: Block): Promise<ErrorCode> {
        return ErrorCode.RESULT_OK;
    }
}
