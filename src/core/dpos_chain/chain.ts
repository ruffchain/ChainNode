import { BigNumber } from 'bignumber.js';

import { ErrorCode } from '../error_code';

import {Block} from '../chain/block';
import { IReadableStorage, Storage } from '../storage/storage';
import * as ValueChain from '../value_chain/chain';
import {ValueContext, BlockExecutor} from '../value_chain/executor';

import { BlockHeader } from './block';
import * as DPOSConsensus from './consensus';

import {ViewExecutor} from '../executor/view';
import * as DPOSBlockExecutor from './executor';



export type TransactionContext = {
    vote: (from: string, candiates: string)=>Promise<ErrorCode>;
    mortgage: (from: string, amount: BigNumber) => Promise<ErrorCode>;
    unmortgage: (from: string, amount: BigNumber) => Promise<ErrorCode>;
    register: (from: string) => Promise<ErrorCode>;
} & ValueChain.TransactionContext;

export type EventContext = {
    vote: (from: string, candiates: string)=>Promise<ErrorCode>;
    mortgage: (from: string, amount: BigNumber) => Promise<ErrorCode>;
    unmortgage: (from: string, amount: BigNumber) => Promise<ErrorCode>;
    register: (from: string) => Promise<ErrorCode>;
} & ValueChain.EventContext;

export type ViewContext = {
    getVote: () => Promise<Map<string, BigNumber> >;
    getStoke: (address: string) => Promise<BigNumber>;
    getCandidates: () => Promise<string[]>;
} & ValueChain.ViewContext;

export type ChainOptions = ValueChain.ChainOptions;

export class Chain extends ValueChain.Chain {
    constructor(param: ChainOptions) {
        super(param);
    }

    public async newBlockExecutor(block: Block, storage: Storage): Promise<{err: ErrorCode, executor?: BlockExecutor}> {
        let kvBalance = (await storage.getReadWritableKeyValue(Chain.kvBalance)).kv!;

        let ve = new ValueContext(kvBalance);
        let externalContext = Object.create(null);
        externalContext.getBalance = async (address: string): Promise<BigNumber> => {
            return await ve.getBalance(address);
        };
        externalContext.transferTo = async (address: string, amount: BigNumber): Promise<ErrorCode> => {
            return await ve.transferTo(Chain.sysAddress, address, amount);
        };
        
        let de = new DPOSConsensus.Context();
        externalContext.vote = async (from: string, candiates: string[]): Promise<ErrorCode> => {
            let vr = await de.vote(storage, from, candiates);
            if (vr.err) {
                throw new Error();
            }
            return vr.returnCode!;
        };
        externalContext.mortgage = async (from: string, amount: BigNumber): Promise<ErrorCode> => {
            let mr = await de.mortgage(storage, from, amount);
            if (mr.err) {
                throw new Error();
            }

            return mr.returnCode!;
        };
        externalContext.unmortgage = async (from: string, amount: BigNumber): Promise<ErrorCode> => {
            let mr = await de.unmortgage(storage, from, amount);
            if (mr.err) {
                throw new Error();
            }

            return mr.returnCode!;
        }
        externalContext.register = async (from: string): Promise<ErrorCode> => {
            let mr = await de.registerToCandidate(storage, from);
            if (mr.err) {
                throw new Error();
            }

            return mr.returnCode!;
        };
        externalContext.getVote = async (): Promise<Map<string, BigNumber> > => {
            let gvr = await de.getVote(storage);
            if (gvr.err) {
                throw new Error();
            }
            return gvr.vote!;
        };
        externalContext.getStoke = async (address: string): Promise<BigNumber> => {
            let gsr = await de.getStoke(storage, address);
            if (gsr.err) {
                throw new Error();
            }
            return gsr.stoke!;
        };
        externalContext.getCandidates = async (): Promise<string[]> => {
            let gc = await de.getCandidates(storage);
            if (gc.err) {
                throw Error();
            }

            return gc.candidates!;
        };

        let executor = new DPOSBlockExecutor.BlockExecutor({block, storage, handler: this.m_options.handler, externContext: externalContext});
        return {err: ErrorCode.RESULT_OK, executor: executor};
    }

    public async newViewExecutor(header: BlockHeader, storage: IReadableStorage, method: string, param: Buffer|string|number|undefined,): Promise<{err: ErrorCode, executor?: ViewExecutor}> {
        let nvex = await super.newViewExecutor(header, storage, method, param);

        let externalContext = nvex.executor!.externContext;
        
        let de = new DPOSConsensus.Context();
       
        externalContext.getVote = async (): Promise<Map<string, BigNumber> > => {
            let gvr = await de.getVote(storage);
            if (gvr.err) {
                throw new Error();
            }
            return gvr.vote!;
        };
        externalContext.getStoke = async (address: string): Promise<BigNumber> => {
            let gsr = await de.getStoke(storage, address);
            if (gsr.err) {
                throw new Error();
            }
            return gsr.stoke!;
        };
        externalContext.getCandidates = async (): Promise<string[]> => {
            let gc = await de.getCandidates(storage);
            if (gc.err) {
                throw Error();
            }

            return gc.candidates!;
        };

        return nvex;
    }


    protected async _compareWork(left: BlockHeader, right: BlockHeader): Promise<{err: ErrorCode, result?: number}> {
        // 更长的链优先
        let height = left.number - right.number;
        if (height !== 0) {
            return {err: ErrorCode.RESULT_OK, result: height};
        }
        // 高度相同更晚的优先
        let tir = await left.getTimeIndex(this);
        if (tir.err) {
            return {err: tir.err};
        }
        let leftIndex = tir.index!;
        tir = await right.getTimeIndex(this);
        if (tir.err) {
            return {err: tir.err};
        }
        let rightIndex = tir.index!;
        let time = leftIndex - rightIndex;
        if (time !== 0) {
            return {err: ErrorCode.RESULT_OK, result: time};
        }
        // 时间戳都相同， 就算了， 很罕见吧， 随缘
        return {err: ErrorCode.RESULT_OK, result: time}; 
    }


    public async getMiners(header: BlockHeader): Promise<{err: ErrorCode, header?: BlockHeader, creators?: string[]}> {
        let denv = new DPOSConsensus.ViewContext();

        let en = DPOSConsensus.ViewContext.getElectionBlockNumber(header.number);
        let electionHeader: BlockHeader;
        let hash: string;
        if (en === header.number) {
            electionHeader = header;
            hash = header.hash;
        } else {
            let hr = await this.getHeader(en);
            if (hr.err) {
                return { err: hr.err };
            }
            electionHeader = <BlockHeader>hr.header
            hash = header.preBlockHash;
        }

        let sr = await this.storageManager.getSnapshotView(hash);
        let gcr = await denv.getNextMiners(sr.storage!);
        this.storageManager.releaseSnapshotView(hash);
        if (gcr.err) {
            return gcr;
        }
        
        return {
            err: ErrorCode.RESULT_OK,
            header: electionHeader,
            creators: gcr.creators!
        };
    }

    protected _getBlockHeaderType(): new () => BlockHeader {
        return BlockHeader;
    }
}