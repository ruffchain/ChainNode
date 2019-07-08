import * as sqlite from 'sqlite';
import { BlockHeader } from './block';
import { BufferWriter } from '../lib/writer';
import { BufferReader } from '../lib/reader';
import { ErrorCode } from '../error_code';
import * as assert from 'assert';
import { LoggerInstance } from 'winston';
import { LRUCache } from '../lib/LRUCache';
import { isArray, isNullOrUndefined } from 'util';
import { Lock } from '../lib/Lock';
import { BlockStorage } from './block_storage';
import { IConsistency } from './consistency';

const initHeaderSql = 'CREATE TABLE IF NOT EXISTS "headers"("hash" CHAR(64) PRIMARY KEY NOT NULL UNIQUE, "pre" CHAR(64) NOT NULL, "verified" TINYINT NOT NULL, "raw" BLOB NOT NULL);';
const initBestSql = 'CREATE TABLE IF NOT EXISTS "best"("height" INTEGER PRIMARY KEY NOT NULL UNIQUE, "hash" CHAR(64) NOT NULL,  "timestamp" INTEGER NOT NULL);';
const getByHashSql = 'SELECT raw, verified FROM headers WHERE hash = $hash';
// Yang Jun Modified 2019-7-8
// const getByTimestampSql = 'SELECT h.raw, h.verified FROM headers AS h LEFT JOIN best AS b ON b.hash = h.hash WHERE b.timestamp = $timestamp';
// const getHeightOnBestSql = 'SELECT b.height, h.raw, h.verified FROM headers AS h LEFT JOIN best AS b ON b.hash = h.hash WHERE b.hash = $hash';
// const getByHeightSql = 'SELECT h.raw, h.verified FROM headers AS h LEFT JOIN best AS b ON b.hash = h.hash WHERE b.height = $height';
const getHeightOnBestSql = 'select raw from headers where hash=$hash and (1==(select count(hash) from best where hash=$hash))';
const getByHeightSql = 'select raw, verified from headers where hash in (select hash from best where height=$height)';
/////////////////////////
const insertHeaderSql = 'INSERT INTO headers (hash, pre, raw, verified) VALUES($hash, $pre, $raw, $verified)';
const getBestHeightSql = 'SELECT max(height) AS height FROM best';
const rollbackBestSql = 'DELETE best WHERE height > $height';
const extendBestSql = 'INSERT INTO best (hash, height, timestamp) VALUES($hash, $height, $timestamp)';
// const getTipSql = 'SELECT h.raw, h.verified FROM headers AS h LEFT JOIN best AS b ON b.hash = h.hash ORDER BY b.height DESC';
const getTipSql = 'select raw, verified from headers where hash in (select hash from best order by height desc limit 1)';
/////////////////////////
const updateVerifiedSql = 'UPDATE headers SET verified=$verified WHERE hash=$hash';
const getByPreBlockSql = 'SELECT raw, verified FROM headers WHERE pre = $pre';

export interface IHeaderStorage extends IConsistency {
    init(): Promise<ErrorCode>;
    uninit(): void;
    getHeader(arg1: string | number | 'latest'): Promise<{ err: ErrorCode, header?: BlockHeader, verified?: VERIFY_STATE }>;
    getHeader(arg1: string | BlockHeader, arg2: number, arg3?: boolean): Promise<{ err: ErrorCode, header?: BlockHeader, headers?: BlockHeader[] }>;
    getHeightOnBest(hash: string): Promise<{ err: ErrorCode, height?: number, header?: BlockHeader }>;
    saveHeader(header: BlockHeader): Promise<ErrorCode>;
    createGenesis(genesis: BlockHeader): Promise<ErrorCode>;
    getNextHeader(hash: string): Promise<{ err: ErrorCode, results?: { header: BlockHeader, verified: VERIFY_STATE }[] }>;
    updateVerified(header: BlockHeader, verified: VERIFY_STATE): Promise<ErrorCode>;
    changeBest(header: BlockHeader): Promise<ErrorCode>;
}

export enum VERIFY_STATE {
    notVerified = 0,
    verified = 1,
    invalid = 2
}

class BlockHeaderEntry {
    public blockheader: BlockHeader;
    public verified: VERIFY_STATE;
    constructor(blockheader: BlockHeader, verified: VERIFY_STATE) {
        this.blockheader = blockheader;
        this.verified = verified;
    }
}

export class HeaderStorage implements IHeaderStorage {
    private m_db: sqlite.Database;
    private m_blockHeaderType: new () => BlockHeader;

    private m_logger: LoggerInstance;

    protected m_cacheHeight: LRUCache<number, BlockHeaderEntry>;
    protected m_cacheHash: LRUCache<string, BlockHeaderEntry>;
    private m_transactionLock = new Lock();
    private m_readonly: boolean;
    private m_relayOpt: any;

    constructor(options: {
        logger: LoggerInstance;
        blockHeaderType: new () => BlockHeader,
        db: sqlite.Database,
        blockStorage: BlockStorage,
        readonly?: boolean
    }) {
        this.m_readonly = !!(options && options.readonly);
        this.m_db = options.db;
        this.m_blockHeaderType = options.blockHeaderType;
        this.m_logger = options.logger;
        this.m_cacheHeight = new LRUCache<number, BlockHeaderEntry>(100);
        this.m_cacheHash = new LRUCache<string, BlockHeaderEntry>(100);
    }

    public async init(): Promise<ErrorCode> {
        if (!this.m_readonly) {
            try {
                let stmt = await this.m_db.run(initHeaderSql);
                stmt = await this.m_db.run(initBestSql);
            } catch (e) {
                this.m_logger.error(e);
                return ErrorCode.RESULT_EXCEPTION;
            }
        }
        return ErrorCode.RESULT_OK;
    }

    uninit() {

    }

    public async getHeader(arg1: string | number | 'latest'): Promise<{ err: ErrorCode, header?: BlockHeader, verified?: VERIFY_STATE }>;

    public async getHeader(arg1: string | BlockHeader, arg2: number, arg3?: boolean): Promise<{ err: ErrorCode, header?: BlockHeader, headers?: BlockHeader[] }>;

    public async getHeader(arg1: string | number | 'latest' | BlockHeader, arg2?: number, arg3?: boolean): Promise<{ err: ErrorCode, header?: BlockHeader, headers?: BlockHeader[] }> {
        let header: BlockHeader | undefined;
        if (isNullOrUndefined(arg2)) {
            if (arg1 instanceof BlockHeader) {
                assert(false);
                return { err: ErrorCode.RESULT_INVALID_PARAM };
            }
            return await this._loadHeader(arg1);
        } else {
            let fromHeader: BlockHeader;
            if (arg1 instanceof BlockHeader) {
                fromHeader = arg1;
            } else {
                let hr = await this._loadHeader(arg1);
                if (hr.err) {
                    return hr;
                }
                fromHeader = hr.header!;
            }
            const withHeaders = isNullOrUndefined(arg3) ? true : arg3;
            let headers: BlockHeader[] | undefined;
            if (withHeaders) {
                headers = [];
                headers.unshift(fromHeader);
            }
            if (arg2 > 0) {
                assert(false);
                return { err: ErrorCode.RESULT_INVALID_PARAM };
            } else {
                if (fromHeader.number + arg2 < 0) {
                    arg2 = -fromHeader.number;
                }
                for (let ix = 0; ix < -arg2; ++ix) {
                    let hr = await this._loadHeader(fromHeader.preBlockHash);
                    if (hr.err) {
                        return hr;
                    }
                    fromHeader = hr.header!;
                    if (headers) {
                        headers.unshift(fromHeader);
                    }
                }
                return { err: ErrorCode.RESULT_OK, header: fromHeader, headers };
            }
        }
    }

    protected async _loadHeader(arg: number | string): Promise<{ err: ErrorCode, header?: BlockHeader, verified?: VERIFY_STATE }> {
        let rawHeader: Buffer;
        let verified: VERIFY_STATE;
        if (typeof arg === 'number') {
            let headerEntry: BlockHeaderEntry | null = this.m_cacheHeight.get(arg as number);
            if (headerEntry) {
                return { err: ErrorCode.RESULT_OK, header: headerEntry.blockheader, verified: headerEntry.verified };
            }
            try {
                let result = await this.m_db.get(getByHeightSql, { $height: arg });
                if (!result) {
                    return { err: ErrorCode.RESULT_NOT_FOUND };
                }
                rawHeader = result.raw;
                verified = result.verified;
            } catch (e) {
                this.m_logger.error(`load Header height ${arg} failed, ${e}`);
                return { err: ErrorCode.RESULT_EXCEPTION };
            }
        } else if (typeof arg === 'string') {
            if (arg === 'latest') {
                try {
                    let result = await this.m_db.get(getTipSql);
                    if (!result) {
                        return { err: ErrorCode.RESULT_NOT_FOUND };
                    }
                    rawHeader = result.raw;
                    verified = result.verified;
                } catch (e) {
                    this.m_logger.error(`load latest Header failed, ${e}`);
                    return { err: ErrorCode.RESULT_EXCEPTION };
                }
            } else {
                let headerEntry: BlockHeaderEntry | null = this.m_cacheHash.get(arg as string);
                if (headerEntry) {
                    // this.m_logger.debug(`get header storage directly from cache hash: ${headerEntry.blockheader.hash} number: ${headerEntry.blockheader.number} verified: ${headerEntry.verified}`);
                    return { err: ErrorCode.RESULT_OK, header: headerEntry.blockheader, verified: headerEntry.verified };
                }

                try {
                    let result = await this.m_db.get(getByHashSql, { $hash: arg });
                    if (!result) {
                        return { err: ErrorCode.RESULT_NOT_FOUND };
                    }
                    rawHeader = result.raw;
                    verified = result.verified;
                } catch (e) {
                    this.m_logger.error(`load Header hash ${arg} failed, ${e}`);
                    return { err: ErrorCode.RESULT_EXCEPTION };
                }
            }
        } else {
            return { err: ErrorCode.RESULT_INVALID_PARAM };
        }
        let header: BlockHeader = new this.m_blockHeaderType();
        let err: ErrorCode = header.decode(new BufferReader(rawHeader, false));
        if (err !== ErrorCode.RESULT_OK) {
            this.m_logger.error(`decode header ${arg} from header storage failed`);
            return { err };
        }
        if (arg !== 'latest' && header.number !== arg && header.hash !== arg) {
            return { err: ErrorCode.RESULT_EXCEPTION };
        }
        let entry: BlockHeaderEntry = new BlockHeaderEntry(header, verified);
        // this.m_logger.debug(`update header storage cache hash: ${header.hash} number: ${header.number} verified: ${verified}`);
        this.m_cacheHash.set(header.hash, entry);
        if (typeof arg === 'number') {
            this.m_cacheHeight.set(header.number, entry);
        }

        return { err: ErrorCode.RESULT_OK, header, verified };
    }

    public async getHeightOnBest(hash: string): Promise<{ err: ErrorCode, height?: number, header?: BlockHeader }> {
        // Yang Jun 2019-7-8
        // let result = await this.m_db.get(getHeightOnBestSql, { $hash: hash });
        // if (!result || result.height === undefined) {
        let result = await this.m_db.get('select raw from headers where hash=$hash', { $hash: hash });
        if (!result || !result.raw) {
            return { err: ErrorCode.RESULT_NOT_FOUND };
        }

        let header: BlockHeader = new this.m_blockHeaderType();
        // let err: ErrorCode = header.decode(new BufferReader(result.raw, false));
        let err: ErrorCode = header.decode(new BufferReader(result['raw'], false));
        if (err !== ErrorCode.RESULT_OK) {
            this.m_logger.error(`decode header ${hash} from header storage failed`);
            return { err };
        }
        // Yang Jun 2019-7-8
        // return { err: ErrorCode.RESULT_OK, height: result.height, header };
        result = await this.m_db.get('select hash from best where height=$height', { $height: header.number });
        if (!result || !result.hash || result.hash !== header.hash) {
            return { err: ErrorCode.RESULT_NOT_FOUND };
        }

        return { err: ErrorCode.RESULT_OK, height: header.number, header };
    }

    protected async _saveHeader(header: BlockHeader): Promise<ErrorCode> {
        let writer = new BufferWriter();
        let err = header.encode(writer);
        if (err) {
            this.m_logger.error(`encode header failed `, err);
            return err;
        }
        try {
            let headerRaw = writer.render();
            await this.m_db.run(insertHeaderSql, { $hash: header.hash, $raw: headerRaw, $pre: header.preBlockHash, $verified: VERIFY_STATE.notVerified });
        } catch (e) {
            this.m_logger.error(`save Header ${header.hash}(${header.number}) failed, ${e}`);
            return ErrorCode.RESULT_EXCEPTION;
        }
        return ErrorCode.RESULT_OK;
    }

    public async saveHeader(header: BlockHeader): Promise<ErrorCode> {
        return await this._saveHeader(header);
    }

    public async createGenesis(genesis: BlockHeader): Promise<ErrorCode> {
        assert(genesis.number === 0);
        if (genesis.number !== 0) {
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        let writer = new BufferWriter();
        let err = genesis.encode(writer);
        if (err) {
            this.m_logger.error(`genesis block encode failed`);
            return err;
        }
        let hash = genesis.hash;
        let headerRaw = writer.render();
        await this.m_db.run(insertHeaderSql, { $hash: genesis.hash, $pre: genesis.preBlockHash, $raw: headerRaw, $verified: VERIFY_STATE.verified });
        await this.m_db.run(extendBestSql, { $hash: genesis.hash, $height: genesis.number, $timestamp: genesis.timestamp });

        return ErrorCode.RESULT_OK;
    }

    public async getNextHeader(hash: string): Promise<{ err: ErrorCode, results?: { header: BlockHeader, verified: VERIFY_STATE }[] }> {
        let query: any;
        try {
            query = await this.m_db.all(getByPreBlockSql, { $pre: hash });
        } catch (e) {
            this.m_logger.error(`getNextHeader ${hash} failed, ${e}`);
            return { err: ErrorCode.RESULT_EXCEPTION };
        }
        if (!query || !query.length) {
            return { err: ErrorCode.RESULT_NOT_FOUND };
        }
        let results = [];
        for (let result of query) {
            let header: BlockHeader = new this.m_blockHeaderType();
            let err: ErrorCode = header.decode(new BufferReader(result.raw, false));
            if (err !== ErrorCode.RESULT_OK) {
                this.m_logger.error(`decode header ${result.hash} from header storage failed`);
                return { err };
            }
            results.push({ header, verified: result.verified });
        }
        return { err: ErrorCode.RESULT_OK, results };
    }

    public async updateVerified(header: BlockHeader, verified: VERIFY_STATE): Promise<ErrorCode> {
        try {
            this.m_logger.debug(`remove header storage cache hash: ${header.hash} number: ${header.number}`);
            this.m_cacheHash.remove(header.hash);
            this.m_cacheHeight.remove(header.number);
            await this.m_db.run(updateVerifiedSql, { $hash: header.hash, $verified: verified });
        } catch (e) {
            this.m_logger.error(`updateVerified ${header.hash}(${header.number}) failed, ${e}`);
            return ErrorCode.RESULT_EXCEPTION;
        }
        return ErrorCode.RESULT_OK;
    }

    public async beginConsistency(): Promise<void> {
        this.m_relayOpt = undefined;
    }
    public async commitConsistency(): Promise<void> {
        if (this.m_relayOpt) {
            this.m_relayOpt();
        }
    }

    public async rollbackConsistency(): Promise<void> {
        this.m_relayOpt = undefined;
    }

    public async changeBest(header: BlockHeader): Promise<ErrorCode> {
        let sqls: string[] = [];
        sqls.push(`INSERT INTO best (hash, height, timestamp) VALUES("${header.hash}", "${header.number}", "${header.timestamp}")`);
        let forkFrom = header;
        let delPoint: { begin: number, end: number } = { begin: 0, end: 0 };

        while (true) {
            let result = await this.getHeightOnBest(forkFrom.preBlockHash);
            if (result.err === ErrorCode.RESULT_OK) {
                let gh = await this._getBestHeight();
                if (gh.err) {
                    return gh.err;
                }
                assert(result.header);
                forkFrom = result.header!;
                sqls.push(`DELETE FROM best WHERE height > ${forkFrom.number}`);
                delPoint.begin = forkFrom.number + 1;
                delPoint.begin = gh.height!; // 这里不能直接用header.number，因为分叉前的best的高度可能高于header
                break;
            } else if (result.err === ErrorCode.RESULT_NOT_FOUND) {
                let _result = await this._loadHeader(forkFrom.preBlockHash);
                assert(_result.header);
                forkFrom = _result.header!;
                sqls.push(`INSERT INTO best (hash, height, timestamp) VALUES("${forkFrom.hash}", "${forkFrom.number}", "${forkFrom.timestamp}")`);
                continue;
            } else {
                return result.err;
            }
        }
        sqls.push(`UPDATE headers SET verified="${VERIFY_STATE.verified}" WHERE hash="${header.hash}"`);
        sqls = sqls.reverse();
        try {
            for (let sql of sqls) {
                await this.m_db.run(sql);
            }
        } catch (e) {
            this.m_logger.error(`changeBest ${header.hash}(${header.number}) failed, ${e}`);
            return ErrorCode.RESULT_EXCEPTION;
        }
        this.m_logger.debug(`remove header storage cache hash: ${header.hash} number: ${header.number}`);
        this.m_relayOpt = () => {
            // 可能先前已经添加了header，但是这次状态变化了，所以需要删除
            this.m_cacheHash.remove(header.hash);
            for (let i = delPoint.begin; i <= delPoint.end; i++) {
                this.m_cacheHeight.remove(i);
            }
        };
        return ErrorCode.RESULT_OK;
    }

    protected async _getBestHeight(): Promise<{ err: ErrorCode, height?: number }> {
        try {
            let r = await this.m_db!.get(getBestHeightSql);
            if (!r || !r.height) {
                return { err: ErrorCode.RESULT_OK, height: 0 };
            }

            return { err: ErrorCode.RESULT_OK, height: r.height };
        } catch (e) {
            this.m_logger.error(`_getBestHeight failed, e=${e}`);
            return { err: ErrorCode.RESULT_EXCEPTION };
        }
    }
}
