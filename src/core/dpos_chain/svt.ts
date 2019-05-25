import { IReadWritableDatabase } from '../chain';
import { LoggerInstance } from 'winston';
import { DposChain } from './chain';
import { BigNumber, ErrorCode, IReadableDatabase, fromStringifiable } from '..';
import assert = require('assert');
import { SqliteStorageKeyValue } from '../storage_sqlite/storage';
import { BanStatus } from './consensus';
import { IfRegisterOption } from '../../../ruff/dposbft/chain/scoop';

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
  public static kvSVTInfo = 'info';

  public static kvVoteVote = 'vote';
  public static kvVoteLasttime = 'last';

  public static kvDpos = 'dpos';
  public static kvDposVote = 'vote';

  public static INTERVAL_IN_HOURS: number = 0.1;


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

    this.m_logger.info('Yang Jun -- unmortgage');
    this.m_logger.info('curBlock:', curBlock);

    let kvSvtVote = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTVote)).kv! as SqliteStorageKeyValue;

    // check svt-vote table
    let stakeInfo = await kvSvtVote.hgetallbyname(from);
    if (stakeInfo.err) {
      this.m_logger.info('Yang Jun -- hgetallbyname failed:', stakeInfo);
      return { err: stakeInfo.err };
    }

    // 可能不止有多个stake
    if (stakeInfo.err === ErrorCode.RESULT_OK) {
      let items = stakeInfo.value!;

      let effectiveAmount: BigNumber = new BigNumber(0);
      for (let voteItem of items) {
        this.m_logger.info('voteItem:');
        this.m_logger.info(JSON.stringify(voteItem));
        let stake: BigNumber = new BigNumber(voteItem.value!);
        let hisDueBlock: number = parseInt(voteItem.field);
        this.m_logger.info('hisDueBlock:', hisDueBlock);

        if (curBlock > hisDueBlock) {
          effectiveAmount = effectiveAmount.plus(stake);
        }
      }
      this.m_logger.info('effectiveAmount:', effectiveAmount.toString());
      this.m_logger.info('amount:', amount.toString());
      // 
      if (effectiveAmount.lt(amount)) {
        this.m_logger.info('Yang Jun -- effectiveAmount less than amount');
        return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_TIME_NOT_DUE };
      }

      let sumAll: BigNumber = amount;
      for (let voteItem of items) {
        let stake: BigNumber = new BigNumber(voteItem.value!);
        // let hisDueBlock = parseInt(voteItem.field);
        this.m_logger.info('Yang Jun -- stake:', stake.toString());

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

    let hret = await this._updatevotevote(from, (new BigNumber(0)).minus
      (amount));
    if (hret) {
      return { err: hret };
    }

    // update dpos-vote
    let hret4 = await this._updatedposvote(from, (new BigNumber(0)).minus
      (amount));
    if (hret4) {
      this.m_logger.info('addVoteToDPos fail: ', hret4);
      return { err: hret4, returnCode: hret4 };
    }

    return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK };
  }

  // Added by Yang Jun 2019-5-20
  async mortgage(from: string, amount: BigNumber): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    assert(amount.gt(0), 'amount must positive');

    this.m_logger.info('Yang Jun -- mortgage');
    this.m_logger.info('curBlock:', this.nGetCurBlock());

    let dueBlock = this.nGetCurMortgageDueBlock();

    this.m_logger.info('dueBlock:', dueBlock);

    let kvSvtVote = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTVote)).kv!;

    let stakeInfo = await kvSvtVote.hget(from, dueBlock.toString());

    if (stakeInfo.err === ErrorCode.RESULT_EXCEPTION) {
      this.m_logger.info('error happened');
      return { err: ErrorCode.RESULT_EXCEPTION, returnCode: ErrorCode.RESULT_EXCEPTION };
    }

    let stake: BigNumber;
    if (stakeInfo.err === ErrorCode.RESULT_NOT_FOUND) {
      stake = new BigNumber(0);
    } else {
      stake = stakeInfo.value!;
    }

    await kvSvtVote.hset(from, dueBlock.toString(), stake.plus(amount));

    // update Vote-vote
    let hret = await this._updatevotevote(from, amount);
    if (hret) {
      return { err: hret };
    }

    // update dpos-vote
    hret = await this._updatedposvote(from, amount);
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
        this.m_logger.info('Yang Jun -- _updatevotee');
        this.m_logger.info(JSON.stringify(p));
        await kvVote.hdel(p.name, p.field);
      }
    }
    return ErrorCode.RESULT_OK;
  }
  protected async _updatedposvote(voter: string, amount: BigNumber): Promise<ErrorCode> {
    this.m_logger.info('_updatedposvote ', voter, ' ', amount);

    let kvDpos = (await this.m_systemDatabase.getReadWritableKeyValue(SVTContext.kvDpos)).kv! as SqliteStorageKeyValue;
    let kvVote = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;

    let voterInfo = await kvVote.hgetallbyname(voter);
    if (voterInfo.err === ErrorCode.RESULT_OK) {
      let producers = voterInfo.value!;

      for (let p of producers) {
        this.m_logger.info('Yang Jun -- _updatedposvote');
        this.m_logger.info(JSON.stringify(p));

        let hret = await kvDpos.hexists('vote', p.field);

        if (hret.err) {
          return hret.err;
        }

        if (hret.value === true) {
          let hret1 = await kvDpos.hget('vote', p.field);
          if (hret1.err) { return hret1.err; }

          let amountNew = hret1.value.plus(amount);

          if (amountNew.eq(0)) {
            let hret4 = await kvDpos.hdel('vote', p.field);
            if (hret4.err) { return hret4.err; }
          } else {
            let hret3 = await kvDpos.hset('vote', p.field, amountNew);
            if (hret3.err) { return hret3.err; }
          }
        }
        if (hret.value === false) {
          let hret2 = await kvDpos.hset('vote', p.field, amount);
          if (hret2.err) { return hret2.err; }
        }
      }
    }
    return ErrorCode.RESULT_OK;
  }
  protected async _updatevotevote(voter: string, amount: BigNumber): Promise<ErrorCode> {
    // update Vote table
    this.m_logger.info('_updatevotevote ', voter, ' ', amount);

    let kvVote = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;

    let voterInfo = await kvVote.hgetallbyname(voter);

    if (voterInfo.err === ErrorCode.RESULT_OK) {
      let producers = voterInfo.value!;

      for (let p of producers) {
        this.m_logger.info('Yang Jun -- _updatevotevote');
        this.m_logger.info(JSON.stringify(p));

        let newvote: BigNumber = p.value.plus(amount);

        if (newvote.eq(0)) {
          let hret1 = await kvVote.hdel(voter, p.field);
          if (hret1.err) { return hret1.err; }
        } else {
          let hret = await kvVote.hset(voter, p.field, newvote);
          if (hret.err) { return hret.err; }
        }

        // 只能添加，不可能减少
        // let voteSum = await kvDPos.hexists(SVTContext.kvDposVote, p.field);

        // if (voteSum.err !== ErrorCode.RESULT_OK) {
        //   return voteSum.err;
        // }

        // if (voteSum.value === true) {
        //   let hvote = await kvDPos.hget(SVTContext.kvDposVote, p.field);
        //   if (hvote.err) { return hvote.err; }
        //   let vote = hvote.value!.plus(amount);

        //   let hvote1 = await kvDPos.hset(SVTContext.kvDposVote, p.field, vote);
        //   if (hvote1.err) {
        //     return hvote1.err;
        //   }
        // }
        // if (voteSum.value === false) {
        //   let hvote = await kvDPos.hset(SVTContext.kvDposVote, p.field, newvote);
        //   if (hvote.err) {
        //     return hvote.err;
        //   }
        // }
      }
    }
    // it does not vote yet
    return ErrorCode.RESULT_OK;
  }
  protected async _setSvtInfo(from: string, option: IfRegisterOption): Promise<{ err: ErrorCode, value?: any }> {
    let kvSvtInfo = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTInfo)).kv! as SqliteStorageKeyValue;

    let objs = option as any;

    for (let key of Object.keys(objs)) {
      let hret = await kvSvtInfo.hset(from, key, objs[key]);
      if (hret.err) {
        this.m_logger.info('set kvSVTInfo hret err:', hret.err);
        return { err: hret.err };
      }
    }

    return { err: ErrorCode.RESULT_OK };
  }

  // register
  public async register(from: string, option: IfRegisterOption): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
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
    this.m_logger.info('Yang Jun -- register');
    this.m_logger.info('curBlock:', this.nGetCurBlock());

    let dueBlock = this.nGetCurDepositDueBlock();
    this.m_logger.info('dueBlock:', dueBlock);

    let kvSvtVote = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTDeposit)).kv!;

    let hret = await kvSvtVote.hset(from, dueBlock.toString(), this.m_chain.globalOptions.depositAmount);
    if (hret.err) {
      this.m_logger.info('hret err:', hret.err);
      return { err: hret.err, returnCode: hret.err };
    }

    // Save option to SVT-info
    let hret2 = await this._setSvtInfo(from, option);
    if (hret2.err) {
      return { err: hret2.err, returnCode: hret2.err };
    }

    return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK };
  }
  public async unregister(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    // 查看svt-deposit记录，看时间上是否到期
    let curBlock: number = this.nGetCurBlock();

    this.m_logger.info('Yang Jun -- unregister');
    this.m_logger.info('curBlock:', curBlock);

    let kvSVTDeposit = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTDeposit)).kv! as SqliteStorageKeyValue;

    let her = await kvSVTDeposit.hgetallbyname(from);

    if (her.err) {
      return { err: her.err, returnCode: her.err };
    }
    if (!her.value) {
      return { err: ErrorCode.RESULT_NOT_FOUND, returnCode: ErrorCode.RESULT_NOT_FOUND };
    }
    this.m_logger.info(JSON.stringify(her.value!));

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

  private async updateVoteToDpos(from: string, bOperation: boolean): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    let kvVoteVote = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;

    let kvDpos = (await this.m_systemDatabase.getReadWritableKeyValue(SVTContext.kvDpos)).kv! as SqliteStorageKeyValue;

    let kvvote = await kvVoteVote.hgetallbyname(from);
    if (kvvote.err) {
      this.m_logger.info('getallbyname from voteVote fail ')
      return { err: kvvote.err };
    }
    this.m_logger.info(JSON.stringify(kvvote.value!));

    let items = kvvote.value!;
    for (let item of items) {
      // delete every vote from dpos-vote table
      this.m_logger.info('item:');
      this.m_logger.info(JSON.stringify(item));
      let votee = item.field; // address
      let amountVote = item.value;

      // Judge if it's there
      let amount: BigNumber = new BigNumber(0);
      let hvalue = await kvDpos.hexists(SVTContext.kvDposVote, votee);
      if (hvalue.err) {
        return { err: hvalue.err };
      }

      if (hvalue.value === true) {
        let hret1 = await kvDpos.hget(SVTContext.kvDposVote, votee);
        if (hret1.err) {
          return { err: hret1.err };
        }
        amount = hret1.value!;
      }

      this.m_logger.info('updateVote: old  ', amount.toString());

      if (bOperation === true) {
        amount = amount.plus(amountVote);
      } else {
        amount = amount.minus(amountVote);
      }

      this.m_logger.info('updateVote: new  ', amount.toString());

      let hret;
      if (amount.eq(0)) {
        hret = await kvDpos.hdel(SVTContext.kvDposVote, votee);
      } else {
        hret = await kvDpos.hset(SVTContext.kvDposVote, votee, amount);
      }

      if (hret.err) {
        return { err: hret.err };
      }

    }
    return { err: ErrorCode.RESULT_OK };
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
  private async checkCandidateToDpos(candidates: string[]): Promise<{ err: ErrorCode, value?: boolean }> {
    this.m_logger.info('Yang Jun -- checkCandidateToDpos');
    let hcand = await this.getCandidates();
    if (hcand.err) {
      return { err: ErrorCode.RESULT_NOT_FOUND };
    }
    let alreadyCandidates = hcand.candidates;
    this.m_logger.info('Yang Jun -- alreadycandidates');
    this.m_logger.info(JSON.stringify(alreadyCandidates));

    if (!SVTContext.bIncorporate(alreadyCandidates!, candidates)) {
      this.m_logger.info('Some candidates are Not within alreadycandidates');
      return { err: ErrorCode.RESULT_OK, value: false };
    } else {
      return { err: ErrorCode.RESULT_OK, value: true };
    }
  }

  private async addVoteToDpos(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    this.m_logger.info('Yang Jun -- addVoteToDpos');
    return this.updateVoteToDpos(from, true);
  }
  /// remove from 's vote from the list
  private async removeVoteFromDpos(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    return this.updateVoteToDpos(from, false);
  }
  private async removeVoteeFromDpos(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    let kvDpos = (await this.m_systemDatabase.getReadWritableKeyValue(SVTContext.kvDpos)).kv! as SqliteStorageKeyValue;

    let hfind = await kvDpos.hexists('vote', from);

    if (hfind.err === ErrorCode.RESULT_NOT_FOUND) {
      return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_NOT_FOUND }
    }
    if (hfind.err) {
      return { err: hfind.err, returnCode: hfind.err };
    }

    let hret = await kvDpos.hdel('vote', from);
    return hret;

  }
  private async removeCandidateFromDpos(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    let kvDpos = (await this.m_systemDatabase.getReadWritableKeyValue(SVTContext.kvDpos)).kv! as SqliteStorageKeyValue;

    let hret = await kvDpos.hdel('candidate', from);
    return hret;

  }
  private async removeVoteFromVote(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    this.m_logger.info('Yang Jun -- removeVoteFromVote table');
    let kvVoteVote = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;

    let hfind = await kvVoteVote.hgetallbyname(from);

    if (hfind.err) {
      return { err: hfind.err, returnCode: hfind.err };
    }

    if (!hfind.value) {
      return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_NOT_FOUND };
    }

    let hret = await kvVoteVote.hdelallbyname(from);
    return hret;
  }
  private async removeVoteeFromVote(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    this.m_logger.info('Yang Jun -- removeVoteeFromVote table');
    let kvVoteVote = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;

    let hfind = await kvVoteVote.hgetallbyfield(from);

    if (hfind.err) {
      return { err: hfind.err, returnCode: hfind.err };
    }

    if (!hfind.value) {
      return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_NOT_FOUND };
    }

    let hret = await kvVoteVote.hdelallbyfield(from);
    return hret;
  }
  private async setVoteLasttime(from: string): Promise<{ err: ErrorCode, value?: string }> {
    let curBlock = this.nGetCurBlock();
    let dueInterval: number = this.m_chain.globalOptions.voteInterval;
    let kvVoteLasttime = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteLasttime)).kv! as SqliteStorageKeyValue;
    let dueBlock = curBlock + dueInterval;

    let hret = await kvVoteLasttime.hset(from, dueBlock.toString(), 0);
    if (hret.err) {
      return { err: hret.err };
    }
    return { err: ErrorCode.RESULT_OK, value: dueBlock.toString() };
  }
  private async getVoteLasttime(from: string): Promise<{ err: ErrorCode, value?: string }> {
    let kvVoteLasttime = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteLasttime)).kv! as SqliteStorageKeyValue;

    let hret = await kvVoteLasttime.hgetallbyname(from);
    if (hret.err) {
      // 读取错误，这个是要退出的!
      return { err: hret.err, value: '' };
    }

    this.m_logger.info('Yang Jun - checkVoteLasttime');
    this.m_logger.info(JSON.stringify(hret.value));

    if (hret.value!.length === 0) {
      let hret1 = await kvVoteLasttime.hset(from, '0', 0);
      if (hret1.err) {
        return { err: hret1.err, value: '' };
      } else {
        return { err: ErrorCode.RESULT_OK, value: '0' };
      }
    }
    return { err: ErrorCode.RESULT_OK, value: hret.value![0].field };

  }
  private async addVoteToVote(from: string, votee: string[], amount: BigNumber[]): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    this.m_logger.info('Yang Jun -- addVoteToVote table');
    let kvVoteVote = (await this.m_voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;

    let hret = await kvVoteVote.hmset(from, votee, amount);
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
      this.m_logger.info(p);
      votSum = votSum.plus(p.value);
    }
    this.m_logger.info('votsum:', votSum.toString());

    return { err: ErrorCode.RESULT_OK, value: votSum };
  }

  // api_vote
  public async vote(from: string, candidates: string[]): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {

    candidates = SVTContext.removeDuplicate(candidates);
    assert(candidates.length > 0 && candidates.length <= this.m_chain.globalOptions.dposVoteMaxProducers, 'candidates.length must right');

    // check with dpos-candidates, if one of them not a candidates , get out
    let hcand = await this.checkCandidateToDpos(candidates);
    if (hcand.err || hcand.value === false) {
      return { err: ErrorCode.RESULT_WRONG_ARG, returnCode: ErrorCode.RESULT_NOT_FOUND };
    }

    // check Vote-last to find If not voted yet, 
    let hreturn = await this.getVoteLasttime(from);
    if (hreturn.err) {
      return { err: ErrorCode.RESULT_READ_RECORD_FAILED, returnCode: ErrorCode.RESULT_READ_RECORD_FAILED };
    }
    let curBlock = this.nGetCurBlock();
    let dueBlock = parseInt(hreturn.value!);

    // 1st vote 

    if (curBlock < dueBlock) {
      return { err: ErrorCode.RESULT_TIME_NOT_DUE, returnCode: ErrorCode.RESULT_TIME_NOT_DUE };
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
    // svt-vote summary of mortgage
    this.m_logger.info('votsum:', hret2.value!.toString());
    let amount: BigNumber = hret2.value!;

    if (amount.eq(0)) {
      return { err: ErrorCode.RESULT_UNKNOWN_VALUE };
    }
    let amountAll: BigNumber[] = [];

    candidates.map(() => {
      amountAll.push(amount);
    });

    // update to Vote-vote table, 
    this.m_logger.info(JSON.stringify(candidates));
    this.m_logger.info(JSON.stringify(amountAll));
    let hret3 = await this.addVoteToVote(from, candidates, amountAll);
    if (hret3.err) {
      this.m_logger.info('addvotevote fail', hret3.err);
      return hret3;
    }

    // update dpos vote table
    // 如何去更新 dpos vote 表格呢？
    let hret4 = await this.addVoteToDpos(from);
    if (hret4.err) {
      this.m_logger.info('addVoteToDPos fail: ', hret4.err);
      return hret4;
    }

    let hret5 = await this.setVoteLasttime(from);
    if (hret5.err) {
      this.m_logger.info('setVoteLastTime failed', hret5.err);
      return hret5;
    }

    return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK };
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

  // block to epoch time
  private nGetTimeFromDueBlock(epochTime: number, block: number): number {

    let out: number = epochTime + block * this.m_chain.globalOptions.blockInterval * 1000;

    return out;
  }
  private async getVoteLasttime(from: string): Promise<{ err: ErrorCode, value?: string }> {
    let kvVoteLasttime = (await this.m_voteDatabase.getReadableKeyValue(SVTContext.kvVoteLasttime)).kv! as SqliteStorageKeyValue;

    let hret = await kvVoteLasttime.hgetallbyname(from);
    if (hret.err) {
      // 读取错误，这个是要退出的!
      return { err: hret.err, value: '' };
    }

    this.m_logger.info('Yang Jun - checkVoteLasttime');
    this.m_logger.info(JSON.stringify(hret.value));

    if (hret.value!.length === 0) {
      let hret1 = await kvVoteLasttime.hset(from, '0', 0);
      if (hret1.err) {
        return { err: hret1.err, value: '' };
      } else {
        return { err: ErrorCode.RESULT_OK, value: '0' };
      }
    }
    return { err: ErrorCode.RESULT_OK, value: hret.value![0].field };

  }
  public async getTicket(address: string): Promise<{ err: ErrorCode, value?: any }> {
    this.m_logger.info('Yang Jun -- into getTicket()');
    let kvVoteVote = (await this.m_voteDatabase.getReadableKeyValue(SVTContext.kvVoteVote)).kv! as SqliteStorageKeyValue;

    let hret = await kvVoteVote.hgetallbyname(address);
    if (hret.err) {
      console.log('getTicket wrong getallbyname')
      return { err: hret.err, value: {} };
    }

    // get last vote time
    let hret1 = await this.getVoteLasttime(address);
    if (hret1.err) {

      return { err: hret1.err, value: {} };
    }
    const epochtime = this.m_chain.epochTime * 1000;
    let nowtime: number = this.nGetTimeFromDueBlock(epochtime, parseInt(hret1.value!));

    let out = Object.create(null);
    out.timestamp = nowtime;
    out.amount = 0;
    out.candidates = [];

    for (let item of hret.value!) {
      // out.set(item.field, item.value);
      out.candidates.push(item.field);
      out.amount = item.value;
    }
    return { err: ErrorCode.RESULT_OK, value: out };
  }
  public async getStake(address: string): Promise<{ err: ErrorCode, stake?: any }> {
    this.m_logger.info('Yang Jun -- into svt::getStake()');
    let curBlock = this.m_chain.tipBlockHeader!.number;
    let out = Object.create(null);

    out.curBlock = curBlock;

    // get epoch_time

    const epochtime = this.m_chain.epochTime * 1000;
    console.log('epochtime:', epochtime);

    // get svt-deposit
    let kvSVTDeposit = (await this.m_svtDatabase.getReadableKeyValue(SVTContext.kvSVTDeposit)).kv! as SqliteStorageKeyValue;

    let hdps = await kvSVTDeposit.hgetallbyname(address);
    if (hdps.err) {
      console.log('search svt-deposit failed:', address);
      return { err: hdps.err };
    }
    console.log(hdps.value!);

    out.deposit = [];
    for (let p of hdps.value!) {
      let dueblock = parseInt(p.field);
      let duetime = this.nGetTimeFromDueBlock(epochtime, dueblock);
      out.deposit.push({ amount: parseInt(p.value), dueBlock: dueblock, dueTime: duetime });
    }

    // get svt-vote
    let kvSVTVote = (await this.m_svtDatabase.getReadableKeyValue(SVTContext.kvSVTVote)).kv! as SqliteStorageKeyValue;
    // 如果投票者的权益不够，则返回
    let her = await kvSVTVote.hgetallbyname(address);
    if (her.err) {
      console.log('search svt-vote faile:', address);
      return { err: her.err };
    }

    console.log(her.value!);

    out.vote = [];
    for (let p of her.value!) {
      let dueblock = parseInt(p.field);
      let duetime = this.nGetTimeFromDueBlock(epochtime, dueblock);
      out.vote.push({ amount: parseInt(p.value), dueBlock: dueblock, dueTime: duetime });
    }

    this.m_logger.info('Yang Jun -- getStake()');
    console.log(out);

    return { err: ErrorCode.RESULT_OK, stake: out };
  }
  protected async _getSvtInfo(from: string): Promise<{ err: ErrorCode, value?: any }> {
    let kvSvtInfo = (await this.m_svtDatabase.getReadableKeyValue(SVTContext.kvSVTInfo)).kv! as SqliteStorageKeyValue;

    let objs: any = Object.create(null);

    let hret = await kvSvtInfo.hgetallbyname(from);

    if (hret.err) {
      return { err: hret.err };
    }
    if (hret.value!.length === 0) { return { err: ErrorCode.RESULT_DB_RECORD_EMPTY }; }

    for (let p of hret.value!) {
      objs[p.field] = p.value;
    }
    return { err: ErrorCode.RESULT_OK, value: objs };
  }
  public async getCandidatesInfo(): Promise<{ err: ErrorCode, candidates?: any }> {

    let kvDPos = (await this.m_systemDatabase.getReadableKeyValue(SVTContext.kvDpos)).kv! as SqliteStorageKeyValue;


    console.log('Yang Jun -- getCandidatesInfo');

    let bVotedOrNot = false;
    let items;
    // check vote
    let gr = await kvDPos.hgetallbyname('vote');
    if (gr.err) {
      return { err: gr.err, candidates: {} };
    }
    let grc = await kvDPos.hgetallbyname('candidate');
    if (grc.err) {
      return { err: grc.err, candidates: {} }
    }

    if (gr.value!.length === 0) {
      bVotedOrNot = false;
      items = grc.value!;
    } else {
      bVotedOrNot = true;
      items = gr.value!;
    }

    let out = Object.create(null);
    out.curMiner = this.m_chain.m_curMiner;

    let candidates: any[] = [];


    for (let v of items) {
      let address = v.field;

      let hreturn = await this._getSvtInfo(address);
      if (hreturn.err) {
        return { err: hreturn.err, candidates: {} };
      }

      let option = hreturn.value! as IfRegisterOption;
      let amount1 =
        bVotedOrNot ?
          v.value.toString().substr(1) : '0';

      candidates.push({
        candidate: v.field,
        amount: amount1,
        name: option.name,
        ip: option.ip,
        url: option.url,
        location: option.location
      });
    }

    candidates = candidates.sort((a: any, b: any) => {
      let va = parseInt(a.amount);
      let vb = parseInt(b.amount);

      if (va > vb) {
        return 1;
      } else if (va === vb) {
        return 0;
      } else {
        return -1;
      }
    });
    out.candidates = candidates;

    return { err: ErrorCode.RESULT_OK, candidates: out };
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
