import { ErrorCode } from '../error_code';
import { DposTransactionContext, DposEventContext, DposViewContext, DposChain, DposChainTipStateOptions, DposChainTipStateCreator} from '../dpos_chain';
import {DposBftChainTipState} from './chain_state';
import {DposBftBlockHeader} from './block';
import {ChainTypeOptions} from '../value_chain';
import {Block, Chain, Storage} from '../value_chain';

export type DposBftTransactionContext = {} & DposTransactionContext;
export type DposBftEventContext = {} & DposEventContext;
export type DposBftViewContext = {} & DposViewContext;

export class DposBftChainTipStateCreator extends DposChainTipStateCreator {
    public createChainTipState(options: DposChainTipStateOptions): DposBftChainTipState {
        return new DposBftChainTipState(options);
    }
}

export class DposBftChain extends DposChain {
    protected createChainTipStateCreator(): DposBftChainTipStateCreator {
        return  new DposBftChainTipStateCreator();
    }

    protected _getBlockHeaderType() {
        return DposBftBlockHeader;
    }

    protected _onCheckTypeOptions(typeOptions: ChainTypeOptions): boolean {
        return typeOptions.consensus === 'dposbft';
    }

    async onCreateGenesisBlock(block: Block, storage: Storage, genesisOptions: any): Promise<ErrorCode> {
        let err = await super.onCreateGenesisBlock(block, storage, genesisOptions);
        if (err) {
            return err;
        }

        let gkvr = await storage.getKeyValue(Chain.dbSystem, Chain.kvConfig);
        if (gkvr.err) {
            return gkvr.err;
        }
        let rpr = await gkvr.kv!.set('consensus', 'dposbft');
        if (rpr.err) {
            return rpr.err;
        }

        return ErrorCode.RESULT_OK;
    }
}

export class DposBftMinerChain extends DposBftChain {
    protected _defaultNetworkOptions() {
        return {
            netType: 'dposbft'
        };
    }
}