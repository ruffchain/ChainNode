import {DposChainTipStateManager} from '../dpos_chain/chain_state_manager';
import {DposBftChainTipState} from './chain_state';
import {DposBftBlockHeader, DposBftBlockHeaderSignature} from './block';
import {ErrorCode} from '../error_code';

export class DposBftChainTipStateManager extends DposChainTipStateManager {
    protected _newChainTipState(libHeader: DposBftBlockHeader) {
        return new DposBftChainTipState({
            logger: this.m_logger,
            globalOptions: this.m_globalOptions,
            getMiners: this.m_getMiners,
            headerStorage: this.m_headerStorage, 
            libHeader
        });
    }

    public async maybeNewBftIRB(signs: DposBftBlockHeaderSignature[]): Promise<ErrorCode> {
        let err = (this.getBestChainState() as DposBftChainTipState).maybeNewBftIRB(signs);
        if (err) {
            return err;
        }

        return await this._onUpdateBestIRB();
    }
}