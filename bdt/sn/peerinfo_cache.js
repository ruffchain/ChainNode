const Base = require('../base/base.js');
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
    constructor({MAX_PEER_COUNT = 1024, PEER_TIMEOUT = 60000} = {}) {
        this.m_peers = new Map();
        this.MAX_PEER_COUNT = MAX_PEER_COUNT;
        this.PEER_TIMEOUT = PEER_TIMEOUT;
    }

    get peerCount() {
        return this.m_peers.size;
    }

    update(peerid, pingBody, address) {
        let now = Date.now();
        let peerInfo = this.m_peers.get(peerid);
        if (!peerInfo) {
            if (this.m_peers.size >= this.MAX_PEER_COUNT) {
                let outtimePeerids = [];
                this.m_peers.forEach((pinfo, pid) => {
                    if (now - pinfo.lastUpdateTime > this.PEER_TIMEOUT) {
                        outtimePeerids.push(pid);
                    } else if (now < pinfo.lastUpdateTime) {
                        pinfo.lastUpdateTime = now;
                    }
                });
                outtimePeerids.forEach(pid => this.m_peers.delete(pid));
            }

            if (this.m_peers.size >= this.MAX_PEER_COUNT) {
                return Result.CACHE_FULL;
            }
                
            peerInfo = {
                'eplist': new Map(),
                'peerid': peerid,
                'updateCount': 0,
            };
            this.m_peers.set(peerid, peerInfo);
        }

        peerInfo.updateCount++;
        peerInfo.address = address;
        peerInfo.info =pingBody.info;
        peerInfo.lastUpdateTime = now;
    
        if(peerInfo.updateCount % 7 === 0) {
            let timeoutEPList = [];
            peerInfo.eplist.forEach((updateTime, ep) => {
                if (now - updateTime >= this.PEER_TIMEOUT || now - updateTime < 0) {
                    timeoutEPList.push(ep);
                }
            });
            timeoutEPList.forEach(ep => peerInfo.eplist.delete(ep));
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