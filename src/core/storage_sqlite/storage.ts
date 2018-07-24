import * as fs from 'fs-extra';
import * as path from 'path';

import * as assert from 'assert';
import * as sqlite from 'sqlite';
import * as sqlite3 from 'sqlite3';

import {JStorageLogger} from '../storage/js_log';

const { TransactionDatabase } = require('sqlite3-transactions');
declare module 'sqlite' {
    interface Database {
        driver: sqlite3.Database;
        __proto__: any;
    }
}

import { ErrorCode } from '../error_code';
import * as BaseStorage from '../storage/storage';

export class SqliteStorageTable implements BaseStorage.IReadWritableKeyValue {
    constructor(public db: sqlite.Database, public name: string) { 
        
    }

    public async set(key: string, value: any): Promise<{ err: ErrorCode }> {
        assert(key);
        const json = JSON.stringify(value);
        const sql = `REPLACE INTO ${this.name} (name, field, value) VALUES ('${key}', "____default____", '${json}')`;
        await this.db.exec(sql);
        return { err: ErrorCode.RESULT_OK };
    }

    public async get(key: string): Promise<{ err: ErrorCode, value?: any }> {
        assert(key);
        const result = await this.db.get(`SELECT value FROM ${this.name} \
            WHERE name=? AND field="____default____"`, key);

        if (result == null) {
            return { err: ErrorCode.RESULT_NOT_FOUND };
        }
        return { err: ErrorCode.RESULT_OK, value: JSON.parse(result.value) };
    }

    public async getAll(): Promise<{ err: ErrorCode, value: Map<string, any>}> {
        const result = await this.db.all(`select name,value from ${this.name} where field="____default____"`);

        let value: Map<string, any> = new Map<string, any>();
        result.forEach((x) => value.set(x.name, JSON.parse(x.value)));
        return {err: ErrorCode.RESULT_OK, value};
    }

    public async hset(key: string, field: string, value: any): Promise<{ err: ErrorCode; }> {
        assert(key);
        assert(field);
        const json = JSON.stringify(value);
        const sql = `REPLACE INTO ${this.name} (name, field, value) VALUES ('${key}', '${field}', '${json}')`;
        await this.db.exec(sql);
        return { err: ErrorCode.RESULT_OK };
    }

    public async hget(key: string, field: string): Promise<{ err: ErrorCode; value?: any; }> {
        assert(key);
        assert(field);
        const result = await this.db.get(`SELECT value FROM ${this.name} WHERE name=? AND field=?`, key, field);

        if (result == null) {
            return { err: ErrorCode.RESULT_NOT_FOUND };
        }
        return { err: ErrorCode.RESULT_OK, value: JSON.parse(result.value) };
    }

    public async hdel(key: string, field: string): Promise<{err: ErrorCode}> {
        await this.db.exec(`DELETE FROM ${this.name} WHERE name='${key}' and field='${field}'`);
        return {err: ErrorCode.RESULT_OK};
    }

    public async hlen(key: string): Promise<{ err: ErrorCode; value: number; }> {
        assert(key);
        const result = await this.db.get(`SELECT count(*) as value FROM ${this.name} WHERE name=?`, key);

        return { err: ErrorCode.RESULT_OK, value: result.value };
    }

    public async hexists(key: string, field: string): Promise<boolean> {
        let { err, value } = await this.hget(key, field);
        return err === ErrorCode.RESULT_OK;
    }

    public async hmset(key: string, fields: string[], values: any[]): Promise<{ err: ErrorCode; }> {
        assert(key);
        assert(fields.length === values.length);

        const statement = await this.db.prepare(`REPLACE INTO ${this.name}  (name, field, value) VALUES (?, ?, ?)`);
        for (let i = 0; i < fields.length; i++) {
            await statement.run([key, fields[i], JSON.stringify(values[i])]);
        }
        await statement.finalize();
        return { err: ErrorCode.RESULT_OK };
    }

    public async hmget(key: string, fields: string[]): Promise<{ err: ErrorCode; value: any[]; }> {
        assert(key);
        const sql = `SELECT * FROM ${this.name} WHERE name=? AND field in (${fields.map((x) => '?').join(',')})`;
        // console.log({ sql });
        const result = await this.db.all(sql, key, ...fields);
        const resultMap: { [other: string]: any } = {};
        result.forEach((x) => resultMap[x.field] = JSON.parse(x.value));
        const values = fields.map((x) => resultMap[x]);

        return { err: ErrorCode.RESULT_OK, value: values };
    }

    public async hkeys(key: string): Promise<{ err: ErrorCode; value: string[]; }> {
        assert(key);
        const result = await this.db.all(`SELECT * FROM ${this.name} WHERE name=?`, key);

        return { err: ErrorCode.RESULT_OK, value: result.map((x) => x.field) };
    }

    public async hvalues(key: string): Promise<{ err: ErrorCode; value: any[]; }> {
        assert(key);
        const result = await this.db.all(`SELECT * FROM ${this.name} WHERE name=?`, key);

        return { err: ErrorCode.RESULT_OK, value: result.map((x) => JSON.parse(x.value)) };
    }

    public async hgetall(key: string): Promise<{ err: ErrorCode; value: any[]; }> {
        const result = await this.db.all(`SELECT * FROM ${this.name} WHERE name=?`, key);

        return {
            err: ErrorCode.RESULT_OK, value: result.map((x) => {
                return { key: x.field, value: JSON.parse(x.value) };
            })
        };
    }

    public async hclean(key: string): Promise<ErrorCode> {
        const result = await this.db.exec(`DELETE FROM ${this.name} WHERE name='${key}'`);
        return ErrorCode.RESULT_OK;
    }

    public async lindex(key: string, index: number): Promise<{ err: ErrorCode; value?: any; }> {
        assert(key);
        return await this.hget(key, index.toString());
    }

    public async lset(key: string, index: number, value: any): Promise<{ err: ErrorCode; }> {
        assert(key);
        return await this.hset(key, index.toString(), value);
    }

    public async llen(key: string): Promise<{ err: ErrorCode; value: number; }> {
        assert(key);
        return await this.hlen(key);
    }

    public async lrange(key: string, start: number, stop: number): Promise<{ err: ErrorCode; value: any[]; }> {
        assert(key);
        const { err, value: len } = await this.llen(key);
        if (stop < 0) {
            stop = len + stop + 1;
        }
        const ret = [];
        for (let i = start; i < stop; i++) {
            const result = await this.lindex(key, i);
            ret.push(result.value);
        }
        return { err: ErrorCode.RESULT_OK, value: ret };
    }

    public async lpush(key: string, value: any): Promise<{ err: ErrorCode; }> {
        assert(key);
        // update index += 1
        // set index[0] = value
        const json = JSON.stringify(value);
        await this.db.exec(`UPDATE ${this.name} SET field=field+1 WHERE name='${key}'`);
        const sql = `INSERT INTO ${this.name} (name, field, value) VALUES ('${key}', '0', '${json}')`;
        // console.log('lpush', { sql });
        await this.db.exec(sql);

        return { err: ErrorCode.RESULT_OK };
    }

    public async lpushx(key: string, value: any[]): Promise<{ err: ErrorCode; }> {
        assert(key);
        const len = value.length;
        await this.db.exec(`UPDATE ${this.name} SET field=field+${len} WHERE name='${key}'`);
        for (let i = 0; i < len; i++) {
            const json = JSON.stringify(value[i]);
            await this.db.exec(`INSERT INTO ${this.name} (name, field, value) VALUES ('${key}', ${i}, ${json})`);
        }
        return { err: ErrorCode.RESULT_OK };
    }

    public async lpop(key: string): Promise<{ err: ErrorCode; value?: any; }> {
        assert(key);
        return this.lremove(key, 0);
    }

    public async rpush(key: string, value: any): Promise<{ err: ErrorCode; }> {
        assert(key);
        const { err, value: len } = await this.llen(key);
        const json = JSON.stringify(value);
        await this.db.exec(`INSERT INTO ${this.name} (name, field, value) VALUES ('${key}', ${len}, '${json}')`);
        return { err: ErrorCode.RESULT_OK };
    }

    public async rpushx(key: string, value: any[]): Promise<{ err: ErrorCode; }> {
        assert(key);
        const { err, value: len } = await this.llen(key);
        for (let i = 0; i < value.length; i++) {
            const json = JSON.stringify(value[i]);
            await this.db.exec(`INSERT INTO ${this.name} (name, field, value) \
                VALUES ('${key}', ${len + i}, '${json}')`);
        }

        return { err: ErrorCode.RESULT_OK };
    }

    public async rpop(key: string): Promise<{ err: ErrorCode; value?: any; }> {
        assert(key);
        const { err, value: len } = await this.llen(key);
        if (len === 0) {
            return { err: ErrorCode.RESULT_NOT_FOUND };
        } else {
            const { err: err2, value } = await this.lindex(key, len - 1);
            await this.db.exec(`DELETE FROM ${this.name} WHERE name='${key}' AND field=${len - 1}`);
            return { err: ErrorCode.RESULT_OK, value };
        }
    }

    public async linsert(key: string, index: number, value: any): Promise<{ err: ErrorCode; }> {
        assert(key);
        const { err, value: len } = await this.llen(key);
        if (len === 0 || index >= len) {
            return await this.lset(key, len, value);
        } else {
            for (let i = len - 1; i >= index; i--) {
                await this.db.exec(`UPDATE ${this.name} SET field=field+1 WHERE name='${key}' AND field = ${i}`);
            }

            return await this.lset(key, index, value);
        }
    }

    public async lremove(key: string, index: number): Promise<{ err: ErrorCode, value?: any }> {
        assert(key);
        const { err, value: len } = await this.llen(key);
        if (len === 0) {
            return { err: ErrorCode.RESULT_NOT_FOUND };
        } else {
            const { err: err2, value } = await this.lindex(key, index);
            let sql = `DELETE FROM ${this.name} WHERE name='${key}' AND field='${index}'`;
            // console.log('lremove', { sql });
            await this.db.exec(sql);
            for (let i = index + 1; i < len; i++) {
                sql = `UPDATE ${this.name} SET field=field-1 WHERE name='${key}' AND field = ${i}`;
                // console.log({ sql });
                await this.db.exec(sql);
            }

            return { err: ErrorCode.RESULT_OK, value };
        }
    }
}

class StorageTransaction implements BaseStorage.StorageTransaction {
    protected m_transcationDB: any;
    protected m_transcation: any;

    constructor(db: sqlite.Database) {
        this.m_transcationDB = new TransactionDatabase(db.driver);
    }

    public beginTransaction(): Promise<ErrorCode> {
        return new Promise<ErrorCode>((resolve, reject) => {
            this.m_transcationDB.beginTransaction((err: Error, transcation: any) => {
                if (err) {
                    reject(err);
                } else {
                    this.m_transcation = transcation;
                    resolve(ErrorCode.RESULT_OK);
                }
            });
        });
    }

    public commit(): Promise<ErrorCode> {
        return new Promise<ErrorCode>((resolve, reject) => {
            this.m_transcation.commit((err: Error) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(ErrorCode.RESULT_OK);
                }
            });
        });
    }

    public rollback(): Promise<ErrorCode> {
        return new Promise<ErrorCode>((resolve, reject) => {
            this.m_transcation.rollback((err: Error) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(ErrorCode.RESULT_OK);
                }
            });
        });
    }
}

export class SqliteStorage extends BaseStorage.Storage {
    private m_db?: sqlite.Database;
    private m_isInit: boolean = false;

    protected _createLogger(): JStorageLogger {
        return new JStorageLogger();
    }

    public get isInit(): boolean {
        return this.m_isInit;
    }

    public async init(readonly?: boolean): Promise<ErrorCode> {
        if (this.m_db) {
            return ErrorCode.RESULT_SKIPPED;
        }
        assert(!this.m_db);
        fs.ensureDirSync(path.dirname(this.m_filePath));
        let options: any = {};
        if (!readonly) {
            options.mode = sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE; 
        } else {
            options.mode = sqlite3.OPEN_READONLY;
        }

        let err = ErrorCode.RESULT_OK;
        try {
            this.m_db = await sqlite.open(this.m_filePath, options);
        } catch (e) {
            err = ErrorCode.RESULT_EXCEPTION;
        }
        // await this.m_db.migrate({ force: 'latest', migrationsPath: path.join(__dirname, 'migrations') });
        
        this.m_eventEmitter.emit('init', err);
        if (!err) {
            this.m_isInit = true;
        }
        
        return err;
    }

    public async uninit(): Promise<ErrorCode> {
        if (this.m_db) {
            await this.m_db.close();
            delete this.m_db;
        }

        return ErrorCode.RESULT_OK;
    }

    public async createKeyValue(name: string): Promise<{err: ErrorCode, kv?: BaseStorage.IReadWritableKeyValue}> {
        await this.m_db!.exec(`CREATE TABLE IF NOT EXISTS ${name} \
            (name TEXT, field TEXT, value TEXT, unique(name, field))`);
        let tbl = new SqliteStorageTable(this.m_db!, name);
        return { err: ErrorCode.RESULT_OK, kv: tbl };
    }

    public async getReadableKeyValue(name: string): Promise<{ err: ErrorCode, kv?: BaseStorage.IReadWritableKeyValue }> {
        let tbl = new SqliteStorageTable(this.m_db!, name);
        return { err: ErrorCode.RESULT_OK, kv: tbl };
    }

    public async getReadWritableKeyValue(name: string): Promise<{ err: ErrorCode, kv?: BaseStorage.IReadWritableKeyValue }> {
        let tbl = new SqliteStorageTable(this.m_db!, name);
        return { err: ErrorCode.RESULT_OK, kv: tbl };
    }

    public async beginTransaction(): Promise<{ err: ErrorCode, value: BaseStorage.StorageTransaction }> {
        assert(this.m_db);
        let transcation = new StorageTransaction(this.m_db!);

        await transcation.beginTransaction();

        return { err: ErrorCode.RESULT_OK, value: transcation };
    }
}
