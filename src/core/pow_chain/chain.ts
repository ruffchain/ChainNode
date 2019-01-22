import {isNullOrUndefined} from 'util';
import {ErrorCode} from '../error_code';
import {ValueChain, ChainTypeOptions, Block, Storage, BlockHeader} from '../value_chain';
import {PowBlockHeader} from './block';
import * as consensus from './consensus';

export class PowChain extends ValueChain {
    protected m_lib?: BlockHeader;
    protected _getBlockHeaderType() {
        return PowBlockHeader;
    }

    protected _onCheckGlobalOptions(globalOptions: any): boolean {
        if (!super._onCheckGlobalOptions(globalOptions)) {
            return false;
        }
        return consensus.onCheckGlobalOptions(globalOptions);
    }

    protected _onCheckTypeOptions(typeOptions: ChainTypeOptions): boolean {
        return typeOptions.consensus === 'pow';
    }

    async onCreateGenesisBlock(block: Block, storage: Storage, genesisOptions?: any): Promise<ErrorCode> {
        let err = await super.onCreateGenesisBlock(block, storage, genesisOptions);
        if (err) {
            return err;
        }
        let gkvr = await storage.getKeyValue(ValueChain.dbSystem, ValueChain.kvConfig);
        if (gkvr.err) {
            return gkvr.err;
        }
        let rpr = await gkvr.kv!.set('consensus', 'pow');
        if (rpr.err) {
            return rpr.err;
        }
        (block.header as PowBlockHeader).bits = this.globalOptions.basicBits;
        block.header.updateHash();
        return ErrorCode.RESULT_OK;
    }

    protected async _onMorkSnapshot(options: {tip: BlockHeader, toMork: Set<string>}): Promise<{err: ErrorCode}> {
        let mork = options.tip.number - 2 * this._confirmDepth;
        mork = mork >= 0 ? mork : 0;
        if (mork !== options.tip.number) {
            let hr = await this.m_headerStorage!.getHeader(mork);
            if (hr.err) {
                this.m_logger.error(`get header ${mork} failed ${hr.err}`);
                return {err: ErrorCode.RESULT_FAILED};
            }
            options.toMork.add(hr.header!.hash);
        }
        return {err: ErrorCode.RESULT_OK};
    }

    getLIB(): {number: number, hash: string} {
        return {number: this.m_lib!.number, hash: this.m_lib!.hash};
    }

    protected async _onUpdateTip(tip: BlockHeader): Promise<ErrorCode> {
        const err = await super._onUpdateTip(tip);
        if (err) {
            return err;
        }
        const hr = await this.m_headerStorage!.getHeader(tip.hash, -this._confirmDepth);
        if (hr.err) {
            return hr.err;
        }
        this.m_lib = hr.headers![0];
        return ErrorCode.RESULT_OK;
    }

    protected get _confirmDepth(): number {
        return !isNullOrUndefined(this.m_instanceOptions!.confirmDepth) ? this.m_instanceOptions!.confirmDepth! : 6; 
    }

    protected get _broadcastDepth(): number {
        return this.m_instanceOptions!.confirmDepth!;
    }
}