'use strict';

const EventEmitter = require('events');
const Base = require('../base/base.js');
const {HashDistance, EndPoint, Config} = require('./util.js');
const Bucket = require('./bucket.js');
const DHTPackageFactory = require('./package_factory.js');
const DHTPackage = require('./packages/package.js');
const Peer = require('./peer.js');
const DHTCommandType = DHTPackage.CommandType;
const assert = require('assert');

const LOG_TRACE = Base.BX_TRACE;
const LOG_INFO = Base.BX_INFO;
const LOG_WARN = Base.BX_WARN;
const LOG_DEBUG = Base.BX_DEBUG;
const LOG_CHECK = Base.BX_CHECK;
const LOG_ASSERT = Base.BX_ASSERT;
const LOG_ERROR = Base.BX_ERROR;

let g_sendStat = null;

class PackageSender extends EventEmitter {
    constructor(mixSocket, bucket) {
        super();
        this.m_mixSocket = mixSocket;
        this.m_bucket = bucket;
        this.m_taskExecutor = null;
    }
    
    get mixSocket() {
        return this.m_mixSocket;
    }

    set taskExecutor(newValue) {
        this.m_taskExecutor = newValue;
    }

    sendPackage(toPeer, cmdPackage, ignoreRouteCache, timeout) {
        let localPeer = this.m_bucket.localPeer;
        let peerStruct = localPeer.toStructForPackage();
        // toPeer可能不是在本地路由表中记录的PEER对象；
        // 在发送时需要更新路由表中PEER对象的一些统计信息，
        // 所以这里要从路由表中重新查找一下
        let peer = this.m_bucket.findPeer(toPeer.peerid) || toPeer;
        if (!peer.hash) {
            peer.hash = HashDistance.hash(peer.peerid);
        }

        if (peer.peerid === localPeer.peerid) {
            cmdPackage.fillCommon(peerStruct, peer, []);
            setImmediate(() => this.emit(PackageSender.Events.localPackage, cmdPackage));
            return;
        }

        let recommandNodes = [];

        if (peer instanceof Peer.Peer &&
            peer.onlineDuration < Config.Peer.recommandNeighborTime &&
            !peer.__noRecommandNeighbor) {

            let closePeerList = this.m_bucket.findClosestPeers(peer.peerid);
            if (closePeerList && closePeerList.length > 0) {
                for (let closePeer of closePeerList) {
                    if (closePeer.isOnline(this.m_bucket.TIMEOUT_MS) &&
                        closePeer.peerid != peer.peerid &&
                        closePeer.peerid != peerStruct.peerid) {
                        recommandNodes.push({id: closePeer.peerid, eplist: closePeer.eplist});
                    }
                }
            }
        }
        
        cmdPackage.__isTooLarge = false;

        // 合并peer和toPeer两个对象的eplist+address
        let eplist = peer.eplist || [];
        let addr = peer.address;
        if (addr) {
            eplist = Peer.Peer.unionEplist(eplist, [EndPoint.toString(addr)]);
        }
        if (toPeer !== peer) {
            if (toPeer.eplist) {
                eplist = Peer.Peer.unionEplist(eplist, toPeer.eplist);
            }
            addr = toPeer.address;
            if (addr) {
                eplist = Peer.Peer.unionEplist(eplist, [EndPoint.toString(addr)]);
            }
        }

        if (!eplist || eplist.length === 0) {
            return;
        }

        let epSet = new Set(eplist);
        LOG_INFO(`PEER(${this.m_bucket.localPeer.peerid}) Send package(${DHTCommandType.toString(cmdPackage.cmdType)}) to peer(${peer.peerid})`);
        assert((peer.peerid === 'SEED_DHT_PEER_10000' || (!epSet.has('4@106.75.175.123@10010@t') && !epSet.has('4@106.75.175.123@10000@u'))),
            `from:${localPeer.peerid},to:${peer.peerid},pkg.src.peerid:${cmdPackage.src.peerid},pkg.dest.peerid:${cmdPackage.dest.peerid}`);

        let options = {
            ignoreCache: ignoreRouteCache,
            socket: null,
            onPreSend: (pkg, remoteAddr, socket, protocol) => this._onPreSendPackage(pkg, remoteAddr, socket, protocol, peer, peerStruct, recommandNodes),
            dropBusyTCP: true,
            timeout,
        };
        this.m_mixSocket.send(cmdPackage, eplist, options);
    }

    _onPreSendPackage(cmdPackage, remoteAddr, socket, protocol, peer, localPeerInfo, recommandNodes) {
        if (cmdPackage.__isTooLarge) {
            return null;
        }

        let now = Date.now();
        
        cmdPackage.fillCommon(localPeerInfo, peer, recommandNodes);
        if (!DHTCommandType.isResp(cmdPackage.cmdType)) {
            cmdPackage.common.packageID = g_sendStat.genPackageID();
        }
        
        cmdPackage.dest.ep = EndPoint.toString(remoteAddr);
        LOG_INFO(`PEER(${this.m_bucket.localPeer.peerid}) Send package(${DHTCommandType.toString(cmdPackage.cmdType)}) to peer(${cmdPackage.dest.peerid}|${peer.peerid}:${EndPoint.toString(remoteAddr)})`);
        assert(cmdPackage.dest.peerid === peer.peerid && cmdPackage.src.peerid === this.m_bucket.localPeer.peerid && (peer.peerid === 'SEED_DHT_PEER_10000' || (cmdPackage.dest.ep !== '4@106.75.175.123@10010@t' && cmdPackage.dest.ep !== '4@106.75.175.123@10000@u')),
            `from:${this.m_bucket.localPeer.peerid},to:${peer.peerid},pkg.src.peerid:${cmdPackage.src.peerid},pkg.dest.peerid:${cmdPackage.dest.peerid}`);
        
        let encoder = DHTPackageFactory.createEncoder(cmdPackage);
        let buffer = encoder.encode();

        if (buffer.length <= DHTPackageFactory.PACKAGE_LIMIT ||
            protocol === this.m_mixSocket.PROTOCOL.tcp ||
            !this.m_taskExecutor) {

            if (peer instanceof Peer.Peer &&
                !peer.__noRecommandNeighbor) {
                peer.__noRecommandNeighbor = true;
            }
            
            peer.lastSendTime = now;
            if (remoteAddr.protocol === EndPoint.PROTOCOL.udp) {
                peer.lastSendTimeUDP = now;
            }

            g_sendStat._onPkgSend(cmdPackage, buffer, peer, remoteAddr);
            return buffer;
        } else {
            // split package
            cmdPackage.__isTooLarge = true;
            this.m_taskExecutor.splitPackage(cmdPackage, peer);
            return null;
        }
    }
}

PackageSender.Events = {
    localPackage: 'localPackage',
}

let g_resenderQueue = [];
function removeTimeoutResender() {
    let now = Date.now();
    if (g_resenderQueue.length > 1024) {
        let i = 0;
        while (i < g_resenderQueue.length) {
            let resender = g_resenderQueue[i];
            // 先把超时包去掉
            if (resender.isTimeout() || now - resender.lastSendTime > 600000) {
                resender.m_timesLimitForce = 0;
                g_resenderQueue.splice(i, 1);
            } else {
                i++;
            }
        }
    }

    if (g_resenderQueue.length > 1024) {
        let i = 0;
        while (i < g_resenderQueue.length) {
            let resender = g_resenderQueue[i];
            // 重发包太多时候，限制最多重发两次
            if (resender.tryTimes > 2) {
                resender.m_timesLimitForce = 0;
                g_resenderQueue.splice(i, 1);
            } else {
                i++;
            }
        }
    }
}

class ResendControlor {
    // 如果不设置peer/pkg/sender，不能调用send，自己调用needResend判定是否需要resend，调用sender.sendPackage后调用onSend控制下次重试的节奏
    // 如果设置了peer/pkg/sender，可以随时调用send重试一次，send函数内部决定是否真的到了重试的时机
    // 内部不设定时器自动resend，使用方需要resend时需手动触发，不用担心任务完成还有额外的resend包发出
    constructor(peer = null, pkg = null, sender = null, initInterval = 1000, timesLimit = 5, isImmediately = true) {
        this.m_peer = peer;
        this.m_pkg = pkg;
        this.m_sender = sender;

        this.m_interval = initInterval;
        this.m_tryTimes = 0;
        this.m_timesLimit = timesLimit;
        this.m_timesLimitForce = timesLimit;
        this.m_lastSendTime = 0;
        this.m_isImmediately = isImmediately;

        g_resenderQueue.push(this);
        removeTimeoutResender();
    }

    send() {
        if (!(this.m_peer && this.m_pkg && this.m_sender && this.needResend())) {
            return;
        }

        this.onSend();
        let delay = (this.m_isImmediately && this.m_tryTimes === 1)? 0 : (this.m_interval >> 1);
        this.m_sender.sendPackage(this.m_peer, this.m_pkg, (this.m_tryTimes % 2 === 0), delay);
    }

    onSend() {
        this.m_lastSendTime = Date.now();
        this.m_tryTimes++;
        if (this.m_tryTimes >= 2) {
            this.m_interval *= 2;
        }
    }

    needResend() {
        return !this.isTimeout() && Date.now() >= this.lastSendTime + this.m_interval;
    }

    isTimeout() {
        return this.m_tryTimes >= Math.min(this.m_timesLimit, this.m_timesLimitForce);
    }

    abort() {
        this.m_timesLimitForce = 0;
    }

    get tryTimes() {
        return this.m_tryTimes;
    }
    
    get lastSendTime() {
        return this.m_lastSendTime;
    }
}

class SendStat {
    constructor(bucket) {
        assert(!g_sendStat);

        this.m_bucket = bucket;

        this.m_packageID = 0;
        this.m_packageTracer = []; // [{id, time}]
        
        // 记录向各peer发包情况，追踪可达peer的数据包丢失情况
        this.m_peerTracer = new Map(); // <peerid, [{time, length}]>
        this.m_traceClearTimer = null;

        this.m_stat = {
            udp: {
                pkgs: 0,
                bytes: 0,
            },
            tcp: {
                pkgs: 0,
                bytes: 0,
            },
            pkgs: new Map(),
        };
    }
    
    static create(bucket) {
        if (!g_sendStat) {
            g_sendStat = new SendStat(bucket);
        }
        return g_sendStat;
    }

    static stat() {
        return g_sendStat.stat();
    }

    stat() {
        return this.m_stat;
    }

    static onPackageGot(...args) {
        return g_sendStat.onPackageGot(...args);
    }

    onPackageGot(cmdPackage, remotePeer, remoteAddr, localAddr) {
        let now = Date.now();

        if (DHTCommandType.isResp(cmdPackage.cmdType)) {
            // update RTT
            let packageID = cmdPackage.common.packageID;
            if (packageID) {
                let spliceCount = 0;
                for (let i = 0; i < this.m_packageTracer.length; i++) {
                    let tracer = this.m_packageTracer[i];
                    if (tracer.id === packageID) {
                        this.m_packageTracer.splice(0, i + 1);
                        let rtt = Date.now() - tracer.time;
                        remotePeer.updateRTT(rtt);
                        this.m_bucket.localPeer.updateRTT(rtt);
                        break;
                    }
                }
            }
        }

        {
            // 计数可达peer的发包数
            if (remoteAddr) {
                let sendTracer = this.m_peerTracer.get(remotePeer.peerid);
                if (sendTracer) {
                    for (let t of sendTracer) {
                        if (now - t.time < Config.Package.Timeout) {
                            let stat = this.m_stat.udp;
                            if (t.protocol === EndPoint.PROTOCOL.tcp) {
                                stat = this.m_stat.tcp;
                            }
                            stat.pkgs++;
                            stat.bytes += t.length;
                        }
                    }
                    this.m_peerTracer.delete(remotePeer.peerid);
                }
            }
        }
    }
    
    genPackageID() {
        this.m_packageID++;
        return this.m_packageID;
    }

    _onPkgSend(cmdPackage, buffer, remotePeer, remoteAddr) {
        if (!EndPoint.isNAT(remoteAddr)) {
            let now = Date.now();
            let cmdType = cmdPackage.cmdType;
            if (cmdType === DHTCommandType.PACKAGE_PIECE_REQ) {
                cmdType = (DHTCommandType.PACKAGE_PIECE_REQ << 16) | cmdPackage.__orignalCmdType;
            }
            let count = this.m_stat.pkgs.get(cmdType) || 0;
            count++;
            this.m_stat.pkgs.set(cmdType, count);

            if (!DHTCommandType.isResp(cmdPackage.cmdType)) {
                this.m_packageTracer.push({id: cmdPackage.common.packageID, time: now});
            }

            // 记录发包时间
            let sendTracer = this.m_peerTracer.get(remotePeer.peerid);
            if (!sendTracer) {
                sendTracer = [{time: now, length: buffer.length, protocol: remoteAddr.protocol}];
                this.m_peerTracer.set(remotePeer.peerid, sendTracer);
            } else {
                sendTracer.push({time: now, length: buffer.length, protocol: remoteAddr.protocol});
            }

            // 定时清理
            if (!this.m_traceClearTimer) {
                this.m_traceClearTimer = setTimeout(() => {
                    this.m_traceClearTimer = null;
                    this._clearTimeoutTracer();
                }, Config.Package.Timeout * 2);
            }
        }
    }

    _clearTimeoutTracer() {
        // 清理超时记录
        let now = Date.now();
        let timeoutPeerids = [];
        this.m_peerTracer.forEach((t, peerid) => {
            if (now - t[t.length - 1].time >= Config.Package.Timeout) {
                timeoutPeerids.push(peerid);
            } else if (now - t[0].time >= Config.Package.Timeout) {
                for (let i = 0; i < t.length; i++) {
                    if (now - t[i].time < Config.Package.Timeout) {
                        t.splice(0, i);
                        break;
                    }
                }
            }
        });
        timeoutPeerids.forEach(peerid => this.m_peerTracer.delete(peerid));
    }
}

module.exports.PackageSender = PackageSender;
module.exports.ResendControlor = ResendControlor;
module.exports.SendStat = SendStat;