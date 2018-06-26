import * as ValueChain from '../value_chain/chain';
import {BlockHeader} from './block';

export type TransactionContext = ValueChain.TransactionContext;

export type EventContext = ValueChain.EventContext;

export type ViewContext = ValueChain.ViewContext;

export type ChainOptions = ValueChain.ChainOptions; 

export class Chain extends ValueChain.Chain {
    protected _getBlockHeaderType(): new () => BlockHeader {
        return BlockHeader;
    }
}