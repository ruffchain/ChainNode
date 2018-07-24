import * as sqlite from 'sqlite';
import * as sqlite3 from 'sqlite3';
import {ErrorCode} from '../error_code';
import * as path from 'path';
import {SqliteStorageTable} from '../storage_sqlite/storage';
import { LoggerInstance } from '../lib/logger_util';

export class GlobalConfig {
    private m_map: Map<string, any> = new Map();
    constructor(private m_logger: LoggerInstance) {

    }

    public getConfig(key: string, d?: any): any {
        return this.m_map.get(key) || d;
    }

    public async loadConfig(dataDir: string, kvConfig: string, dbFile: string): Promise<ErrorCode> {
        let gh = await this.getGenesisHeaderHash(dataDir, dbFile);
        if (gh.err) {
            return gh.err;
        }
        let filePath = path.join(dataDir, `./storage/dump/${gh.hash!}`);
        let db;
        try {
            db = await sqlite.open(filePath, { mode: sqlite3.OPEN_READONLY });
        } catch (error) {
            this.m_logger.error(`open database ${filePath} failed.`);
            return ErrorCode.RESULT_FAILED;
        }

        let kv: SqliteStorageTable = new SqliteStorageTable(db, kvConfig);

        let ga = await kv.getAll();
        if (ga.err) {
            this.m_logger.error(`get chainConfig from ${filePath} failed, err ${ga.err}`);
        } else {
            this.m_map = ga.value;
        }
        
        await db.close();
        return ga.err;
    }

    private async getGenesisHeaderHash(dataDir: string, dbFile: string): Promise<{err: ErrorCode, hash?: string}> {
        let db: sqlite.Database;
        try {
           db = await sqlite.open(dataDir + '/' + dbFile, { mode: sqlite3.OPEN_READONLY });
        } catch (error) {
            this.m_logger.error(`open database ${dataDir + '/' + dbFile} failed. Ignore it if create Genesis.`);
            return {err: ErrorCode.RESULT_FAILED};
        }

        const result = await db.get('select hash from best where height=0');
        if (!result || !result.hash) {
            this.m_logger.error(`cannot find genesis hash from ${dataDir + '/' + dbFile}`);
            return {err: ErrorCode.RESULT_NOT_FOUND};
        }

        await db.close();
        return {err: ErrorCode.RESULT_OK, hash: result.hash};
    }
}