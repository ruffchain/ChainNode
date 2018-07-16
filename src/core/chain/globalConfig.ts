import * as sqlite from 'sqlite';
import * as sqlite3 from 'sqlite3';
import {ErrorCode} from '../error_code';
import * as path from 'path';
import {StorageTable} from '../storage_sqlite/storage';

class GlobalConfig {
    protected m_map: Map<string, any> = new Map();
    protected m_isLoad: boolean = false;
    constructor() {

    }

    public getConfig(key: string, d: any = null): any {
        return this.m_map.get(key) || d;
    }

    public isLoad(): boolean {
        return this.m_isLoad;
    }

    public async loadConfig(dataDir: string, kvConfig: string, dbFile: string): Promise<ErrorCode> {
        let gh = await this.getGenesisHeaderHash(dataDir, dbFile);
        if (gh.err) {
            return gh.err;
        }
        let filePath = path.join(dataDir, `./storage/dump/${gh.hash!}`);
        let db: sqlite.Database = await sqlite.open(filePath, { mode: sqlite3.OPEN_READONLY });
        let kv: StorageTable = new StorageTable(db, kvConfig);
        let ga = await kv.getAll();
        if (ga.err) {
            console.log(`getAll failed, err ${ga.err}`);
            db.close();
            return ga.err;
        }
        this.m_map = ga.value;
        db.close();
        this.m_isLoad = true;

        return ErrorCode.RESULT_OK;
    }

    protected async getGenesisHeaderHash(dataDir: string, dbFile: string): Promise<{err: ErrorCode, hash?: string}> {
        let db: sqlite.Database;
        try {
           db = await sqlite.open(dataDir + '/' + dbFile, { mode: sqlite3.OPEN_READONLY });
        } catch (error) {
            return {err: ErrorCode.RESULT_NOT_FOUND};
        }

        const result = await db.get('select hash from best where height=0');
        if (!result || !result.hash) {
            return {err: ErrorCode.RESULT_NOT_FOUND};
        }

        await db.close();
        return {err: ErrorCode.RESULT_OK, hash: result.hash};
    }
}

export = new GlobalConfig();