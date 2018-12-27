
import { isNullOrUndefined } from 'util';
import {ErrorCode} from '../error_code';
import {IReadableDatabase, IReadWritableDatabase} from '../value_chain';
import {BigNumber} from 'bignumber.js';
import * as assert from 'assert';
import {LoggerInstance} from '../lib/logger_util';

// DPOS的节点会定时出块，如果时间间隔已到，指定节点还未出块的话，就跳过这个节点，下一个节点出块
// 出块间隔时间必须远小于创建并广播块到所有DPOS出块节点的时间
// 所有time单位均为seconds

// 出块间隔时间
// export const blockInterval = 10

// 出块间隔允许的最大误差
// export const maxBlockIntervalOffset = 1

// //重新选举的块时间，暂时设定成每10块选举一次
// export const reSelectionBlocks = 10

// //最大出块者总数，先定成21
// export const maxCreator = 21;

// //最小出块者总数，先定成2
// export const minCreator = 2;

// //每个节点最多可以投的producer数量
// export const dposVoteMaxProducers = 30;

// //超过该时间不出块就将被封禁
// export const timeOffsetToLastBlock = 60 * 60 * 24;

// //封禁时长
// export const timeBan = 30 * timeOffsetToLastBlock;

// //每unbanBlocks个块后进行一次解禁计算
// export const unbanBlocks = reSelectionBlocks * 2;

export function onCheckGlobalOptions(globalOptions: any) {
    if (isNullOrUndefined(globalOptions.minCreateor)) {
        return false;
    }
    if (isNullOrUndefined(globalOptions.maxCreateor)) {
        return false;
    }
    if (isNullOrUndefined(globalOptions.reSelectionBlocks)) {
        return false;
    }
    if (isNullOrUndefined(globalOptions.blockInterval)) {
        return false;
    }
    if (isNullOrUndefined(globalOptions.timeOffsetToLastBlock)) {
        return false;
    }
    if (isNullOrUndefined(globalOptions.timeBan)) {
        return false;
    }
    if (isNullOrUndefined(globalOptions.unbanBlocks)) {
        return false;
    }
    if (isNullOrUndefined(globalOptions.dposVoteMaxProducers)) {
        return false;
    }
    return true;
}

enum BanStatus {
    NoBan = 0, 
    Delay = 1, // 已经达到禁用条件，但是延时生效(产生不可逆块后才生效)
    Ban = 2, // 判断用，value大于等于它就表示已经ban了
}

export type ViewContextOptions = {
    currDatabase: IReadableDatabase,
    globalOptions: any,
    logger: LoggerInstance,
};

export class ViewContext {
    protected m_currDatabase: IReadableDatabase;
    protected m_globalOptions: any;
    protected m_logger: LoggerInstance;

    constructor(options: ViewContextOptions) {
        this.m_currDatabase = options.currDatabase;
        this.m_globalOptions = options.globalOptions;
        this.m_logger = options.logger;
    }

    get currDatabase(): IReadableDatabase {
        return this.m_currDatabase;
    }

    public static kvDPOS: string = 'dpos';
    public static keyCandidate: string = 'candidate'; // 总的候选人
    public static keyVote: string = 'vote';
    public static keyStake: string = 'stake';
    public static keyNextMiners: string = 'miner';

    // 每个代表投票的那些人
    public static keyProducers: string = 'producers';

    // 生产者最后一次出块时间
    public static keyNewBlockTime: string = 'newblocktime';

    // 提议miners,成为提议miner后未必能进入出块序列，成为提议后这个块成为不可逆后才能成为真正miners
    public static keyProposeMiners: string = 'proposeminer';

    static getElectionBlockNumber(globalOptions: any, _number: number): number {
        if (_number === 0) {
            return 0;
        }

        return Math.floor((_number - 1) / globalOptions.reSelectionBlocks) * globalOptions.reSelectionBlocks;
    }

    async getNextMiners(): Promise<{err: ErrorCode, creators?: string[]}> {
        let kvElectionDPOS = (await this.currDatabase.getReadableKeyValue(ViewContext.kvDPOS)).kv!;
        let llr = await kvElectionDPOS.llen(ViewContext.keyNextMiners);
        if (llr.err) {
            return {err: llr.err};
        }
        let lrr = await kvElectionDPOS.lrange(ViewContext.keyNextMiners, 0, llr.value!);
        if (lrr.err) {
            return {err: lrr.err};
        }
        return {err: ErrorCode.RESULT_OK, creators: lrr.value};
    }

    async getProposeMiners(): Promise<{err: ErrorCode, creators?: string[]}> {
        let kvElectionDPOS = (await this.currDatabase.getReadableKeyValue(ViewContext.kvDPOS)).kv!;
        let llr = await kvElectionDPOS.llen(ViewContext.keyProposeMiners);
        if (llr.err) {
            return {err: llr.err};
        }
        let lrr = await kvElectionDPOS.lrange(ViewContext.keyProposeMiners, 0, llr.value!);
        if (lrr.err) {
            return {err: lrr.err};
        }
        return {err: ErrorCode.RESULT_OK, creators: lrr.value};
    }

    async getStake(address: string): Promise<{err: ErrorCode, stake?: BigNumber}> {
        let kvCurDPOS = (await this.currDatabase.getReadableKeyValue(ViewContext.kvDPOS)).kv!;
        // 如果投票者的权益不够，则返回
        let her = await kvCurDPOS.hget(ViewContext.keyStake, address);
        if (her.err) {
            return {err: her.err};
        }

        return {err: ErrorCode.RESULT_OK, stake: her.value!};
    }

    async getVote(): Promise<{err: ErrorCode, vote?: Map<string, BigNumber>}> {
        let kvCurDPOS = (await this.currDatabase.getReadableKeyValue(ViewContext.kvDPOS)).kv!;
        let gr = await kvCurDPOS.hgetall(ViewContext.keyVote);
        if (gr.err) {
            return {err: gr.err};
        }
        let cans = await this.getValidCandidates();
        if (cans.err) {
            return {err: cans.err};
        }

        cans.candidates!.sort();
        let isValid: (s: string) => boolean = (s: string): boolean => {
            for (let c of cans.candidates!) {
                if (c === s) {
                    return true;
                } else if (c > s) {
                    return false;
                }
            }
            return false;
        };
        let vote = new Map();
        for (let v of gr.value!) {
            if (isValid(v.key)) {
                vote.set(v.key, v.value);
            }
        }
        return {err: ErrorCode.RESULT_OK, vote};
    }

    async getCandidates(): Promise<{err: ErrorCode, candidates?: string[]}> {
        let kvDPos = (await this.currDatabase.getReadableKeyValue(ViewContext.kvDPOS)).kv!;
        let gr = await this.getValidCandidates();
        if (gr.err) {
            return {err: gr.err};
        }

        let gv = await kvDPos.hgetall(ViewContext.keyVote);
        if (gv.err) {
            return {err: gv.err};
        }
        let vote = new Map<string, BigNumber>();
        for (let v of gv.value!) {
            vote.set(v.key, v.value);
        }
        gr.candidates!.sort((a: string, b: string): number => {
            if (vote.has(a) && vote.has(b)) {
                if (vote.get(a)!.eq(vote.get(b)!)) {
                    return 0;
                }
                return vote.get(a)!.gt(vote.get(b)!) ? -1 : 1;
            }

            if (!vote.has(a) && !vote.has(b)) {
                return 0;
            }

            if (vote.has(a)) {
                return -1;
            }

            return 1;
        });

        return {err: ErrorCode.RESULT_OK, candidates: gr.candidates!};
    }
    
    protected async getValidCandidates(): Promise<{err: ErrorCode, candidates?: string[]}> {
        let kvDPos = (await this.currDatabase.getReadableKeyValue(ViewContext.kvDPOS)).kv!;
        let gr = await kvDPos.hgetall(ViewContext.keyCandidate);
        if (gr.err) {
            return {err: gr.err};
        }
        let candidates: string[] = [];
        for (let v of gr.value!) {
            if ((v.value as number) >= BanStatus.NoBan) {
                candidates.push(v.key);
            }
        }

        return {err: ErrorCode.RESULT_OK, candidates};
    }

    async isBan(address: string): Promise<{err: ErrorCode, ban?: boolean}> {
        let kvDPos = (await this.currDatabase.getReadableKeyValue(ViewContext.kvDPOS)).kv!;
        let timeInfo = await kvDPos.hget(ViewContext.keyCandidate, address);
        if (timeInfo.err) {
            return {err: ErrorCode.RESULT_OK, ban: false};
        }

        return {err: ErrorCode.RESULT_OK, ban: (timeInfo.value as number) >= BanStatus.Ban ? true : false};
    }
}

export type ContextOptions = ViewContextOptions & {};

export class Context extends ViewContext {
    constructor(options: ContextOptions) {
        super(options);
    }
    get currDatabase(): IReadWritableDatabase {
        return this.m_currDatabase as IReadWritableDatabase;
    }

    removeDuplicate(s: string[]): string[] {
        let s1 = [];
        let bit: Map<string, number> = new Map();
        for (let v of s) {
            if (!bit.has(v)) {
                s1.push(v);
                bit.set(v, 1);
            }
        }
        return s1;
    }

    async init(candidates: string[], miners: string[]): Promise<{err: ErrorCode}> {
        candidates = this.removeDuplicate(candidates);
        miners = this.removeDuplicate(miners);
        let kvCurDPOS = (await this.currDatabase.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let candiateValues = candidates.map(() => {
            return BanStatus.NoBan;
        });
        let hmr = await kvCurDPOS.hmset(Context.keyCandidate, candidates, candiateValues);
        if (hmr.err) {
            return hmr;
        }
        let rpr = await kvCurDPOS.rpushx(Context.keyNextMiners, miners);
        if (rpr.err) {
            return rpr;
        }
        rpr = await kvCurDPOS.rpushx(Context.keyProposeMiners, miners);
        if (rpr.err) {
            return rpr;
        }
        return {err: ErrorCode.RESULT_OK};
    }

    async finishElection(libDatabase: IReadableDatabase, shuffleFactor: string): Promise<{err: ErrorCode}> {
        let kvCurDPOS = (await this.currDatabase.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let gvr = await this.getVote();
        if (gvr.err) {
            this.m_logger.error(`finishElection, getvote failde,errcode=${gvr.err}`);
            return {err: gvr.err};
        }
        
        let election: Array<{address: string, vote: BigNumber}> = new Array();
        for (let address of gvr.vote!.keys()) {
            election.push({address, vote: gvr.vote!.get(address)!});
        }
        // 按照投票权益排序
        election.sort((l, r) => {
            if (l.vote.eq(r.vote)) {
                return 0;
            } else {
                return (l.vote.gt(r.vote) ? -1 : 1);
            }
        });
        let creators = election.slice(0, this.m_globalOptions.maxCreator).map((x) => {
            return x.address;
        });

        if (creators.length === 0) {
            return {err: ErrorCode.RESULT_OK};
        }

        let minersInfo = await this.getProposeMiners();
        if (minersInfo.err) {
            this.m_logger.error(`finishElection getNextMiners failed,errcode=${minersInfo.err}`);
            return minersInfo;
        }

        if (creators.length < this.m_globalOptions.minCreator) {
            this.m_logger.warn(`finishElection not update propose miners,for new miners count (${creators.length}) less than minCreateor(${this.m_globalOptions.minCreator})`);
            // 总的个数比最小要求的个数还少也不补
            return {err: ErrorCode.RESULT_OK};
        }

        if (creators.length < minersInfo.creators!.length) {
            this.m_logger.warn(`finishElection not update propose miners,for new miners count (${creators.length}) less than prev propse miners count(${minersInfo.creators!.length})`);
            // 每次更新miner的时候，总的个数不能少于上一轮的个数，否则不补
            return {err: ErrorCode.RESULT_OK};
        }

        this._shuffle(shuffleFactor, creators);
        this.m_logger.info(`finishElection propose miners,${JSON.stringify(creators)}`);

        // 这里选举得写进提议miners
        let llr = await kvCurDPOS.llen(ViewContext.keyProposeMiners);
        if (llr.err) {
            return {err: llr.err};
        }
        for (let ix = llr.value! - 1; ix >= 0; ix--) {
            let lrr = await kvCurDPOS.lremove(ViewContext.keyProposeMiners, ix);
            if (lrr.err) {
                return {err: lrr.err};
            }
        }
        let lpr = await kvCurDPOS.rpushx(ViewContext.keyProposeMiners, creators);
        if (lpr.err) {
            return {err: lpr.err};
        }

        // 把最近不可逆块得keyProposeMiners更新到keyNextMiners作为当前miners
        let libDev = new ViewContext({currDatabase: libDatabase, globalOptions: this.m_globalOptions, logger: this.m_logger});
        let hr = await libDev.getProposeMiners();
        if (hr.err) {
            return hr;
        }
        this.m_logger.info(`finishElection miners,${JSON.stringify(hr.creators!)}`);
        llr = await kvCurDPOS.llen(ViewContext.keyNextMiners);
        if (llr.err) {
            return {err: llr.err};
        }
        for (let ix = llr.value! - 1; ix >= 0; ix--) {
            let lrr = await kvCurDPOS.lremove(ViewContext.keyNextMiners, ix);
            if (lrr.err) {
                return {err: lrr.err};
            }
        }
        lpr = await kvCurDPOS.rpushx(ViewContext.keyNextMiners, hr.creators!);
        if (lpr.err) {
            return {err: lpr.err};
        }

        return {err: ErrorCode.RESULT_OK};
    }

    async mortgage(from: string, amount: BigNumber): Promise<{err: ErrorCode, returnCode?: ErrorCode}> {
        assert(amount.gt(0), 'amount must positive');

        let kvDPos = (await this.currDatabase.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let stakeInfo = await kvDPos.hget(ViewContext.keyStake, from);
        let stake: BigNumber = stakeInfo.err === ErrorCode.RESULT_OK ? stakeInfo.value : new BigNumber(0);
        await kvDPos.hset(ViewContext.keyStake, from, stake.plus(amount));

        await this._updatevote(from, amount);

        return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK};
    }

    async unmortgage(from: string, amount: BigNumber): Promise<{err: ErrorCode, returnCode?: ErrorCode}> {
        assert(amount.gt(0), 'amount must positive');

        let kvDPos = (await this.currDatabase.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let stakeInfo = await kvDPos.hget(ViewContext.keyStake, from);
        if (stakeInfo.err) {
            return {err: stakeInfo.err};
        }
        let stake: BigNumber = stakeInfo.value!;
        if (stake.lt(amount)) {
            return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_NOT_ENOUGH};
        }
        if (stake.isEqualTo(amount)) {
            await kvDPos.hdel(ViewContext.keyStake, from);
        } else {
            await kvDPos.hset(ViewContext.keyStake, from, stake.minus(amount));
        }

        await this._updatevote(from, (new BigNumber(0)).minus(amount));
        if (stake.isEqualTo(amount)) {
            await kvDPos.hdel(ViewContext.keyProducers, from);
        }

        return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK};
    }

    async vote(from: string, candidates: string[]): Promise<{err: ErrorCode, returnCode?: ErrorCode}> {
        candidates = this.removeDuplicate(candidates);
        assert(candidates.length > 0 && candidates.length <= this.m_globalOptions.dposVoteMaxProducers, 'candidates.length must right');
        
        let cans = await this.getValidCandidates();
        if (cans.err) {
            return {err: cans.err};
        }

        cans.candidates!.sort();
        let isValid: (s: string) => boolean = (s: string): boolean => {
            for (let c of cans.candidates!) {
                if (c === s) {
                    return true;
                } else if (c > s) {
                    return false;
                }
            }
            return false;
        };
        for (let p of candidates) {
            if (!isValid(p)) {
                return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_NOT_FOUND};
            }
        }

        let kvDPos = (await this.currDatabase.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let stakeInfo = await kvDPos.hget(ViewContext.keyStake, from);
        if (stakeInfo.err) {
            return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_NOT_ENOUGH};
        }
        let stake: BigNumber = stakeInfo.value!;
        
        let producerInfo = await kvDPos.hget(ViewContext.keyProducers, from);
        if (producerInfo.err === ErrorCode.RESULT_OK) {
            let producers = producerInfo.value!;
            if (producers.length === candidates.length) {
                producers.sort();
                candidates.sort();
                let i = 0;
                for (i = 0; i < producers.length; i++) {
                    if (producers[i] !== candidates[i]) {
                        break;
                    }
                }
                if (i === producers.length) {
                    return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK};
                }
            }

            // 取消投给先前的那些人
            await this._updatevote(from, new BigNumber(0).minus(stake));
        }
        // 设置新的投票对象
        await kvDPos.hset(ViewContext.keyProducers, from, candidates);
        // 计票
        await this._updatevote(from, stake);

        return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK};
    }

    async registerToCandidate(candidate: string): Promise<{err: ErrorCode, returnCode?: ErrorCode}>  {
        let kvDPos = (await this.currDatabase.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let her = await kvDPos.hexists(ViewContext.keyCandidate, candidate);
        if (her.err) {
            return {err: her.err};
        }
        if (her.value) {
            return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK};
        }

        await kvDPos.hset(ViewContext.keyCandidate, candidate, BanStatus.NoBan);
        return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK};
    }

    async unbanProducer(timestamp: number) {
        let kvDPos = (await this.currDatabase.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;

        // 解禁
        let candidateInfo = await kvDPos.hgetall(ViewContext.keyCandidate);
        for (let c of candidateInfo.value!) {
            if ((c.value as number) >= BanStatus.Ban && (c.value as number) <= timestamp) {
                await kvDPos.hset(ViewContext.keyCandidate, c.key, BanStatus.NoBan);
            }
        }
    }

    async checkIfNeedBan(timestamp: number) {
        let kvDPos = (await this.currDatabase.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let minersInfo = await this.getNextMiners();
        if (minersInfo.err) {
            return ;
        }
        for (let m of minersInfo.creators!) {
            let hr = await kvDPos.hget(ViewContext.keyNewBlockTime, m);
            if (hr.err) {
                return;
            }

            if (timestamp - (hr.value! as number) >= this.m_globalOptions.timeOffsetToLastBlock ) {
                await kvDPos.hset(ViewContext.keyCandidate, m, BanStatus.Delay);
            }
        }
    }

    async banProducer(timestamp: number) {
        let kvDPos = (await this.currDatabase.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let hr = await this.getNextMiners();
        if (hr.err) {
            return;
        }
        // 只会是当前得miner能出现BanStatus.Delay状态，全部给ban了
        for (let m of hr.creators!) {
            let candidateInfo = await kvDPos.hget(ViewContext.keyCandidate, m);
            if (candidateInfo.err) {
                return;
            }
            if ((candidateInfo.value as number) === BanStatus.Delay) {
                await kvDPos.hset(ViewContext.keyCandidate, m, timestamp + this.m_globalOptions.timeBan);
            }
        }
    }

    async updateProducerTime(producer: string, timestamp: number) {
        let kvDPos = (await this.currDatabase.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;       
        await kvDPos.hset(ViewContext.keyNewBlockTime, producer, timestamp);
    }

    async maintain_producer(timestamp: number): Promise<ErrorCode> {
        let kvDPos = (await this.currDatabase.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let minersInfo = await this.getNextMiners();
        assert( minersInfo.err === ErrorCode.RESULT_OK);

        for (let m of minersInfo.creators!) {
            let her = await kvDPos.hexists(ViewContext.keyNewBlockTime, m);
            if (her.err) {
                return her.err;
            }
            if (!her.value) {
                // 可能是新进入序列，默认把当前block的时间当作它的初始出块时间
                await kvDPos.hset(ViewContext.keyNewBlockTime, m, timestamp);
            }
        }

        // 已经被剔除出块序列了，清理它的计时器
        let allTimeInfo = await kvDPos.hgetall(ViewContext.keyNewBlockTime);
        for (let p of allTimeInfo.value!) {
            let i = 0;
            for (i = 0; i < minersInfo.creators!.length; i++) {
                if (p.key === minersInfo.creators![i]) {
                    break;
                }
            }

            if (i === minersInfo.creators!.length) {
                let her = await kvDPos.hexists(ViewContext.keyNewBlockTime, p.key);
                if (her.err) {
                    return her.err;
                }
                if (her.value) {
                    await kvDPos.hdel(ViewContext.keyNewBlockTime, p.key);
                }
            }
        }
        
        return ErrorCode.RESULT_OK;
    }

    protected async _updatevote(voteor: string, amount: BigNumber): Promise<ErrorCode> {
        let kvDPos = (await this.currDatabase.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let producerInfo = await kvDPos.hget(ViewContext.keyProducers, voteor);
        if (producerInfo.err === ErrorCode.RESULT_OK) {
            let producers = producerInfo.value!;
            for (let p of producers) {
                let voteInfo = await kvDPos.hget(ViewContext.keyVote, p);
                if (voteInfo.err === ErrorCode.RESULT_OK) {
                    let vote: BigNumber = voteInfo.value!.plus(amount);
                    if (vote.eq(0)) {
                        await kvDPos.hdel(ViewContext.keyVote, p);
                    } else {
                        await kvDPos.hset(ViewContext.keyVote, p, vote);
                    }
                } else {
                    assert(amount.gt(0), '_updatevote amount must positive');
                    await kvDPos.hset(ViewContext.keyVote, p, amount);
                }
            }
        }

        return ErrorCode.RESULT_OK;
    }

    protected _shuffle(shuffle_factor: string, producers: string[]) {
        let buf: Buffer = Buffer.from(shuffle_factor);
        let total: number = 0;
        for (let i = 0; i < buf.length; i++) {
            total = total + buf[i];
        }
        for (let i = 0; i < producers.length; ++i) {
            let k = total + i * 2685821657736338717;
            k ^= (k >> 12);
            k ^= (k << 25);
            k ^= (k >> 27);
            k *= 2685821657736338717;

            let jmax: number = producers.length - i;
            let j = i + k % jmax;
            let temp: string = producers[i];
            producers[i] = producers[j];
            producers[j] = temp;
        }
    }
}