import * as assert from 'assert';

import { ErrorCode } from '../error_code';
import * as Address from '../address';

import { Encoding } from '../lib/encoding';
import { BufferWriter } from '../lib/writer';
import { BufferReader } from '../lib/reader';
import * as digest from '../lib/digest';

import { BlockHeader } from './block'; 

export function instance(superClass: new(...args: any[]) => BlockHeader) {
    return class extends superClass {
        constructor(...args: any[]) {
            super(args[0]);
        }
        
        // Uint8Array(33)
        private m_pubkey: Buffer = new Buffer(33);
        // Uint8Array(64)
        private m_sign: Buffer = Encoding.ZERO_SIG64;
    
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

        protected _encodeSignContent(): Buffer {
            let writer = super._encodeHashContent(new BufferWriter());
            writer.writeBytes(this.m_pubkey);
            return writer.render();
        }

        protected _verifySign(): boolean {
            let signHash = digest.hash256(this._encodeSignContent());
            return Address.verifyBufferMsg(signHash, this.m_sign, this.m_pubkey);
        }
    };
}
