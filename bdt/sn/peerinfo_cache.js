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

const Result = {
    SUCCESS: 0,
    CACHE_FULL: 110,
};

class PeerInfoCache
{
    constructor({MAX_PEER_COUNT = 1024, PEER_TIMEOUT = 60809} = {}) {
        this.m_peers = new Map();
        this.MAX_PEER_COUNT = MAX_PEER_COUNT;
        this.PEER_TIMEOUT = PEER_TIMEOUT;
    }

    get peerCount() {
        return this.m_peers.size;
    }

    update(peerid, pingBody, address) {
        let now = TimeHelper.uptimeMS();
        let peerInfo = this.m_peers.get(peerid);
        if (!peerInfo) {
            if (this.m_peers.size >= this.MAX_PEER_COUNT) {
                let outtimePeerids = [];
                this.m_peers.forEach((pinfo, pid) => {
                    if (now - pinfo.lastUpdateTime > this.PEER_TIMEOUT) {
                        outtimePeerids.push(pid);
                    }
                });
                outtimePeerids.forEach(pid => this.m_peers.delete(pid));
            }

            if (this.m_peers.size >= this.MAX_PEER_COUNT) {
                return Result.CACHE_FULL;
            }
                
            peerInfo = {
                eplist: new Map(),
                peerid: peerid,
                updateCount: 0,
                dynamics: new Map(), // 动态地址, <srcPeerid, map<sessionid,eplist>>
            };
            this.m_peers.set(peerid, peerInfo);
        }

        peerInfo.updateCount++;
        peerInfo.address = address;
        peerInfo.info = pingBody.info;
        peerInfo.lastUpdateTime = now;
    
        if(peerInfo.updateCount % 7 === 0) {
            let timeoutEPList = [];
            peerInfo.eplist.forEach((updateTime, ep) => {
                if (now - updateTime >= this.PEER_TIMEOUT) {
                    timeoutEPList.push(ep);
                }
            });
            timeoutEPList.forEach(ep => peerInfo.eplist.delete(ep));

            peerInfo.dynamics.clear();
        }
    
        for (let ep of pingBody.eplist) {
            peerInfo.eplist.set(ep, now);
        }

        return Result.SUCCESS;
    }

    getPeerInfo(peerid) {
        return this.m_peers.get(peerid);
    }
}

PeerInfoCache.Result = Result;

module.exports = PeerInfoCache;