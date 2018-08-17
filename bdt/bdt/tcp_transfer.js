// Copyright (c) 2016-2018, BuckyCloud, Inc. and other BDT contributors.
// The BDT project is supported by the GeekChain Foundation.
// All rights reserved.

// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//     * Redistributions of source code must retain the above copyright
//       notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//     * Neither the name of the BDT nor the
//       names of its contributors may be used to endorse or promote products
//       derived from this software without specific prior written permission.

// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
// ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY
// DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
// ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

"use strict";
const EventEmitter = require('events');
const baseModule = require('../base/base');
const blog = baseModule.blog;
const packageModule = require('./package');
const BDTPackage = packageModule.BDTPackage;
const BDT_ERROR = packageModule.BDT_ERROR;
const BDTSendBuffer = require('./send_buffer');
const assert = require('assert');

class TCPTransfer {
    constructor(connection, remoteSender, lastAckCallback) {
        this.m_connection = connection;
        this.m_remoteSender = remoteSender;
        const opt = connection.stack._getOptions();
        // 发送缓存
        this.m_sendBuffer = new BDTSendBuffer(opt.defaultSendBufferSize, opt.drainFreeBufferSize);
        this.m_sendBuffer.on('drain', () => {
            this.m_connection.emit('drain');
        });

        this.m_resumeSendBufferSize = opt.defaultSendBufferSize - opt.drainFreeBufferSize;
        // send fin的callback，在收到fin ack 时触发
        this.m_finAckCallback = null;
        // 第一次回复了fin的ack时触发
        this.m_lastAckCallback = lastAckCallback;

        this.m_trySendTimer = setInterval(() => this.trySendLeftData(), opt.resendInterval);
    }
    
    send(buffer) {
        let [err, sentBytes] = this.m_sendBuffer.push(buffer);
        if (sentBytes > 0) {
            this.trySendLeftData();
        }
        return sentBytes;
    }

    sendFin(callback) {
        if (this.m_finAckCallback) {
            return ;
        }
        let _doSendFin = ()=>{
            let encoder = this._allocDataPackage(null, true);
            this.m_connection._postPackage(encoder);
            if (this.m_finAckCallback) {
                let finAckCallback = this.m_finAckCallback;
                this.m_finAckCallback = null;
                finAckCallback();
            }
        };
        this.m_finAckCallback = callback;
        if (this.m_sendBuffer.curSize) {
            this.m_sendBuffer.once('empty', ()=>{
                _doSendFin();
            });
        } else {
            _doSendFin();
        }
    }

    close() {
        clearInterval(this.m_trySendTimer);
        this.m_trySendTimer = null;
        this.m_lastAckCallback = null;
    }

    _onPackage(decoder) {
        // TCP没有空的ack包
        assert(decoder.header.seq === this.m_connection._getNextRemoteSeq() && (decoder.header.cmdType === BDTPackage.CMD_TYPE.fin || (decoder.data && decoder.data.length > 0)));
        this.m_connection._setNextRemoteSeq(decoder.nextSeq);
        if (decoder.header.cmdType === BDTPackage.CMD_TYPE.data) {
            if (decoder.data && decoder.data.length > 0) {
                setImmediate(() => this.m_connection.emit('data', [decoder.data]));
            }
        } else if (decoder.header.cmdType === BDTPackage.CMD_TYPE.fin) {
            if (this.m_lastAckCallback) {
                this.m_lastAckCallback();
            }
            setImmediate(() => {
                // C++的异步tcp模式，通知一个空包
                this.m_connection.emit('data', [Buffer.allocUnsafe(0)]);
                // node.js模式，通知'end'
                this.m_connection.emit('end');
            });
        }
    } 

    _allocDataPackage(buffers, fin=false) {
        let encoder = null;
        if (!fin) {
            encoder = this.m_connection._createPackageHeader(BDTPackage.CMD_TYPE.data);
            encoder.addData(buffers);
        } else {
            encoder = this.m_connection._createPackageHeader(BDTPackage.CMD_TYPE.fin);
        }
        encoder.header.seq = this.m_connection._nextSeq(encoder.dataLength + 1);
        return encoder;
    }

    trySendLeftData() {
        if (this.m_sendBuffer.curSize > 0 && this.m_remoteSender.socket.bufferSize <= this.m_resumeSendBufferSize) {
            let buffers = this.m_sendBuffer.head(TCPTransfer.maxPackageSize);
            let encoder = this._allocDataPackage(buffers);
            this.m_connection._postPackage(encoder);
        }
    }
}

TCPTransfer.maxPackageSize = 0xED89;

module.exports = TCPTransfer;