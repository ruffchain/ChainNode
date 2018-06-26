import * as BaseBlock from '../chain/block';
import { BufferWriter } from '../lib/writer';
import { BufferReader } from '../lib/reader';
import {ErrorCode} from '../error_code';

export class BlockHeader extends BaseBlock.BlockHeader {
    constructor() {
        super();
        this.m_coinbase = '';
    }

    private m_coinbase: string;

    get coinbase(): string {
        return this.m_coinbase;
    }

    set coinbase(coinbase: string) {
        this.m_coinbase = coinbase;
    }

    protected _encodeHashContent(writer: BufferWriter): BufferWriter {
        writer = super._encodeHashContent(writer);
        writer.writeVarString(this.m_coinbase);
        return writer;
    }

    protected _decodeHashContent(reader: BufferReader): ErrorCode {
        let err: ErrorCode = super._decodeHashContent(reader);
        if (err !== ErrorCode.RESULT_OK) {
            return err;
        }
        this.m_coinbase = reader.readVarString('utf-8');
        return ErrorCode.RESULT_OK;
    }

    public stringify(): any {
        let obj = super.stringify();
        obj.coinbase = this.coinbase;
        return obj;
    }
}