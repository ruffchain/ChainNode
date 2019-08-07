import {ErrorCode, stringifyErrorCode} from '../error_code';
import {LRUCache} from '../lib/LRUCache';
import { LoggerInstance } from '../lib/logger_util';

import { IHeaderStorage, BlockHeader } from '../chain';

import {DposChainTipState, DposChainTipStateOptions} from './chain_state';
import {DposBlockHeader} from './block';
const assert = require('assert');

export type StorageIrbEntry = {
    tipHash: string,
    irbHash: string,
    irbHeight: number
};
export interface IChainStateStorage {
    saveIRB(header: DposBlockHeader, irbHeader: DposBlockHeader): Promise<ErrorCode>;
    getIRB(blockHash: string): Promise<{err: ErrorCode, irb?: StorageIrbEntry}>;
}

export type DposChainTipStateManagerOptions = {
    logger: LoggerInstance,
    headerStorage: IHeaderStorage,
    getMiners: (header: DposBlockHeader) => Promise<{err: ErrorCode, creators?: string[]}>;
    globalOptions: any;
    stateStorage: IChainStateStorage;
};

export class DposChainTipStateManager {
    public static cacheSize: number = 500;
    protected m_headerStorage: IHeaderStorage;
    protected m_logger: LoggerInstance;
    protected m_globalOptions: any;
    protected m_getMiners: (header: DposBlockHeader) => Promise<{err: ErrorCode, creators?: string[]}>;
    protected m_tipStateCache: LRUCache<string, DposChainTipState> = new LRUCache(DposChainTipStateManager.cacheSize);
    protected m_bestTipState?: DposChainTipState ;
    protected m_prevBestIRB?: BlockHeader;
    protected m_storage: IChainStateStorage;

    constructor(options: DposChainTipStateManagerOptions) {
        this.m_headerStorage = options.headerStorage;
        this.m_logger = options.logger;
        this.m_globalOptions = options.globalOptions;
        this.m_getMiners = options.getMiners;
        this.m_storage = options.stateStorage;
    }

    getBestChainState(): DposChainTipState {
        return this.m_bestTipState!;
    }

    protected _newChainTipState(libHeader: DposBlockHeader): DposChainTipState {
        return new DposChainTipState({
            logger: this.m_logger,
            globalOptions: this.m_globalOptions,
            getMiners: this.m_getMiners,
            headerStorage: this.m_headerStorage,
            libHeader
        });
    }

    async init(): Promise<ErrorCode> {
        let hr = await this.m_headerStorage.getHeader(0);
        if (hr.err) {
            this.m_logger.error(`chain tip state manager init failed for get genesis header failed ${stringifyErrorCode(hr.err)}`);
            return hr.err;
        }
        const genesisHeader = hr.header! as DposBlockHeader;
        this.m_bestTipState = this._newChainTipState(genesisHeader);
        this.m_tipStateCache.set(genesisHeader.hash, this.m_bestTipState);
        this.m_prevBestIRB = genesisHeader;
        return ErrorCode.RESULT_OK;
    }

    async onUpdateTip(header: DposBlockHeader): Promise<{ err: ErrorCode, state?: DposChainTipState }> {
        if (this.m_bestTipState!.IRB.number === 0 && header.number > 1) {
            // 可能是第一次初始化
            let gi = await this.m_storage.getIRB('latest');
            if (!gi.err) {
                let gh = await this.m_headerStorage.getHeader(gi.irb!.irbHash);
                if (gh.err) {
                    this.m_logger.error(`onUpdateTip failed, for get irb header failed, e=${stringifyErrorCode(gh.err)}`);
                    return { err: gh.err };
                }

                this.m_bestTipState = this._newChainTipState(gh.header! as DposBlockHeader);
                this.m_tipStateCache.set(header.hash, this.m_bestTipState);
                this.m_prevBestIRB = gh.header!;
            }
        }
        // 可能分叉了 已经切换分支了，所以需要从fork上去bulid
        let hr = await this._getState(header);
        if (hr.err) {
            return hr;
        }

        this.m_bestTipState = hr.state!;
        let err = await this._onUpdateBestIRB();
        if (err) {
            return {err};
        }

        return hr;
    }

    async compareIRB(compareHeader: DposBlockHeader, tipHeader: DposBlockHeader): Promise<{err: ErrorCode, result?: number}> {
        if (compareHeader.preBlockHash === tipHeader.hash) {
            return {err: ErrorCode.RESULT_OK, result: 0};
        }
        assert(this.m_bestTipState!.tip === tipHeader, `best tip.number=${this.m_bestTipState!.tip.number}, tipHeader.number=${tipHeader.number}`);
        if (this.m_bestTipState!.tip !== tipHeader) {
            return {err: ErrorCode.RESULT_NOT_FOUND};
        }
        const bestTipState = this.m_bestTipState!;
        // compareHeader没有和specilHeader在specil的lib处相交，那么compareHeader的lib一定小于specilHeader的
        let prev: string = compareHeader.hash;
        let n = compareHeader.number;
        while (n >= bestTipState.IRB.number) {
            let hr = await this.m_headerStorage!.getHeader(prev);
            if (hr.err) {
                return { err: hr.err };
            }

            if (prev === bestTipState!.IRB.hash) {
                break;
            }

            prev = hr.header!.preBlockHash;
            n--;
        }

        if (n > bestTipState.IRB.number) {
            return { err: ErrorCode.RESULT_OK, result: -1 };
        }

        let hrCompare = await this._getState(compareHeader);
        if (hrCompare.err) {
            return { err: hrCompare.err };
        }
        if (bestTipState.IRB.number === hrCompare.state!.IRB.number) {
            return { err: ErrorCode.RESULT_OK, result: 0 };
        }

        return { err: ErrorCode.RESULT_OK, result: hrCompare.state!.IRB.number - bestTipState.IRB.number };
    }

    protected async _onUpdateBestIRB(): Promise<ErrorCode> {
        if (!this.m_prevBestIRB || this.m_prevBestIRB.hash !== this.getBestChainState().IRB.hash) {
            this.m_prevBestIRB = this.getBestChainState().IRB;
            return await this.m_storage.saveIRB(this.getBestChainState().tip, this.getBestChainState().IRB);
        }

        return ErrorCode.RESULT_OK;
    }

    protected async _getState(header: DposBlockHeader): Promise<{ err: ErrorCode, state?: DposChainTipState }> {
        let s = this.m_tipStateCache.get(header.hash);
        if (s) {
            return {err: ErrorCode.RESULT_OK, state: s};
        }
        // 分支一定是从当前链的最后一个不可逆点或者它之后的点开始复制的，否则不需要创建
        const bestTipState = this.m_bestTipState!;
        if (header.number < bestTipState!.IRB.number) {
            this.m_logger.error(`_getState failed, for the fork and best's crossed block number is less than the best's irreversible`);
            return {err: ErrorCode.RESULT_OUT_OF_LIMIT};
        }
        this.m_logger.debug(`IRB number: ${bestTipState.IRB.number}`);
        const hr = await this.m_headerStorage.getHeader(header, bestTipState.IRB.number - header.number);
        if (hr.err) {
            this.m_logger.error(`_getState getHeader of ${header.number} ${header.hash} on irb ${bestTipState.IRB.number} ${bestTipState.IRB.hash} failed for ${stringifyErrorCode(hr.err)}`);
            return {err: ErrorCode.RESULT_EXCEPTION};
        }
        if (hr.header!.hash !== bestTipState.IRB.hash) {
            this.m_logger.error(`_getState failed, for header ${header.number} ${header.hash} not fork from irb ${bestTipState.IRB.number} ${bestTipState.IRB.hash}`);
            return {err: ErrorCode.RESULT_OUT_OF_LIMIT};
        }
        let newState: DposChainTipState|undefined;
        let fromIndex = hr.headers!.length - 1;
        for (; fromIndex >= 0; --fromIndex) {
            const thisHeader = hr.headers![fromIndex];
            let cacheState: DposChainTipState | null = this.m_tipStateCache.get(thisHeader.hash);
            if (cacheState ) {
                newState = cacheState;
                this.m_tipStateCache.remove(thisHeader.hash);
                this.m_logger.debug(`Find cache for hash: ${thisHeader.hash} number: ${thisHeader.number}`);
                // 另一种方案是clone当前的
                // newState = cacheState.clone();
                break;
            }
        }

        if (!newState) {
            newState = this._newChainTipState(bestTipState.IRB);
            this.m_logger.error('#### Set fromIndex to 1');
            fromIndex = 1;
        } else {
            fromIndex += 1;
        }
        this.m_logger.debug(`fromIndex is ${fromIndex}, length is ${hr.headers!.length}`);
        const passedHeaders = hr.headers!.slice(fromIndex);
        for (let h of passedHeaders) {
            this.m_logger.debug(`update tip for ${h.number} hash ${h.hash}`);
            let err = await newState.updateTip(h as DposBlockHeader);
            if (err) {
                this.m_logger.error(`_getState updateTip error according to number, err = ${err}`);
                return { err };
            }
        }

        this.m_tipStateCache.set(header.hash, newState);
        return { err: ErrorCode.RESULT_OK, state: newState};
    }
}
