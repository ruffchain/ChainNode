
import {ErrorCode} from '../error_code';
import {IReadableStorage, IReadWritableStorage} from '../storage/storage';
import {Chain} from '../value_chain/chain';
import {BigNumber} from 'bignumber.js';
import * as assert from 'assert';

//DPOS的节点会定时出块，如果时间间隔已到，指定节点还未出块的话，就跳过这个节点，下一个节点出块
//出块间隔时间必须远小于创建并广播块到所有DPOS出块节点的时间
//所有time单位均为seconds
export const blockInterval = 30    //先定一分钟一个块

export const maxBlockIntervalOffset = 1

//重新选举的块时间，暂时设定成每10块选举一次
export const reSelectionBlocks = 10

//最大出块者总数，先定成21
export const maxCreator = 21;

//最小出块者总数，先定成2
export const minCreator = 2;

//每个节点最多可以投的producer数量
export const dposVoteMaxProducers = 30;

//超过该时间不出块就将被封禁
export const timeOffsetToLastBlock = 24 * 3600 * 1000; 

//封禁时长
export const timeBan = 30 * timeOffsetToLastBlock;

//每unbanBlocks个块后进行一次解禁计算
export const unbanBlocks = reSelectionBlocks * 10;

export class ViewContext {
    public static kvDPOS: string = 'dpos';
    public static keyCandidate: string = 'candidate'; //总的候选人
    public static keyVote: string = 'vote';
    public static keyStoke: string = 'stoke';
    public static keyNextMiners: string = 'miner';

    //每个代表投票的那些人
    public static keyProducers: string = 'producers';

    //生产者最后一次出块时间
    public static keyNewBlockTime: string = 'newblocktime';


    static getElectionBlockNumber(_number: number):number {
        if (_number === 0) {
            return 0;
        }
        return Math.floor((_number - 1) / reSelectionBlocks) * reSelectionBlocks;
    }


    async getNextMiners(electionStorage: IReadableStorage): Promise<{err: ErrorCode, creators?: string[]}> {
        let kvElectionDPOS = (await electionStorage.getReadableKeyValue(ViewContext.kvDPOS)).kv!;
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

    async getStoke(curStorage: IReadableStorage, address: string): Promise<{err: ErrorCode, stoke?: BigNumber}> {
        let kvCurDPOS = (await curStorage.getReadableKeyValue(ViewContext.kvDPOS)).kv!;
        //如果投票者的权益不够，则返回
        if (!(await kvCurDPOS.hexists(ViewContext.keyStoke, address))) {
            return {err: ErrorCode.RESULT_OK, stoke: new BigNumber(0)};
        } else {
            let gr = await kvCurDPOS.hget(ViewContext.keyStoke, address);
            if (gr.err) {
                return {err: gr.err};
            }
            return {err: ErrorCode.RESULT_OK, stoke: new BigNumber(gr.value! as string)};
        }
    }

    async getVote(curStorage: IReadableStorage): Promise<{err: ErrorCode, vote?: Map<string, BigNumber>}> {
        let kvCurDPOS = (await curStorage.getReadableKeyValue(ViewContext.kvDPOS)).kv!;
        let gr = await kvCurDPOS.hgetall(ViewContext.keyVote);
        if (gr.err) {
            return {err: gr.err};
        }
        let cans = await this.getValidCandidates(curStorage);
        if (cans.err) {
            return {err: cans.err};
        }

        cans.candidates!.sort();
        let isValid: (s: string) => boolean = (s: string): boolean => {
            for (let c of cans.candidates!) {
                if (c === s) {
                    return true;
                } else if (c < s) {
                    return false;
                }
            }
            return false;
        }
        let vote = new Map();
        for (let v of gr.value!) {
            if (isValid(v.key)) {
                vote.set(v.key, new BigNumber(v.value));
            }
        }
        return {err: ErrorCode.RESULT_OK, vote};
    }

    async getValidCandidates(curStorage: IReadableStorage): Promise<{err: ErrorCode, candidates?: string[]}> {
        let kvDPos = (await curStorage.getReadableKeyValue(ViewContext.kvDPOS)).kv!;
        let gr = await kvDPos.hgetall(ViewContext.keyCandidate);
        if (gr.err) {
            return {err: gr.err};
        }
        let candidates: string[] = [];
        for (let v of gr.value!) {
            if ((v.value as number) === 0) {
                candidates.push(v.key);
            }
        }

        return {err: ErrorCode.RESULT_OK, candidates: candidates};
    }
}

export class Context extends ViewContext {
    constructor() {
        super();
    }

    async init(curStorage: IReadWritableStorage, miners: string[]): Promise<{err: ErrorCode}> {
        let kvCurDPOS = (await curStorage.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let candiateValues = miners.map(()=>{return 0});
        let hmr = await kvCurDPOS.hmset(Context.keyCandidate, miners, candiateValues);
        if (hmr.err) {
            return hmr;
        }
        let rpr = await kvCurDPOS.rpushx(Context.keyNextMiners, miners);
        if (rpr.err) {
            return rpr;
        }
        return {err: ErrorCode.RESULT_OK};
    }

    
    async finishElection(curStorage: IReadWritableStorage, blockhash: string): Promise<{err: ErrorCode}> {
        let kvCurDPOS = (await curStorage.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let gvr = await this.getVote(curStorage);
        if (gvr.err) {
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
        let creators = election.slice(0, maxCreator).map((x) => {
            return x.address;
        });

        if (creators.length === 0) {
            return {err: ErrorCode.RESULT_OK};
        }

        this._shuffle(blockhash, creators);

        let llr = await kvCurDPOS.llen(ViewContext.keyNextMiners);
        if (llr.err) {
            return {err: llr.err};
        }
        for (let ix = 0; ix < llr.value; ++ix) {
            let lrr = await kvCurDPOS.lremove(ViewContext.keyNextMiners, 0);
            if (lrr.err) {
                return {err: lrr.err};
            }
        }
        let lpr = await kvCurDPOS.rpushx(ViewContext.keyNextMiners, creators);

        if (lpr.err) {
            return {err: lpr.err};
        }

        return {err: ErrorCode.RESULT_OK};
    }

    async mortgage(curStorage: IReadWritableStorage, from: string, amount: BigNumber): Promise<{err: ErrorCode, returnCode?: ErrorCode}> {
        assert(amount.gt(0), 'amount must positive');
        let kvBalance = (await curStorage.getReadWritableKeyValue(Chain.kvBalance)).kv!;
        let balanceInfo = await kvBalance.get(from);
        if (balanceInfo.err) {
            return {err: balanceInfo.err};
        }

        let balance: BigNumber = new BigNumber(balanceInfo.value!);
        if (balance.lt(amount)) {
            return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_NOT_ENOUGH};
        }

        let sysBalanceInfo = await kvBalance.get(Chain.sysAddress);
        let sysBalance: BigNumber = new BigNumber(0);
        if (sysBalanceInfo.err === ErrorCode.RESULT_OK) {
            sysBalance = new BigNumber(sysBalanceInfo.value!);
        }

        await kvBalance.set(from, balance.minus(amount).toString());
        await kvBalance.set(Chain.sysAddress, sysBalance.plus(amount).toString());


        let kvDPos = (await curStorage.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let stokeInfo = await kvDPos.hget(ViewContext.keyStoke, from);
        let stoke: BigNumber = new BigNumber(stokeInfo.err === ErrorCode.RESULT_OK ? stokeInfo.value as string : 0);
        await kvDPos.hset(ViewContext.keyStoke, from, stoke.plus(amount).toString());

        await this._updatevote(curStorage, from, amount);

        return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK};
    }

    async unmortgage(curStorage: IReadWritableStorage, from: string, amount: BigNumber): Promise<{err: ErrorCode, returnCode?: ErrorCode}> {
        assert(amount.gt(0), 'amount must positive');

        let kvDPos = (await curStorage.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let stokeInfo = await kvDPos.hget(ViewContext.keyStoke, from);
        if (stokeInfo.err) {
            return {err: stokeInfo.err};
        }
        let stoke: BigNumber = new BigNumber(stokeInfo.value!);
        if (stoke.lt(amount)) {
            return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_NOT_ENOUGH};
        }
        if (stoke.isEqualTo(amount)) {
            kvDPos.hdel(ViewContext.keyStoke, from);
        } else {
            kvDPos.hset(ViewContext.keyStoke, from, stoke.minus(amount).toString());
        }

        let balance: BigNumber = new BigNumber(0);
        let kvBalance = (await curStorage.getReadWritableKeyValue(Chain.kvBalance)).kv!;
        let balanceInfo = await kvBalance.get(from);
        if (balanceInfo.err === ErrorCode.RESULT_OK) {
            balance = new BigNumber(balanceInfo.value!);
        }
        let sysBalanceInfo = await kvBalance.get(Chain.sysAddress);
        assert(sysBalanceInfo.err === ErrorCode.RESULT_OK, 'sys balance must exist');
        let sysBalance: BigNumber = new BigNumber(sysBalanceInfo.value!);
        assert(sysBalance.gt(amount), `system balance must great amout,sys=${sysBalanceInfo.value!},amount=${amount.toString()}`)

        await kvBalance.set(from, balance.plus(amount).toString());
        await kvBalance.set(Chain.sysAddress, sysBalance.minus(amount).toString());

        await this._updatevote(curStorage, from, (new BigNumber(0)).minus(amount));
        if (stoke.isEqualTo(amount)) {
            kvDPos.hdel(ViewContext.keyProducers, from);
        }

        return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK};
    }

    async vote(curStorage: IReadWritableStorage, from: string, candidates: string[]): Promise<{err: ErrorCode, returnCode?: ErrorCode}> {
        assert(candidates.length > 0 && candidates.length <= dposVoteMaxProducers, 'candidates.length must right');
        
        let cans = await this.getValidCandidates(curStorage);
        if (cans.err) {
            return {err: cans.err};
        }

        cans.candidates!.sort();
        let isValid: (s: string) => boolean = (s: string): boolean => {
            for (let c of cans.candidates!) {
                if (c === s) {
                    return true;
                } else if (c < s) {
                    return false;
                }
            }
            return false;
        }
        for (let p of candidates) {
            if (!isValid(p)) {
                return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_NOT_FOUND};
            }
        }

        let kvDPos = (await curStorage.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let stokeInfo = await kvDPos.hget(ViewContext.keyStoke, from);
        if (stokeInfo.err) {
            return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_NOT_ENOUGH};
        }
        let stoke: BigNumber = new BigNumber(stokeInfo.value!);
        
        let producerInfo = await kvDPos.hget(ViewContext.keyProducers, from);
        if (producerInfo.err === ErrorCode.RESULT_OK) {
            let producers = JSON.parse(producerInfo.value!);
            if (producers.length === candidates.length) {
                producers.sort();
                candidates.sort();
                let i=0;
                for (i = 0; i < producers.length; i++) {
                    if (producers[i] !== candidates[i]) {
                        break;
                    }
                }
                if (i === producers.length) {
                    return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK};
                }
            }

            //取消投给先前的那些人
            await this._updatevote(curStorage, from, new BigNumber(0).minus(stoke));
        }
        //设置新的投票对象
        await kvDPos.hset(ViewContext.keyProducers, from, JSON.stringify(candidates));
        //计票
        await this._updatevote(curStorage, from, stoke);

        return {err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK};
    }

    async unbanProducer(curStorage: IReadWritableStorage, timestamp: number) {
        let kvDPos = (await curStorage.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;

        //解禁
        let candidateInfo = await kvDPos.hgetall(ViewContext.keyCandidate);
        for (let c of candidateInfo.value) {
            if ((c.value as number) !== 0 && (c.value as number) <= timestamp) {
                await kvDPos.hset(ViewContext.keyCandidate, c.key, 0);
            }
        }
    }

    async updateProducerTime(curStorage: IReadWritableStorage, producer: string, timestamp: number) {
        let kvDPos = (await curStorage.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        await kvDPos.hset(ViewContext.keyNewBlockTime, producer, timestamp);
    }

    async maintain_producer(curStorage: IReadWritableStorage, timestamp: number): Promise<ErrorCode> {
        let kvDPos = (await curStorage.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let allTimeInfo = await kvDPos.hgetall(ViewContext.keyNewBlockTime);
        let minersInfo = await this.getNextMiners(curStorage);
        assert( minersInfo.err === ErrorCode.RESULT_OK);
        let intersection: string[] = [];
        for (let m of minersInfo.creators!) {
            let i = 0;
            for (i = 0; i < allTimeInfo.value.length; i++) {
                if (m === allTimeInfo.value[i].key) {
                    intersection.push(m);
                    if (timestamp - (allTimeInfo.value[i].value as number) >= timeOffsetToLastBlock) {
                        await kvDPos.hset(ViewContext.keyCandidate, m, timestamp + timeBan);
                    }
                    break;
                }
            }

            if (i === allTimeInfo.value.length) {
                //可能是新进入序列，默认把当前block的时间当作它的初始出块时间
                await kvDPos.hset(ViewContext.keyNewBlockTime, m, timestamp);
            }
        }

        //已经被剔除出块序列了，清理它的计时器
        if (allTimeInfo.value.length !== intersection.length) {
            for (let p of allTimeInfo.value) {
                let i = 0;
                for (i = 0; i < intersection.length; i++) {
                    if (p.key === intersection[i]) {
                        break;
                    }
                }
    
                if (i === intersection.length) {
                    await kvDPos.hdel(ViewContext.keyNewBlockTime, p.key);
                }
            }
        }

        return ErrorCode.RESULT_OK;
    }

    protected async _updatevote(curStorage: IReadWritableStorage, voteor: string, amount: BigNumber): Promise<ErrorCode> {
        let kvDPos = (await curStorage.getReadWritableKeyValue(ViewContext.kvDPOS)).kv!;
        let producerInfo = await kvDPos.hget(ViewContext.keyProducers, voteor);
        if (producerInfo.err === ErrorCode.RESULT_OK) {
            let producers = JSON.parse(producerInfo.value!);
            for (let p of producers) {
                let voteInfo = await kvDPos.hget(ViewContext.keyVote, p);
                if (voteInfo.err === ErrorCode.RESULT_OK) {
                    await kvDPos.hset(ViewContext.keyVote, p, (new BigNumber(voteInfo.value!)).plus(amount).toString());
                } else {
                    assert(amount.gt(0), '_updatevote amount must positive');
                    await kvDPos.hset(ViewContext.keyVote, p, amount.toString());
                }
            }
        }

        return ErrorCode.RESULT_OK;
    }

    protected _shuffle(blockhash: string, producers: string[]) {
        let buf: Buffer = Buffer.from(blockhash);
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