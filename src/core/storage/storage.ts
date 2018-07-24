import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import { ErrorCode } from '../error_code';
import {LoggerInstance} from '../lib/logger_util';
import { StorageLogger, LoggedStorage } from './logger';
import { BufferReader } from '../lib/reader';

const digest = require('../lib/digest');

export interface IReadableKeyValue {
    // 单值操作
    get(key: string): Promise<{ err: ErrorCode, value?: any }>;
    getAll(): Promise<{ err: ErrorCode, value: Map<string, any>}>;

    // hash
    hexists(key: string, field: string): Promise<boolean>;
    hget(key: string, field: string): Promise<{ err: ErrorCode, value?: any }>;
    hmget(key: string, fields: string[]): Promise<{ err: ErrorCode, value: any[] }>;
    hlen(key: string): Promise<{ err: ErrorCode, value: number }>;
    hkeys(key: string): Promise<{ err: ErrorCode, value: string[] }>;
    hvalues(key: string): Promise<{ err: ErrorCode, value: any[] }>;
    hgetall(key: string): Promise<{ err: ErrorCode; value: any[]; }>;

    // array
    lindex(key: string, index: number): Promise<{ err: ErrorCode, value?: any }>;
    llen(key: string): Promise<{ err: ErrorCode, value: number }>;
    lrange(key: string, start: number, stop: number): Promise<{ err: ErrorCode, value: any[] }>;
}

export interface IWritableKeyValue {
    // 单值操作
    set(key: string, value: boolean|number|string): Promise<{ err: ErrorCode }>;
    
    // hash
    hset(key: string, field: string, value: boolean|number|string): Promise<{ err: ErrorCode }>;
    hmset(key: string, fields: string[], values: (boolean|number|string)[]): Promise<{ err: ErrorCode }>;
    hclean(key: string): Promise<ErrorCode>;
    hdel(key: string, field: string): Promise<{err: ErrorCode}>;
    
    // array
    lset(key: string, index: number, value: boolean|number|string): Promise<{ err: ErrorCode }>;

    lpush(key: string, value: boolean|number|string): Promise<{ err: ErrorCode }>;
    lpushx(key: string, value: (boolean|number|string)[]): Promise<{ err: ErrorCode }>;
    lpop(key: string): Promise<{ err: ErrorCode, value?: any }>;

    rpush(key: string, value: boolean|number|string): Promise<{ err: ErrorCode }>;
    rpushx(key: string, value: (boolean|number|string)[]): Promise<{ err: ErrorCode }>;
    rpop(key: string): Promise<{ err: ErrorCode, value?: boolean|number|string }>;

    linsert(key: string, index: number, value: boolean|number|string): Promise<{ err: ErrorCode }>;
    lremove(key: string, index: number): Promise<{ err: ErrorCode, value?: any }>;
}

export type IReadWritableKeyValue = IReadableKeyValue & IWritableKeyValue;

export interface StorageTransaction {
    beginTransaction(): Promise<ErrorCode>;
    commit(): Promise<ErrorCode>;
    rollback(): Promise<ErrorCode>;
}

export abstract class  IReadableStorage {
    public abstract getReadableKeyValue(name: string): Promise<{ err: ErrorCode, kv?: IReadableKeyValue }>;
}

export abstract class  IReadWritableStorage extends IReadableStorage {
    public abstract createKeyValue(name: string): Promise<{err: ErrorCode, kv?: IReadWritableKeyValue}>;
    public abstract getReadWritableKeyValue(name: string): Promise<{ err: ErrorCode, kv?: IReadWritableKeyValue }>;
    public abstract beginTransaction(): Promise<{ err: ErrorCode, value: StorageTransaction }>;
}

export type StorageOptions = {
    filePath: string, 
    logger: LoggerInstance
};

export abstract class Storage extends IReadWritableStorage {
    protected m_filePath: string;
    protected m_logger: LoggerInstance;
    protected m_storageLogger?: LoggedStorage;
    protected m_eventEmitter: EventEmitter = new EventEmitter();

    constructor(options: StorageOptions) {
        super();
        this.m_filePath = options.filePath;
        this.m_logger = options.logger;
    }   

    protected abstract _createLogger(): StorageLogger;

    public createLogger() {
        if (!this.m_storageLogger) {
            this.m_storageLogger = new LoggedStorage(this, this._createLogger());
        }
    }

    public get storageLogger(): StorageLogger|undefined {
        if (this.m_storageLogger) {
            return this.m_storageLogger.logger;
        }
    }

    on(event: 'init', listener: (err: ErrorCode) => any): this;
    on(event: string, listener: (...args: any[]) => void): this {
        this.m_eventEmitter.on(event, listener);
        return this;
    }
    once(event: 'init', listener: (err: ErrorCode) => any): this;
    once(event: string, listener: (...args: any[]) => void): this {
        this.m_eventEmitter.once(event, listener);
        return this;
    }

    public async redo(logBuf: Buffer): Promise<ErrorCode> {
        let logger = this._createLogger();
        let err = logger.decode(new BufferReader(logBuf));
        if (err) {
            return err;
        }
        return logger.redoOnStorage(this);
    }

    get filePath() {
        return this.m_filePath;
    }

    public abstract get isInit(): boolean;

    public abstract init(readonly?: boolean): Promise<ErrorCode>;

    public abstract uninit(): Promise<ErrorCode>;

    public async reset(): Promise<ErrorCode> {
        await this.remove();
        return await this.init();
    }

    public async remove() {
        await this.uninit();
        fs.removeSync(this.m_filePath);
    }

    public async messageDigest(): Promise<{ err: ErrorCode, value: ByteString }> {
        let buf = await fs.readFile(this.m_filePath);
        let hash = digest.hash256(buf).toString('hex');
        return { err: ErrorCode.RESULT_OK, value: hash };
    }
}