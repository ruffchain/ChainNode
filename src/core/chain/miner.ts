import {Chain, ChainGlobalOptions, ChainInstanceOptions} from './chain';
import {Block, BlockHeader} from '../block';
import {ErrorCode} from '../error_code';
import * as assert from 'assert';
import {LoggerInstance, LoggerOptions} from '../lib/logger_util';
import { EventEmitter } from 'events';
import { Storage } from '../storage';
import {BaseHandler} from '../executor';
import { INode } from '../net';
import { isNumber, isBoolean, isString } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import { isValidAddress } from '../address';

export type MinerInstanceOptions = ChainInstanceOptions;

export enum MinerState {
    none = 0,
    init = 1,
    syncing = 2,
    idle = 3,
    executing = 4,
    mining = 5,
}

export class Miner extends EventEmitter {
    protected m_chain?: Chain;
    protected m_instanceOptions: any;
    protected m_state: MinerState;
    protected m_logger!: LoggerInstance;
    constructor(options: LoggerOptions) {
        super();
        this.m_logger = options.logger!;
        this.m_state = MinerState.none;
    }

    get chain(): Chain {
        return this.m_chain!;
    }

    get peerid(): string {
        return this.m_chain!.peerid;
    }

    public async initComponents(dataDir: string, handler: BaseHandler): Promise<ErrorCode> {
        if (this.m_state > MinerState.none) {
            return ErrorCode.RESULT_OK;
        }
        
        this.m_chain = this._chainInstance();
        let err = await this.m_chain!.initComponents(dataDir, handler);
        if (err) {
            this.m_logger.error(`miner initComponent failed for chain initComponent failed`, err);
            return err;
        }
        this.m_state = MinerState.init;
        return ErrorCode.RESULT_OK;
    }

    protected _chainInstance(): Chain {
        return new Chain({logger: this.m_logger!});
    }

    public parseInstanceOptions(node: INode, instanceOptions: Map<string, any>): {err: ErrorCode, value?: any} {
        let value = Object.create(null);
        value.node = node;
        return {err: ErrorCode.RESULT_OK, value};
    }

    public async initialize(options: MinerInstanceOptions): Promise<ErrorCode> {
        if (this.m_state !== MinerState.init) {
            this.m_logger.error(`miner initialize failed hasn't initComponent`);
            return ErrorCode.RESULT_INVALID_STATE;
        }
        this.m_state = MinerState.syncing;
        let err = await this.m_chain!.initialize(options);
        if (err) {
            this.m_logger.error(`miner initialize failed for chain initialize failed ${err}`);
            return err;
        }
        this.m_chain!.on('tipBlock', (chain: Chain, tipBlock: BlockHeader) => {
            this._onTipBlock(this.m_chain!, tipBlock);
        });
        this.m_state = MinerState.idle;
        return ErrorCode.RESULT_OK;
    }

    public async create(globalOptions: ChainGlobalOptions, genesisOptions?: any): Promise<ErrorCode> {
        if (this.m_state !== MinerState.init) {
            this.m_logger.error(`miner create failed hasn't initComponent`);
            return ErrorCode.RESULT_INVALID_STATE;
        }
        if (!this.m_chain!.onCheckGlobalOptions(globalOptions)) {
            this.m_logger.error(`miner create failed for invalid globalOptions`, globalOptions);
        }
        let genesis = this.m_chain!.newBlock();
        genesis.header.timestamp = Date.now() / 1000;
        let sr = await this.chain.storageManager.createStorage('genesis');
        if (sr.err) {
            return sr.err;
        }
        let err;

        do {
            err = await this._decorateBlock(genesis);
            if (err) {
                break;
            }
            err = await this._createGenesisBlock(genesis, sr.storage!, globalOptions, genesisOptions);
            if (err) {
                break;
            }
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
    protected async _createGenesisBlock(block: Block, storage: Storage, globalOptions: ChainGlobalOptions, genesisOptions?: any): Promise<ErrorCode> {
        let dbr = await storage.createDatabase(Chain.dbUser);
        if (dbr.err) {
            this.m_logger.error(`miner create genensis block failed for create user table to storage failed ${dbr.err}`);

            return dbr.err;
        }
        dbr = await storage.createDatabase(Chain.dbSystem);
        if (dbr.err) {
            return dbr.err;
        } 
        let kvr = await dbr.value!.createKeyValue(Chain.kvNonce);
        if (kvr.err) {
            this.m_logger.error(`miner create genensis block failed for create nonce table to storage failed ${kvr.err}`);
            return kvr.err;
        }
        kvr = await dbr.value!.createKeyValue(Chain.kvConfig);
        if (kvr.err) {
            this.m_logger.error(`miner create genensis block failed for create config table to storage failed ${kvr.err}`);
            return kvr.err;
        }

        for (let [key, value] of Object.entries(globalOptions)) {
            if (!(isString(value) || isNumber(value) || isBoolean(value))) {
                assert(false, `invalid globalOptions ${key}`);
                this.m_logger.error(`miner create genensis block failed for write global config to storage failed for invalid globalOptions ${key}`);
                return ErrorCode.RESULT_INVALID_FORMAT;
            }
            let {err} = await kvr.kv!.hset('global', key, value as string|number|boolean);
            if (err) {
                this.m_logger.error(`miner create genensis block failed for write global config to storage failed ${err}`);
                return err;
            }
        }

        return ErrorCode.RESULT_OK;
    }

    protected async _createBlock(header: BlockHeader): Promise<{err: ErrorCode, block?: Block}> {
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
            return {err: sr.err};
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
            return {err};
        }
        let ssr = await this.chain.storageManager.createSnapshot(sr.storage!, block.hash, true);
        if (ssr.err) {
            return {err: ssr.err};
        }
        await this.chain.addMinedBlock(block, ssr.snapshot!);
        this.m_state = MinerState.idle;
        this.m_logger.info(`finish mine a block on block hash: ${this.chain.tipBlockHeader!.hash} number: ${this.chain.tipBlockHeader!.number}`);
        return {err, block};
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
