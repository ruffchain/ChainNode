import {Transaction} from './transaction';
import {Chain, ChainOptions} from './chain';
import {Block, BlockHeader} from './block';
import {ErrorCode} from '../error_code';
import * as assert from 'assert';
import { BlockStorage } from './block_storage';
import {LoggerInstance, initLogger, LoggerOptions} from '../lib/logger_util';
import { EventEmitter } from 'events';
import { Storage } from '../storage/storage_manager';

export {Chain} from './chain';

export type MinerOptions = {} & ChainOptions;

export enum MinerState {
    none = 0,
    initializing = 1,
    idle = 2,
    executing = 3,
    mining = 4,
};

export class Miner extends EventEmitter{
    protected m_chain: Chain;
    // private m_miningBlock?: Block;
    protected m_state: MinerState;
    protected m_logger: LoggerInstance;
    constructor(options: MinerOptions) {
        super();
        this.m_logger = initLogger(options);
        options.logger = this.m_logger;
        this.m_state = MinerState.none;
        this.m_chain = this._chainInstance(options);
    }

    protected _chainInstance(options: ChainOptions) {
        return new Chain(options);
    }

    get chain(): Chain {
        return this.m_chain;
    }

    get peerid(): string {
        return this.m_chain.peerid;
    }

    public async initialize(): Promise<ErrorCode> {
        this.m_state = MinerState.initializing;
        let err = await this.m_chain.initialize();
        if (err !== ErrorCode.RESULT_OK) {
            return err;
        }
        this.m_chain.on('tipBlock', (chain: Chain, tipBlock: BlockHeader)=>{
            this._onTipBlock(this.m_chain, tipBlock);
        });
        this.m_state = MinerState.idle;
        return ErrorCode.RESULT_OK;
    }


    public async create(options?: any): Promise<ErrorCode> {
        await this.m_chain.initComponents();
        let genesis = this.m_chain.newBlock();
        genesis.header.timestamp = Date.now() / 1000;
        let sr = await this.m_chain.storageManager.createStorage('genesis');
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
            let nber = await this.m_chain.newBlockExecutor(genesis, sr.storage!);
            if (nber.err) {
                err = nber.err;
                break;
            }
            err = await nber.executor!.execute();
            await nber.executor!.uninit();
            if (err) {
                break;
            }
            let ssr = await this.m_chain.storageManager.createSnapshot(sr.storage!, genesis.header.hash);
            if (ssr.err) {
                err = ssr.err;
                break;
            }
            assert(ssr.snapshot);
            err = await this.m_chain.create(genesis, ssr.snapshot!);
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

        assert(options!.txlivetime && options!.consensusname, 'options must have txlivetime');
        await kvr.kv!.set('txlivetime', options!.txlivetime);
        await kvr.kv!.set('consensus', options!.consensusname);

        return ErrorCode.RESULT_OK;
    }

    protected async _createBlock(header: BlockHeader): Promise<ErrorCode> {
        let block = this.m_chain.newBlock(header);
        this.m_state = MinerState.executing;
        let tx = this.m_chain.pending.popTransaction();
        while (tx) {
            block.content.addTransaction(tx);
            tx = this.m_chain.pending.popTransaction();
        }
        await this._decorateBlock(block);
        let sr = await this.m_chain.storageManager.createStorage(header.preBlockHash, block.header.preBlockHash);
        if (sr.err) {
            return sr.err;
        }
        let err: ErrorCode;
        do {
            let nber = await this.m_chain.newBlockExecutor(block, sr.storage!);
            if (nber.err) {
                err = nber.err;
                break;
            }
            err = await nber.executor!.execute();
            await nber.executor!.uninit();
            if (err) {
                this.m_logger.error(`${this.m_chain.node!.node.peerid} execute failed! ret ${err}`);
                break;
            }
            this.m_state = MinerState.mining;
            err = await this._mineBlock(block);
            if (err) {
                this.m_logger.error(`${this.m_chain.node!.node.peerid} mine block failed! ret ${err}`);
                break;
            }
        } while (false);
        if (err) {
            await sr.storage!.remove();
            return err;
        }
        let ssr = await this.m_chain.storageManager.createSnapshot(sr.storage!, block.hash, true);
        if (ssr.err) {
            return ssr.err;
        }
        await this.m_chain.addMinedBlock(block, ssr.snapshot!);
        this.m_state = MinerState.idle;
        this.m_logger.info(`finish mine a block on block hash: ${this.m_chain.tipBlockHeader!.hash} number: ${this.m_chain.tipBlockHeader!.number}`);
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
