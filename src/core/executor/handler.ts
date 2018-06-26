import {ErrorCode} from '../error_code';
import {Transaction,EventLog} from '../chain/transaction';
import {Storage} from '../storage/storage';

export type TxListener = (context: any, params: any) => Promise<ErrorCode>;
export type BlockHeigthFilter = (height: number) => Promise<boolean>;
export type BlockHeightListener = (context: any, bBeforeBlockExec: boolean) => Promise<ErrorCode>;
export type ViewListener = (context: any, params: any) => Promise<any>;

export class BaseHandler {
    protected m_txListeners: Map<string, TxListener> = new Map();
    protected m_viewListeners: Map<string, ViewListener> = new Map();
    protected m_heightEventListeners: {filter: BlockHeigthFilter, listener: BlockHeightListener}[] = [];

    constructor() {
    }

    public addTX(name: string, listener: TxListener) {
        if (name.length > 0 && listener) {
            this.m_txListeners.set(name,listener);
        }
    }

    public getListener(name: string): TxListener|undefined {
        return this.m_txListeners.get(name);
    }

    public addViewMethod(name: string, listener: ViewListener) {
        if (name.length > 0 && listener) {
            this.m_viewListeners.set(name,listener);
        }
    }

    public getViewMethod(name: string): ViewListener|undefined {
        return this.m_viewListeners.get(name) as ViewListener;
    }

    public addBlockHeightEvent(filter: BlockHeigthFilter, listener: BlockHeightListener) {
        this.m_heightEventListeners.push({filter, listener});
    }

    public async getBlockHeightListeners(h: number): Promise<BlockHeightListener[]> {
        let listeners: BlockHeightListener[] = [];
        for (let l of this.m_heightEventListeners) {
            if (l.filter(h)) {
                listeners.push(l.listener);
            }
        }
        return listeners;
    }
}