import {ErrorCode} from '../error_code';
import {LRUCache} from '../lib/LRUCache';
import {DposChainTipState, DposChainTipStateOptions} from './chain_state';
import {DposBlockHeader} from './block';

export class DposChainTipStateCreator {
    public createChainTipState(options: DposChainTipStateOptions): DposChainTipState {
        return new DposChainTipState(options);
    }
}

export type DposChainTipStateManagerOptions = DposChainTipStateOptions & {
    creator: DposChainTipStateCreator
};

export class DposChainTipStateManager {
    public static cacheSize: number = 500;
    protected m_options: DposChainTipStateManagerOptions;
    protected m_tipStateCache: LRUCache<string, DposChainTipState> = new LRUCache(DposChainTipStateManager.cacheSize);
    protected m_bestChainTipState: DposChainTipState ;

    constructor(options: DposChainTipStateManagerOptions) {
        this.m_options = options;
        this.m_bestChainTipState = this.m_options.creator.createChainTipState(this.m_options);
        this.m_tipStateCache.set(this.m_options.libHeader.hash, this.m_bestChainTipState);
    }

    public getBestChainState(): DposChainTipState {
        return this.m_bestChainTipState;
    }

    public async init(): Promise<ErrorCode> {
        let tipNumber = this.m_options.chain.tipBlockHeader ? this.m_options.chain.tipBlockHeader!.number : 0;
        if (tipNumber === 0) {
            return ErrorCode.RESULT_OK;
        }
        return await this.buildChainStateOnBest(tipNumber);
    }

    public async updateBestChainTip(header: DposBlockHeader): Promise<{ err: ErrorCode, state?: DposChainTipState }> {
        // 可能分叉了 已经切换分支了，所以需要从fork上去bulid
        let hr = await this.buildChainStateOnFork(header);
        if (hr.err) {
            return hr;
        }

        this.m_bestChainTipState = hr.state!;
        
        return hr;
    }

    public async compareIrreversibleBlockNumer(compareHeader: DposBlockHeader, specilHeader: DposBlockHeader): Promise<{err: ErrorCode, result?: number}> {
        if (compareHeader.preBlockHash === specilHeader.hash) {
            return {err: ErrorCode.RESULT_OK, result: 0};
        }
        
        let hrSpecil = await this.buildChainStateOnFork(specilHeader);
        if (hrSpecil.err) {
            return {err: hrSpecil.err};
        }

        // compareHeader没有和specilHeader在specil的lib处相交，那么compareHeader的lib一定小于specilHeader的
        let prev: string = compareHeader.hash;
        let n = compareHeader.number;
        while (n >= hrSpecil.state!.irreversible) {
            let hr = await this.m_options.chain.getHeader(prev);
            if (hr.err) {
                return { err: hr.err };
            }

            if (prev === hrSpecil.state!.irreversibleHash) {
                break;
            }

            prev = hr.header!.preBlockHash;
            n--;
        }

        if (n > hrSpecil.state!.irreversible) {
            return { err: ErrorCode.RESULT_OK, result: -1 };
        }

        let hrCompare = await this.buildChainStateOnFork(compareHeader);
        if (hrCompare.err) {
            return { err: hrCompare.err };
        }
        if (hrSpecil.state!.irreversible === hrCompare.state!.irreversible) {
            return { err: ErrorCode.RESULT_OK, result: 0 };
        }

        return { err: ErrorCode.RESULT_OK, result: hrCompare.state!.irreversible - hrSpecil.state!.irreversible };
    }

    protected async buildChainStateOnBest(toIndex: number): Promise<ErrorCode> {
        let state = this.m_bestChainTipState;
        let beginIndex: number = state.tip.number + 1;
        if (toIndex < beginIndex) {
            this.m_options.chain.logger.error(`buildChainStateOnBest param error according to number, toIndex ${toIndex} beginIndex ${beginIndex}`);
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        
        // header必须要通过number去getHeader一次，确保在bestchain上面
        for (let i = beginIndex; i <= toIndex; i++) {
            let hr = await this.m_options.chain.getHeader(i);
            if (hr.err) {
                this.m_options.chain.logger.error(`buildChainStateOnBest get header error according to number, err = ${hr.err}`);
                return hr.err;
            }

            let err = await state.updateTip(hr.header! as DposBlockHeader);
            if (err) {
                this.m_options.chain.logger.error(`buildChainStateOnBest updateTip error according to number, err = ${err}`);
                return err;
            }
        }
        this.m_bestChainTipState = state; 

        return ErrorCode.RESULT_OK;
    }

    protected async buildChainStateOnFork(header: DposBlockHeader): Promise<{ err: ErrorCode, state?: DposChainTipState }> {
        this.m_tipStateCache.set(this.m_bestChainTipState.tip.hash, this.m_bestChainTipState);
        let s = this.m_tipStateCache.get(header.hash);
        if (s) {
            return {err: ErrorCode.RESULT_OK, state: s}; // --------------------------------------------
        }
        // 可能冲best上面，也可能是重其他fork上面,只能按照hash查找
        let headers: DposBlockHeader[] = [];
        // 分支一定是从当前链的最后一个不可逆点或者它之后的点开始复制的，否则不需要创建
        let newState = this.m_options.creator.createChainTipState(this.m_options);
        while (true) {
            if (header.number < this.m_bestChainTipState.irreversible) {
                this.m_options.chain.logger.error(`buildChainStateOnFork failed, for the fork and best's crossed block number is less than the best's irreversible`);
                return {err: ErrorCode.RESULT_INVALID_PARAM};
            }
            let cacheState: DposChainTipState | null = this.m_tipStateCache.get(header.hash);
            if (cacheState ) { // 需要确认相交点
                this.m_tipStateCache.remove(header.hash);
                newState = cacheState;
                break;
            }

            if (header.number === this.m_bestChainTipState.irreversible && header.hash === this.m_bestChainTipState.irreversibleHash) {
                let hr1 = await this.m_options.chain.getHeader(this.m_bestChainTipState.irreversibleHash);
                if (hr1.err) {
                    this.m_options.chain.logger.error(`buildChainStateOnFork failed, get header failed,errcode=${hr1.err},hash=${this.m_bestChainTipState.irreversibleHash}`);
                    return { err: hr1.err };
                }
                let hr2 = await this.m_options.chain.getMiners(hr1.header! as DposBlockHeader);
                if (hr2.err) {
                    this.m_options.chain.logger.error(`buildChainStateOnFork failed, get miners failed,errcode=${hr2.err}, hash=${this.m_bestChainTipState.irreversibleHash}`);
                    return {err: hr2.err};
                }
                newState = this.m_options.creator.createChainTipState({libHeader: hr1.header! as DposBlockHeader, libMiners: hr2.creators!, chain: this.m_options.chain, globalOptions: this.m_options.globalOptions});
                break;
            }

            headers.unshift(header);

            let hr = await this.m_options.chain.getHeader(header.preBlockHash);
            if (hr.err) {
                this.m_options.chain.logger.error(`buildChainState get header error according to hash, err = ${hr.err}`);
                return { err: hr.err };
            }
            header = hr.header! as DposBlockHeader;
        }

        for (let h of headers) {
            let err = await newState.updateTip(h);
            if (err) {
                this.m_options.chain.logger.error(`buildChainState updateTip error according to number, err = ${err}`);
                return { err };
            }
        }

        this.m_tipStateCache.set(header.hash, newState);
        return { err: ErrorCode.RESULT_OK, state: newState};
    }
}