import {BufferWriter} from './lib/writer';
import {BufferReader} from './lib/reader';

export {BufferWriter} from './lib/writer';
export {BufferReader} from './lib/reader';

import {ErrorCode} from './error_code';
export {ErrorCode} from './error_code';

import {Encoding} from './lib/encoding';
import * as digest from './lib/digest';


export interface JSONable {
    stringify(): any;
}

export interface Serializable {
    encode(writer: BufferWriter): BufferWriter;
    decode(reader: BufferReader): ErrorCode;
}

export class SerializableWithHash implements Serializable, JSONable {
    constructor() {
        this.m_hash = Encoding.NULL_HASH;
    }
    get hash(): string {
        return this.m_hash;
    }

    protected m_hash: string;

    protected _encodeHashContent(writer: BufferWriter): BufferWriter {
        return writer;
    }
    protected _decodeHashContent(reader: BufferReader): ErrorCode {
        return ErrorCode.RESULT_OK;
    }

    public encode(writer: BufferWriter): BufferWriter {
        // writer.writeHash(this.hash);
        writer = this._encodeHashContent(writer);
        return writer;
    }

    public decode(reader: BufferReader): ErrorCode {
        // this.m_hash = reader.readHash('hex');
        let err = this._decodeHashContent(reader);
        this.updateHash();
        return err;
    }

    public updateHash(): void {
        this.m_hash = this._genHash();
    }

    protected _genHash(): string {
        let contentWriter: BufferWriter = new  BufferWriter();
        this._encodeHashContent(contentWriter);
        let content: Buffer = contentWriter.render();
        return digest.hash256(content).toString('hex');
    }

    protected _verifyHash(): boolean {
        return this.hash === this._genHash();
    }

    stringify(): any {
        return {hash: this.hash};
    }
}
