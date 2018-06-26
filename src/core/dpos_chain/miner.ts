import * as assert from 'assert';

import { ErrorCode } from '../error_code';
import { addressFromSecretKey } from '../address';

import {Storage} from '../storage/storage_manager';
import { Block } from '../chain/block';
import * as ValueMiner from '../value_chain/miner';

import { Chain, ChainOptions } from './chain';
import * as Consensus from './consensus';
import { BlockHeader } from './block';


export type MinerOptions = {minerSecret: Buffer} & ValueMiner.MinerOptions & ChainOptions;

export type CreateOptions = {
    miners: string[]
};

export class Miner extends ValueMiner.Miner {
    private m_secret: Buffer;
    private m_address!: string;
    private m_timer?: NodeJS.Timer;
    protected m_runTxPending: any = [];
    protected m_currTx: any = null;
    constructor(options: MinerOptions) {
        super(options);
        this.m_secret = options.minerSecret;
        this.m_address = addressFromSecretKey(this.m_secret)!;
        if (!this.coinbase) {
            this.coinbase = this.m_address;
        }
        assert(this.coinbase, `secret key failed`);
    }

    protected _chainInstance(options: ChainOptions) {
        return new Chain(options);
    }

    get chain(): Chain {
        return <Chain>this.m_chain;
    }

    get address(): string {
        return this.m_address;
    }

    public async initialize(): Promise<ErrorCode> {
        if (!this.m_address) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        let err = await super.initialize();
        if (err) {
            return err;
        }
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
        
        this.m_timer = setTimeout(async ()=>{
            delete this.m_timer;
            let now = Date.now() / 1000;
            let tip = <BlockHeader>this.m_chain.tipBlockHeader!;
            let blockHeader = new BlockHeader();
            blockHeader.setPreBlock(tip);
            blockHeader.timestamp = now;
            let dmr = await blockHeader.getDueMiner(<Chain>this.m_chain);
            if (dmr.err) {
                return ;
            }
            if (this.m_address === dmr.miner) {
                await this._createBlock(blockHeader);
            }
            this._resetTimer();
        }, tr.timeout!);
        return ErrorCode.RESULT_OK;
    }
    

    protected async _mineBlock(block: Block): Promise<ErrorCode> {
        //只需要给block签名
        this.m_logger.info(`${this.peerid} create block, sign ${this.m_address}`);
        (<BlockHeader>block.header).signBlock(this.m_secret);
        block.header.updateHash();
        return ErrorCode.RESULT_OK;
    }

    protected async _nextBlockTimeout(): Promise<{err: ErrorCode, timeout?: number}> {
        let hr = await this.m_chain.getHeader(0);
        if (hr.err) {
            return {err: hr.err}
        }
        let now = Date.now() / 1000;
        let nextTime = (Math.floor((now - hr.header!.timestamp) / Consensus.blockInterval)+1) * Consensus.blockInterval;

        return {err: ErrorCode.RESULT_OK, timeout: (nextTime + hr.header!.timestamp - now)*1000};
    }

    protected async _createGenesisBlock(block: Block, storage: Storage, options: CreateOptions): Promise<ErrorCode> {
        let err = await super._createGenesisBlock(block, storage, options);
        if (err) {
            return err;
        }

        //storage的键值对要在初始化的时候就建立好
        await storage.createKeyValue(Consensus.ViewContext.kvDPOS);

        let denv = new Consensus.Context();
        let ir = await denv.init(storage, options.miners);
        return ir.err;
    }
}