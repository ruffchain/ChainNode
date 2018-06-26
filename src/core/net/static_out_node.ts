import {ErrorCode} from '../error_code';
import {INode} from './node';

export function instance(superClass: new(...args: any[]) => INode) {
    return class extends superClass {
        constructor(...args: any[]) {
            super(args[0]);
            this.m_staticPeers = (args[1]).slice(0);
        }
        private m_staticPeers: string[];
        async randomPeers(count: number): Promise<{err: ErrorCode, peers: string[]}> {
            if (this.m_staticPeers.length) {
                return {err: ErrorCode.RESULT_OK, peers: this.m_staticPeers};
            } else {
                return {err: ErrorCode.RESULT_SKIPPED, peers: []};
            }
        }
    };
}
