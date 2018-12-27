import { ErrorCode } from '../error_code';
import { DposBlockHeader } from '../dpos_chain';
import {BufferWriter} from '../lib/writer';
import {BufferReader} from '../lib/reader';
import {BlockContent} from '../block/block';

export type DposBftBlockHeaderSignature =   {
    hash: string, pubkey: Buffer, sign: Buffer
};

export class DposBftBlockHeader extends DposBlockHeader {
    // 签名部分不进入hash计算
    protected m_bftSigns: DposBftBlockHeaderSignature[] = [];

    set bftSigns(signs: DposBftBlockHeaderSignature[]) {
        this.m_bftSigns = [];
        this.m_bftSigns.push(...signs);
    }

    get bftSigns(): DposBftBlockHeaderSignature[] {
        return this.m_bftSigns;
    }

    public encode(writer: BufferWriter): ErrorCode {
        let err = super.encode(writer);
        if (err) {
            return err;
        }
        writer.writeU16(this.m_bftSigns.length);
        for (let s of this.m_bftSigns) {
            writer.writeBytes(s.pubkey);
            writer.writeBytes(s.sign);
            writer.writeHash(s.hash);
        }
        return ErrorCode.RESULT_OK;
    }

    public decode(reader: BufferReader): ErrorCode {
        let err = super.decode(reader);
        if (err) {
            return err;
        }
        this.m_bftSigns = [];
        try {
            let n: number = reader.readU16();
            for (let i = 0; i < n; i++) {
                let pubkey: Buffer = reader.readBytes(33);
                let sign: Buffer = reader.readBytes(64);
                let hash: string = reader.readHash().toString('hex');
                this.m_bftSigns.push({hash, pubkey, sign});
            }
        } catch (e) {
            return ErrorCode.RESULT_INVALID_FORMAT;
        }
        return ErrorCode.RESULT_OK;
    }
}