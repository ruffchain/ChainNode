import {ChainEventFilterStub} from './stub';
import { ErrorCode} from '../depends';
import {ChainClient} from '../client/client';

export type BlockEventLogs = {
    blockHash: string,
    blockNumber: number,
    logs: {
        name: string,
        param: any;
    }[]
};
export type ChainEventFilterOptions = {
    chainClient: ChainClient,
    filters: object
};
export class ChainEventFilter {
    private m_filters: object;
    private m_chainClient: ChainClient;
    private m_WatchListener: any;
    private m_watchCB: any;
    private m_stub: ChainEventFilterStub;
    constructor(options: ChainEventFilterOptions) {
        this.m_filters = options.filters;
        this.m_chainClient = options.chainClient;
        this.m_stub = new ChainEventFilterStub(this.m_filters);
    }

    init(): ErrorCode {
        this.m_WatchListener = async (blockHash: string, blockNumber: number, eventLogs: any[]) => {
            if (this.m_stub.filterFunc && eventLogs.length && this.m_watchCB) {
                let l: any[] = [];
                for (let event of eventLogs) {
                    if (this.m_stub.filterFunc(event)) {
                        l.push(event);
                    }
                }

                if (l.length > 0) {
                    let event: BlockEventLogs = { blockHash, blockNumber, logs: l };
                    let ret = { err: ErrorCode.RESULT_OK, event };
                    this.m_watchCB(ret);
                }
            }
        };
        return this.m_stub.init();
    }

    async get(options: {block: string|number|'latest'|{from: string|number, offset: string}}): Promise<{err: ErrorCode, events?: BlockEventLogs[]}> {
        let param = {block: options.block, filters: this.m_filters};
        let cr = await this.m_chainClient.rpcClient.callAsync('getEventLogs', param);
        if (cr.ret !== 200) {
            return {err: ErrorCode.RESULT_FAILED};
        }
        return JSON.parse(cr.resp!);
    }

    watch(cb: any) {
        if (this.m_watchCB) {
            this.m_chainClient.removeListener('eventLogs', this.m_WatchListener);
        }
        this.m_watchCB = cb;
        this.m_chainClient.on('eventLogs', this.m_WatchListener);

        return ErrorCode.RESULT_OK;
    }

    stop() {
        if (this.m_watchCB) {
            this.m_chainClient.removeListener('eventLogs', this.m_WatchListener);
            this.m_watchCB = undefined;
        }
    }
}