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

const Base = require('../base/base.js');
const BaseUtil = require('../base/util.js');
const TimeHelper = BaseUtil.TimeHelper;

const LOG_INFO = Base.BX_INFO;
const LOG_WARN = Base.BX_WARN;
const LOG_DEBUG = Base.BX_DEBUG;
const LOG_CHECK = Base.BX_CHECK;
const LOG_ASSERT = Base.BX_ASSERT;
const LOG_ERROR = Base.BX_ERROR;

class ResendQueue {
    constructor({MAX_PACKAGE_COUNT = 1024 * 4} = {})
    {
        this.MAX_PACKAGE_COUNT = MAX_PACKAGE_COUNT;
        this.m_packageInfos = new Map();
    }

    // 注意addPackage/confirmPackage的packageID配对
    static genPackageID(cmdType, remotePeeridHash, seq)
    {
        let id = `${cmdType}:${remotePeeridHash}:${seq}`;
        LOG_INFO(`genPackageID:${id}`);
        return id;
    }

    addPackage(packageID, buffer, server, remoteAddr, interval, times, onTimeOut) {
        if (this.m_packageInfos.size > this.MAX_PACKAGE_COUNT) {
            let maxResendTimes = 0;
            let maxResendPackageID = '';

            for (let [k, v] of this.m_packageInfos.entries()) {
                if (v.times > maxResendTimes) {
                    maxResendTimes = v.times;
                    maxResendPackageID = k;
                }
            }

            // 如果队列满了就删掉重试次数最多的
            if (maxResendTimes >= 2) {
                this.m_packageInfos.delete(maxResendPackageID);
            } else {
                LOG_WARN('resend queue full!,drop package.');
                return;
            }
        }

        let now = TimeHelper.uptimeMS();
        let info = {
            id: packageID,
            buffer: buffer,
            server: server,
            remoteEP: BaseUtil.EndPoint.toString(remoteAddr),
            interval: interval,
            times: 0,
            onTimeOut: onTimeOut,
            timeOutDelay: interval * times,
            createTime: now,
            lastSend: now,
        };

        this.m_packageInfos.set(packageID, info);
    }

    confirmPackage(packageID) {
        this.m_packageInfos.delete(packageID);
    }

    onTimer() {
        let now = TimeHelper.uptimeMS();
        let willRemove = [];
        let k = null;
        for (let [k, v] of this.m_packageInfos.entries()) {
            if(now - v.createTime > v.timeOutDelay) {
                if(v.onTimeOut) {
                    v.onTimeOut();
                }
                LOG_INFO(`package(${k}) is timeout!!!!`);
                willRemove.push(k);
            } else {
                if (now - v.lastSend > v.interval * (v.times + 1)) {
                    v.times = v.times + 1;
                    v.lastSend = now;
                    LOG_INFO(`resend a req package(${k})`);
                    v.server.send(
                        v.buffer,
                        [v.remoteEP],
                        true
                    );
                }
            }
        }

        for (let id of willRemove) {
            this.m_packageInfos.delete(id);
        }
    }
}

module.exports = ResendQueue;