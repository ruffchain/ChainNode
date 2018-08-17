import * as assert from 'assert';

import { ErrorCode } from '../error_code';

import {BlockWithSign, ValueBlockHeader, } from '../value_chain';
import { DbftChain } from './chain';
import {BufferWriter} from '../lib/writer';
import {BufferReader} from '../lib/reader';
const digest = require('../lib/digest');
import {DBFTSProxy} from './dbftProxy';

export class DbftBlockHeader extends BlockWithSign(ValueBlockHeader) {
    // 签名部分不进入hash计算
    protected m_dbftSigns: {address: string, sign: string}[] = [];

    protected _encodeHashContent(writer: BufferWriter): ErrorCode {
        let err = super._encodeHashContent(writer);
        if (err) {
            return err;
        }
        writer.writeU16(this.m_dbftSigns.length);
        for (let s of this.m_dbftSigns) {
            writer.writeVarString(s.address);
            writer.writeVarString(s.sign);
        }
        return ErrorCode.RESULT_OK;
    }

    protected _decodeHashContent(reader: BufferReader): ErrorCode {
        let err: ErrorCode = super._decodeHashContent(reader);
        if (err !== ErrorCode.RESULT_OK) {
            return err;
        }
        try {
            let n: number = reader.readU16();
            for (let i = 0; i < n; i++) {
                let address: string = reader.readVarString();
                let sign: string = reader.readVarString();
                this.m_dbftSigns.push({address, sign});
            }
        } catch (e) {
            return ErrorCode.RESULT_INVALID_FORMAT;
        }
        return ErrorCode.RESULT_OK;
    }

    // protected _encodeSignContent(): Buffer {
    //     // 用supper，计算的时候不算m_dbftSigns部分
    //     let writer = super._encodeHashContent(new BufferWriter());
    //     writer.writeBytes(this.pubkey);
    //     return writer.render();
    // }

    protected _genHash(): string {
        let contentWriter: BufferWriter = new  BufferWriter();
        // 用supper，计算的时候不算m_dbftSigns部分
        super._encodeHashContent(contentWriter);
        let content: Buffer = contentWriter.render();
        return digest.hash256(content).toString('hex');
    }

    public addSigns(signs: {address: string, sign: string}[]) {
        this.m_dbftSigns = [];
        this.m_dbftSigns = this.m_dbftSigns.concat(signs);
    }

    public async verify(chain: DbftChain): Promise<{ err: ErrorCode, valid?: boolean }> {
        // 先验证签名是否正确
        if (!this._verifySign()) {
            chain.logger.error(`verify block ${this.number} sign error!`);
            return { err: ErrorCode.RESULT_OK, valid: false };
        }
        // 从某个设施验证pubkey是否在列表中,是否轮到这个节点出块
        return await this._verifyMiner(chain);
    }

    private async _verifyMiner(chain: DbftChain): Promise<{ err: ErrorCode, valid?: boolean }> {
        let gm = await chain.getMiners(this);
        if (gm.err) {
            return {err: gm.err};
        }

        let minerMap: Map<string, Buffer> = new Map();
        gm.miners!.forEach((v) => {
            minerMap.set(v.address, Buffer.from(v.pubkey, 'hex'));
        });

        let m: number = Math.floor(this.m_dbftSigns.length * 2 / 3);
        if (m * 3 < this.m_dbftSigns.length * 2) {
            m = m + 1;
        }
        if (m === 0 ) {
            return {err: ErrorCode.RESULT_FAILED};
        }

        let succSign: Map<string, number> = new Map();
        let count = 0;
        for (let s of this.m_dbftSigns) {
            if (succSign.has(s.address)) {
                continue;
            }
            if (!minerMap.has(s.address)) {
                continue;
            }
            if (await DBFTSProxy.verifySign(Buffer.from(this.hash, 'hex'), minerMap.get(s.address)!, Buffer.from(s.sign, 'hex')) === ErrorCode.RESULT_OK) {
                succSign.set(s.address, 1);
                count++;
            }
        }
        if (count >= m) {
            return {err: ErrorCode.RESULT_OK, valid: true};
        }

        return {err: ErrorCode.RESULT_FAILED, valid: false};
    }
}