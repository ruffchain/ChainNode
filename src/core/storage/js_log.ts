import { ErrorCode } from '../error_code';
import * as BaseLogger from './logger';
import {BufferReader, BufferWriter} from '../serializable';
import {StorageTransaction, IWritableKeyValue, IReadWritableStorage} from './storage';

class TransactionLogger implements StorageTransaction {
    constructor(private owner: JStorageLogger) {

    }

    async beginTransaction(): Promise<ErrorCode> {
        this.owner.appendLog(`{let trans = (await storage.beginTransaction()).value;`);
        return ErrorCode.RESULT_OK;
    }

    async commit(): Promise<ErrorCode> {
        this.owner.appendLog(`await trans.commit();}`);
        return ErrorCode.RESULT_OK;
    }

    async rollback(): Promise<ErrorCode> {
        this.owner.appendLog(`await trans.rollback();}`);
        return ErrorCode.RESULT_OK;
    }
}

class KeyValueLogger implements IWritableKeyValue {
    constructor(private owner: JStorageLogger, private name: string) {
        
    }
    
    async set(key: string, value: any): Promise<{ err: ErrorCode }> {
        this.owner.appendLog(`await ${this.name}.set(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
        return {err: ErrorCode.RESULT_OK};
    }
    
    // hash
    async hset(key: string, field: string, value: any): Promise<{ err: ErrorCode }> {
        this.owner.appendLog(`await ${this.name}.hset(${JSON.stringify(key)}, ${JSON.stringify(field)}, ${JSON.stringify(value)});`);
        return {err: ErrorCode.RESULT_OK};
    }
    async hmset(key: string, fields: string[], values: any[]): Promise<{ err: ErrorCode }> {
        this.owner.appendLog(`await ${this.name}.hmset(${JSON.stringify(key)}, ${JSON.stringify(fields)}, ${JSON.stringify(values)});`);
        return {err: ErrorCode.RESULT_OK};
    }
    async hclean(key: string): Promise<ErrorCode> {
        this.owner.appendLog(`await ${this.name}.hclean(${JSON.stringify(key)});`);
        return ErrorCode.RESULT_OK;
    }

    public async hdel(key: string, field: string): Promise<{err: ErrorCode}> {
        this.owner.appendLog(`await ${this.name}.hdel(${key},${field})`);
        return {err: ErrorCode.RESULT_OK };
    }
    
    // array
    async lset(key: string, index: number, value: any): Promise<{ err: ErrorCode }> {
        this.owner.appendLog(`await ${this.name}.lset(${JSON.stringify(key)}, ${index}, ${JSON.stringify(value)});`);
        return {err: ErrorCode.RESULT_OK};
    }

    async lpush(key: string, value: any): Promise<{ err: ErrorCode }> {
        this.owner.appendLog(`await ${this.name}.lpush(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
        return {err: ErrorCode.RESULT_OK};
    }
    async lpushx(key: string, value: any[]): Promise<{ err: ErrorCode }> {
        this.owner.appendLog(`await ${this.name}.lpushx(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
        return {err: ErrorCode.RESULT_OK};
    }
    async lpop(key: string): Promise<{ err: ErrorCode, value?: any }> {
        this.owner.appendLog(`await ${this.name}.lpop(${JSON.stringify(key)});`);
        return {err: ErrorCode.RESULT_OK};
    }

    async rpush(key: string, value: any): Promise<{ err: ErrorCode }> {
        this.owner.appendLog(`await ${this.name}.rpush(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
        return {err: ErrorCode.RESULT_OK};
    }
    async rpushx(key: string, value: any[]): Promise<{ err: ErrorCode }> {
        this.owner.appendLog(`await ${this.name}.rpushx(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
        return {err: ErrorCode.RESULT_OK};
    }
    async rpop(key: string): Promise<{ err: ErrorCode, value?: any }> {
        this.owner.appendLog(`await ${this.name}.rpop(${JSON.stringify(key)});`);
        return {err: ErrorCode.RESULT_OK};
    }

    async linsert(key: string, index: number, value: any): Promise<{ err: ErrorCode }> {
        this.owner.appendLog(`await ${this.name}.linsert(${JSON.stringify(key)}, ${index}, ${JSON.stringify(value)});`);
        return {err: ErrorCode.RESULT_OK};
    }
    async lremove(key: string, index: number): Promise<{ err: ErrorCode, value?: any }> {
        this.owner.appendLog(`await ${this.name}.hset(${JSON.stringify(key)}, ${index});`);
        return {err: ErrorCode.RESULT_OK};
    }
}

export class JStorageLogger implements BaseLogger.StorageLogger {
    constructor() {
        this.m_log = '';
    }
    private m_log: string = '';
    private m_nextVal: number = 0;

    private _kvVal(): string {
        let val = `kv${this.m_nextVal}`;
        ++this.m_nextVal;
        return val;
    }

    get log(): string {
        return this.m_log!;
    }

    redoOnStorage(storage: IReadWritableStorage): Promise<ErrorCode> {
        return new Promise((resolve) => {
            eval(this.m_log);
        });
    }

    encode(writer: BufferWriter): BufferWriter {
        writer.writeVarString(this.m_log);
        return writer;
    }

    decode(reader: BufferReader): ErrorCode {
        this.m_log = reader.readVarString();
        return ErrorCode.RESULT_OK;
    }

    init(): any {
        this.m_log = 'async function redo() {';
    }

    finish() {
        this.appendLog('}; redo().then(()=>{resolve(0);})');
    }

    appendLog(log: string) {
        this.m_log += log;
    }

    async createKeyValue(name: string): Promise<{err: ErrorCode, kv?: IWritableKeyValue}> {
        let val = this._kvVal();
        this.appendLog(`let ${val} = (await storage.createKeyValue(${JSON.stringify(name)})).kv;`);
        return {err: ErrorCode.RESULT_OK, kv: new KeyValueLogger(this, val)};
    }

    async beginTransaction(): Promise<{ err: ErrorCode, value: StorageTransaction }> {
        return {err: ErrorCode.RESULT_OK, value: new TransactionLogger(this)};
    }

    async getReadWritableKeyValue(name: string): Promise<{err: ErrorCode, kv?: IWritableKeyValue}> {
        let val = this._kvVal();
        this.appendLog(`let ${val} = (await storage.getReadWritableKeyValue(${JSON.stringify(name)})).kv;`);
        return {err: ErrorCode.RESULT_OK, kv: new KeyValueLogger(this, val)};
    }
}