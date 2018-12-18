import {ErrorCode} from '../error_code';
import {Transaction} from '../block';
import { isNullOrUndefined } from 'util';

export type TxListener = (context: any, params: any) => Promise<ErrorCode>;
export type TxPendingChecker = (tx: Transaction) => ErrorCode;
export type BlockHeigthFilter = (height: number) => Promise<boolean>;
export type BlockHeightListener = (context: any) => Promise<ErrorCode>;
export type ViewListener = (context: any, params: any) => Promise<any>;

export type ChainEventDefination = {indices?: string[]};
export type ChainEventDefinations = Map<string, ChainEventDefination>;

export class BaseHandler {
    protected m_txListeners: Map<string, {listener: TxListener, checker?: TxPendingChecker}> = new Map();
    protected m_viewListeners: Map<string, ViewListener> = new Map();
    protected m_preBlockListeners: {filter: BlockHeigthFilter, listener: BlockHeightListener}[] = [];
    protected m_postBlockListeners: {filter: BlockHeigthFilter, listener: BlockHeightListener}[] = [];
    
    constructor() {
    }

    public genesisListener?: BlockHeightListener;

    public addTX(name: string, listener: TxListener, checker?: TxPendingChecker) {
        if (name.length > 0 && listener) {
            this.m_txListeners.set(name, {listener, checker});
        }
    }
    
    public getTxListener(name: string): TxListener|undefined {
        const stub = this.m_txListeners.get(name);
        if (!stub) {
            return undefined;
        }
        return stub.listener;
    }

    public getTxPendingChecker(name: string): TxPendingChecker|undefined {
        const stub = this.m_txListeners.get(name);
        if (!stub) {
            return undefined;
        }
        if (!stub.checker) {
            return (tx: Transaction) => ErrorCode.RESULT_OK;
        }
        return stub.checker;
    }

    public addViewMethod(name: string, listener: ViewListener) {
        if (name.length > 0 && listener) {
            this.m_viewListeners.set(name, listener);
        }
    }

    public getViewMethod(name: string): ViewListener|undefined {
        return this.m_viewListeners.get(name) as ViewListener;
    }

    public getViewMethodNames(): Array<string> {
        return [...this.m_viewListeners.keys()];
    }

    public addPreBlockListener(filter: BlockHeigthFilter, listener: BlockHeightListener) {
        this.m_preBlockListeners.push({filter, listener});
    }

    public addPostBlockListener(filter: BlockHeigthFilter, listener: BlockHeightListener) {
        this.m_postBlockListeners.push({filter, listener});
    }

    public getPreBlockListeners(h?: number): {index: number, listener: BlockHeightListener}[] {
        let listeners = [];
        for (let index = 0; index < this.m_preBlockListeners.length; ++index) {
            let s = this.m_preBlockListeners[index];
            if (isNullOrUndefined(h) || s.filter(h)) {
                listeners.push({listener: s.listener, index});
            } 
        }
        return listeners;
    }

    public getPostBlockListeners(h: number): {index: number, listener: BlockHeightListener}[] {
        let listeners = [];
        for (let index = 0; index < this.m_postBlockListeners.length; ++index) {
            let s = this.m_postBlockListeners[index];
            if (isNullOrUndefined(h) || s.filter(h)) {
                listeners.push({listener: s.listener, index});
            } 
        }
        return listeners;
    }

    defineEvent(name: string, def: ChainEventDefination) {
        this.m_eventDefinations.set(name, def);
    }

    getEventDefination(name: string): ChainEventDefination|undefined {
        return this.m_eventDefinations.get(name);
    }

    getEventDefinations(): ChainEventDefinations {
        const d = this.m_eventDefinations;
        return d;
    }

    protected m_eventDefinations: ChainEventDefinations = new Map();
}