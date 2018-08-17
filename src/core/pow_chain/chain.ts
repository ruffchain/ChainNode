import {ValueChain, ChainTypeOptions} from '../value_chain';
import {PowBlockHeader} from './block';
import * as consensus from './consensus';

export class PowChain extends ValueChain {
    protected _getBlockHeaderType() {
        return PowBlockHeader;
    }

    onCheckGlobalOptions(globalOptions: any): boolean {
        if (!super.onCheckGlobalOptions(globalOptions)) {
            return false;
        }
        return consensus.onCheckGlobalOptions(globalOptions);
    }

    protected _onCheckTypeOptions(typeOptions: ChainTypeOptions): boolean {
        return typeOptions.consensus === 'pow';
    }
}