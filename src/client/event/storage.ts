const assert = require('assert');
import * as sqlite from 'sqlite';
import * as sqlite3 from 'sqlite3';

import { isNullOrUndefined, isNull } from 'util';

import {ErrorCode, LoggerInstance, ChainEventDefinations, ChainEventDefination, Block, ReceiptSourceType, EventLog, stringifyErrorCode} from '../../core';

export class ChainEventStorage {
    constructor(options: {
        logger: LoggerInstance, 
        dbPath: string, 
        eventDefinations: ChainEventDefinations,
    }) {
        this.m_dbPath = options.dbPath;
        this.m_logger = options.logger;
        this.m_eventDefinations = options.eventDefinations;
    }

    private m_dbPath: string;
    private m_db?: sqlite.Database;
    private m_logger: LoggerInstance;
    private m_eventDefinations: ChainEventDefinations;

    async init(options: {
        readonly?: boolean}): 
        Promise<{
            err: ErrorCode, 
            latest?: {number: number, hash: string}
        }> {
        const readonly = isNullOrUndefined(options.readonly) ? false : options.readonly;
        let sqliteOptions: any = {};
        if (!readonly) {
            sqliteOptions.mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE; 
        } else {
            sqliteOptions.mode = sqlite3.OPEN_READONLY;
        }
        try {
            this.m_db = await sqlite.open(this.m_dbPath, sqliteOptions);
        } catch (e) {
            this.m_logger.error(`open database failed`, e);
            return {err: ErrorCode.RESULT_EXCEPTION};
        }

        if (readonly) {
            const _lbr = await this.getLatestBlock();
            if (_lbr.err === ErrorCode.RESULT_NOT_FOUND) {
                return {err: ErrorCode.RESULT_INVALID_STATE};
            }
            return _lbr;
        }
        let err = await this._initBlocksTable();
        if (err) {
            return {err};
        }
        for (let [name, def] of this.m_eventDefinations.entries()) {
            err = await this._initEventTable(name, def);
            if (err) {
                return {err};
            }
        }
        return this.getLatestBlock(); 
    }

    async getLatestBlock(): Promise<{err: ErrorCode, latest?: {number: number, hash: string}}> {
        let latest;
        try {
            latest = await this.m_db!.get(`SELECT * FROM blocks ORDER BY number DESC`);
        } catch (e) {
            this.m_logger.error('sql get latest block failed ', e);
            return {err: ErrorCode.RESULT_EXCEPTION};
        }
        if (!latest) {
            return {err: ErrorCode.RESULT_NOT_FOUND};
        }
        return {err: ErrorCode.RESULT_OK, latest};
    }

    protected async _initBlocksTable(): Promise<ErrorCode> {
        try {
            await this.m_db!.run(`CREATE TABLE IF NOT EXISTS "blocks"("number" INTEGER NOT NULL UNIQUE, "hash" CHAR(64) NOT NULL)`);
        } catch (e) {
            this.m_logger.error(`init blocks table failed `, e);
            return ErrorCode.RESULT_EXCEPTION;
        }
        return ErrorCode.RESULT_OK;
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

    async revertToBlock(blockNumber: number): Promise<ErrorCode> {
        try {
            await this.m_db!.run('BEGIN;');
        } catch (e) {
            this.m_logger.error('revert to block failed for begin transaction ', e);
            return ErrorCode.RESULT_EXCEPTION;
        }
        let err;
        do {
            try {
                this.m_db!.run(`DELETE FROM blocks WHERE number > ${blockNumber}`);
            } catch (e) {
                this.m_logger.error(`sql delete from blocks failed for `, e);
                err = ErrorCode.RESULT_EXCEPTION;
                break;
            }
            
            for (const name of this.m_eventDefinations.keys()) {
                try {
                    this.m_db!.run(`DELETE FROM ${this._eventTblName(name)} WHERE block_number > ${blockNumber}`);
                } catch (e) {
                    this.m_logger.error(`sql delete from event failed for `, e);
                    err = ErrorCode.RESULT_EXCEPTION;
                    break;
                }
            }
        } while (false);
        if (err) {
            await this.m_db!.run('ROLLBACK;');            
            return err;
        }
        try {
            await this.m_db!.run('COMMIT;');
        } catch (e) {
            this.m_logger.error('revert to block failed for commit transaction', e);
            return ErrorCode.RESULT_EXCEPTION;
        }
        return ErrorCode.RESULT_OK;
    }

    async addBlock(block: Block): Promise<ErrorCode> {
        try {
            await this.m_db!.run('BEGIN;');
        } catch (e) {
            this.m_logger.error('add block failed for begin transaction ', e);
            return ErrorCode.RESULT_EXCEPTION;
        }
        let err = await this._addBlock(block);
        if (err) {
            await this.m_db!.run('ROLLBACK;');            
            return err;
        }
        try {
            await this.m_db!.run('COMMIT;');
        } catch (e) {
            this.m_logger.error('add block failed for commit transaction', e);
            return ErrorCode.RESULT_EXCEPTION;
        }
        return ErrorCode.RESULT_OK;
    }

    // this.m_logger.error(`undefined event ${log.name} in block number: ${block.number} hash: ${block.hash} receipt index ${i}`);
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

    protected async _addBlock(block: Block): Promise<ErrorCode> {
        const receipts = block.content.receipts;
        let eventIndex = 0;
        let sqls = [];
        const sqlAddBlock = `INSERT INTO blocks (number, hash) VALUES (${block.number}, "${block.hash}")`;
        sqls.push(sqlAddBlock);
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

    async getEvents(options: {blocks: string[], querySql: Map<string, string|null>}): Promise<{err: ErrorCode, events?: Map<string, number[]>}> {
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
                this.m_logger.error(`sql get events of ${hash} failed `, e);
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
}