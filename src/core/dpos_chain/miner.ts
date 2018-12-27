import * as assert from 'assert';

import { ErrorCode } from '../error_code';
import { addressFromSecretKey } from '../address';

import {ValueMiner, Chain, Block, Storage, ValueMinerInstanceOptions, NetworkCreator} from '../value_chain';
import { DposBlockHeader } from './block';
import {DposChain} from './chain';
import * as consensus from './consensus';
import { LoggerOptions } from '../lib/logger_util';
import * as Address from '../address';

export type DposMinerInstanceOptions = {secret: Buffer} & ValueMinerInstanceOptions;

class InnerChain extends DposChain {
    protected get _ignoreVerify() {
        return false;
    }
}

export class DposMiner extends ValueMiner {
    protected m_secret?: Buffer;
    private m_address?: string;
    private m_timer?: NodeJS.Timer;
    protected m_nowSlot: number = 0;
    protected m_epochTime: number = 0;

    get chain(): DposChain {
        return this.m_chain as DposChain;
    }

    get address(): string {
        return this.m_address!;
    }

    protected _chainInstance(): Chain {
        return new InnerChain(this.m_constructOptions);
    }

    public parseInstanceOptions(options: {
        parsed: any, 
        origin: Map<string, any>
    }): {err: ErrorCode, value?: any} {
        let {err, value} = super.parseInstanceOptions(options);
        if (err) {
            return {err};
        }
        if (!options.origin.get('minerSecret')) {
            this.m_logger.error(`invalid instance options not minerSecret`);
            return {err: ErrorCode.RESULT_INVALID_PARAM};
        }
        value.secret = Buffer.from(options.origin.get('minerSecret'), 'hex');
        return {err: ErrorCode.RESULT_OK, value};
    }
    
    public async initialize(options: DposMinerInstanceOptions): Promise<ErrorCode> {
        this.m_secret = options.secret;
        this.m_address = addressFromSecretKey(this.m_secret);
        if (!this.m_address) {
            this.m_logger.error(`dpos miner init failed for invalid secret`);
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        if (!options.coinbase) {
            this.coinbase = this.m_address;
        }
        assert(this.coinbase, `secret key failed`);

        if (!this.m_address) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        let err = await super.initialize(options);
        if (err) {
            return err;
        }

        let hr = await this.m_chain!.getHeader(0);
        if (hr.err) {
            return hr.err;
        }
        this.m_epochTime = hr.header!.timestamp;
        let now = Date.now() / 1000;
        let blockInterval = this.m_chain!.globalOptions.blockInterval;
        this.m_nowSlot = Math.floor((now - this.m_epochTime) / blockInterval) + 1;

        this.m_logger.info(`begin Mine...`);
        this._resetTimer();

        return ErrorCode.RESULT_OK;
    }

    protected createHeader(): DposBlockHeader {
        return new DposBlockHeader();
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
            if (now >= this.m_nowSlot * this.m_chain!.globalOptions.blockInterval + this.m_epochTime) {
                // 都到了当前slot的右边缘时间（下个slot的开始时间）了才执行，难道是程序太卡导致timer延后了，不管如何不出块
                this._resetTimer();
                return;
            }

            let tip = this.m_chain!.tipBlockHeader! as DposBlockHeader;
            let blockHeader = this.createHeader();
            blockHeader.setPreBlock(tip);
            // 都以当前slot的左边缘时间为块的时间,便于理解和计算。
            blockHeader.timestamp = this.m_epochTime + (this.m_nowSlot - 1) * this.m_chain!.globalOptions.blockInterval;
            blockHeader.pubkey = (Address.publicKeyFromSecretKey(this.m_secret!) as Buffer);
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
        this.m_logger.info(`create block, sign ${this.m_address}`);
        (block.header as DposBlockHeader).signBlock(this.m_secret!);
        block.header.updateHash();
        return ErrorCode.RESULT_OK;
    }

    protected async _nextBlockTimeout(): Promise<{err: ErrorCode, timeout?: number}> {
        let blockInterval: number = this.m_chain!.globalOptions.blockInterval;
        do {
            this.m_nowSlot++;
            let nowSlotBeginTimeOffset: number = (this.m_nowSlot - 1) * blockInterval; 
            let now = Date.now() / 1000;
            if (this.m_epochTime + nowSlotBeginTimeOffset > now) {
                let ret = {err: ErrorCode.RESULT_OK, timeout: (this.m_epochTime + nowSlotBeginTimeOffset - now) * 1000};
                this.m_logger.debug(`dpos _nextTimeout nowslot=${this.m_nowSlot}, timeout=${ret.timeout}`);
                return ret;
            }
        } while (true);
    }
}