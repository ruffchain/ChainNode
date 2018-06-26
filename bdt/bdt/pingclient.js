"use strict";
const packageModule = require('./package');
const BDT_ERROR = packageModule.BDT_ERROR;
const BDTPackage = packageModule.BDTPackage;
const EventEmitter = require('events');
const baseModule = require('../base/base');
const SNDHT = require('../sn/sn_dht');
const blog = baseModule.blog;
const BaseUtil = require('../base/util.js');
const assert = require('assert');

class MultiSNPingClient extends EventEmitter {
    constructor(stack) {
        super();
        this.m_stack = stack;
        this.m_peerFinder = this.m_stack.peerFinder;
        this.m_state = PingClient.STATE.init;
        this.m_peerMap = {};
        this.m_snChangedListener = null;
        this.m_refreshSNTimer = null;
        this.m_lastSessionid = Math.floor(Math.random() * 100000);
        this.m_blackSNMap = {};
    }

    get state() {
        return this.m_state;
    }

    get snList() {
        let snList = [];
        for (let [sessionid, pingClient] of Object.entries(this.m_peerMap)) {
            snList.push(pingClient.sn);
        }
        return snList;
    }

    connect() {
        if (this.m_state === PingClient.STATE.init) {
            this.m_snChangedListener = () => {
                this.m_state = PingClient.STATE.connecting;
                let tryRefreshSNList = () => {
                    this.m_peerFinder.findSN(this.m_stack.peerid).then(([error, peerlist]) => {
                            if (error || !peerlist || !peerlist.length) {
                                return ;
                            }
                            if (peerlist.length > 3) {
                                peerlist = peerlist.slice(0, 3);
                            }
                            this._resetConnecting(peerlist);
                        });
                };
                this.m_refreshSNTimer = setInterval(tryRefreshSNList, this.m_stack._getOptions().tryOfflineSNInterval);
                tryRefreshSNList();
            };
            this.m_snChangedListener();
            this.m_peerFinder.on(this.m_peerFinder.EVENT.SNChanged, this.m_snChangedListener);
        } else {
            return BDT_ERROR.invalidState;
        }
    }

    close() {
        for (let peerid in this.m_peerMap) {
            this.m_peerMap[peerid].close();
            delete this.m_peerMap[peerid];
        }
        if (this.m_snChangedListener) {
            this.m_peerFinder.removeListener(this.m_peerFinder.EVENT.SNChanged, this.m_snChangedListener);
            this.m_snChangedListener = null;
        }
        if (this.m_refreshSNTimer) {
            clearInterval(this.m_refreshSNTimer);
            this.m_refreshSNTimer = null;
        }
        this.m_state = PingClient.STATE.closed;
    }

    _resetConnecting(peerlist) {
        if (!peerlist || !peerlist.length) {
            return;
        }

        let setBlack = peerid => {
            this.m_blackSNMap[peerid] = Date.now();
        };
        let isBlack = peerid => {
            let t = this.m_blackSNMap[peerid];
            let now = Date.now();
            if (t) {
                if (now > t && now - t < this.m_stack._getOptions().tryOfflineSNInterval) {
                    return true;
                }
                delete this.m_blackSNMap[peerid];
            }
            return false;
        }

        // 取第一个节点作为主节点，并以它的上下线作为上下线标志
        let peeridlist = new Set();
        let mainPeerid = null;
        peerlist.forEach(peer => {
            if (!isBlack(peer.peerid)) {
                peeridlist.add(peer.peerid);
                mainPeerid = mainPeerid || peer.peerid;
            }
        });
        if (peeridlist.size === 0) {
            return;
        }

        let now = Date.now();
        for (let [sessionid, pingClient] of Object.entries(this.m_peerMap)) {
            if (peeridlist.has(pingClient.sn.peerid) && pingClient.state !== PingClient.STATE.offline) {
                pingClient.isMain = (pingClient.sn.peerid === mainPeerid);
                peeridlist.delete(pingClient.sn.peerid);
            } else {
                setBlack(pingClient.sn.peerid);
                pingClient.close();
                delete this.m_peerMap[sessionid];
            }
        }

        if (!this.m_connecting) {
            this.m_connecting = {};
        }
        this.m_connecting.startTime = Date.now();
        
        for (let peer of peerlist) {
            if (peeridlist.has(peer.peerid)) {
                let sessionid = this._genSessionid();
                let pingClient = new PingClient(this.m_stack, peer, sessionid);
                pingClient.connect();
                pingClient.isMain = (peer.peerid === mainPeerid);
                // 主SN上线下线决定SN总体状态；任意SN下线就重新搜索SN
                pingClient.once(PingClient.EVENT.online, ()=>{
                    if (this.m_peerMap[sessionid] && pingClient.isMain) {
                        if (this.m_state !== PingClient.STATE.online) {
                            this.m_state = PingClient.STATE.online;
                            setImmediate(()=>{this.emit(PingClient.EVENT.online);});
                        }
                    }
                });

                pingClient.once(PingClient.EVENT.offline, ()=>{
                    setBlack(pingClient.sn.peerid);
                    if (this.m_peerMap[sessionid]) {
                        if (pingClient.isMain) {
                            if (this.m_state !== PingClient.STATE.offline) {
                                this.m_state = PingClient.STATE.offline;
                                setImmediate(() => this.emit(PingClient.EVENT.offline));
                            }
                        }
                        if (this.m_snChangedListener) {
                            this.m_snChangedListener();
                        }
                    }
                });

                pingClient.on(PingClient.EVENT.nearSN, snPeerid => {
                    let newSNPingClient = this._getPingClientByPeerid(snPeerid);
                    if (newSNPingClient) {
                        if (newSNPingClient.state === PingClient.EVENT.offline) {
                            newSNPingClient.close();
                            setBlack(snPeerid);
                            delete this.m_peerMap[newSNPingClient.sessionid];
                        } else {
                            return;
                        }
                    }

                    if (this.m_snChangedListener) {
                        this.m_snChangedListener();
                    }
                });

                this.m_peerMap[sessionid] = pingClient;
            }
        }
        peeridlist = null;
    }

    _onPackage(decoder, remoteSender) {
        let pingClient = this.m_peerMap[decoder.header.sessionid];
        if (pingClient) {
            pingClient._onPackage(decoder, remoteSender);
        }
    }

    _genSessionid() {
        let sessionid = this.m_lastSessionid;
        do {
            sessionid++;
            if (sessionid === 0x80000000) {
                sessionid = 1025;
            }
            assert(this.m_lastSessionid !== sessionid);
        } while (this.m_peerMap[sessionid]);
        this.m_lastSessionid = sessionid;
        return sessionid;
    }

    _getPingClientByPeerid(snPeerid) {
        for (let [sessionid, pingClient] of Object.entries(this.m_peerMap)) {
            if (pingClient.sn.peerid === snPeerid) {
                return pingClient;
            }
        }
        return null;
    }
}

class PingClient extends EventEmitter {
    constructor(stack, snPeer, sessionid) {
        super();
        this.m_stack = stack;
        this.m_state = PingClient.STATE.init;
        this.m_connecting = null;
        this.m_snSender = null;
        this.m_seq = stack.initSeq();
        this.m_ping = null;
        this.m_snPeer = {
            peerid: snPeer.peerid,
            peeridHash: BDTPackage.hashPeerid(snPeer.peerid),
            eplist: new Array(...snPeer.eplist)
        };

        this.m_initSender = this._initSender();
        this.m_isMain = false;
        this.m_pingInterval = stack._getOptions().pingInterval;
        this.m_sessionid = sessionid;
    }

    get sn() {
        return this.m_snPeer;
    }

    get snSender() {
        return this.m_snSender;
    }

    get state() {
        return this.m_state;
    }

    get isMain() {
        return this.m_isMain;
    }

    set isMain(is) {
        this.m_isMain = is;
        this.m_pingInterval = this.m_stack._getOptions().pingInterval;
        // 不是主SN，把ping间隔拉长一倍
        if (!is) {
            this.m_pingInterval *= 2;
        }
    }

    get sessionid() {
        return this.m_sessionid;
    }

    connect() {
        if (this.m_state === PingClient.STATE.init) {
            this.m_state = PingClient.STATE.connecting;
            this.m_connecting = {
                startTime: Date.now(),
                timer: null
            };

            this._tryConnect();
            return BDT_ERROR.success;
        } else {
            return BDT_ERROR.invalidState;
        }
    }

    close() {
        this._stopConnecting();
        this._stopPing();
        this.removeAllListeners(PingClient.EVENT.online);
        this.removeAllListeners(PingClient.EVENT.offline);
        this.removeAllListeners(PingClient.EVENT.nearSN);
        this.m_state = PingClient.STATE.closed;
    }

    _onPackage(decoder, remoteSender) {
        let getProtocol = (sender) => {
            if (sender.remoteEPList.length > 0) {
                let addr = BaseUtil.EndPoint.toAddress(sender.remoteEPList[0]);
                return addr.protocol;
            }
        }

        let header = decoder.header;
        assert(header.sessionid === this.m_sessionid, `pkg.sessionid:${header.sessionid},sessionid:${this.m_sessionid}`);
        if (decoder.header.cmdType === BDTPackage.CMD_TYPE.pingResp) {
            if (this.m_state < PingClient.STATE.connecting) {
                return ;
            }
            if (header.ackSeq === this.m_seq) {
                this.m_seq += 1;
            }
            let body = decoder.body;
            if (body.forward) {
                this._resetConnecting(body.forward);
            } else if (body.offline) {
                this._stopPing();
                this.m_state = PingClient.STATE.offline;
                this.emit(PingClient.EVENT.offline);
                return ;
            } else {
                if (this.m_state === PingClient.STATE.connecting) {
                    this._stopConnecting();
                    this.m_state = PingClient.STATE.online;
                    this.m_snSender = remoteSender;
                    let now = Date.now();
                    this.m_ping = {
                        timer: null,
                        lastRespTime: now,
                        lastUDPTime: now,
                    };

                    let opt = this.m_stack._getOptions();
                    let pingInterval = opt.pingInterval;
                    let timeUpdateDetect = BaseUtil.TimeHelper.createTimeUpdateDetector(opt.timeoutDeviation, pingInterval);
                    let lastPingTime = now;
                    this.m_ping.timer = setInterval(()=>{
                        let [now, timeRevise] = timeUpdateDetect();
                        this.m_ping.lastRespTime += timeRevise;
                        this.m_ping.lastUDPTime += timeRevise;
                        lastPingTime += timeRevise;

                        let respInterval = now - this.m_ping.lastRespTime;
                        if (respInterval > opt.pingTimeout) {
                            this._stopPing();
                            this.m_state = PingClient.STATE.offline;
                            this.emit(PingClient.EVENT.offline);
                            return ;
                        } else if (respInterval > pingInterval * 3) {
                            this.m_snSender.socket = null;
                        } else if (respInterval > pingInterval * 5) {
                            this.m_snSender.isResend = true;
                            // 太长时间没收到响应包，测试一下TCP，万一连通还能凑合一下
                            if (this.m_initSender.tcp) {
                                this.m_initSender.tcp.isResend = true;
                                this.m_initSender.tcp.postPackage(pingPkg, null, true, opt.pingDelay);
                            }
                        }

                        let pingPkg = this._createPingPackage();
                        if (this.m_isMain || now - lastPingTime >= this.m_pingInterval) {
                            if (this.m_snSender.postPackage(pingPkg, null, true, opt.pingDelay) !== this.m_stack.mixSocket.ERROR.success) {
                                this.m_snSender.isResend = true;
                                this.m_snSender.postPackage(pingPkg, null, true, opt.pingDelay);
                            }
                        }

                        // 太长时间没udp收发，一般是udp被禁的情况，但还是测试一下，万一突然打开了呢
                        if (getProtocol(this.m_snSender) === BaseUtil.EndPoint.PROTOCOL.tcp) {
                            if (now - this.m_ping.lastUDPTime > pingInterval * 5 &&
                                this.m_initSender.udp) {
                                    this.m_initSender.udp.isResend = true;
                                    this.m_initSender.udp.postPackage(pingPkg, null, true, opt.pingDelay);
                                    this.m_ping.lastUDPTime = now;
                            }
                        } else {
                            this.m_ping.lastUDPTime = now;
                        }
                    }, pingInterval);
                    this.emit(PingClient.EVENT.online);
                } else if (this.m_state === PingClient.STATE.online) {
                    let now = Date.now();
                    if (getProtocol(remoteSender) === BaseUtil.EndPoint.PROTOCOL.udp) {
                        this.m_ping.lastUDPTime = now;
                        this.m_snSender = remoteSender;
                        this.m_snSender.isResend = false;
                    } else {
                        // 如果收到TCP响应包，等UDP完全没响应再把当前生效sender改成tcp
                        if (now - this.m_ping.lastUDPTime > this.m_stack._getOptions().pingInterval * 5) {
                            this.m_snSender = remoteSender;
                            this.m_snSender.isResend = false;
                        }
                    }
                    this.m_ping.lastRespTime = now;
                }

                if (body.nearSN) {
                    setImmediate(() => this.emit(PingClient.EVENT.nearSN, body.nearSN));
                }
            }
        }
    }

    _tryConnect() {
        // 尽量用udp，tcp协议无法穿透，纯TCP协议SN的价值在于所有节点都是公网节点，无需穿透
        let encoder = this._createPingPackage();
        const opt = this.m_stack._getOptions();
        if (this.m_initSender.udp) {
            this.m_initSender.udp.postPackage(encoder, null, true, opt.pingDelay);
        } else {
            this.m_initSender.tcp.postPackage(encoder, null, true, opt.pingDelay);
        }

        let tryTimes = 0;
        let ping = () => {
            tryTimes++;
            if (tryTimes > 3) {
                if (this.m_initSender.tcp) {
                    this.m_initSender.tcp.postPackage(encoder, null, true, opt.pingDelay);
                    this.m_initSender.tcp.isResend = (tryTimes % 3 === 0);
                }
            }
            if (this.m_initSender.udp) {
                this.m_initSender.udp.postPackage(encoder, null, true, opt.pingDelay);
                this.m_initSender.udp.isResend = (tryTimes % 3 === 0);
            }
        }

        let timeUpdateDetect = BaseUtil.TimeHelper.createTimeUpdateDetector(opt.timeoutDeviation, opt.pingConnectInterval);
        this.m_connecting.timer = setInterval(()=>{
            let [now, timeRevise] = timeUpdateDetect();
            this.m_connecting.startTime += timeRevise;
            if (now - this.m_connecting.startTime > opt.pingConnectTimeout) {
                this._stopConnecting();
                this.m_state = PingClient.STATE.offline;
                this.emit(PingClient.EVENT.offline);
                return ;
            }
            ping();
        }, opt.pingConnectInterval);

        ping();
    }

    _resetConnecting(remoteInfo) {
        this.m_snPeer = remoteInfo;
        this.m_snPeer.peeridHash = BDTPackage.hashPeerid(remoteInfo.peerid);
        
        if (this.m_state === PingClient.STATE.connecting) {
            this.m_connecting.startTime = Date.now();
        } else if (this.m_state === PingClient.STATE.online) {
            this.m_state = PingClient.STATE.connecting;
            this._stopPing();
            this.m_connecting = {
                startTime: Date.now(),
                timer: null
            };
            this._tryConnect();
        }
    }

    _stopConnecting() {
        if (this.m_connecting) {
            clearInterval(this.m_connecting.timer);
            this.m_connecting = null;
        }
    }


    _stopPing() {
        if (this.m_ping) {
            clearInterval(this.m_ping.timer);
            this.m_ping = null;
        }
    }


    _createPingPackage() {
        let encoder = BDTPackage.createEncoder();
        let header = encoder.header;
        header.cmdType = BDTPackage.CMD_TYPE.pingReq;
        header.sessionid = this.m_sessionid;
        header.src = {
            peeridHash: this.m_stack.peeridHash 
        };
        header.dest = {
            peeridHash: this.m_snPeer.peeridHash
        };
        header.seq = this.m_seq;
        let body = encoder.body;
        body.peerid = this.m_stack.peerid;
        body.eplist = this.m_stack.eplist;
        return encoder;
    }

    _initSender() {
        let initSender = {
            udp: null,
            tcp: null,
        };

        let classifyEPList = (eplist, protocol) => {
            let subEPList = [];
            eplist.forEach(ep => {
                let addr = BaseUtil.EndPoint.toAddress(ep);
                if (addr.protocol === protocol) {
                    subEPList.push(ep);
                }
            });
            return subEPList;
        }

        let udpEPList = classifyEPList(this.m_snPeer.eplist, BaseUtil.EndPoint.PROTOCOL.udp);
        if (udpEPList.length > 0) {
            initSender.udp = BDTPackage.createSender(this.m_stack.mixSocket, null, udpEPList);
        }

        let tcpEPList = classifyEPList(this.m_snPeer.eplist, BaseUtil.EndPoint.PROTOCOL.tcp);
        if (tcpEPList.length > 0) {
            initSender.tcp = BDTPackage.createSender(this.m_stack.mixSocket, null, tcpEPList);
        }
        return initSender;
    }
}


PingClient.STATE = {
    init: 0,
    connecting: 1,
    online: 2,
    offline: 3,
    closed:  4,
};

PingClient.EVENT = {
    online: 'online',
    offline: 'offline',
    nearSN: 'nearSN',
};

module.exports.PingClient = PingClient;
module.exports.MultiSNPingClient = MultiSNPingClient;