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
const packageModule = require('./package');
const assert = require('assert');
const BDTPackage = packageModule.BDTPackage;
const BDT_ERROR = packageModule.BDT_ERROR;

class BDTSendBuffer extends EventEmitter {
    constructor(maxSize, drainSize) {
        super();
        this.m_queue = [];
        this.m_maxSize = maxSize;
        this.m_drainSize = drainSize;
        this.m_curSize = 0;
    }


    get maxSize() {
        return this.m_maxSize;
    }

    get freeSize() {
        return this.m_maxSize - this.m_curSize;
    }

    get curSize() {
        return this.m_curSize;
    }

    push(buffer) {
        if (!buffer.length) {
            return [BDT_ERROR.success, 0];
        }
        // 都上js了还管啥拷贝性能~,尽量减少就好，没必要避免
        if (buffer.length + this.m_curSize > this.m_maxSize) {
            if (buffer.length < this.m_drainSize) {
                return [BDT_ERROR.outofSize, 0];
            } else {
                let freeSize = this.m_maxSize - this.m_curSize;
                let sendBuf = Buffer.alloc(freeSize);
                buffer.copy(sendBuf);
                this.m_queue.push(sendBuf);
                this.m_curSize = this.m_maxSize;
                return [BDT_ERROR.outofSize, freeSize];
            }
        } else {
            try {
                let sendBuf = Buffer.alloc(buffer.length);
                buffer.copy(sendBuf);
                this.m_queue.push(sendBuf);
                this.m_curSize += buffer.length;
                return [BDT_ERROR.success, buffer.length];
            } catch (error) {
                assert(false, `error:${error},buffer.length:${buffer.length},buffer.kMaxLength:${require('buffer').kMaxLength}`);
                return [BDT_ERROR.outofSize, 0];
            }
        }
    }

    head(bytes) {
        if (!this.m_queue.length) {
            return null;
        }
        if (!bytes) {
            return null;
        }
        let buffers = [];
        let index = 0;
        let spliceIndex = 0;
        let curBytes = bytes;
        for (index = 0; index < this.m_queue.length; ++index) {
            let buffer = this.m_queue[index];
            if (buffer.length > curBytes) {
                let sendBuffer = buffer.slice(0, curBytes);
                buffers.push(sendBuffer);
                this.m_queue[index] = buffer.slice(curBytes);
                curBytes = 0;
                break;
            } else {
                buffers.push(buffer);
                curBytes -= buffer.length;
                spliceIndex += 1;
                if (curBytes === 0) {
                    break;
                }
            }
        }
        if (spliceIndex) {
            this.m_queue.splice(0, spliceIndex);
        }
        let preSize = this.m_curSize;
        this.m_curSize -= (bytes - curBytes);
        let trigerSize =  this.m_maxSize - this.m_drainSize;
        if (preSize > trigerSize && this.m_curSize <= trigerSize) {
            setImmediate(()=>{this.emit('drain');});
        }
        if (this.m_curSize === 0) {
            setImmediate(()=>{this.emit('empty');});
        }
        return buffers;
    }
}

module.exports = BDTSendBuffer;