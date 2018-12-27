import { ErrorCode, stringifyErrorCode} from '../error_code';
import {DposBlockHeader} from './block';
import {DposChain} from './chain';
const assert = require('assert');
import { LoggerInstance } from '../lib/logger_util';

type ConfireEntry = {number: number, hash: string, miner: string, count: number};
export type DposChainTipStateOptions = {libHeader: DposBlockHeader, libMiners: string[], chain: DposChain, globalOptions: any};
export class DposChainTipState {
    // 当前节点计算出的候选不可逆区块number
    protected m_proposedIrreversibleBlocknum: number = 0;
    // 不可逆区块number
    protected m_irreversibleBlocknum: number = 0;
    protected m_irreversibleBlockHash: string;
    // 各生产者确认的候选不可逆区块number
    protected m_producerToLastImpliedIrb: Map<string, {number: number, hash: string}> = new Map();
    // 各生产者上次出块的块number
    protected m_producerToLastProduced: Map<string, number> = new Map();
    // 待确认区块信息
    protected m_confirmInfo: ConfireEntry[] = [];

    protected m_chain: DposChain;
    protected m_globalOptions: any;
    protected m_tip: DposBlockHeader;

    protected m_libHeader: DposBlockHeader;
    protected m_libMiners: string[];

    constructor(options: DposChainTipStateOptions) {
        this.m_libHeader = options.libHeader;
        this.m_libMiners = [];
        this.m_libMiners = [...options.libMiners];
        this.m_chain = options.chain;
        this.m_globalOptions = options.globalOptions;
        this.m_irreversibleBlocknum = 0;
        this.m_irreversibleBlockHash = this.m_libHeader.hash;
        this.m_tip = options.libHeader;
    }

    get irreversible(): number {
        return this.m_irreversibleBlocknum;
    }

    get irreversibleHash(): string {
        return this.m_irreversibleBlockHash;
    }

    get logger(): LoggerInstance {
        return this.m_chain.logger;
    }

    get tip(): DposBlockHeader {
        return this.m_tip;
    }

    public async updateTip(header: DposBlockHeader): Promise<ErrorCode> {
        if (header.preBlockHash !== this.m_tip.hash || header.number !== this.m_tip.number + 1) {
            this.logger.info(`updateTip failed for header error, header.number ${header.number} should equal tip.number+1 ${this.m_tip.number + 1}, header.preBlockHash '${header.preBlockHash}' should equal tip.hash ${this.m_tip.hash} headerhash=${header.hash}`);
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        let gm = await this.m_chain.getMiners(header);
        if (gm.err) {
            this.logger.info(`get miners failed errcode=${stringifyErrorCode(gm.err)}, state=${this.dump()}`);
            return gm.err;
        }

        let numPreBlocks = this.getNumberPrevBlocks(header);
        this.m_producerToLastProduced.set(header.miner, header.number);

        let needConfireCount: number = Math.ceil(gm.creators!.length * 2 / 3);

        this.m_confirmInfo.push({ number: header.number, hash: header.hash, miner: header.miner, count: needConfireCount});

        let index = this.m_confirmInfo.length - 1;
        while (index >= 0 && numPreBlocks !== 0 ) {
            let entry: ConfireEntry = this.m_confirmInfo[index];
            entry.count--;
            if (entry.count === 0) {
                this.m_proposedIrreversibleBlocknum = entry.number;
                this.m_producerToLastImpliedIrb.set(entry.miner, {number: entry.number, hash: entry.hash});
                // 当前block为候选不可逆块,需要做：1.清理之前的entry
                this.m_confirmInfo = this.m_confirmInfo.slice(index + 1);
                // 2.计算是否会产生不可逆块
                this.calcIrreversibleNumber();
                break;
            } else if (numPreBlocks > 0) {
                numPreBlocks--;
            }

            index--;
        }
         
        if (numPreBlocks === 0 || index === 0) {
            // 清除重复
            let i = 0;
            for (i = 0; i < this.m_confirmInfo.length - 1; i++) {
                if (this.m_confirmInfo[i].count !== this.m_confirmInfo[i + 1].count && this.m_confirmInfo[i].count === this.m_confirmInfo[0].count) {
                    break;
                }
            }
            if (i > 0) {
                this.m_confirmInfo = this.m_confirmInfo.slice(i);
            }
        }

        if (this.m_confirmInfo.length > this.m_globalOptions.maxCreateor * 2) {
            this.m_confirmInfo.unshift();
        }
        this.m_tip = header;

        if (header.number === 0 || header.number % this.m_globalOptions.reSelectionBlocks === 0) {
            this.promote(gm.creators!);
        }

        return ErrorCode.RESULT_OK;
    }

    public dump(): string {
        let data = this.toJsonData();
        return JSON.stringify(data, null, '\t');
    }

    protected toJsonData(): any {
        let data: any = {};
        data.producer_to_last_implied_irb = [];
        for (let [miner, number] of this.m_producerToLastImpliedIrb) {
            data.producer_to_last_implied_irb.push({miner, number});
        }
        data.producer_to_last_produced = [];
        for (let [miner, number] of this.m_producerToLastProduced) {
            data.producer_to_last_produced.push({miner, number});
        }
        data.confire_info = this.m_confirmInfo;
        data.tip = {};
        if (this.m_tip) {
            data.tip.tipnumber = this.m_tip.number;
            data.tip.tipminer = this.m_tip.miner;
            data.tip.tiphash = this.m_tip.hash;
        }
        data.proposed_irreversible_blocknum = this.m_proposedIrreversibleBlocknum;
        data.irreversible_blocknum = this.m_irreversibleBlocknum;
        return data;
    }

    protected getNumberPrevBlocks(header: DposBlockHeader): number {
        let number = this.m_producerToLastProduced.get(header.miner);
        if (!number) {
            return -1;
        }

        return header.number > number ? header.number - number : 0;
    }

    protected calcIrreversibleNumber() {
        let numbers: Array<number> = new Array();
        for (let [_, info] of this.m_producerToLastImpliedIrb) {
            numbers.push(info.number);
        }
        if (numbers.length > 0) {
            numbers.sort();
            // 2/3的人推荐某个block成为候选不可逆block，那么这个块才能成为不可逆，那么上一个不可逆块号就是1/3中最大的
            let n = Math.floor((numbers.length - 1) / 3); 
            this.m_irreversibleBlocknum = numbers[n];

            for (let [_, info] of this.m_producerToLastImpliedIrb) {
                if (this.m_irreversibleBlocknum === info.number) {
                    this.m_irreversibleBlockHash = info.hash;
                }
            }
        }
    }

    protected promote(miners: string[]) {
        let newImpliedIrb: Map<string, {number: number, hash: string}> = new Map();
        let newProduced: Map<string, number> = new Map();
        for (let m of miners) {
            let irb = this.m_producerToLastImpliedIrb.get(m);
            newImpliedIrb.set(m, irb ? irb : {number: this.m_irreversibleBlocknum, hash: this.m_irreversibleBlockHash!});
            
            let pr = this.m_producerToLastProduced.get(m);
            newProduced.set(m, pr ? pr : this.m_irreversibleBlocknum);
        }

        this.m_producerToLastImpliedIrb = newImpliedIrb;
        this.m_producerToLastProduced = newProduced;
    }
}