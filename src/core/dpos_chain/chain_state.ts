const assert = require('assert');

import { ErrorCode, stringifyErrorCode } from '../error_code';
import { LoggerInstance } from '../lib/logger_util';
import { DposBlockHeader } from './block';
import { IHeaderStorage } from '../chain';
import { isThisTypeNode } from 'typescript';

type ConfireEntry = {
    header: DposBlockHeader,
    count: number
};

export type DposChainTipStateOptions = {
    globalOptions: any,
    logger: LoggerInstance,
    getMiners: (header: DposBlockHeader) => Promise<{ err: ErrorCode, creators?: string[] }>,
    // lib short for last irreversiable block
    libHeader: DposBlockHeader,
    headerStorage: IHeaderStorage
};

export class DposChainTipState {
    private m_logger: LoggerInstance;
    protected m_globalOptions: any;
    protected m_getMiners: (header: DposBlockHeader) => Promise<{ err: ErrorCode, creators?: string[] }>;
    protected m_tip: DposBlockHeader;
    // 当前节点计算出的候选不可逆区块number
    protected m_proposedIRBNum: number = 0;
    // 不可逆区块number
    protected m_irb: DposBlockHeader;
    protected m_headerStorage: IHeaderStorage;

    // Added by Yang Jun
    private mIRB: number;
    private mProposedIRB: number;

    protected m_producerInfo: {
        // 各生产者确认的候选不可逆区块number
        lastImpliedIRB: Map<string, DposBlockHeader>,
        // 各生产者上次出块的块number
        lastProduced: Map<string, number>
    } = {
            lastImpliedIRB: new Map(),
            lastProduced: new Map()
        };
    // 待确认区块信息
    protected m_confirmInfo: ConfireEntry[] = [];

    constructor(options: DposChainTipStateOptions) {
        this.m_logger = options.logger;
        this.m_headerStorage = options.headerStorage;
        this.m_globalOptions = options.globalOptions;
        this.m_getMiners = options.getMiners;
        this.m_tip = options.libHeader;
        this.m_irb = options.libHeader;

        // Added by Yang Jun 2019
        this.mIRB = 0;
        this.mProposedIRB = 0;

    }

    get IRB(): DposBlockHeader {
        const irb = this.m_irb;
        return irb;
    }

    get logger(): LoggerInstance {
        return this.m_logger;
    }

    get tip(): DposBlockHeader {
        return this.m_tip;
    }

    protected _getMiner(header: DposBlockHeader): Promise<{ err: ErrorCode, creators?: string[] }> {
        return this.m_getMiners(header);
    }

    async updateTip(header: DposBlockHeader): Promise<ErrorCode> {

        // Added by Yang 2020-04-10
        this.logger.debug(`updateTip m_tip : ${this.m_tip.number} ${this.m_tip.hash}`);
        if (header.preBlockHash !== this.m_tip.hash || header.number !== this.m_tip.number + 1) {
            this.logger.error(`updateTip failed for header error, header.number ${header.number} should equal tip.number+1 ${this.m_tip.number + 1}, header.preBlockHash '${header.preBlockHash}' should equal tip.hash ${this.m_tip.hash} headerhash=${header.hash}`);
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        let gm = await this.m_getMiners(header);
        if (gm.err) {
            this.logger.error(`get miners failed errcode=${stringifyErrorCode(gm.err)}, state=${this.dump()}`);
            return gm.err;
        }

        let numPreBlocks = this._getNumberPrevBlocks(header);
        this.logger.debug(`numPreBlocks:${numPreBlocks}`);
        this.m_producerInfo.lastProduced.set(header.miner, header.number);

        let needConfireCount: number = Math.ceil(gm.creators!.length * 2 / 3);

        this.m_confirmInfo.push({ header, count: needConfireCount });
        this.logger.debug("needConfirmCount:" + needConfireCount);

        let index = this.m_confirmInfo.length - 1;
        this.logger.debug(`Initial index:${index}`);

        // Yang jun , for mismatch problem for 3039480
        let mJudgePreBlocks =0;
        if(header.number > 3039380 && numPreBlocks > 0){
            mJudgePreBlocks = -1;
        }else{
            mJudgePreBlocks = 0;
        }

        while (index >= 0 && numPreBlocks !== mJudgePreBlocks) {
            let entry: ConfireEntry = this.m_confirmInfo[index];

            this.logger.debug(`index:${index} entry.count: ${entry.count}`);
            this.logger.debug(`entry.header ${entry.header.number} numPreBlocks:${numPreBlocks}`);

            entry.count--;
            this.logger.debug("entry.count--:" + entry.count);

            if (entry.count === 0) {
                this.logger.debug("### check IRB")
                this.m_proposedIRBNum = entry.header.number;
                this.m_producerInfo.lastImpliedIRB.set(entry.header.miner, entry.header);
                // 当前block为候选不可逆块,需要做：1.清理之前的entry
                this.m_confirmInfo = this.m_confirmInfo.slice(index + 1);
                // 2.计算是否会产生不可逆块
                this._calcIrreversibleNumber();
                break;
            } else if (numPreBlocks > 0) {
                numPreBlocks--;
            }

            index--;
        }


        if (numPreBlocks === 0 || index === 0) {
            // 清除重复
            this.logger.debug("Clean redundant");
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
            this._promote(gm.creators!);
        }

        return ErrorCode.RESULT_OK;
    }

    dump(): string {
        let data = this.toJsonData();
        return JSON.stringify(data, null, '\t');
    }

    toJsonData(): any {
        let data: any = {};
        data.producer_to_last_implied_irb = [];
        for (let [_, header] of this.m_producerInfo.lastImpliedIRB) {
            data.producer_to_last_implied_irb.push({ miner: header.miner, number: header.number });
        }
        data.producer_to_last_produced = [];
        for (let [miner, number] of this.m_producerInfo.lastProduced) {
            data.producer_to_last_produced.push({ miner, number });
        }
        data.confire_info = [];
        for (let entry of this.m_confirmInfo) {
            data.confire_info.push({ number: entry.header.number, hash: entry.header.hash, miner: entry.header.miner, count: entry.count });
        }
        data.tip = {};
        if (this.m_tip) {
            data.tip.tipnumber = this.m_tip.number;
            data.tip.tipminer = this.m_tip.miner;
            data.tip.tiphash = this.m_tip.hash;
        }
        data.proposed_irreversible_blocknum = this.m_proposedIRBNum;
        data.irreversible_blocknum = this.m_irb.number;

        // added by Yang Jun 2019
        this.mProposedIRB = this.m_proposedIRBNum;
        this.mIRB = this.m_irb.number;
        return data;
    }

    protected _getNumberPrevBlocks(header: DposBlockHeader): number {
        let number = this.m_producerInfo.lastProduced.get(header.miner);
        if (!number) {
            return -1;
        }

        return header.number > number ? header.number - number : 0;
    }

    protected _calcIrreversibleNumber() {
        let numbers: Array<number> = new Array();
        for (let [_, info] of this.m_producerInfo.lastImpliedIRB) {
            numbers.push(info.number);
        }
        // this.logger.debug("calcIRB:" + JSON.stringify(numbers));

        if (numbers.length > 0) {
            numbers.sort();
            // 2/3的人推荐某个block成为候选不可逆block，那么这个块才能成为不可逆，那么上一个不可逆块号就是1/3中最大的
            let n = Math.floor((numbers.length - 1) / 3);
            let irbNumber = numbers[n];
            this.logger.debug(`n:${n} irbNumber: ${irbNumber}`)

            for (let [_, info] of this.m_producerInfo.lastImpliedIRB) {
                if (irbNumber === info.number) {
                    this.logger.debug("Caught irbNumber:" + irbNumber)
                    this.m_irb = info;
                }
            }
        }
    }

    protected _promote(miners: string[]) {
        let newImpliedIrb: Map<string, DposBlockHeader> = new Map();
        let newProduced: Map<string, number> = new Map();

        // for (let m of miners) {
        //     let irb = this.m_producerInfo.lastImpliedIRB.get(m);
        //     newImpliedIrb.set(m, irb ? irb : this.m_irb);

        //     let pr = this.m_producerInfo.lastProduced.get(m);
        //     newProduced.set(m, pr ? pr : this.m_irb.number);
        // }
        // Yang
        for (let m of miners) {
            let irb = this.m_producerInfo.lastImpliedIRB.get(m);
            newImpliedIrb.set(m, irb ? irb : this.m_irb);

            let pr = this.m_producerInfo.lastProduced.get(m);
            newProduced.set(m, pr ? pr : this.m_irb.number);
        }

        this.m_producerInfo.lastImpliedIRB = newImpliedIrb;
        this.m_producerInfo.lastProduced = newProduced;
    }

    // Yang Jun 2019-3-18
    public getIRB() {
        return this.mIRB;
    }
    public getProposedIRB() {
        return this.mProposedIRB;
    }
    public getMiner() {
        return this.m_tip.miner;
    }
}
