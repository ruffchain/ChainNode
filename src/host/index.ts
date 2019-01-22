export * from '../core';
export * from './host/chain_host';
import {ChainHost} from './host/chain_host';
let host = new ChainHost();
export {host};

import {ChainEvent} from './event/element';
import {TxStorage} from './tx/element';
import {ElementCreator, elementRegister as ElementRegister} from './context/element_creator';
import {IElement, ElementOptions} from './context/element';
ElementRegister.register(ChainEvent.ElementName, (options: ElementOptions): IElement => {
    return new ChainEvent(options);
});
ElementRegister.register(TxStorage.ElementName, (options: ElementOptions): IElement => {
    return new TxStorage(options);
});

import {LoggerInstance, initChainCreator, createValueDebuger, ErrorCode, ValueIndependDebugSession, ValueChainDebugSession} from '../core';
const valueChainDebuger = {
    async createIndependSession(loggerOptions: {logger?: LoggerInstance, loggerOptions?: {console: boolean, file?: {root: string, filename?: string}}, level?: string}, dataDir: string): Promise<{err: ErrorCode, session?: ValueIndependDebugSession}> {        
        const cdr = await createValueDebuger(initChainCreator(loggerOptions), dataDir);
        if (cdr.err) {
            return {err: cdr.err};
        }
        return {err: ErrorCode.RESULT_OK, session: cdr.debuger!.createIndependSession()};
    },

    async createChainSession(loggerOptions: {logger?: LoggerInstance, loggerOptions: {console: boolean, file?: {root: string, filename?: string}}, level?: string}, dataDir: string, debugerDir: string): Promise<{err: ErrorCode, session?: ValueChainDebugSession}> {
        const cdr = await createValueDebuger(initChainCreator(loggerOptions), dataDir);
        if (cdr.err) {
            return {err: cdr.err};
        }
        return cdr.debuger!.createChainSession(debugerDir);
    }
};
export {valueChainDebuger};