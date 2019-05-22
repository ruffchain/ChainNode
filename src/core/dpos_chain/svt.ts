import { IReadWritableDatabase } from '../chain';
import { LoggerInstance } from 'winston';
import { DposChain } from './chain';
import { BigNumber, ErrorCode, IReadableDatabase } from '..';
import assert = require('assert');
import { SqliteStorageKeyValue } from '../storage_sqlite/storage';
import { BanStatus } from './consensus';

// This is used to query SVT, Vote, Dpos table at once
// Added by Yang Jun 2019-5-20

export type SVTContextOptions = {
  svtDatabase: IReadWritableDatabase,
  voteDatabase: IReadWritableDatabase,
  systemDatabase: IReadWritableDatabase,
  logger: LoggerInstance,
  chain: DposChain
};

export class SVTContext {
  protected m_logger: LoggerInstance;
  protected m_chain: DposChain;

  protected m_svtDatabase: IReadWritableDatabase;
  protected m_voteDatabase: IReadWritableDatabase;
  protected m_systemDatabase: IReadWritableDatabase;

  // passin database handler
  constructor(options: SVTContextOptions) {
    this.m_logger = options.logger;
    this.m_chain = options.chain;

    this.m_svtDatabase = options.svtDatabase;
    this.m_voteDatabase = options.voteDatabase;
    this.m_systemDatabase = options.systemDatabase;
  }

  // Added by Yang Jun
  public static kvSVTVote = 'vote';
  public static kvSVTDeposit = 'deposit';
  public static kvSVTFree = 'free'; // Use it only when it can be transfered

  public static kvVoteVote = 'vote';

  public static kvDpos = 'dpos';
  public static kvDposVote = 'vote';

  public static INTERVAL_IN_HOURS: number = 0.1;

  // public static computeDueBlock(curBlock: number, blockInterval: number, mortgageBlock: number): number {
  //   let sixHours = 0.1 * 3600 / blockInterval;
  //   return (Math.round(curBlock / sixHours) + 1) * sixHours + mortgageBlock;
  // }

  public static removeDuplicate(s: string[]): string[] {
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
  public static bIncorporate(realCandidates: string[], candidates: string[]): boolean {
    for (let p of candidates) {
      if (realCandidates.indexOf(p) === -1) {
        return false;
      }
    }
    return true;
  }

  private nGetCurBlock(): number {
    return this.m_chain.tipBlockHeader!.number;
  }
  private nGetCurDueBlock(delay: number): number {
    let BLOCK_INTERVAL = this.m_chain.globalOptions.blockInterval;

    let intervals = SVTContext.INTERVAL_IN_HOURS * 3600 / BLOCK_INTERVAL;
    return (Math.round(this.nGetCurBlock() / intervals) + 1) * intervals + delay;

  }
  private nGetCurMortgageDueBlock(): number {
    return this.nGetCurDueBlock(this.m_chain.globalOptions.mortgagePeriod);
  }
  private nGetCurDepositDueBlock(): number {
    return this.nGetCurDueBlock(this.m_chain.globalOptions.depositPeriod);
  }

  // Add by Yang Jun 2019-5-21
  async unmortgage(from: string, amount: BigNumber): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    assert(amount.gt(0), 'amount must positive');

    let curBlock = this.nGetCurBlock();

    console.log('Yang Jun -- unmortgage');
    console.log('curBlock:', curBlock);

    let kvSvtVote = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTVote)).kv! as SqliteStorageKeyValue;

    // check svt-vote table
    let stakeInfo = await kvSvtVote.hgetallbyname(from);
    if (stakeInfo.err) {
      console.log('Yang Jun -- hgetallbyname failed:', stakeInfo);
      return { err: stakeInfo.err };
    }

    // 可能不止有多个stake
    if (stakeInfo.err === ErrorCode.RESULT_OK) {
      let items = stakeInfo.value!;

      let effectiveAmount: BigNumber = new BigNumber(0);
      for (let voteItem of items) {
        console.log('voteItem:');
        console.log(voteItem);
        let stake: BigNumber = new BigNumber(voteItem.value!);
        let hisDueBlock: number = parseInt(voteItem.field);
        console.log('hisDueBlock:', hisDueBlock);

        if (curBlock > hisDueBlock) {
          effectiveAmount = effectiveAmount.plus(stake);
        }
      }
      console.log('effectiveAmount:', effectiveAmount.toString());
      console.log('amount:', amount.toString());
      // 
      if (effectiveAmount.lt(amount)) {
        console.log('Yang Jun -- effectiveAmount less than amount');
        return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_TIME_NOT_DUE };
      }

      let sumAll: BigNumber = amount;
      for (let voteItem of items) {
        let stake: BigNumber = new BigNumber(voteItem.value!);
        // let hisDueBlock = parseInt(voteItem.field);
        console.log('Yang Jun -- stake:', stake.toString());

        let hret1;

        if (stake.gt(sumAll)) {
          hret1 = await kvSvtVote.hset(from, voteItem.field, stake.minus(sumAll));
          if (hret1.err) { return hret1; }
          break;
        } else if (stake.lt(sumAll)) {
          hret1 = await kvSvtVote.hdel(from, voteItem.field);
          sumAll = sumAll.minus(stake);
          if (hret1.err) { return hret1; }
        } else {
          hret1 = await kvSvtVote.hdel(from, voteItem.field);
          if (hret1.err) { return hret1; }
          break;
        }
      }
    }

    let hret = await this._updatevote(from, (new BigNumber(0)).minus
      (amount));
    if (hret) {
      return { err: hret };
    }

    return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK };
  }

  // Added by Yang Jun 2019-5-20
  async mortgage(from: string, amount: BigNumber): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    assert(amount.gt(0), 'amount must positive');

    console.log('Yang Jun -- mortgage');
    console.log('curBlock:', this.nGetCurBlock());

    let dueBlock = this.nGetCurMortgageDueBlock();

    console.log('dueBlock:', dueBlock);

    let kvSvtVote = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTVote)).kv!;

    let stakeInfo = await kvSvtVote.hget(from, dueBlock.toString());

    if (stakeInfo.err === ErrorCode.RESULT_EXCEPTION) {
      console.log('error happened');
      return { err: ErrorCode.RESULT_EXCEPTION, returnCode: ErrorCode.RESULT_EXCEPTION };
    }

    let stake: BigNumber;
    if (stakeInfo.err === ErrorCode.RESULT_NOT_FOUND) {
      stake = new BigNumber(0);
    } else {
      stake = stakeInfo.value!;
    }

    await kvSvtVote.hset(from, dueBlock.toString(), stake.plus(amount));

    let hret = await this._updatevote(from, amount);
    if (hret) {
      return { err: hret };
    }

    return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK };
  }
  protected async _updatevotee(votee: string): Promise<ErrorCode> {
    let kvVote = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;

    let voteeInfo = await kvVote.hgetallbyfield(votee);

    if (voteeInfo.err === ErrorCode.RESULT_OK) {
      let producers = voteeInfo.value!;
      for (let p of producers) {
        console.log('Yang Jun -- _updatevotee');
        console.log(p);
        await kvVote.hdel(p.name, p.field);
      }
    }
    return ErrorCode.RESULT_OK;
  }
  protected async _updatevote(voter: string, amount: BigNumber): Promise<ErrorCode> {
    // update Vote table
    let kvVote = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;

    let kvDPos = (await this.m_systemDatabase.getReadWritableKeyValue(SVTContext.kvDpos)).kv! as SqliteStorageKeyValue;

    let voterInfo = await kvVote.hgetallbyname(voter);

    if (voterInfo.err === ErrorCode.RESULT_OK) {
      let producers = voterInfo.value!;

      for (let p of producers) {
        console.log('Yang Jun -- _updatevote');
        console.log(p);

        let newvote: BigNumber = p.value.plus(amount);

        let hret = await kvVote.hset(voter, p.field, newvote);
        if (hret.err) {
          return hret.err;
        }

        // 只能添加，不可能减少
        let voteSum = await kvDPos.hget(SVTContext.kvDposVote, p.field);

        if (voteSum.err === ErrorCode.RESULT_OK) {
          let vote: BigNumber = voteSum.value!.plus(amount);
          let hret1;
          if (vote.eq(0)) {
            hret1 = await kvVote.hdel(SVTContext.kvDposVote, p.field);
          } else {
            hret1 = await kvVote.hset(SVTContext.kvDposVote, p.field, vote);
          }
          if (hret1.err) {
            return hret1.err;
          }

        } else if (voteSum.err === ErrorCode.RESULT_NOT_FOUND) {
          assert(amount.gt(0), '_updatevote amount must positive');
          let hret2 = await kvDPos.hset(SVTContext.kvDposVote, p.field, amount);
          if (hret2.err) {
            return hret2.err;
          }
        }
      }
    }
    // it does not vote yet
    return ErrorCode.RESULT_OK;
  }
  // register
  public async register(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    // 如果已经是候选人的话，则退出
    let kvDPos = (await this.m_systemDatabase.getReadWritableKeyValue(SVTContext.kvDpos)).kv!;

    let her = await kvDPos.hexists('candidate', from);

    if (her.err) {
      return { err: her.err };
    }
    // true
    if (her.value) {
      return { err: ErrorCode.RESULT_ALREADY_EXIST, returnCode: ErrorCode.RESULT_ALREADY_EXIST };
    }
    await kvDPos.hset('candidate', from, BanStatus.NoBan);

    // 在SVT-depoist里面添加, 不再检测是否存在
    console.log('Yang Jun -- register');
    console.log('curBlock:', this.nGetCurBlock());

    let dueBlock = this.nGetCurDepositDueBlock();
    console.log('dueBlock:', dueBlock);

    let kvSvtVote = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTDeposit)).kv!;

    let hret = await kvSvtVote.hset(from, dueBlock.toString(), this.m_chain.globalOptions.depositAmount);

    return hret;
  }
  public async unregister(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    // 查看svt-deposit记录，看时间上是否到期
    let curBlock: number = this.nGetCurBlock();

    console.log('Yang Jun -- unregister');
    console.log('curBlock:', curBlock);

    let kvSVTDeposit = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTDeposit)).kv! as SqliteStorageKeyValue;

    let her = await kvSVTDeposit.hgetallbyname(from);

    if (her.err) {
      return { err: her.err, returnCode: her.err };
    }
    if (!her.value) {
      return { err: ErrorCode.RESULT_NOT_FOUND, returnCode: ErrorCode.RESULT_NOT_FOUND };
    }
    let item = her.value[0];
    let dueBlock: number = parseInt(item.field);
    if (dueBlock > curBlock) {
      return { err: ErrorCode.RESULT_TIME_NOT_DUE, returnCode: ErrorCode.RESULT_TIME_NOT_DUE };
    }

    // delete from svt-deposit
    let hret = await kvSVTDeposit.hdel(item.name, item.field);
    if (hret.err) { return hret; }

    // delete from vote-vote
    let hret1 = await this.removeVoteeFromVote(item.name);
    if (hret1.err) { return hret1; }

    // delete from dpos-candidate

    let hret2 = await this.removeCandidateFromDpos(item.name);
    if (hret2.err) { return hret2; }

    // delete from dpos-vote
    let hret3 = await this.removeVoteeFromDpos(item.name);
    if (hret3.err) { return hret3; }

    return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK };
  }
  protected async getCandidates(): Promise<{ err: ErrorCode, candidates?: string[] }> {
    let kvDPos = (await this.m_systemDatabase.getReadWritableKeyValue(SVTContext.kvDpos)).kv! as SqliteStorageKeyValue;
    let gr = await kvDPos.hgetallbyname('candidate');
    if (gr.err) {
      return { err: gr.err };
    }
    let candidates: string[] = [];
    for (let v of gr.value!) {
      candidates.push(v.field);
    }

    return { err: ErrorCode.RESULT_OK, candidates: candidates! };
  }
  private async updateVoteToDpos(from: string, bOperation: boolean): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    let kvVoteVote = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;
    let kvDposVote = (await this.m_systemDatabase.getReadWritableKeyValue(SVTContext.kvDposVote)).kv! as SqliteStorageKeyValue;

    let kvvote = await kvVoteVote.hgetallbyname(from);
    if (kvvote.err) {
      return { err: kvvote.err };
    }

    let items = kvvote.value!;
    for (let item of items) {
      // delete every vote from dpos-vote table
      let votee = item.field; // address
      let amountVote = item.value;
      let hvalue = await kvDposVote.hget(SVTContext.kvDposVote, votee);
      if (hvalue.err) {
        return { err: hvalue.err };
      }
      let amount: BigNumber = hvalue.value!;
      console.log('updateVote: old  ', amount.toString());

      if (bOperation === true) {
        amount = amount.plus(amountVote);
      } else {
        amount = amount.minus(amountVote);
      }

      console.log('updateVote: new  ', amount.toString());

      let hret;
      if (amount.eq(0)) {
        hret = await kvDposVote.hdel(SVTContext.kvDposVote, votee);
      } else {
        hret = await kvDposVote.hset(SVTContext.kvDposVote, votee, amount);
      }

      if (hret.err) {
        return { err: hret.err };
      }

    }
    return { err: ErrorCode.RESULT_OK };
  }
  private async checkCandidateToDpos(candidates: string[]): Promise<{ err: ErrorCode, value?: boolean }> {
    console.log('Yang Jun -- checkCandidateToDpos');
    let hcand = await this.getCandidates();
    if (hcand.err) {
      return { err: ErrorCode.RESULT_NOT_FOUND };
    }
    let alreadyCandidates = hcand.candidates;
    console.log('Yang Jun -- alreadycandidates')
    console.log(alreadyCandidates);

    if (!SVTContext.bIncorporate(alreadyCandidates!, candidates)) {
      console.log('Some candidates are Not within alreadycandidates');
      return { err: ErrorCode.RESULT_OK, value: false };
    } else {
      return { err: ErrorCode.RESULT_OK, value: true };
    }
  }

  private async addVoteToDpos(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    console.log('Yang Jun -- addVoteToDpos');
    return this.updateVoteToDpos(from, true);
  }

  private async removeVoteFromDpos(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    return this.updateVoteToDpos(from, false);
  }
  private async removeVoteeFromDpos(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    let kvDposVote = (await this.m_systemDatabase.getReadWritableKeyValue(SVTContext.kvDposVote)).kv! as SqliteStorageKeyValue;

    let hret = await kvDposVote.hdel('vote', from);
    return hret;

  }
  private async removeCandidateFromDpos(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    let kvDpos = (await this.m_systemDatabase.getReadWritableKeyValue(SVTContext.kvDpos)).kv! as SqliteStorageKeyValue;

    let hret = await kvDpos.hdel('candidate', from);
    return hret;

  }
  private async removeVoteFromVote(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    console.log('Yang Jun -- removeVoteFromVote table');
    let kvVoteVote = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;

    let hret = await kvVoteVote.hdelallbyname(from);
    return hret;
  }
  private async addVoteToVote(from: string, votee: string[], amount: BigNumber[]): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    console.log('Yang Jun -- addVoteToVote table');
    let kvVoteVote = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;

    let hret = await kvVoteVote.hmset(from, votee, amount);
    return hret;
  }
  private async removeVoteeFromVote(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    console.log('Yang Jun -- removeVoteeFromVote table');
    let kvVoteVote = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;

    let hret = await kvVoteVote.hdelallbyfield(from);
    return hret;
  }

  private async calcVoteFromMortgage(from: string): Promise<{ err: ErrorCode, value?: BigNumber }> {
    // calculate svt-vote, voteSum
    let kvSVTVote = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTVote)).kv! as SqliteStorageKeyValue;

    let kvVote = await kvSVTVote.hgetallbyname(from);
    if (kvVote.err) {
      return { err: ErrorCode.RESULT_EXCEPTION };
    }

    let items: any[] = kvVote.value!;
    let votSum: BigNumber = new BigNumber(0);
    for (let p of items) {
      console.log(p);
      votSum = votSum.plus(p.value);
    }
    console.log('votsum:', votSum.toString());

    return { err: ErrorCode.RESULT_OK, value: votSum };
  }

  // vote
  public async vote(from: string, candidates: string[]): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {

    candidates = SVTContext.removeDuplicate(candidates);
    assert(candidates.length > 0 && candidates.length <= this.m_chain.globalOptions.dposVoteMaxProducers, 'candidates.length must right');

    // check with dpos-candidates
    let hcand = await this.checkCandidateToDpos(candidates);
    if (hcand.err || hcand.value === false) {
      return { err: ErrorCode.RESULT_WRONG_ARG, returnCode: ErrorCode.RESULT_NOT_FOUND };
    }

    // remove vote from dpos
    let hret = await this.removeVoteFromDpos(from);
    if (hret.err) {
      return hret;
    }

    let hret1 = await this.removeVoteFromVote(from);
    if (hret1.err) {
      return hret1;
    }

    // calculate svt-vote, voteSum
    let hret2 = await this.calcVoteFromMortgage(from);
    if (hret2.err) {
      return { err: hret2.err };
    }

    console.log('votsum:', hret2.value!.toString());
    let amount: BigNumber = hret2.value!;

    if (amount.eq(0)) {
      return { err: ErrorCode.RESULT_UNKNOWN_VALUE };
    }
    let amountAll: BigNumber[] = [];


    candidates.map(() => {
      amountAll.push(amount);
    });

    // update to Vote-vote table, 
    let hret3 = await this.addVoteToVote(from, candidates, amountAll);
    if (hret3.err) {
      return hret3;
    }

    // update dpos vote table
    // 如何去更新 dpos vote 表格呢？
    let hret4 = await this.addVoteToDpos(from);
    if (hret4.err) {
      return hret4;
    }
    return { err: ErrorCode.RESULT_OK };
  }
}
////////////////////////////////////////////////////////////////////////
/// SVTViewContext definitions
///////////////////////////////////////////////////////////////////////
export type SVTViewContextOptions = {
  svtDatabase: IReadableDatabase,
  voteDatabase: IReadableDatabase,
  systemDatabase: IReadableDatabase,
  logger: LoggerInstance,
  chain: DposChain
}
export class SVTViewContext {
  protected m_logger: LoggerInstance;
  protected m_chain: DposChain;

  protected m_svtDatabase: IReadableDatabase;
  protected m_voteDatabase: IReadableDatabase;
  protected m_systemDatabase: IReadableDatabase;

  // passin database handler
  constructor(options: SVTViewContextOptions) {
    this.m_logger = options.logger;
    this.m_chain = options.chain;

    this.m_svtDatabase = options.svtDatabase;
    this.m_voteDatabase = options.voteDatabase;
    this.m_systemDatabase = options.systemDatabase;
  }

  public async getTicket(address: string): Promise<{ err: ErrorCode, value?: any }> {
    console.log('Yang Jun -- into getTicket()');
    let kvVoteVote = (await this.m_voteDatabase.getReadableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;
    let out: any = [];
    let hret = await kvVoteVote.hgetallbyname(address);
    if (hret.err) {
      return hret;
    }

    for (let item of hret.value!) {
      out.push({ candidate: item.field, amount: item.value.toString() });
    }
    return { err: ErrorCode.RESULT_OK, value: out };
  }
  public async getStake(address: string): Promise<{ err: ErrorCode, stake?: any }> {
    console.log('Yang Jun -- into svt::getStake()');
    let curBlock = this.m_chain.tipBlockHeader!.number;
    let out = Object.create(null);

    out.curBlock = curBlock;

    // get svt-deposit
    let kvSVTDeposit = (await this.m_svtDatabase.getReadableKeyValue(SVTContext.kvSVTDeposit)).kv! as SqliteStorageKeyValue;

    let hdps = await kvSVTDeposit.hgetallbyname(address);
    if (hdps.err) {
      return { err: hdps.err };
    }

    out.deposit = [];
    for (let p of hdps.value!) {
      out.deposit.push({ amount: p.value, dueBlock: p.field });
    }

    // get svt-vote
    let kvSVTVote = (await this.m_svtDatabase.getReadableKeyValue(SVTContext.kvSVTVote)).kv! as SqliteStorageKeyValue;
    // 如果投票者的权益不够，则返回
    let her = await kvSVTVote.hgetallbyname(address);
    if (her.err) {
      return { err: her.err };
    }

    out.vote = [];
    for (let p of her.value!) {
      out.vote.push({ amount: p.value, dueBlock: p.field });
    }

    console.log('Yang Jun -- getStake()');
    console.log(out);

    return { err: ErrorCode.RESULT_OK, stake: out };
  }
  public async getCandidates(): Promise<{ err: ErrorCode, candidates?: string[] }> {
    let kvDPos = (await this.m_systemDatabase.getReadableKeyValue(SVTContext.kvDpos)).kv! as SqliteStorageKeyValue;
    let gr = await kvDPos.hgetallbyname('candidate');
    if (gr.err) {
      return { err: gr.err };
    }
    let candidates: string[] = [];
    for (let v of gr.value!) {
      candidates.push(v.field);
    }

    return { err: ErrorCode.RESULT_OK, candidates: candidates! };
  }
  public async getVote(): Promise<{ err: ErrorCode, candidates?: any[] }> {
    let kvDPos = (await this.m_systemDatabase.getReadableKeyValue(SVTContext.kvDpos)).kv! as SqliteStorageKeyValue;
    let gr = await kvDPos.hgetallbyname('vote');
    if (gr.err) {
      return { err: gr.err };
    }
    let candidates: any[] = [];
    for (let v of gr.value!) {
      candidates.push({ candidate: v.field, amount: v.value.toString() });
    }

    return { err: ErrorCode.RESULT_OK, candidates: candidates! };
  }
}
