import {ErrorCode} from '../error_code';

export type TxListener = (context: any, params: any) => Promise<ErrorCode>;
export type BlockHeigthFilter = (height: number) => Promise<boolean>;
export type BlockHeightListener = (context: any) => Promise<ErrorCode>;
export type ViewListener = (context: any, params: any) => Promise<any>;

export class BaseHandler {
    protected m_txListeners: Map<string, TxListener> = new Map();
    protected m_viewListeners: Map<string, ViewListener> = new Map();
    protected m_preBlockListeners: {filter: BlockHeigthFilter, listener: BlockHeightListener}[] = [];
    protected m_postBlockListeners: {filter: BlockHeigthFilter, listener: BlockHeightListener}[] = [];
    
    constructor() {
    }

    public genesisListener?: BlockHeightListener;

    public addTX(name: string, listener: TxListener) {
        if (name.length > 0 && listener) {
            this.m_txListeners.set(name, listener);
        }
    }

    public getListener(name: string): TxListener|undefined {
        return this.m_txListeners.get(name);
    }

    public addViewMethod(name: string, listener: ViewListener) {
        if (name.length > 0 && listener) {
            this.m_viewListeners.set(name, listener);
        }
    }

    public getViewMethod(name: string): ViewListener|undefined {
        return this.m_viewListeners.get(name) as ViewListener;
    }

    public addPreBlockListener(filter: BlockHeigthFilter, listener: BlockHeightListener) {
        this.m_preBlockListeners.push({filter, listener});
    }

    public addPostBlockListener(filter: BlockHeigthFilter, listener: BlockHeightListener) {
        this.m_postBlockListeners.push({filter, listener});
    }

    public getPreBlockListeners(h: number): BlockHeightListener[] {
        let listeners = [];
        for (let l of this.m_preBlockListeners) {
            if (l.filter(h)) {
                listeners.push(l.listener);
            }
        }
        return listeners;
    }

    public getPostBlockListeners(h: number): BlockHeightListener[] {
        let listeners = [];
        for (let l of this.m_postBlockListeners) {
            if (l.filter(h)) {
                listeners.push(l.listener);
            }
        }
        return listeners;
    }
}