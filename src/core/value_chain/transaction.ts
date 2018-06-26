import { BigNumber } from 'bignumber.js';
import * as BaseTransaction from '../chain/transaction';
import { BufferWriter, BufferReader, ErrorCode } from '../serializable';

export class Transaction extends BaseTransaction.Transaction {
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

    get fee(): BigNumber {
        return this.m_fee;
    }

    set value(value: BigNumber) {
        this.m_value = value;
    }

    set fee(value: BigNumber) {
        this.m_fee = value;
    }

    protected _encodeHashContent(writer: BufferWriter): BufferWriter{
        super._encodeHashContent(writer);
        writer.writeBigNumber(this.m_value);
        writer.writeBigNumber(this.m_fee);
        return writer;
    }

    protected _decodeHashContent(reader: BufferReader): ErrorCode {
        super._decodeHashContent(reader);
        this.m_value = reader.readBigNumber();
        this.m_fee = reader.readBigNumber();

        return ErrorCode.RESULT_OK;
    }
}