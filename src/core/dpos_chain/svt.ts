import { IReadWritableDatabase } from '../chain';
import { LoggerInstance } from 'winston';
import { DposChain } from './chain';
import { BigNumber, ErrorCode, Chain, IReadableDatabase, fromStringifiable } from '..';
import assert = require('assert');
import { SqliteStorage, SqliteReadWritableDatabase, SqliteStorageKeyValue, SqliteReadableDatabase } from '../storage_sqlite/storage';
import { BanStatus } from './consensus';
// import { SqliteStorageKeyValue } from '../storage_sqlite/storage';

// This is used to query SVT, Vote, Dpos table at once
// Added by Yang Jun 2019-5-20

export function computeDueBlock(curBlock: number, blockInterval: number, mortgageBlock: number): number {
  let sixHours = 0.1 * 3600 / blockInterval;
  return (Math.round(curBlock / sixHours) + 1) * sixHours + mortgageBlock;
}

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

  // Add by Yang Jun 2019-5-21
  async unmortgage(from: string, amount: BigNumber): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    assert(amount.gt(0), 'amount must positive');

    let curBlock = this.m_chain.tipBlockHeader!.number;
    let UNMORTGAGE_PERIOD = this.m_chain.globalOptions.mortgagePeriod;

    console.log('Yang Jun -- unmortgage');
    console.log('curBlock:', curBlock, ' unmortgage period:', UNMORTGAGE_PERIOD);

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
        let stake: BigNumber = voteItem.value!;
        let hisDueBlock = parseInt(fromStringifiable(voteItem.field));
        console.log('hisDueBlock:', hisDueBlock);

        if (curBlock > hisDueBlock) {
          effectiveAmount.plus(stake);
        }
      }
      console.log('effectiveAmount:', effectiveAmount.toString());
      console.log('amount:', amount.toString());
      // 
      if (effectiveAmount.lt(amount)) {
        console.log('Yang Jun -- effectiveAmount less than amount');
        return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_TIME_NOT_DUE };
      } else {

      }
      let sumAll: BigNumber = amount;
      for (let voteItem of items) {
        let stake: BigNumber = voteItem.value!;
        // let hisDueBlock = parseInt(voteItem.field);
        console.log('Yang Jun -- stake:', stake.toString());

        if (stake.gt(sumAll)) {
          await kvSvtVote.hset(from, voteItem.field, stake.minus(sumAll));
          break;
        } else if (stake.lt(sumAll)) {
          await kvSvtVote.hdel(from, voteItem.field);
          sumAll.minus(stake);
        } else {
          await kvSvtVote.hdel(from, voteItem.field);
          break;
        }
      }
    }

    await this._updatevote(from, (new BigNumber(0)).minus(amount));

    return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK };
  }

  // Added by Yang Jun 2019-5-20
  async mortgage(from: string, amount: BigNumber): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    assert(amount.gt(0), 'amount must positive');

    let curBlock = this.m_chain.tipBlockHeader!.number;
    let UNMORTGAGE_PERIOD = this.m_chain.globalOptions.mortgagePeriod;
    let BLOCK_INTERVAL = this.m_chain.globalOptions.blockInterval;

    console.log('Yang Jun -- mortgage');
    console.log('curBlock:', curBlock, ' unortgage period:', UNMORTGAGE_PERIOD);

    let dueBlock = computeDueBlock(curBlock, BLOCK_INTERVAL, UNMORTGAGE_PERIOD);
    console.log('dueBlock:', dueBlock);

    let kvSvtVote = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTVote)).kv!;

    // kvSvtVote.hset(from, '0', 1000);
    // console.log('write into svt vote');

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

    await this._updatevote(from, amount);

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

        // if (newvote.eq(0)) {
        //   await 
        // } else {
        await kvVote.hset(voter, p.field, newvote);
        // }

        // 只能添加，不可能减少
        let voteSum = await kvDPos.hget(SVTContext.kvDposVote, p.field);

        if (voteSum.err === ErrorCode.RESULT_OK) {
          let vote: BigNumber = voteSum.value!.plus(amount);
          if (vote.eq(0)) {
            await kvVote.hdel(SVTContext.kvDposVote, p.field);
          } else {
            await kvVote.hset(SVTContext.kvDposVote, p.field, vote);

          }

        } else if (voteSum.err === ErrorCode.RESULT_NOT_FOUND) {
          assert(amount.gt(0), '_updatevote amount must positive');
          await kvDPos.hset(SVTContext.kvDposVote, p.field, amount);
        }
      }
    }

    return ErrorCode.RESULT_OK;
  }
  public async register(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    // 如果已经是候选人的话，则退出
    let kvDPos = (await this.m_systemDatabase.getReadWritableKeyValue(SVTContext.kvDpos)).kv!;

    let her = await kvDPos.hexists('candidate', from);

    if (her.err) {
      return { err: her.err };
    }
    // true
    if (her.value) {
      return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK };
    }
    await kvDPos.hset('candidate', from, BanStatus.NoBan);

    // 在SVT-depoist里面添加, 不再检测是否存在
    let curBlock = this.m_chain.tipBlockHeader!.number;
    let UNMORTGAGE_PERIOD = this.m_chain.globalOptions.depositPeriod;
    let BLOCK_INTERVAL = this.m_chain.globalOptions.blockInterval;

    console.log('Yang Jun -- register');
    console.log('curBlock:', curBlock, ' unortgage period:', UNMORTGAGE_PERIOD);

    let dueBlock = computeDueBlock(curBlock, BLOCK_INTERVAL, UNMORTGAGE_PERIOD);
    console.log('dueBlock:', dueBlock);

    let kvSvtVote = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTDeposit)).kv!;

    await kvSvtVote.hset(from, dueBlock.toString(), this.m_chain.globalOptions.depositAmount);

    return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK };

  }
  public async unregister(from: string): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    // 查看svt-deposit记录，看时间上是否到期
    let curBlock = this.m_chain.tipBlockHeader!.number;
    let UNMORTGAGE_PERIOD = this.m_chain.globalOptions.depositPeriod;
    let BLOCK_INTERVAL = this.m_chain.globalOptions.blockInterval;
    console.log('Yang Jun -- register');
    console.log('curBlock:', curBlock, ' unortgage period:', UNMORTGAGE_PERIOD);

    let kvSvtVote = (await this.m_svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTDeposit)).kv! as SqliteStorageKeyValue;

    let her = await kvSvtVote.hgetallbyname(from);

    if (her.err) {
      return { err: her.err, returnCode: her.err };
    }
    if (!her.value) {
      return { err: ErrorCode.RESULT_NOT_FOUND, returnCode: ErrorCode.RESULT_NOT_FOUND }
    }
    let item = her.value[0];
    let dueBlock = parseInt(fromStringifiable(item.field));
    if (dueBlock > curBlock) {
      return { err: ErrorCode.RESULT_TIME_NOT_DUE, returnCode: ErrorCode.RESULT_TIME_NOT_DUE };
    }
    await kvSvtVote.hdel(item.name, item.field);

    // 清除svt-deposit, 清除 system#dpos中的candidates记录
    let kvDPos = (await this.m_systemDatabase.getReadWritableKeyValue(SVTContext.kvDpos)).kv!;
    let hcand = await kvDPos.hexists('candidate', from);
    if (hcand.err) {
      return { err: hcand.err };
    }
    // true
    if (hcand.value) {
      await kvDPos.hdel('candidate', from);
    } else {
      return { err: ErrorCode.RESULT_NOT_FOUND, returnCode: ErrorCode.RESULT_NOT_FOUND };
    }
    // 更新投票的票仓, Vote-vote
    await this._updatevotee(from);

    return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK };
  }
}
/// SVTViewContext definitions
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

  public async getStake(address: string): Promise<{ err: ErrorCode, stake?: any }> {
    console.log('Yang Jun -- into svt::getStake()');
    let curBlock = this.m_chain.tipBlockHeader!.number;
    let out = Object.create(null);

    out.curBlock = curBlock;

    let kvSVTDeposit = (await this.m_svtDatabase.getReadableKeyValue(SVTContext.kvSVTDeposit)).kv! as SqliteStorageKeyValue;

    let hdps = await kvSVTDeposit.hgetallbyname(address);
    if (hdps.err) {
      return { err: hdps.err };
    }

    out.deposit = [];
    for (let p of hdps.value!) {
      out.deposit.push({ amount: p.value, dueBlock: p.field });
    }

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
}
