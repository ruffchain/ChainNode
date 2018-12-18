import {ChainEventFilterStub} from './stub';
import { ErrorCode } from '../../core';

export class ChainEventFilter {
    constructor(filters: object) {
        this.m_filters = filters;
    }
    private m_filters: object;

    init(): ErrorCode {
        
        return ErrorCode.RESULT_OK;
    }

    get(options: {block: string|number|'latest'|{from: string|number, offset: string}}) {
        
    }

    watch() {

    }

    stop() {

    }
}