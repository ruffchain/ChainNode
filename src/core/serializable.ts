import {BufferWriter} from './lib/writer';
import {BufferReader} from './lib/reader';

export {BufferWriter} from './lib/writer';
export {BufferReader} from './lib/reader';

import {ErrorCode} from './error_code';
export {ErrorCode} from './error_code';

import {Encoding} from './lib/encoding';
import * as digest from './lib/digest';
import {BigNumber} from 'bignumber.js';
import { isUndefined, isNull, isNumber, isBuffer, isBoolean, isString, isArray, isObject } from 'util';


export interface JSONable {
    stringify(): any;
}

export function stringify(o: any): any {
    if (isUndefined(o) || isNull(o)) {
        return o;
    } else if (isNumber(o) || isString(o) || isBoolean(o)) {
        return o;
    } else if (o instanceof BigNumber) {
        return o.toString();
    } else if (isBuffer(o)) {
        return o.toString('hex');
    } else if (isArray(o) || o instanceof Array) {
        let s = [];
        for (let e of o) {
            s.push(stringify(e));
        }
        return s;
    } else if (isObject(o)) {
        let s = Object.create(null);
        for (let k of Object.keys(o)) {
            s[k] = stringify(o[k]);
        }
        return s;
    } else if (o instanceof Map) {
        let s = Object.create(null);
        for (let k of o.keys()) {
            s[k] = stringify(o.get(k));
        }
        return s;
    } else {
        throw new Error('not JSONable');
    }
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
