
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

'use strict';

/**
 * 以相对平滑稳定的节奏发送数据包
 */
const EventEmitter = require('events');
const {TimeHelper} = require('../base/util');

class PaceSender extends EventEmitter {
    constructor(options) {
        super();

        this.m_options = {
            alpha: 0.125,
            maxPkgInterval: 100,
            minPkgInterval: 2,
            periodInterval: 10,
            maxDelay: 500,
        };

        this.m_lastPkgTime = 0;
        this.m_lastSendTime = 0;
        this.m_maxTimeout = 0;
        this.m_pkgInterval = this.m_options.minPkgInterval;

        this.m_queue = [];
        this.m_timer = null;
    }

    start() {
        if (!this.m_timer) {
            this.m_timer = setInterval(() => this._period(), this.m_options.periodInterval);
            this.removeAllListeners(PaceSender.EVENT.pop);
        }
    }

    stop() {
        if (!this.m_timer) {
            this.m_queue = [];
            clearInterval(this.m_timer);
            this.m_timer = null;
        }
    }

    push(pkg, eplist, options) {
        let now = TimeHelper.uptimeMS();

        // update (pkgInterval, this.m_lastPkgTime)
        let pkgInterval = Math.min(now - this.m_lastPkgTime, this.m_options.maxPkgInterval);
        this.m_pkgInterval = pkgInterval * this.m_options.alpha + this.m_pkgInterval * (1 - this.m_options.alpha);
        this.m_lastPkgTime = now;

        if (!options || 
            !options.timeout || 
            options.timeout < 0 || 
            (this.m_queue.length === 0 && pkgInterval >= this.m_options.minPkgInterval)) {
            this.emit(PaceSender.EVENT.pop, pkg, eplist, options);
            return;
        }

        let pkgTimeout = now + options.timeout;
        if (this.m_maxTimeout < pkgTimeout) {
            this.m_maxTimeout = pkgTimeout;
        }
        this.m_queue.push({pkg, eplist, options, sendTime: now});
    }

    _period() {
        /**
         * 发送数量 = max(总包数/(m_maxTimeout-this.m_lastSendTime)*(now-m_lastSendTime), (now-m_lastSendTime)/平均包间隔，总包数)
         */
        let now = TimeHelper.uptimeMS();
        let sendInterval = Math.min(now - this.m_lastSendTime, this.m_options.maxPkgInterval);
        
        let delay = this.m_maxTimeout - this.m_lastSendTime;
        if (delay <= 0) {
            delay = 1;
        } else if (delay > this.m_options.maxDelay) {
            delay = this.m_options.maxDelay;
            this.m_maxTimeout = now + this.m_options.maxDelay;
        }

        let limitCount = Math.max(this.m_queue.length * sendInterval / delay, sendInterval / this.m_pkgInterval);
        if (limitCount < 1) {
            if (sendInterval < this.m_pkgInterval) {
                return;
            } else {
                limitCount = 1;
            }
        } else {
            limitCount = Math.ceil(limitCount);
        }

        this.m_lastSendTime = now;
        let sendPkgs = this.m_queue.splice(0, limitCount);
        for (let stub of sendPkgs) {
            this.emit(PaceSender.EVENT.pop, stub.pkg, stub.eplist, stub.options);
        }
    }
};

PaceSender.EVENT = {
    pop: 'pop',
};

module.exports = PaceSender;