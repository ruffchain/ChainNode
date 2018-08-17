import { BigNumber } from 'bignumber.js';
import {Transaction} from '../chain';
import { BufferWriter, BufferReader, ErrorCode } from '../serializable';

export class ValueTransaction extends Transaction {
    constructor() {
        super();
        this.m_value = new BigNumber(0);
        this.m_fee = new BigNumber(0);
    }

    private m_value: BigNumber;
    private m_fee: BigNumber;

    get value(): BigNumber {
        return this.m_value;
    }

    set value(value: BigNumber) {
        this.m_value = value;
    }

    get fee(): BigNumber {
        return this.m_fee;
    }
   
    set fee(value: BigNumber) {
        this.m_fee = value;
    }

    protected _encodeHashContent(writer: BufferWriter): ErrorCode {
        let err = super._encodeHashContent(writer);
        if (err) {
            return err;
        }
        writer.writeBigNumber(this.m_value);
        writer.writeBigNumber(this.m_fee);
        return ErrorCode.RESULT_OK;
    }

    protected _decodeHashContent(reader: BufferReader): ErrorCode {
        let err = super._decodeHashContent(reader);
        if (err) {
            return err;
        }
        try {
            this.m_value = reader.readBigNumber();
            this.m_fee = reader.readBigNumber();
        } catch (e) {
            return ErrorCode.RESULT_INVALID_FORMAT;
        }

        return ErrorCode.RESULT_OK;
    }

    stringify(): any {
        let obj = super.stringify();
        obj.value = this.value.toString();
        obj.fee = this.value.toString();
        return obj;
    }
}