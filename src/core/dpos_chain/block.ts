import * as assert from 'assert';

import { ErrorCode } from '../error_code';
import * as Address from '../address';

import { Encoding } from '../lib/encoding';
import { BufferWriter } from '../lib/writer';
import { BufferReader } from '../lib/reader';
import * as digest from '../lib/digest';

import * as ValueBlock from '../value_chain/block';

import { Chain } from './chain';
import * as Consensus from './consensus';


/** 出块计算从1开始，假设重新选举周期为100：
第一周期为1-100
第二周期为101-200
以此类推
*/
export class BlockHeader extends ValueBlock.BlockHeader {
    //Uint8Array(33)
    private m_pubkey: Buffer = new Buffer(33);
    //Uint8Array(64)
    private m_sign: Buffer = Encoding.ZERO_SIG64;

    
    constructor() {
        super();
    }

    get pubkey(): Buffer {
        return this.m_pubkey;
    }

    get miner(): string {
        return Address.addressFromPublicKey(this.m_pubkey)!;
    }

    protected _encodeHashContent(writer: BufferWriter): BufferWriter {
        writer = super._encodeHashContent(writer);
        writer.writeBytes(this.m_pubkey);
        writer.writeBytes(this.m_sign);
        return writer;
    }

    protected _decodeHashContent(reader: BufferReader): ErrorCode {
        let err: ErrorCode = super._decodeHashContent(reader);
        if (err !== ErrorCode.RESULT_OK) {
            return err;
        }
        this.m_pubkey = reader.readBytes(33);
        this.m_sign = reader.readBytes(64);
        return ErrorCode.RESULT_OK;
    }

    public signBlock(secret: Buffer) {
        this.m_pubkey = Address.publicKeyFromSecretKey(secret) as Buffer;
        let signHash = digest.hash256(this._encodeSignContent());
        this.m_sign = Address.signBufferMsg(signHash, secret);
    }

    public async verify(chain: Chain): Promise<{ err: ErrorCode, valid?: boolean }> {
        //先验证签名是否正确
        if (!this._verifySign()) {
            chain.logger.error(`verify block ${this.number} sign error!`);
            return { err: ErrorCode.RESULT_OK, valid: false };
        }
        //从某个设施验证pubkey是否在列表中,是否轮到这个节点出块
        return await this._verifyMiner(chain);
    }

    private _encodeSignContent(): Buffer {
        let writer = super._encodeHashContent(new BufferWriter());
        writer.writeBytes(this.m_pubkey);
        return writer.render();
    }

    private _verifySign() {
        let signHash = digest.hash256(this._encodeSignContent());
        return Address.verifyBufferMsg(signHash, this.m_sign, this.m_pubkey);
    }

    public async getTimeIndex(chain: Chain): Promise<{err: ErrorCode, index?: number}> {
        let hr = await chain.getHeader(0);
        if (hr.err) {
            return {err: hr.err};
        }
        // TODO: 可以兼容一些误差?
        let offset = this.timestamp - hr.header!.timestamp;
        if (offset < 0) {
            return {err: ErrorCode.RESULT_OK};
        }
        // 不能偏离太远
        let src = Math.trunc(offset / Consensus.blockInterval);
        let min = Math.trunc((offset - Consensus.maxBlockIntervalOffset) / Consensus.blockInterval);
        let max = Math.trunc((offset + Consensus.maxBlockIntervalOffset) / Consensus.blockInterval);
        if (src === min && src === max) {
            return {err: ErrorCode.RESULT_OK, index: src};
        } else if (src !== min) {
            return {err: ErrorCode.RESULT_OK, index: src};
        } else if (src !== max) {
            return {err: ErrorCode.RESULT_OK, index: max};
        } else {
            assert(false);
            return {err: ErrorCode.RESULT_OK};
        }
    }

    private async _verifyMiner(chain: Chain): Promise<{ err: ErrorCode, valid?: boolean }> {
        if (!this.number) {
            return {err: ErrorCode.RESULT_EXCEPTION};
        }

        let hr = await chain.getHeader(this.preBlockHash);
        if (hr.err) {
            return {err: hr.err};
        }
        // 时间不可回退
        let preHeader = <BlockHeader>hr.header!;
        if (this.timestamp < preHeader.timestamp) {
            return {err: ErrorCode.RESULT_OK, valid: false};
        }
        
        let dmr = await this.getDueMiner(chain);
        if (dmr.err) {
            return {err: dmr.err};
        }

        return {err: ErrorCode.RESULT_OK, valid: dmr.miner === this.miner};
    }

    public async getDueMiner(chain: Chain): Promise<{err: ErrorCode, miner?: string}> {
        if (!this.number) {
            return {err: ErrorCode.RESULT_EXCEPTION};
        }
        let tir = await this.getTimeIndex(chain);
        if (tir.err) {
            return {err: tir.err};
        }
        if (!tir.index) {
            return {err: ErrorCode.RESULT_OK};
        }
        
        let thisIndex = tir.index;
        let gcr = await chain.getMiners(this);
        if (gcr.err) {
            return {err: gcr.err};
        }
        let electionHeader = gcr.header!;
        tir = await electionHeader.getTimeIndex(chain);
        let electionIndex = tir.index!;
        let index = (thisIndex - electionIndex) % gcr.creators!.length;
        if (index < 0) {
            return {err: ErrorCode.RESULT_OK};
        }
        let creators = gcr.creators!;
        return {err: ErrorCode.RESULT_OK, miner: creators[index]};
    }

}