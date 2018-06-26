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