import { ErrorCode, stringifyErrorCode } from '../error_code';
import {DposChainTipStateOptions, DposChainTipState, DposBlockHeader} from '../dpos_chain';
import {DposBftBlockHeader, DposBftBlockHeaderSignature} from './block';
import * as libAddress from '../address';
import {LRUCache} from '../lib/LRUCache';

export class DposBftChainTipState extends DposChainTipState {
    protected m_bftLibSigns: DposBftBlockHeaderSignature[] = [];
    protected m_bftIrreversibleBlocknum: number = 0;
    protected m_bftIrreversibleBlockHash: string;
    protected m_hashMinerCache: LRUCache<string, string[]> = new LRUCache(10);

    constructor(options: DposChainTipStateOptions) {
        super(options);
        this.m_bftIrreversibleBlocknum = options.libHeader.number;
        this.m_bftIrreversibleBlockHash = options.libHeader.hash;
    }

    get bftIrreversibleBlockNum(): number {
        return this.m_bftIrreversibleBlocknum;
    }

    get dposIrreversibleBlockNum(): number {
        return super.irreversible;
    }

    get irreversible(): number {
        return this.m_bftIrreversibleBlocknum > this.m_irreversibleBlocknum ? this.m_bftIrreversibleBlocknum : this.m_irreversibleBlocknum;
    }

    get irreversibleHash(): string {
        return this.m_bftIrreversibleBlocknum > this.m_irreversibleBlocknum ? this.m_bftIrreversibleBlockHash : this.m_irreversibleBlockHash;
    }

    get bftSigns(): DposBftBlockHeaderSignature[] {
        return this.m_bftLibSigns;
    }

    public async updateTip(header: DposBftBlockHeader): Promise<ErrorCode> {
        let err = await super.updateTip(header);
        if (err) {
            return err;
        }

        await this.maybeNewBftIrreversibleNumber(header.bftSigns);

        return ErrorCode.RESULT_OK;
    }

    public async maybeNewBftIrreversibleNumber(minerSigns: DposBftBlockHeaderSignature[]): Promise<ErrorCode> {
        let hr = await this._maybeNewBftIrreversibleNumber(minerSigns);
        if (hr.err) {
            return hr.err;
        }

        if (hr.blib! > this.m_bftIrreversibleBlocknum) {
            this.m_bftIrreversibleBlocknum = hr.blib!;
            this.m_bftLibSigns = hr.signs!;
            this.m_bftIrreversibleBlockHash = hr.hash!;
        }

        return ErrorCode.RESULT_OK;
    }

    protected async _maybeNewBftIrreversibleNumber(signs: DposBftBlockHeaderSignature[]): Promise<{err: ErrorCode, blib?: number, hash?: string, signs?: DposBftBlockHeaderSignature[]}> {
        let hashCount: Map<string, number> = new Map();
        let maxCount = -1;
        let maxCountHeader: DposBftBlockHeader | undefined;
        for (let sign of signs) {
            let hr = await this.m_chain.getHeader(sign.hash);
            if (hr.err) {
                this.logger.info(`dpos_bft _maybeNewBftIrreversibleNumber get header failed errcode=${stringifyErrorCode(hr.err)}`);
                return { err: hr.err };
            }
            // if (hr.header!.preBlockHash !== this.irreversibleHash) {
            //     continue;
            // }
            let count = hashCount.get(sign.hash);
            if (!count) {
                count = 0;
            }
            count++;

            hashCount.set(sign.hash, count);
            if (count > maxCount) {
                maxCount = count;
                maxCountHeader = hr.header! as DposBftBlockHeader;
            }
        }

        if (!maxCountHeader) {
            return {err: ErrorCode.RESULT_NOT_FOUND};
        }

        let miners: string[] | null = this.m_hashMinerCache.get(maxCountHeader!.hash);
        if (!miners) {
            let hr1 = await this.m_chain.getMiners(maxCountHeader!);
            if (hr1.err) {
                this.logger.info(`dpos_bft _maybeNewBftIrreversibleNumber get miners failed errcode=${stringifyErrorCode(hr1.err)}`);
                return {err: hr1.err};
            }
            miners = hr1.creators!;
        }

        let minersSet: Set<string> = new Set(miners);
        let validSigns: DposBftBlockHeaderSignature[] = [];
        for (let sign of signs) {
            let address = libAddress.addressFromPublicKey(sign.pubkey)!;
            if (sign.hash === maxCountHeader!.hash && minersSet.has(address)) {
                validSigns.push(sign);
            }
        }

        let needConfireCount: number = Math.ceil(miners.length * 2 / 3);
        if (validSigns.length < needConfireCount) {
            return {err: ErrorCode.RESULT_NOT_ENOUGH};
        }

        return {err: ErrorCode.RESULT_OK, blib: maxCountHeader.number, hash: maxCountHeader.hash, signs: validSigns};
    }

    protected toJsonData(): any {
        let d = super.toJsonData();
        d.bft_irreversible_blocknum = this.m_bftIrreversibleBlocknum;
        return d;
    }
}