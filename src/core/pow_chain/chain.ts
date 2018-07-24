import {ValueChain} from '../value_chain';
import {PowBlockHeader} from './block';

export class PowChain extends ValueChain {
    protected _getBlockHeaderType() {
        return PowBlockHeader;
    }
}