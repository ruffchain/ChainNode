import { ErrorCode, stringifyErrorCode } from '../error_code';
import { DposChainTipStateOptions, DposChainTipState, DposBlockHeader } from '../dpos_chain';
import { DposBftBlockHeader, DposBftBlockHeaderSignature } from './block';
import * as libAddress from '../address';
import { LRUCache } from '../lib/LRUCache';

export class DposBftChainTipState extends DposChainTipState {
    protected m_bftLibSigns: DposBftBlockHeaderSignature[] = [];
    protected m_bftIRB: DposBftBlockHeader;
    protected m_hashMinerCache: LRUCache<string, string[]> = new LRUCache(10);

    // added by Yang Jun 2019
    private mBftIRB: number;

    constructor(options: DposChainTipStateOptions) {
        super(options);
        this.m_bftIRB = options.libHeader as DposBftBlockHeader;

        this.mBftIRB = 0;
    }

    get bftIRB(): DposBftBlockHeader {
        const irb = this.m_bftIRB;
        return irb;
    }

    get IRB() {
        return this.m_bftIRB.number > this.m_irb.number ? this.m_bftIRB : this.m_irb;
    }

    get bftSigns(): DposBftBlockHeaderSignature[] {
        const signs = this.m_bftLibSigns;
        return signs;
    }

    public async updateTip(header: DposBftBlockHeader): Promise<ErrorCode> {
        let err = await super.updateTip(header);
        if (err) {
            return err;
        }

        await this.maybeNewBftIRB(header.bftSigns);

        return ErrorCode.RESULT_OK;
    }

    public async maybeNewBftIRB(signs: DposBftBlockHeaderSignature[]): Promise<ErrorCode> {
        let hashCount: Map<string, number> = new Map();
        let maxCount = -1;
        let maxCountHeader: DposBftBlockHeader | undefined;

        for (let sign of signs) {
            let hr = await this.m_headerStorage.getHeader(sign.hash);
            if (hr.err) {
                this.logger.info(`dpos_bft _maybeNewBftIrreversibleNumber get header failed errcode=${stringifyErrorCode(hr.err)}`);
                return hr.err;
            }
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
            return ErrorCode.RESULT_NOT_FOUND;
        }

        let miners: string[] | null = this.m_hashMinerCache.get(maxCountHeader!.hash);
        if (!miners) {
            let hr1 = await this.m_getMiners(maxCountHeader!);
            if (hr1.err) {
                this.logger.info(`dpos_bft _maybeNewBftIrreversibleNumber get miners failed errcode=${stringifyErrorCode(hr1.err)}`);
                return hr1.err;
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
            return ErrorCode.RESULT_NOT_ENOUGH;
        }

        if (maxCountHeader.number > this.m_bftIRB.number) {
            this.m_bftIRB = maxCountHeader;
            this.m_bftLibSigns = validSigns;
        }

        return ErrorCode.RESULT_OK;
    }

    toJsonData(): any {
        let d = super.toJsonData();
        d.bft_irreversible_blocknum = this.m_bftIRB.number;

        d.IRB = this.IRB.number;

        // Added by Yang Jun
        this.mBftIRB = this.m_bftIRB.number;
        return d;
    }

    // Add by Yang Jun
    public getBftIRB() {
        return this.mBftIRB;
    }
}
