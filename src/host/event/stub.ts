import { ErrorCode, EventLog } from '../../core';
import { isObject, isArray } from 'util';

export class ChainEventFilterStub {
    constructor(filters: any) {
        this.m_filters = filters;
    }

    get querySql(): Map<string, string|null> {
        const q = this.m_querySql!;
        return q;
    }

    get filterFunc(): (log: EventLog) => boolean {
        return this.m_filterFunc!;
    }

    init(): ErrorCode {
        if (!this.m_filters 
            || !isObject(this.m_filters) 
            || !Object.keys(this.m_filters).length) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        let querySql = new Map();
        let filterFuncs = new Map();
        for (let [event, filter] of Object.entries(this.m_filters)) {
            if (!filter || !Object.keys(filter).length) {
                filterFuncs.set(name, (log: EventLog): boolean => {
                    return true;
                });
                querySql.set(event, null);
            }
            let pfr = ChainEventFilterStub._parseFilter(filter, (op, ...opr: any[]): string => {
                if (op === 'and') {
                    let sql = '( ' + opr[0] + ' )';
                    for (let e of opr.slice(1)) {
                        sql += ' AND ( ' + e + ' )';
                    }
                    return sql;
                } else if (op === 'or') {
                    let sql = '( ' + opr[0] + ' )';
                    for (let e of opr.slice(1)) {
                        sql += ' OR ( ' + e + ' )';
                    }
                    return sql;
                } else if (op === 'eq') {
                    return `e."index@${opr[0]}" = '${JSON.stringify(opr[1])}'`;
                } else if (op === 'neq') {
                    return `e."index@${opr[0]}" != '${JSON.stringify(opr[1])}'`;
                } else if (op === 'in') {
                    let sql = `e."index@${opr[0]}" IN [`;
                    if (opr[1].length) {
                        sql += `'${JSON.stringify(opr[1][0])}'`;
                    } 
                    for (let v of opr[1]) {
                        sql += `,'${JSON.stringify(opr[1][0])}'`;
                    }
                    sql += ']';
                    return sql;
                } else {
                    throw new Error();
                }
            });
            if (pfr.err) {
                return pfr.err;
            } 
            querySql.set(event, pfr.value!);

            pfr = ChainEventFilterStub._parseFilter(filter, (op, ...opr: any[]): string => {
                if (op === 'and') {
                    let sql = '( ' + opr[0] + ' )';
                    for (let e of opr.slice(1)) {
                        sql += ' && ( ' + e + ' )';
                    }
                    return sql;
                } else if (op === 'or') {
                    let sql = '( ' + opr[0] + ' )';
                    for (let e of opr.slice(1)) {
                        sql += ' || ( ' + e + ' )';
                    }
                    return sql;
                } else if (op === 'eq') {
                    return `JSON.stringify(l.param.${opr[0]}) === '${JSON.stringify(opr[1])}'`;
                } else if (op === 'neq') {
                    return `JSON.stringify(l.param.${opr[0]})" !== '${JSON.stringify(opr[1])}'`;
                } else if (op === 'in') {
                    return `${opr[1].map((v: any) => JSON.stringify(v))}.indexOf(JSON.stringify(l.param.${opr[0]})) !== -1`;
                } else {
                    throw new Error();
                }
            });
            if (pfr.err) {
                return pfr.err;
            } 
            let _func;
            let funcDef = '_func = (l) => { return ' + pfr.value! + ';};';
            try {
                eval(funcDef);
            } catch (e) {
                return ErrorCode.RESULT_EXCEPTION;
            }
            filterFuncs.set(event, _func);
        }
        
        this.m_querySql = querySql;
        this.m_filterFunc = (log: EventLog): boolean => {
            if (!filterFuncs.has(log.name)) {
                return false;
            }
            return (filterFuncs.get(log.name)(log));
        };
        return ErrorCode.RESULT_OK;
    }

    private static _parseFilter(filter: any, parser: (op: string, ...opr: any[]) => string): {err: ErrorCode, value?: string} {
        if (!isObject(filter)) {
            return {err: ErrorCode.RESULT_INVALID_FORMAT};
        }
        const keys = Object.keys(filter);
        if (keys.length !== 1) {
            return {err: ErrorCode.RESULT_INVALID_FORMAT};
        }
        const op = keys[0];
        if (op === '$and') {
            let exp = filter['$and'];
            if (!isArray(exp)) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            } 
            if (exp.length > 2) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            }
            let opr = [];
            for (let sub of exp) {
                const pfr = this._parseFilter(sub, parser);
                if (pfr.err) {
                    return {err: pfr.err};
                }
                opr.push(pfr.value);
            }
            let value;
            try {
                value = parser('and', ...opr);
            } catch (e) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            }
            return {err: ErrorCode.RESULT_OK, value};
        } else if (op === '$or') {
            let exp = filter['$or'];
            if (!isArray(exp)) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            } 
            if (exp.length > 2) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            }
            let opr = [];
            for (let sub of exp) {
                const pfr = this._parseFilter(sub, parser);
                if (pfr.err) {
                    return {err: pfr.err};
                }
                opr.push(pfr.value);
            }
            let value;
            try {
                value = parser('or', ...opr);
            } catch (e) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            }
            return {err: ErrorCode.RESULT_OK, value};
        } else if (op === '$eq') {
            let exp = filter['$eq'];
            if (!isObject(exp)) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            } 
            const _keys = Object.keys(exp);
            if (_keys.length !== 1) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            }
            const index = _keys[0];
            let value;
            try {
                value = parser('eq', index, exp[index]);
            } catch (e) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            }
            return {err: ErrorCode.RESULT_OK, value};
        } else if (op === '$neq') {
            let exp = filter['$neq'];
            if (!isObject(exp)) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            } 
            const _keys = Object.keys(exp);
            if (_keys.length !== 1) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            }
            const index = _keys[0];
            let value;
            try {
                value = parser('neq', index, exp[index]);
            } catch (e) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            }
            return {err: ErrorCode.RESULT_OK, value};
        } else if (op === '$in') {
            let exp = filter['$in'];
            if (!isObject(exp)) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            } 
            const _keys = Object.keys(exp);
            if (_keys.length !== 1) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            }
            const index = _keys[0];
            if (!isArray(exp[index])) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            }
            let value;
            try {
                value = parser('in', index, exp[index]);
            } catch (e) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            }
            return {err: ErrorCode.RESULT_OK, value};
        } else {
            let index = op;
            let value;
            try {
                value = parser('eq', index, filter[index]);
            } catch (e) {
                return {err: ErrorCode.RESULT_INVALID_FORMAT};
            }
            return {err: ErrorCode.RESULT_OK, value};
        }
    }

    private m_filters: object;
    private m_querySql?: Map<string, string>;
    private m_filterFunc?: (log: EventLog) => boolean;
}