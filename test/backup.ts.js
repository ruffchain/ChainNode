import { IReadWritableDatabase } from '../chain';
import { LoggerInstance } from 'winston';
import { DposChain } from './chain';
import { BigNumber, ErrorCode } from '..';
import assert = require('assert');

// This is used to query SVT, Vote, Dpos table at once
// Added by Yang Jun 2019-5-20

export function computeDueBlock(curBlock: number, blockInterval: number, mortgageBlock: number): number {
  let sixHours = 6 * 3600 / blockInterval;
  return (Math.round(curBlock / sixHours) + 1) * sixHours + mortgageBlock;
}

export type SVTContextOptions = {
  dposDatabase: IReadWritableDatabase,
  svtDatabase: IReadWritableDatabase,
  voteDatabase: IReadWritableDatabase,
  globalOptions: any,
  logger: LoggerInstance,
  chain: DposChain
}

export class SVTContext {
  protected m_dposDatabase: IReadWritableDatabase;
  protected m_svtDatabase: IReadWritableDatabase;
  protected m_voteDatabase: IReadWritableDatabase;
  protected m_globalOptions: any;
  protected m_logger: LoggerInstance;
  protected m_chain: DposChain;

  constructor(options: SVTContextOptions) {
    this.m_dposDatabase = options.dposDatabase;
    this.m_svtDatabase = options.svtDatabase;
    this.m_voteDatabase = options.voteDatabase;
    this.m_globalOptions = options.globalOptions;
    this.m_logger = options.logger;
    this.m_chain = options.chain;
  }

  get dposDatabase(): IReadWritableDatabase {
    return this.m_dposDatabase;
  }
  get svtDatabase(): IReadWritableDatabase {
    return this.m_svtDatabase;
  }
  get voteDatabase(): IReadWritableDatabase {
    return this.m_voteDatabase;
  }
  // Added by Yang Jun
  public static kvSVTVote = 'vote';
  public static kvSVTDeposit = 'deposit';
  public static kvSVTFree = 'free'; // Use it only when it can be transfered

  public static kvVoteVote = 'vote';

  public static kvDpos = 'dpos';
  public static kvDposVote = 'vote';

  // Added by Yang Jun 2019-5-20
  async mortgage(chain: DposChain, from: string, amount: BigNumber): Promise<{ err: ErrorCode, returnCode?: ErrorCode }> {
    assert(amount.gt(0), 'amount must positive');

    let curBlock = chain.tipBlockHeader!.number;
    let UNMORTGAGE_PERIOD = chain.globalOptions.mortgagePeriod;
    let BLOCK_INTERVAL = chain.globalOptions.blockInterval;

    let dueBlock = computeDueBlock(curBlock, BLOCK_INTERVAL, UNMORTGAGE_PERIOD);

    let kvSvtVote = (await this.svtDatabase.getReadWritableKeyValue(SVTContext.kvSVTVote)).kv!;

    let stakeInfo = await kvSvtVote.hget(from, dueBlock.toString());
    let stake: BigNumber = stakeInfo.err === ErrorCode.RESULT_OK ? stakeInfo.value : new BigNumber(0);
    await kvSvtVote.hset(from, dueBlock.toString(), stake.plus(amount));

    await this._updatevote(from, amount);

    return { err: ErrorCode.RESULT_OK, returnCode: ErrorCode.RESULT_OK };
  }
  protected async _updatevote(voter: string, amount: BigNumber): Promise<ErrorCode> {
    // update Vote table
    let kvVote = (await this.voteDatabase.getReadWritableKeyValue(SVTContext.kvVoteVote)).kv!;

    let kvDPos = (await this.dposDatabase.getReadWritableKeyValue(SVTContext.kvDpos)).kv!;

    let voterInfo = await kvVote.hgetallbyname(voter);
    if (voterInfo.err === ErrorCode.RESULT_OK) {
      let producers = voterInfo.value!;
      for (let p of producers) {
        let voteItem = await kvVote.hget(voter, p.field);
        let valueToPass;

        if (voteItem.err === ErrorCode.RESULT_OK) {
          let vote: BigNumber = voteItem.value!.plus(amount);
          if (vote.eq(0)) {
            await kvVote.hdel(voter, p.field);
          } else {
            await kvVote.hset(voter, p.field, vote);

          }
        } else {
          assert(amount.gt(0), '_updatevote amount must positive');
          await kvVote.hset(voter, p.field, amount);
        }
        // update dpos table
        let voteSum = await kvDPos.hget(SVTContext.kvDposVote, p.field);
        if (voteSum.err === ErrorCode.RESULT_OK) {
          let vote: BigNumber = voteSum.value!.plus(amount);
          if (vote.eq(0)) {
            await kvDPos.hdel(SVTContext.kvDposVote, p.field);
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

}
