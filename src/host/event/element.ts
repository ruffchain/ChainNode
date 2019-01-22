import {ErrorCode, LoggerInstance, Chain, ChainEventDefinations, ChainEventDefination, Block, ReceiptSourceType, EventLog, stringifyErrorCode} from '../../core';
import {IElement, ElementOptions} from '../context/element';
import * as sqlite from 'sqlite';
import { isNullOrUndefined, isNull, isString, isObject } from 'util';
const assert = require('assert');
import {ChainEventFilterStub} from './stub';

export class ChainEvent implements IElement {
    private m_chain: Chain;
    private m_logger: LoggerInstance;
    private m_db?: sqlite.Database;
    private m_eventDefinations: ChainEventDefinations;
    constructor(options: ElementOptions) {
        this.m_chain = options.chain;
        this.m_logger = this.m_chain.logger;
        this.m_eventDefinations = options.chain.handler.getEventDefinations();
    }

    public static ElementName: string = 'event';

    public async init(db: sqlite.Database): Promise<ErrorCode> {
        this.m_db = db;

        for (let [name, def] of this.m_eventDefinations.entries()) {
            let err = await this._initEventTable(name, def);
            if (err) {
                this.m_logger.error(`events init failed err=${err}, strerr=${stringifyErrorCode(err)}`);
                return err;
            }
        }

        return ErrorCode.RESULT_OK;
    }

    public async addBlock(block: Block): Promise<ErrorCode> {
        const receipts = block.content.receipts;
        let eventIndex = 0;
        let sqls = [];
        for (const name of this.m_eventDefinations.keys()) {
            // 这里为block在每个event table中加入一条index 为 -1的记录；
            // 当查询某个block的event时，为了区分block不存在和block中没有event的情况
            // block通过addBlock加入到event table之后，select from event table至少会返回index 为-1这条记录；
            // block没有通过addBlock加入到event table的话， select会返回无记录
            let rlog = new EventLog();
            rlog.name = name;
            const sr = this._sqlAddEvent(block.number, -1, rlog);
            if (sr.err) {
                this.m_logger.error(`add replaceholder event sql for block hash: ${block.hash} number: ${block.number} on event ${name} failed ${stringifyErrorCode(sr.err)}`);
                return ErrorCode.RESULT_EXCEPTION;
            }
            sqls.push(sr.sql!);
        }
        for (let i = 0; i < receipts.length; ++i) {
            let r = receipts[i];
            if (r.sourceType === ReceiptSourceType.preBlockEvent
                || r.sourceType === ReceiptSourceType.transaction
                || r.sourceType === ReceiptSourceType.postBlockEvent) {
                for (let l of r.eventLogs) {
                    const sr = this._sqlAddEvent(block.number, eventIndex, l);
                    if (sr.err) {
                        this.m_logger.error(`add event sql for block hash: ${block.hash} number: ${block.number} on event ${eventIndex} failed ${stringifyErrorCode(sr.err)}`);
                        return ErrorCode.RESULT_EXCEPTION;
                    }
                    sqls.push(sr.sql!);
                    ++eventIndex;
                }
            } else {
                assert(false, `invalid receipt source type of block number: ${block.number} hash: ${block.hash} receipt index ${i}`);
                return ErrorCode.RESULT_EXCEPTION;
            }
        }
        const runOps = sqls.map((sql) => this.m_db!.run(sql));
        try {
            await Promise.all(runOps);
        } catch (e) {
            this.m_logger.error(`sql add block failed for `, e);
            return ErrorCode.RESULT_EXCEPTION;
        }
        
        return ErrorCode.RESULT_OK;
    }
    public async revertToBlock(num: number): Promise<ErrorCode> {
        for (const name of this.m_eventDefinations.keys()) {
            try {
                await this.m_db!.run(`DELETE FROM ${this._eventTblName(name)} WHERE block_number > ${num}`);
            } catch (e) {
                this.m_logger.error(`sql delete from event failed for `, e);
                return ErrorCode.RESULT_EXCEPTION;
            }
        }

        return ErrorCode.RESULT_OK;
    }

    async getEventByStub(block: any, stub: ChainEventFilterStub): Promise<{
        err: ErrorCode, 
        events?: {blockHash: string, blockNumber: number, eventLogs: EventLog[]}[]}> {
        let ghr;
        if (isString(block)) {
            ghr = await this.m_chain.getHeader(block);
        } else if (isObject(block)) {
            ghr = await this.m_chain.getHeader(block.from, block.offset);
        } else {
            return {err: ErrorCode.RESULT_INVALID_PARAM};
        }
        if (ghr.err) {
            this.m_logger.error(`get event by stub failed for get headers failed `, stringifyErrorCode(ghr.err));
            return {err: ghr.err};
        }
        let blocks = [];
        let headers = [];
        if (ghr.headers) {
            headers = ghr.headers!;
        } else {
            headers.push(ghr.header!);
        }
        for (const header of headers) {
            let _block = this.m_chain.getBlock(header.hash);
            if (!_block) {
                this.m_logger.error(`get event by stub failed for block ${header.hash} missing`);
                return {err: ErrorCode.RESULT_INVALID_BLOCK};
            }
            blocks.push(_block);
        }
        const ger = await this._getEvents({blocks: blocks.map((_block) => _block.hash), querySql: stub.querySql});
        if (ger.err) {
            this.m_logger.error(`get event by stub failed for storage err `, stringifyErrorCode(ger.err));
            return {err: ger.err};
        }
        let events = [];
        for (const _block of blocks) {
            if (ger.events!.has(_block.hash)) {
                const blockEvents = _block.content.eventLogs;
                const indices = ger.events!.get(_block.hash)!;
                let eventLogs = [];
                for (const index of indices) {
                    eventLogs.push(blockEvents[index]);
                }
                events.push({blockHash: _block.hash, blockNumber: _block.number, eventLogs});
            }
        }
        return {err: ErrorCode.RESULT_OK, events};
    }

    private async _getEvents(options: {blocks: string[], querySql: Map<string, string|null>}): Promise<{err: ErrorCode, events?: Map<string, number[]>}> {
        let events = new Map();
        let err;
        for (let hash of options.blocks) {
            let sqls = [];
            for (const [event, filterSql] of options.querySql.entries()) {
                let _sql = `SELECT e."index" AS "index" FROM ${this._eventTblName(event)} AS e LEFT JOIN blocks AS b ON e."block_number" = b.number WHERE b.hash = "${hash}" AND (e."index" = -1 OR (e."index" >= 0 `;
                if (!isNull(filterSql)) {
                    _sql += ` AND (` + filterSql + ')';
                }
                _sql += `))`;
                sqls.push(_sql);
            }
            if (!sqls.length) {
                events.set(hash, []);
                continue;
            } 
            let sqlGet;
            if (sqls.length === 1) {
                sqlGet = sqls[0];
            } else {
                sqlGet = sqls[0];
                for (let sql of sqls.slice(1)) {
                    sqlGet += ` UNION ${sql} `;
                }
            }
            sqlGet += ` ORDER BY "index" `;
            let records;
            try {
                records = await this.m_db!.all(sqlGet);
            } catch (e) {
                this.m_logger.error(`sql get events of ${hash} failed e=${e}, sql=${sqlGet}`, e);
                err = ErrorCode.RESULT_EXCEPTION;
                break;
            }
            
            if (records.length) {
                let blockEvents: number[] = [];
                for (const r of records) {
                    if (r.index >= 0) {
                        blockEvents.push(r.index);
                    }
                }
                events.set(hash, blockEvents);
            }
        }
        if (err) {
            return {err};
        }
        return {err: ErrorCode.RESULT_OK, events};
    }

    private _sqlAddEvent(blockNumber: number, eventIndex: number, log: EventLog): {err: ErrorCode, sql?: string} {
        const def = this.m_eventDefinations.get(log.name);
        if (!def) {
            return {err: ErrorCode.RESULT_EXCEPTION};
        }
        let sql = `INSERT INTO ${this._eventTblName(log.name)} ("index", "block_number"`;
        const param = isNullOrUndefined(log.param) ? {} : log.param; 
        if (def.indices) {
            for (const index of def.indices) {
                sql += `, ${this._indexColName(index)}`;
            }
            sql += `) VALUES (${eventIndex}, ${blockNumber}`;
            for (const index of def.indices) {
                const indexValue = JSON.stringify(param[index]);
                sql += `, '${indexValue}'`;
            }
            sql += ')'; 
        }
        return {err: ErrorCode.RESULT_OK, sql};
    }

    protected async _initEventTable(name: string, def: ChainEventDefination): Promise<ErrorCode> {
        let sqlCreateIndex = '';
        const tblName = this._eventTblName(name);
        if (def.indices) {
            for (let index of def.indices) {
                const colName = this._indexColName(index);
                sqlCreateIndex += `, ${colName} MULTICHAR NOT NULL`;
            }
            sqlCreateIndex += ');';
            for (let index of def.indices) {
                const colName = this._indexColName(index);
                sqlCreateIndex += `CREATE INDEX ${colName} ON ${tblName}(${colName});`;
            }
        }
        const sqlCreate = `CREATE TABLE IF NOT EXISTS ${tblName} ("index" INTEGER NOT NULL, "block_number" INTERGER NOT NULL` + sqlCreateIndex;
        try {
            await this.m_db!.run(sqlCreate);
        } catch (e) {
            this.m_logger.error(`init event ${name} table failed `, e);
            return ErrorCode.RESULT_EXCEPTION;
        }
        return ErrorCode.RESULT_OK;
    }

    private _eventTblName(name: string): string {
        return `"event@${name}"`;
    }

    private _indexColName(index: string): string {
        return `"index@${index}"`;
    }
}