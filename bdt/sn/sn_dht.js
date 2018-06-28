'use strict';

const {Config, Result: DHTResult, HashDistance, RandomGenerator} = require('../dht/util.js');
const EventEmitter = require('events');
const DHTPeer = require('../dht/peer.js');
const assert = require('assert');
const HashConfig = Config.Hash;
const SN_DHT_SERVICE_ID = '4243153e-8d98-4384-8ae0-0ca1802235e2';

const Base = require('../base/base.js');

const LOG_INFO = Base.BX_INFO;
const LOG_WARN = Base.BX_WARN;
const LOG_DEBUG = Base.BX_DEBUG;
const LOG_CHECK = Base.BX_CHECK;
const LOG_ASSERT = Base.BX_ASSERT;
const LOG_ERROR = Base.BX_ERROR;

/*
    SN-SERVICE-INFO: {
        scope: maskBitCount, // 标识该SN服务节点范围（服务peer的PEERID-HASH值和该SN的PEERID-HASH值匹配位数）
    }
*/

const THIN_SEARCH_SN_INTERVAL_MS = 2000;
const SEARCH_NEAR_SN_INTERVAL_MS = 600000;
const SN_PEER_COUNT = 5;
const SENSIOR_SN_COUNT = 1;
const DEFAULT_SERVICE_SCOPE = 10;

class SNDHT {
    constructor(fatherDHT, {MINI_ONLINE_TIME_MS = 24 * 3600000, RECENT_SN_CACHE_TIME = 120000, REFRESH_SN_DHT_INTERVAL = 600000} = {}) {
        this.m_fatherDHT = fatherDHT;
        this.m_snDHT = this.m_fatherDHT.prepareServiceDHT([SN_DHT_SERVICE_ID]);

        let localPeer = this.m_snDHT.localPeer;
        this.m_localPeer = {
            peerid: localPeer.peerid,
            hash: localPeer.hash,
        };

        this.m_nearNormalSNDistance = HashDistance.MAX_HASH;
        this.m_nearSensiorSNDistance = HashDistance.MAX_HASH;
        this.m_eventEmitter = new EventEmitter();
        this.m_timer = null;
        this.m_timerJoinService = null;
        this.m_isJoinedDHT = false;
        this.m_tryRefreshTimes = 0;

        this.MINI_ONLINE_TIME_MS = MINI_ONLINE_TIME_MS;
        this.RECENT_SN_CACHE_TIME = RECENT_SN_CACHE_TIME;
        this.REFRESH_SN_DHT_INTERVAL = REFRESH_SN_DHT_INTERVAL;

        this.m_snOnlineListener = null;
        this.m_recentSNMap = new Map(); // 近期上线SN

        // <TODO>测试代码
        this.m_snDHT.__joinedDHTTimes = this.m_snDHT.__joinedDHTTimes || 0;
        this.m_snDHT.attachBroadcastEventListener(SNDHT.Event.SN.online, (eventName, params, sourcePeerid) => {
            assert(eventName === SNDHT.Event.SN.online && params.peerid === sourcePeerid,
                `eventName:${eventName},params:${JSON.stringify(params)},sourcePeerid:${sourcePeerid}`);
            assert(this.m_snDHT.__joinedDHTTimes > 0, `sourcePeerid:${sourcePeerid},localPeer:${JSON.stringify(this.m_fatherDHT.m_bucket.localPeer.toStructForPackage())}`);            
        });
    }

    signinVistor() {
        let isRunningBefore = this.m_snDHT.isRunning();
        this.m_snDHT.signinVistor();
        if (!isRunningBefore) {
            this._onStart();
        }
    }

    signoutVistor() {
        let isRunningBefore = this.m_snDHT.isRunning();
        this.m_snDHT.signoutVistor();
        if (isRunningBefore && !this.m_snDHT.isRunning()) {
            this._onStop();
        }
    }

    signinServer(isSeed) {
        let isRunningBefore = this.m_snDHT.isRunning();

        this._tryJoinService(isSeed);
        if (!isRunningBefore) {
            this._onStart();
        }
    }

    signoutServer() {
        let isRunningBefore = this.m_snDHT.isRunning();
        this.m_snDHT.signoutServer();
        this.m_fatherDHT.deleteValue(SN_DHT_SERVICE_ID, this.m_localPeer.peerid);
        this._stopTryJoinService();
        if (isRunningBefore && !this.m_snDHT.isRunning()) {
            this._onStop();
        }
    }

    findSN(peerid, callback) {
        if (callback) {
            this._findSN(peerid, true, (result, snList) => callback({result, snList: (snList || [])}));
        } else {
            return new Promise(resolve => {
                this._findSN(peerid, true, (result, snList) => {
                    resolve({result, snList: (snList || [])});
                });
            });
        }
    }
        
    // SN服务端接口
    setServiceScope(maskBitCount) {
        this.m_snDHT.updateServiceInfo('scope', DEFAULT_SERVICE_SCOPE);
    }

    getServiceScope() {
        let maskBitCount = this.m_snDHT.getServiceInfo('scope');
        maskBitCount = maskBitCount || 0;
        return {maskBitCount};
    }

    get isJoinedDHT() {
        return this.m_isJoinedDHT;
    }

    attachEvent(eventName, listener) {
        if (typeof eventName === 'string' && typeof listener === 'function') {
            this.m_eventEmitter.on(eventName, listener);
            return {eventName, listener, result: DHTResult.SUCCESS};
        } else {
            LOG_ASSERT(false, `attachEvent invalid args type, (eventName type: ${typeof eventName}, listener type: ${typeof listener}).`);
            return {result: DHTResult.INVALID_ARGS};
        }
    }

    detachEvent(eventName, listener) {
        if (typeof eventName === 'string' && typeof listener === 'function') {
            this.m_eventEmitter.removeListener(eventName, listener);
            return DHTResult.SUCCESS;
        } else {
            LOG_ASSERT(false, `detachEvent invalid args type, (eventName type: ${typeof eventName}, listener type: ${typeof listener}).`);
            return DHTResult.INVALID_ARGS;
        }
    }

    emitBroadcastEvent(eventName, params) {
        return this.m_snDHT.emitBroadcastEvent(eventName, params);
    }

    // listener(eventName, params, sourcePeerid)
    attachBroadcastEventListener(eventName, listener) {
        return this.m_snDHT.attachBroadcastEventListener(eventName, listener);
    }

    // attachBroadcastEventListener相同输入参数
    detachBroadcastEventListener(eventName, listener) {
        return this.detachBroadcastEventListener(eventName, listener);
    }

    _onStart() {
        this.m_tryRefreshTimes = 0;
        if (!this.m_timer) {
            this._searchNearSN();
        }
    }

    _onStop() {
        this.m_tryRefreshTimes = 0;
        if (this.m_timer) {
            clearTimeout(this.m_timer);
            this.m_timer = null;
        }
    }

    _searchNearSN() {
        if (this.m_timer) {
            clearTimeout(this.m_timer);
            this.m_timer = null;
        }

        this.m_tryRefreshTimes++;
        this._findSN(this.m_localPeer.peerid, true, (result, snList) => {
            if (!this.m_snDHT.isRunning()) {
                return;
            }

            this._onSearchNearSN(snList);
            if (this.m_timer) {
                return;
            }

            let nextSearchInterval = THIN_SEARCH_SN_INTERVAL_MS;
            if (this.m_tryRefreshTimes > 6 || (snList && snList.length >= SN_PEER_COUNT)) {
                nextSearchInterval = RandomGenerator.integer(SEARCH_NEAR_SN_INTERVAL_MS, SEARCH_NEAR_SN_INTERVAL_MS / 2);
            } else if (this.m_tryRefreshTimes > 3) {
                nextSearchInterval = SEARCH_NEAR_SN_INTERVAL_MS / 3;
            }
            this.m_timer = setTimeout(() => this._searchNearSN(), nextSearchInterval);
        });
    }

    _getNearSNList(peerlist, targetHash, targetPeerid) {
        let normalSNList = [];
        let sensiorSNList = [];

        if (!peerlist || peerlist.length === 0) {
            return {normal: normalSNList, sensior: sensiorSNList};
        }

        HashDistance.sortByDistance(peerlist, {hash: targetHash, peerid: targetPeerid});
        let servicePath = this.m_snDHT.servicePath;
        let lastPeer = null;
        for (let peer of peerlist) {
            if (lastPeer && lastPeer.peerid === peer.peerid) {
                continue;
            }
            lastPeer = peer;

            let maskBitCount = 0;
            if (peer instanceof DHTPeer.Peer) {
                let serviceDescriptor = peer.findService(servicePath);
                if (serviceDescriptor && serviceDescriptor.isSigninServer()) {
                    maskBitCount = serviceDescriptor.getServiceInfo([], 'scope') || 0;
                }
            }

            if (HashDistance.firstDifferentBit(targetHash, peer.hash) >= maskBitCount) {
                if (HashDistance.isBitSet(peer.hash, 0)) {
                    sensiorSNList.push(peer);
                } else {
                    normalSNList.push(peer);
                }
            }
        }

        return {normal: normalSNList, sensior: sensiorSNList};
    }

    _onSearchNearSN(snList) {
        if (!snList || snList.length === 0) {
            return;
        }

        let normalDistance = HashDistance.calcDistance(snList[0].hash, this.m_localPeer.hash);
        let sensiorDistance = HashDistance.MAX_HASH;
        for (let sn of snList) {
            if (HashDistance.isBitSet(sn.hash, 0)) {
                sensiorDistance = HashDistance.calcDistance(sn.hash, this.m_localPeer.hash);
                break;
            }
        }

        if (HashDistance.compareHash(normalDistance, this.m_nearNormalSNDistance) != 0
            || HashDistance.compareHash(sensiorDistance, this.m_nearSensiorSNDistance) != 0) {

                this.m_nearNormalSNDistance = normalDistance;
                this.m_nearSensiorSNDistance = sensiorDistance;
                this.m_eventEmitter.emit(SNDHT.Event.NearSNChanged);
        }
    }

    _findSN(peerid, forceSearch = false, callback = undefined) {
        let filterResultSNList = (snList, targetPeerHash) => {
            let {normal: normalSNList, sensior: sensiorSNList} = this._getNearSNList(snList, targetPeerHash);
            let sensiorSNCount = Math.min(sensiorSNList.length, SENSIOR_SN_COUNT);
            let normalSNCount = Math.min(normalSNList.length, SN_PEER_COUNT - sensiorSNCount);
            normalSNList.splice(normalSNCount,
                normalSNList.length - normalSNCount,
                ...sensiorSNList.slice(0, sensiorSNCount));
            return normalSNList;
        }

        if (peerid === this.m_localPeer.peerid && !forceSearch) {
            let snList = filterResultSNList(this.m_snDHT.getAllOnlinePeers(), this.m_localPeer.hash);
            if (snList.length >= SN_PEER_COUNT) {
                callback(DHTResult.SUCCESS, snList);
                return;
            }
        }

        if (this.m_nearNormalSNDistance === HashDistance.MAX_HASH && this.m_snDHT.getAllOnlinePeers().length === 0) {
            this.m_fatherDHT.getValue(SN_DHT_SERVICE_ID, peerid, 0, ({result, values}) => {
                let snList = [];
                if (values) {
                    values.forEach((eplist, peerid) => {
                        let peer = {peerid, eplist};
                        this.m_fatherDHT.ping(peer);
                        snList.push(peer);
                    });
                }
                snList = filterResultSNList(snList, HashDistance.checkHash(peerid));
                callback(result, snList);
            });
        } else {
            this.m_snDHT.findPeer(peerid, ({result, peerlist}) => {
                let targetHash = HashDistance.checkHash(peerid);
                if (!peerlist) {
                    peerlist = [];
                }
                peerlist = peerlist.concat(this.m_snDHT.getAllOnlinePeers());
                let snList = filterResultSNList(peerlist, targetHash);

                result = snList.length > 0? DHTResult.SUCCESS : DHTResult.FAILED;
                callback(result, snList);
            });
        }
    }

    _tryJoinService(isSeed) {
        if (this.m_timerJoinService) {
            return;
        }

        this.m_isJoinedDHT = false;
        let lastOnlineTime = 0; // 最后一次上公网的时间
        const MAX_DISTANCE_SERVICE_PEER = HashDistance.hashBit(HashDistance.MAX_HASH, DEFAULT_SERVICE_SCOPE, Config.Hash.BitCount);

        let recentState = [];
        let refreshState = localPeer => {
            let stat = this.m_fatherDHT.stat().udp;

            let state = {
                distanceOk: this.m_nearNormalSNDistance === 0 || HashDistance.compareHash(this.m_nearNormalSNDistance, MAX_DISTANCE_SERVICE_PEER) > 0, // 距离范围内没有其他SN
                sentCount: stat.send.pkgs,
                recvCount: stat.recv.pkgs,
                question: localPeer.question,
                answer: localPeer.answer,
                RTT: localPeer.RTT,
            };

            if (recentState.length >= 5) {
                recentState.shift();
            }
            recentState.push(state);
        }

        // 判定是否满足加入DHT的条件
        let isOk = state => {
            return  state.distanceOk && // 距离范围满足条件
                    state.sentCount && state.recvCount / state.sentCount > 1 && // 收包率
                    state.answer > 100 && state.question / state.answer > 1 && // QA比
                    state.RTT < 100; // 延迟
        }

        let canJoinDHT = () => {
            if (recentState.length < 5) {
                return false;
            }

            for (let state of recentState) {
                if (!isOk(state)) {
                    return false;
                }
            }
            return true;
        }

        let needUnjoinDHT = () => {
            if (recentState.length < 5) {
                return true;
            }

            let noOkCount = 0;
            for (let state of recentState) {
                if (!isOk(state)) {
                    noOkCount++;
                }
            }
            return noOkCount >= 2;
        }

        let refresh = () => {
            let localPeer = this.m_fatherDHT.localPeer;
            refreshState(localPeer);

            if (localPeer.natType === DHTPeer.NAT_TYPE.internet) {
                let now = Date.now();
                if (lastOnlineTime === 0) {
                    lastOnlineTime = now;
                }
                // 在internet上线足够久，并且附近没有SN上线
                LOG_INFO(`SN test online:now=${now},lastOnlineTime=${lastOnlineTime}, isJoined=${this.m_isJoinedDHT},nearSNDistance=${this.m_nearNormalSNDistance}`);
                if (now - lastOnlineTime >= this.MINI_ONLINE_TIME_MS && !this.m_isJoinedDHT && canJoinDHT()) {
                    // SN上线；
                    this._joinDHT(isSeed);
                } else if (needUnjoinDHT()) {
                    this._unjoinDHT();
                }
            } else {
                LOG_INFO(`not internet.natType=${localPeer.natType}`);
                lastOnlineTime = 0;
                this._unjoinDHT();
            }
        }

        this.m_timerJoinService = setInterval(refresh, this.REFRESH_SN_DHT_INTERVAL);
        refresh();
    }

    _stopTryJoinService() {
        if (this.m_timerJoinService) {
            clearInterval(this.m_timerJoinService);
            this.m_timerJoinService = null;
        }
    }

    // SN上线；
    // 1.在SN子网中广播上线消息
    // 2.监听其他SN的上线消息，并通知合适的客户端在新SN上线，注意分流，考虑在客户端下次ping的时候随pingResp通知
    _joinDHT(isSeed) {
        if (this.m_isJoinedDHT) {
            return;
        }

        this.m_snDHT.__joinedDHTTimes++;
        this.m_isJoinedDHT = true;
        this.m_snDHT.signinServer();
        //this.m_snDHT.updateServiceInfo('scope', DEFAULT_SERVICE_SCOPE);
        if (isSeed) {
            this.m_fatherDHT.saveValue(SN_DHT_SERVICE_ID, this.m_localPeer.peerid, this.m_fatherDHT.localPeer.eplist);
        }
        this._onStart();

        this.m_snOnlineListener = (eventName, params, sourcePeerid) => {
            assert(eventName === SNDHT.Event.SN.online && params.peerid === sourcePeerid,
                `eventName:${eventName},params:${JSON.stringify(params)},sourcePeerid:${sourcePeerid}`);
            
            if (params.peerid === this.m_localPeer.peerid) {
                return;
            }
            this.m_recentSNMap.set(params.peerid, {onlineTime: Date.now(), hash: HashDistance.hash(params.peerid)});
            this.m_eventEmitter.emit(SNDHT.Event.SN.online, {peerid: params.peerid});
        };
        this.m_snDHT.attachBroadcastEventListener(SNDHT.Event.SN.online, this.m_snOnlineListener);
        this.m_snDHT.emitBroadcastEvent(SNDHT.Event.SN.online, {peerid: this.m_localPeer.peerid});
    }

    _unjoinDHT() {
        if (!this.m_isJoinedDHT) {
            return;
        }

        this.m_isJoinedDHT = false;
        this.m_snDHT.signoutServer();
        this.m_fatherDHT.deleteValue(SN_DHT_SERVICE_ID, this.m_localPeer.peerid);

        if (this.m_snOnlineListener) {
            this.m_snDHT.detachBroadcastEventListener(SNDHT.Event.SN.online, this.m_snOnlineListener);
            this.m_snOnlineListener = null;
        }
    }

    getRecentNearSN(peerid) {
        let timeoutSNs = [];
        let now = Date.now();
        let peeridHash = HashDistance.hash(peerid);
        let nearestDistance = HashDistance.calcDistanceByHash(peeridHash, this.m_localPeer.hash);
        let nearestSNPeerid = this.m_localPeer.peerid;
        this.m_recentSNMap.forEach((snInfo, snPeerid) => {
            let cacheTime = now - snInfo.onlineTime;
            if (cacheTime > this.RECENT_SN_CACHE_TIME) {
                timeoutSNs.push(snPeerid);
                return;
            } else if (cacheTime < 0) {
                snInfo.onlineTime = now;
            }

            let distance2SN = HashDistance.calcDistanceByHash(peeridHash, snInfo.hash);
            if (HashDistance.compareHash(distance2SN, nearestDistance) < 0) {
                nearestDistance = distance2SN;
                nearestSNPeerid = snPeerid;
            }
        });
        
        timeoutSNs.forEach(snPeerid => this.m_recentSNMap.delete(snPeerid));
        return nearestSNPeerid;
    }
}

SNDHT.Event = {
    NearSNChanged: 'NearSNChanged',
    SN: {
        online: 'online', // SN上线
    }
};

module.exports = SNDHT;