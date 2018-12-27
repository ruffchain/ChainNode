const assert = require('assert');
import {ErrorCode, stringifyErrorCode} from '../error_code';
import {LoggerInstance} from '../lib/logger_util';
import {StorageManager, IReadableStorage} from '../storage';
import * as fs from 'fs-extra';
import { SqliteStorage } from '../storage_sqlite/storage';

export interface BlockExecutorExternParam {
    value: any;
    type: string;
    finalize(): void;
    interprocessEncode(): Promise<{err: ErrorCode, result?: any}>;
} 

class InprocessStorageParam implements BlockExecutorExternParam {
    private m_storage?: IReadableStorage;
    private m_storageManager?: StorageManager;
    private m_blockHash?: string;
    private m_encodedPath?: string;
    private m_logger: LoggerInstance;

    static type: string = 'storage';

    get type() {
        return InprocessStorageParam.type;
    }

    constructor(options: {logger: LoggerInstance}) {
        this.m_logger = options.logger;
    }

    async init(options: {storageManager: StorageManager, blockHash: string}): Promise<ErrorCode> {
        this.m_logger.debug(`begin create external storage param ${options.blockHash}`);
        const vr = await options.storageManager.getSnapshotView(options.blockHash);
        if (vr.err) {
            this.m_logger.error(`create extern storage param ${options.blockHash} failed for ${stringifyErrorCode(vr.err)}`);
            return vr.err;
        }
        this.m_storage = vr.storage!;
        this.m_storageManager = options.storageManager;
        this.m_blockHash = options.blockHash;
        return ErrorCode.RESULT_OK;
    }

    get value(): IReadableStorage {
        return this.m_storage!;
    }

    finalize(): void {
        if (!this.m_blockHash) {
            return ;
        }
        this.m_logger.debug(`extern storage param ${this.m_blockHash} finalized`);
        this.m_storageManager!.releaseSnapshotView(this.m_blockHash!);
        if (this.m_encodedPath && fs.existsSync(this.m_encodedPath)) {
            this.m_logger.debug(`extern storage param ${this.m_blockHash} has encoded, remove encode path ${this.m_encodedPath}`);
            fs.unlinkSync(this.m_encodedPath);
        }
    }

    async interprocessEncode(): Promise<{err: ErrorCode, result?: any}> {
        assert(this.m_storageManager, `try to interprocess encode null storage`);
        if (this.m_encodedPath) {
            assert(false, `encode twice, last encode path is ${this.m_encodedPath}`);
            return {err: ErrorCode.RESULT_ALREADY_EXIST};
        }
        const name = `${Date.now()}${this.m_blockHash!}`;
        this.m_logger.debug(`interprocess encode storage param ${this.m_blockHash} to path ${name}`);
        const csr = await this.m_storageManager!.createStorage(name, this.m_blockHash!);
        if (csr.err) {
            this.m_logger.error(`interprocess encode storage param ${this.m_blockHash} failed for ${stringifyErrorCode(csr.err)}`);
            return {err: csr.err};
        }
        this.m_encodedPath = csr.storage!.filePath;
        await csr.storage!.uninit();
        return {
            err: ErrorCode.RESULT_OK, 
            result: { 
                path: this.m_encodedPath
            }
        };
    }
}

class InterprocessStorageParam implements BlockExecutorExternParam {
    private m_storage?: SqliteStorage;
    private m_logger: LoggerInstance;

    constructor(options: {logger: LoggerInstance}) {
        this.m_logger = options.logger;
    }

    get type() {
        return InprocessStorageParam.type;
    }

    async init(options: {encoded: any}): Promise<ErrorCode> {
        let storage = new SqliteStorage({ 
            filePath: options.encoded.path, 
            logger: this.m_logger
        });
        const err = await storage.init(true);
        if (err) {
            return err;   
        }
        this.m_storage = storage;
        return ErrorCode.RESULT_OK;
    }

    get value(): IReadableStorage {
        return this.m_storage!;
    }

    finalize(): void {
        if (!this.m_storage) {
            return ;
        }
        this.m_logger.debug(`interprocess extern storage param ${this.m_storage.filePath} finalize`);
        this.m_storage!.uninit();
    }

    async interprocessEncode(): Promise<{err: ErrorCode, result?: any}> {
        assert(false, `should not encode storage param in worker routine`);
        return {err: ErrorCode.RESULT_NO_IMP};
    }
}

export class BlockExecutorExternParamCreator {
    constructor(options: {logger: LoggerInstance}) {
        this.m_logger = options.logger;
    }
    private m_logger: LoggerInstance;

    async createStorage(options: {storageManager: StorageManager, blockHash: string}): Promise<{err: ErrorCode, param?: BlockExecutorExternParam}> {
        const p = new InprocessStorageParam({
            logger: this.m_logger
        });
        const err = await p.init(options);
        if (err) {
            return {err};
        }
        return {err: ErrorCode.RESULT_OK, param: p};
    }

    async interprocessEncode(params: BlockExecutorExternParam[]): Promise<{err: ErrorCode, encoded?: object[]}> {
        let err: ErrorCode = ErrorCode.RESULT_OK;
        let ops = [];
        for (const p of params) {
            if (p.type === InprocessStorageParam.type) {
            } else {
                err = ErrorCode.RESULT_INVALID_PARAM;
                break;
            }
            ops.push(p.interprocessEncode());
        }
        if (err) {
            return {err};
        }
        let results = await Promise.all(ops);
        let encoded = [];
        for (let ix = 0; ix < results.length; ++ix) {
            const r = results[ix];
            const p = params[ix];
            if (r.err) {
                return {err: r.err};
            }
            encoded.push({
                type: p.type,
                encoded: r.result!
            });
        }
        return {err: ErrorCode.RESULT_OK, encoded};
    }

    async interprocessDecode(encoded: any[]): Promise<{err: ErrorCode, params?: BlockExecutorExternParam[]}> {
        let params = [];
        let err = ErrorCode.RESULT_OK;
        let ops = [];
        for (const e of encoded) {
            if (e.type === InprocessStorageParam.type) {
                ops.push(this._decodeStorage(e.encoded));
            } else {
                err = ErrorCode.RESULT_INVALID_PARAM;
            }
        }
        if (err) {
            return {err};
        }
        const results = await Promise.all(ops);
        for (const r of results) {
            if (r.err) {
                return {err: r.err};
            }
            params.push(r.param!);
        }
        return {err: ErrorCode.RESULT_OK, params};
    }
    
    async _decodeStorage(encoded: any): Promise<{err: ErrorCode, param?: BlockExecutorExternParam}> {
        const p = new InterprocessStorageParam({
            logger: this.m_logger
        });
        const err = await p.init({encoded});
        if (err) {
            return {err};
        }
        return {err: ErrorCode.RESULT_OK, param: p}; 
    }
}