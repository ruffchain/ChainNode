import {ErrorCode} from '../error_code';
import { BufferReader } from '../lib/reader';
import { BufferWriter } from '../lib/writer';
import { write } from 'fs-extra';

let MAIN_VERSION: string = '1.2.3.4';

export class Version {
    protected m_mainVersion: string;
    protected m_timestamp: number;
    protected m_peerid: string;
    constructor() {
        this.m_mainVersion = MAIN_VERSION;
        this.m_timestamp = Date.now();
        this.m_peerid = '';
    }

    set mainversion(v: string) {
        this.m_mainVersion = v;
    }

    get mainversion(): string {
        return this.m_mainVersion;
    }

    get timestamp(): number {
        return this.m_timestamp;
    }

    set peerid(p: string) {
        this.m_peerid = p;
    }

    get peerid(): string {
        return this.m_peerid;
    }

    public decode(reader: BufferReader): ErrorCode {
        this.m_timestamp =  reader.readU64();
        this.m_peerid = reader.readVarString();
        this.m_mainVersion = reader.readVarString();

        return ErrorCode.RESULT_OK;
    }

    public encode(writer: BufferWriter): BufferWriter {
        writer.writeU64(this.m_timestamp);
        writer.writeVarString(this.m_peerid);
        writer.writeVarString(this.m_mainVersion);
        return writer;
    }

    public isSupport(): boolean {
        return true;
    }
}