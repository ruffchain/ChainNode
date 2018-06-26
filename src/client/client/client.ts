export {ErrorCode, BigNumber} from '../types';
export {Transaction} from '../../core/value_chain/transaction';
export * from '../../core/address';
export {stringify} from '../../core/serializable';

import {HostClient, HostClientOptions} from './rpc';

export type ChainClientOptions = HostClientOptions;

export class ChainClient extends HostClient {
    constructor(options: ChainClientOptions) {
        super(options);
    }
}