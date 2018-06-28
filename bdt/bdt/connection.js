"use strict";
const EventEmitter = require('events');
const assert = require('assert');
const packageModule = require('./package');
const BDTStack = require('./stack');
const BDTTransfer = require('./transfer');
const TCPTransfer = require('./tcp_transfer');
const BDTPackage = packageModule.BDTPackage;
const BDT_ERROR = packageModule.BDT_ERROR;
const baseModule = require('../base/base');
const blog = baseModule.blog;
const BaseUtil = require('../base/util.js');
const EndPoint = BaseUtil.EndPoint;
const {TCPConnectionMgr} = require('./tcp_connection_helper.js');

class BDTConnection extends EventEmitter {
    /*
        options:
            vport:number vport 
            allowHalfOpen: true or false
    */
    constructor(stack, options) {
        super();
        this.m_stack = stack;
        this.m_state = BDTConnection.STATE.init;
        this.m_createFrom = null;

        this.m_remote = {
            peerid: null,
            peeridHash: null,
            vport: null,
            sender: null,
            sessionid: null,
        };

        this.m_vport = null;
        this.m_sessionid = null;

        this.m_nextSeq = stack.initSeq();
        this.m_nextRemoteSeq = null;
        /*{
            timer: NodeTimer timer instance to clearInterval
            startTime:number start time
            vport:number vport to syn
            sender:[BDTPackageSender] sender to use
        }*/
        this.m_tryConnect = null;

        /*{
            timer: NodeTimer timer instance to clearInterval
        }*/
        this.m_snCall = null;

        this.m_peerFinder = null;

//<<<<<<<<<统计诊断
        this.queryRemote = {
            ep: '', // 对方发包地址，如果跟从SN和DHT返回eplist不同，基本可以确定对方是对称NAT
            sn: {
                start: 0, // 开始查询SN的时间
                finishsn: 0, // 查询到SN的时间
                respEP1: 0, // SN第一次响应时间
                respEP2: 0, // SN最后一次响应时间
                getEP: 0, // 第一次返回对方地址的时间
                snList: [],
                eplist: [],
            },
            dht: {
                start: 0,
                finish: 0,
                eplist: [],
            },
            flow: {
                udp: {
                    send: {
                        pkgs: 0,
                        bytes: 0,
                    },
                    recv: {
                        pkgs: 0,
                        bytes: 0,
                    }
                },
                tcp: {
                    send: {
                        pkgs: 0,
                        bytes: 0,
                    },
                    recv: {
                        pkgs: 0,
                        bytes: 0,
                    }
                }
            }
        };
//>>>>>>>>>>>>>>

        this.m_respPackages = {};
        this.m_pendingDataPackages = [];

        this.m_transfer = null;

        let now = Date.now();
        this.m_heartbeat = {
            lastRecvTime: now,
            lastSendTime: now
        };
        this.m_heartbeatTimer = null;

        this.m_useTCP = false;

        this.m_options = {
            // 是否允许半开连接：
            // 如果置true，在收到'end'事件后，依旧可以向对端发送数据，直到不再需要connection后手动调用close关闭连接；
            // 默认值为false，在收到对端发来的'fin'包后自动回复一个'fin'关闭连接。
            allowHalfOpen: false,
        };

        if (options && options.allowHalfOpen) {
            this.m_options.allowHalfOpen = true;
        }
    }

    get local() {
        return {
            peerid: this.m_stack.peerid,
            vport: this.m_vport,
        };
    }

    get remote() {
        return {
            peerid: this.m_remote.peerid,
            vport: this.m_remote.vport
        };
    }

    get useTCP() {
        return this.m_useTCP;
    }

    bind(vport) {
        if (this.m_stack.state !== BDTStack.STATE.created) {
            blog.error(`[BDT]: connection bind when stack not create`);
            return BDT_ERROR.invalidState;
        }
        let err = BDT_ERROR.success;
        [err, vport] = this.m_stack._genVPort(vport, this);
        if (err) {
            blog.error(`[BDT]: connection bind to vport failed for ${BDT_ERROR.toString(err)}`);
            return err;
        }

        let sessionid = null;
        [err, sessionid] = this.m_stack._genSessionid(this);
        if (err) {
            this.m_stack._releaseVPort(vport, this);
            blog.error(`[BDT]: connection gen sessionid failed for ${BDT_ERROR.toString(err)}`);
            return err;
        }
        blog.info(`[BDT]: connection bind to vport ${vport}`);
        this.m_createFrom = BDTConnection.CREATE_FROM.connect;
        this.m_vport = vport;
        this.m_sessionid = sessionid;
        return BDT_ERROR.success;
    }

    /*params:{
        peerid:string acceptor's peerid
        vport:number acceport's vport
    }
    */
    // event error
    // event connect
    connect(params, callback) {
        assert(this.m_vport);
        if (callback) {
            this._connect(params).then(()=>{
                callback();
            });
        } else {
            return this._connect(params);
        }
    }

    send(buffer) {
        if (this.m_state !== BDTConnection.STATE.establish &&
            this.m_state !== BDTConnection.STATE.closeWait) {
            return 0;
        }     
        return this.m_transfer.send(buffer);
    }

    close(force=false, callback=null) {
        if (this.m_state === BDTConnection.STATE.closed) {
            if (callback) {
                callback();
            }
            return Promise.resolve();    
        }
        return new Promise((resolve)=>{
            this.once(BDTConnection.EVENT.close, ()=>{
                if (callback) {
                    callback();
                }
                resolve();
            });
            if (force) {
                this._changeState(BDTConnection.STATE.closed);
                return;
            }
            if (this.m_state < BDTConnection.STATE.establish) {
                this._changeState(BDTConnection.STATE.closed);
            } else if (this.m_state === BDTConnection.STATE.establish) {
                this._changeState(BDTConnection.STATE.finWait1);
            } else if (this.m_state === BDTConnection.STATE.closeWait) {
                this._changeState(BDTConnection.STATE.lastAck);
            } 
        }); 
    }

    get stack() {
        return this.m_stack;
    }

    _nextSeq(length) {
        let seq = this.m_nextSeq;
        this.m_nextSeq += length;
        if (length !== 0) {
            blog.debug(`[BDT]: connection update seq to ${this.m_nextSeq}`);
        }
        return seq; 
    }

    _setNextRemoteSeq(remoteSeq) {
        this.m_nextRemoteSeq = remoteSeq;
        blog.debug(`[BDT]: connection update remote seq to ${remoteSeq}`);
        return this.m_nextRemoteSeq;
    }

    _getNextRemoteSeq() {
        return this.m_nextRemoteSeq;
    }
    
    _postPackage(encoder) {
        if (!this._onSendPackage) {
            this._onSendPackage = (packageBuffer, remoteAddr, socket, protocol) => {
                if (!EndPoint.isNAT(remoteAddr)) {
                    let stat = this.queryRemote.flow.udp;
                    if (protocol === EndPoint.PROTOCOL.tcp) {
                        stat = this.queryRemote.flow.tcp;
                    }
                    stat.send.pkgs++;
                    stat.send.bytes += packageBuffer.length;
                }
            }
        }
        this.m_heartbeat.lastSendTime = Date.now();
        this.m_remote.sender.postPackage(encoder, this._onSendPackage, !this.useTCP);
    }

    _connect(params) {
        blog.info(`[BDT]: connection begin connect to ${params.peerid}:${params.vport}`);
        let connectOp = new Promise(
            (resolve, reject)=>{
                this.once(BDTConnection.EVENT.error, (err)=>{
                    resolve(err);
                });
                this.once(BDTConnection.EVENT.connect, ()=>{
                    resolve(BDT_ERROR.success);
                });
                if (this.m_state !== BDTConnection.STATE.init) {
                    blog.warn(`[BDT]: connection try to connect in state ${BDTConnection.STATE.toString(this.m_state)}`);
                    this.emit(BDTConnection.EVENT.error, BDT_ERROR.invalidState);
                    return ;
                }
                if (!this.m_vport) {
                    blog.warn(`[BDT]: connection try to connect before bind to vport`);
                    this.emit(BDTConnection.EVENT.error, BDT_ERROR.conflict);
                    return ;
                }

                this.m_remote.peerid = params.peerid;
                this.m_remote.peeridHash = BDTPackage.hashPeerid(params.peerid);
                this.m_remote.vport = params.vport;
                this._changeState(BDTConnection.STATE.waitAck,
                    BDTPackage.createSender(this.m_stack.mixSocket, null, [])
                );
            }
        );
        return connectOp;
    }

    _createFromAcceptor(params) {
        let { remote, acceptor }  = params;
        this.m_remote = {
            peerid: remote.peerid,
            peeridHash: remote.peeridHash,
            vport: remote.vport,
            sessionid: remote.sessionid,
        };
        this.m_acceptor = acceptor;
        this.m_vport = acceptor.vport;
        this.m_createFrom = BDTConnection.CREATE_FROM.acceptor;

        // generate local sessionid
        let [err, sessionid] = this.m_stack._genSessionid(this);
        if (err) {
            blog.error(`[BDT]: create connection from acceptor on vport ${this.m_vport} with remote ${this.m_remote} failed, err = ${BDT_ERROR.toString(err)}`);
            return err;
        }
        this.m_sessionid = sessionid;
        blog.debug(`[BDT]: create connection from acceptor on vport ${this.m_vport} with remote ${this.m_remote}`);
        return BDT_ERROR.success;
    }

    _createPackageHeader(cmdType) {
        let encoder = BDTPackage.createEncoder();
        let header = encoder.header;
        header.useTCP = this.m_useTCP;
        header.cmdType = cmdType;
        header.dest = {
            peeridHash: this.m_remote.peeridHash,
            vport: this.m_remote.vport
        };
        header.src = {
            peeridHash: this.m_stack.peeridHash,
            vport: this.m_vport
        };
        header.sessionid = this.m_remote.sessionid;
        return encoder;
    }

    _createSynAckPackage(seq, ackSeq) {
        let encoder = this._createPackageHeader(BDTPackage.CMD_TYPE.synAck);
        encoder.header.seq = seq;
        encoder.header.ackSeq = ackSeq;
        encoder.header.sessionid = this.m_sessionid;
        encoder.body.src = this.m_stack.peerid;
        encoder.body.dest = this.m_remote.peerid;

        return encoder;
    }

    _createSynPackage(seq) {
        let encoder = this._createPackageHeader(BDTPackage.CMD_TYPE.syn);
        encoder.header.seq = seq;
        encoder.header.sessionid = this.m_sessionid;
        encoder.body.src = this.m_stack.peerid;
        encoder.body.dest = this.m_remote.peerid;
        return encoder;
    }

    _createCallPackage(seq) {
        let encoder = this._createPackageHeader(BDTPackage.CMD_TYPE.callReq);
        encoder.header.seq = seq;
        encoder.header.sessionid = this.m_sessionid;
        encoder.body.src = this.m_stack.peerid;
        encoder.body.dest = this.m_remote.peerid;
        return encoder;
    }

    _createCalledRespPackage(called) {
        let encoder = this._createPackageHeader(BDTPackage.CMD_TYPE.calledResp);
        encoder.header.ackSeq = called.header.seq;
        encoder.header.sessionid = this.m_sessionid;
        encoder.body.src = this.m_stack.peerid;
        encoder.body.dest = this.m_remote.peerid;

        return encoder;
    }

    _createSynAckAckPackage(seq) {
        let encoder = this._createPackageHeader(BDTPackage.CMD_TYPE.synAckAck);
        encoder.header.seq = seq;
        encoder.body.src = this.m_stack.peerid;
        encoder.body.dest = this.m_remote.peerid;

        return encoder;
    }

    _createHeartbeatPackage() {
        let encoder = this._createPackageHeader(BDTPackage.CMD_TYPE.heartbeat);
        return encoder;
    }

    _createHeartbeatRespPackage() {
        let encoder = this._createPackageHeader(BDTPackage.CMD_TYPE.heartbeatResp);
        return encoder;
    }

    _startHeartbeat() {
        if (this.m_heartbeatTimer) {
            return ;
        }

        let timeoutTimes = 0;
        let beginTimeout = this.m_stack._getOptions().heartbeatBeginTimeout;
        let breakTimeout = this.m_stack._getOptions().breakTimeout;
        let heartbeatInterval = this.m_stack._getOptions().heartbeatInterval;
        let timeUpdateDetect = BaseUtil.TimeHelper.createTimeUpdateDetector(this.m_stack._getOptions().timeoutDeviation, heartbeatInterval);
        this.m_heartbeatTimer = setInterval(() => {
            let [now, reviseDelta] = timeUpdateDetect();
            this.m_heartbeat.lastRecvTime += reviseDelta;
            this.m_heartbeat.lastSendTime += reviseDelta;

            let timeout = now - this.m_heartbeat.lastRecvTime;
            if (timeout > beginTimeout) {
                timeoutTimes++;
                if (timeoutTimes % 3 === 0) {
                    if (this.m_remote.sender && !this.m_useTCP) {
                        this.m_remote.sender.socket = null;
                        this.m_remote.sender.isResend = true;
                    }
                }
                if (timeout > breakTimeout) {
                    this._changeState(BDTConnection.STATE.break, BDT_ERROR.timeout);
                } else {
                    if (now - this.m_heartbeat.lastSendTime > heartbeatInterval) {
                        this._postPackage(this._createHeartbeatPackage());
                    }
                }
            } else {
                timeoutTimes = 0;
            }
        }, heartbeatInterval);
    }

    _stopHeartbeat() {
        if (this.m_heartbeatTimer) {
            clearInterval(this.m_heartbeatTimer);
            this.m_heartbeatTimer = null;
        }
    }
 
    _refreshHeartbeat() {
        this.m_heartbeat.lastRecvTime = Date.now();
    }

    _onPackage(decoder, remoteSender) {
        let remoteEP = remoteSender.remoteEPList[0];
        if (decoder.header.cmdType === BDTPackage.CMD_TYPE.calledReq) {
            let calledResp = null;
            if (this.m_state === BDTConnection.STATE.init) {
                let updateRemoteSender = BDTPackage.createSender(
                    this.m_stack.mixSocket,
                    null, 
                    decoder.body.eplist);
                blog.debug(`[BDT]: connection update connecting remote address to ${decoder.body.eplist}`);
                calledResp = this._createCalledRespPackage(decoder);
                this.m_respPackages[calledResp.header.cmdType] = calledResp;
                this._changeState(BDTConnection.STATE.waitAckAck, updateRemoteSender);
            } else {
                // sn重发的called 包在任何时候都要回复called resp
                calledResp = this.m_respPackages[BDTPackage.CMD_TYPE.calledResp];
                if (!calledResp) {
                    calledResp = this._createCalledRespPackage(decoder);
                    this.m_respPackages[calledResp.header.cmdType] = calledResp;
                }
            }
            remoteSender.postPackage(calledResp);
            return ;
        } else if (decoder.header.cmdType === BDTPackage.CMD_TYPE.callResp) {
            // <<<<<<统计诊断
            let now = Date.now();
            if (this.queryRemote.sn.respEP1 === 0) {
                this.queryRemote.sn.respEP1 = now;
            }
            if (decoder.body.eplist.length > 0) {
                this.queryRemote.sn.getEP = this.queryRemote.sn.getEP || now;
            }
            this.queryRemote.sn.respEP2 = now;
            this.queryRemote.sn.eplist = [... new Set([...this.queryRemote.sn.eplist, ...decoder.body.eplist])];
            // console.log(`snEP:${remoteEP},eplist:${decoder.body.eplist},time:${decoder.body.time},now:${now}`);
            // >>>>>>
            if (this.m_state === BDTConnection.STATE.waitAck) {
                if (decoder.body.eplist.length) {
                    this._addRemoteEP(decoder.body.eplist);
                    blog.debug(`[BDT]: connection update connecting remote address to ${decoder.body.eplist}`);
                }
            }
        }
        
        // TCP应该始终确定remoteEP和socket
        if (this.m_remote.sender && !this.m_useTCP) {
            this.m_remote.sender.addRemoteEPList(remoteSender.remoteEPList);
            if (this.m_remote.sender.isResend) {
                this.m_remote.sender.isResend = false;
                this.m_remote.sender.socket = remoteSender.socket;
                this.m_remote.sender.updateActiveEP(remoteEP);
            }
        }

        let remoteAddr = EndPoint.toAddress(remoteEP);
        if (this.m_state === BDTConnection.STATE.establish && !EndPoint.isNAT(remoteAddr)) {
            let stat = this.queryRemote.flow.udp;
            if (remoteAddr.protocol === EndPoint.PROTOCOL.tcp) {
                stat = this.queryRemote.flow.tcp;
            }
            stat.recv.pkgs++;
            stat.recv.bytes += decoder.header.totalLength;
        }

        this._refreshHeartbeat();
        if (decoder.header.cmdType === BDTPackage.CMD_TYPE.syn) {
            this.queryRemote.ep = remoteEP;
            if (this.m_createFrom === BDTConnection.CREATE_FROM.acceptor) {
                if (this.m_state === BDTConnection.STATE.init) {
                    blog.debug(`[BDT]: connection update connecting remote address to ${remoteSender.remoteEPList}`);
                    this._changeState(BDTConnection.STATE.waitAckAck, remoteSender);
                } else if (!this.m_useTCP) {
                    // 任何时候收到syn 也应该回复ack， 防止ack丢失
                    // ack丢失可能是因为对方地址错误，更新一下
                    this._addRemoteEP(remoteSender.remoteEPList);
                    let ack = this.m_respPackages[BDTPackage.CMD_TYPE.synAck];
                    if (ack) {
                        remoteSender.postPackage(ack);
                    }
                }
            }
        } else if (decoder.header.cmdType === BDTPackage.CMD_TYPE.synAck) {
            this.queryRemote.ep = remoteEP;
            // console.log(`synAck: remoteEP:${remoteEP}`);
            if (this.m_state === BDTConnection.STATE.waitAck) {
                // 可确定是否用tcp
                this.m_useTCP = (remoteAddr.protocol === EndPoint.PROTOCOL.tcp);
                this.m_remote.sender = remoteSender;
                this.m_remote.sender.updateActiveEP(remoteEP);
                this.m_remote.sessionid = decoder.header.sessionid;
                if (this.m_tryConnect && this.m_tryConnect.remoteSender && !this.m_useTCP) {
                    this.m_remote.sender.addRemoteEPList(this.m_tryConnect.remoteSender.remoteEPList);
                }
                this._setNextRemoteSeq(decoder.nextSeq);
                let synAckAck = this._createSynAckAckPackage(this._nextSeq(1), decoder.header.seq);
                if (!this.m_useTCP) {
                    this.m_respPackages[synAckAck.header.cmdType] = synAckAck;
                }
                this.m_remote.sender.postPackage(synAckAck);
                this._changeState(BDTConnection.STATE.establish);
            } else if (!this.m_useTCP) {
                // 任何时候收到ack 也应该回复ackack， 防止ackack丢失
                let synAckAck = this.m_respPackages[BDTPackage.CMD_TYPE.synAckAck];
                assert(synAckAck);
                remoteSender.postPackage(synAckAck);
            }
        } else if (decoder.header.cmdType === BDTPackage.CMD_TYPE.synAckAck) {
            this.queryRemote.ep = remoteEP;
            if (this.m_state === BDTConnection.STATE.waitAckAck) {
                // 可确定是否用tcp
                this.m_useTCP = decoder.header.useTCP;
                assert(!this.m_useTCP || remoteAddr.protocol === EndPoint.PROTOCOL.tcp);
                this.m_remote.sender = remoteSender;
                this.m_remote.sender.updateActiveEP(remoteEP);
                if (this.m_tryConnect && this.m_tryConnect.remoteSender && !this.m_useTCP) {
                    this.m_remote.sender.addRemoteEPList(this.m_tryConnect.remoteSender.remoteEPList);
                }

                this._setNextRemoteSeq(decoder.nextSeq);
                this._changeState(BDTConnection.STATE.establish);
                if (!this.m_useTCP) {
                    let prePkg = null;
                    this.m_pendingDataPackages.forEach(pkg => {
                        assert(!prePkg || pkg.header.seq > prePkg.seq);
                        this.m_transfer._onPackage(pkg);
                    });
                }
                this.m_pendingDataPackages = null;
            }
        } else if (decoder.header.cmdType === BDTPackage.CMD_TYPE.data
            ||decoder.header.cmdType === BDTPackage.CMD_TYPE.fin) {
            this.queryRemote.ep = remoteEP;
            assert(!this.m_useTCP || remoteAddr.protocol === EndPoint.PROTOCOL.tcp);
            if (this.m_transfer) {
                this.m_transfer._onPackage(decoder, remoteSender);
            } else if (this.m_state === BDTConnection.STATE.waitAckAck) {
                let pendingCount = this.m_pendingDataPackages.length;
                if (pendingCount === 0 || this.m_pendingDataPackages[pendingCount - 1].header.seq < decoder.header.seq) {
                    this.m_pendingDataPackages.push(decoder);
                } else {
                    let [pos, insertPos] = BaseUtil.algorithm.binarySearch(decoder, this.m_pendingDataPackages, (target, cursor) => target.header.seq - cursor.header.seq);
                    if (pos < 0) {
                        this.m_pendingDataPackages.splice(insertPos, 0, decoder);
                    }
                }
            }
        } else if (decoder.header.cmdType === BDTPackage.CMD_TYPE.heartbeat) {
            this.queryRemote.ep = remoteEP;
            if (this.m_state === BDTConnection.STATE.establish) {
                this._postPackage(this._createHeartbeatRespPackage());
            }
        } else if (decoder.header.cmdType === BDTPackage.CMD_TYPE.heartbeatResp) {
            this.queryRemote.ep = remoteEP;
            // do nothing
        }
    }
    
    _startSNCall(seq) {
        if (this.m_snCall) {
            return ;
        }
        // <<<<<<统计诊断
        if (!this.queryRemote.sn.start) {
            this.queryRemote.sn.start = Date.now();
        }
        //>>>>>>

        this.m_snCall = {
            timer: null
        };

        let snPeerListAll = [];
        let resendTimes = 0;
        const tryCallInterval = this.m_stack._getOptions().tryConnectInterval;
        
        let postCallPackage = snPeer => {
            let now = Date.now();
            let resendInterval = Math.max(3, snPeerListAll.length);
            for (let peer of snPeer) {
                if (peer.nextCallTime > now && peer.nextCallTime < now + peer.callInterval) {
                    continue;
                }
                peer.nextCallTime = now + peer.callInterval;
                peer.callInterval *= 2;

                peer.sender.isResend = (resendTimes === peer.nextResendTime);
                let callPackage = this._createCallPackage(seq);
                peer.sender.postPackage(callPackage);
                if (peer.sender.isResend) {
                    peer.sender.isResend = false;
                    peer.nextResendTime += resendInterval;
                }
            }
        }

        let startCall2SN = () => {
            if (!this.m_snCall) {
                return;
            }
            if (resendTimes === 3) {
                this._startPeerFinder();
            }
            // 试着通过DHT穿透一下
            if (resendTimes >= 2 && resendTimes <= snPeerListAll.length) {
                this.m_stack._findSN(snPeerListAll[resendTimes - 1].peerid);
            }
            postCallPackage(snPeerListAll);
            resendTimes++;
            this.m_snCall.timer = setTimeout(startCall2SN, tryCallInterval);
        }

        let startSNFinder = () => {
            let finder = this.m_stack._findSN(this.m_remote.peerid);
            finder.then(([err, peerlist]) => {
                // 准备下一轮查找SN
                if (this.m_snCall) {
                    let tryFindSNInterval = this.m_snCall.tryFindSNInterval || this.m_stack._getOptions().tryFindSNInterval;
                    setTimeout(() => {
                        if (this.m_snCall) {
                            startSNFinder();
                            this._startPeerFinder();
                            this.m_snCall.tryFindSNInterval = tryFindSNInterval * 2;
                        }
                    }, tryFindSNInterval);
                } else {
                    return;
                }

                if (!peerlist || peerlist.length === 0) {
                    this._startPeerFinder();
                    return ;
                }

                // <<<<<<统计诊断
                this.queryRemote.sn.finishsn = this.queryRemote.sn.finishsn || Date.now();
                peerlist.forEach(p => {
                    for (let sn of this.queryRemote.sn.snList) {
                        if (sn.pid === p.peerid) {
                            return;
                        }
                    }
                    this.queryRemote.sn.snList.push({pid: p.peerid, eplist: p.eplist});
                });
                //>>>>>>

                // 追加到SN列表
                let nextResendTime = resendTimes + 3;
                let newSNList = [];
                peerlist.forEach(peer => {
                    for (let existSN of snPeerListAll) {
                        if (existSN.peerid === peer.peerid) {
                            return;
                        }
                    }
                    let sender = BDTPackage.createSender(this.m_stack.mixSocket, null, peer.eplist);
                    sender.isResend = false;
                    let snInfo = {
                        peerid: peer.peerid,
                        sender: sender,
                        nextCallTime: 0,
                        callInterval: tryCallInterval,
                        nextResendTime,
                    };
                    snPeerListAll.push(snInfo);
                    newSNList.push(snInfo);
                    nextResendTime++;
                });

                if (newSNList.length === snPeerListAll.length) {
                    // 第一次查到SN
                    startCall2SN();
                } else if (newSNList.length > 0) {
                    // 立即对新发现SN发起一次call
                    postCallPackage(newSNList);
                }
            });
        }

        startSNFinder();
    }

    _stopSNCall() {
        if (this.m_snCall) {
            clearTimeout(this.m_snCall.timer);
            this.m_snCall = null;
        }
    }

    _startPeerFinder() {
        if (this.m_peerFinder) {
            return ;
        }

        // <<<<<<统计诊断
        if (!this.queryRemote.dht.start) {
            this.queryRemote.dht.start = Date.now();
        }
        //>>>>>>

        let finder = this.m_stack._findPeer(this.m_remote.peerid);
        if (!finder) {
            return;
        }

        this.m_peerFinder = finder;
        
        let onFoundPeer = peer => {
            // <<<<<<统计诊断
            if (!this.queryRemote.dht.finish1) {
                this.queryRemote.dht.finish1 = Date.now();
            }
            //>>>>>>
            if ((!peer || !peer.eplist || peer.eplist.length === 0)) {
                if (this.m_peerFinder) {
                    let tryFindPeerInterval = this.m_peerFinder.tryFindPeerInterval || this.m_stack._getOptions().tryFindSNInterval;
                    setTimeout(() => {
                        if (this.m_peerFinder) {
                            this._stopPeerFinder();
                            this._startPeerFinder();
                            this.m_peerFinder.tryFindPeerInterval = tryFindPeerInterval * 2;
                        }
                    }, tryFindPeerInterval);
                }
                return ;
            }

            // <<<<<<统计诊断
            this.queryRemote.dht.finish = Date.now();
            this.queryRemote.dht.eplist = peer.eplist;
            //>>>>>>

            if (this.m_peerFinder === finder) {
                if (this.m_state === BDTConnection.STATE.waitAck) {
                    if (peer.eplist.length) {
                        this._addRemoteEP(peer.eplist);
                        blog.debug(`[BDT]: connection update connecting remote address to ${peer.eplist}`);
                    }
                }
            }
            this._stopPeerFinder();
        }

        let onNotSupport = () => {};
        finder.then(onFoundPeer, onNotSupport);
    }

    _stopPeerFinder() {
        this.m_peerFinder = null;
    }

    _startTryConnect(remoteSender, connectPackage) {
        assert(!this.m_tryConnect);
        if (this.m_tryConnect) {
            return ;
        }
        let opt = this.m_stack._getOptions();
        let tryTimes = 0;
        let timeUpdateDetect = null;
        
        let tryConnectRoutine = ()=>{
            let now = 0;
            if (timeUpdateDetect) {
                let timeRevise = 0;
                [now, timeRevise] = timeUpdateDetect();
                this.m_tryConnect.startTime += timeRevise;
            } else {
                now = Date.now();
            }
            let tryTime = now - this.m_tryConnect.startTime;
            if (tryTime > opt.connectTimeout) {
                this.emit(BDTConnection.EVENT.error, BDT_ERROR.timeout);
                this._changeState(BDTConnection.STATE.closed);
                return;
            }

            if (this.m_tryConnect.remoteSender.remoteEPList.length) {
                tryTimes++;
                // 每3次测试一下对方peer所有地址
                this.m_tryConnect.remoteSender.isResend = (tryTimes % 3 === 0);
                let sender = this.m_tryConnect.remoteSender;
                if (!this.m_tryConnect.remoteSender.socket && tryTimes <= 1) {
                    // 第一次只用udp测试一下，如果对方没响应就用全部地址测试
                    let udpEPList = [];
                    this.m_tryConnect.remoteSender.remoteEPList.forEach(ep => {
                        if (EndPoint.toAddress(ep).protocol === EndPoint.PROTOCOL.udp) {
                            udpEPList.push(ep);
                        }
                    });
                    if (udpEPList.length) {
                        sender = BDTPackage.createSender(this.m_stack.mixSocket, null, udpEPList);
                    }
                }
                
                sender.postPackage(connectPackage);
            }
        };

        this.m_tryConnect = {
            timer: setInterval(tryConnectRoutine, opt.tryConnectInterval),
            startTime: Date.now(),
            remoteSender: remoteSender,
            sendConnectPackage: tryConnectRoutine,
        };
        
        tryConnectRoutine();
        timeUpdateDetect = BaseUtil.TimeHelper.createTimeUpdateDetector(opt.timeoutDeviation, opt.tryConnectInterval);
    }

    _stopTryConnect() {
        this._stopSNCall();
        this._stopPeerFinder();
        if (this.m_tryConnect) {
            clearInterval(this.m_tryConnect.timer);
            this.m_tryConnect = null;
        }
    }

    _addRemoteEP(eplist) {
        if (this.m_tryConnect) {
            this.m_tryConnect.remoteSender.addRemoteEPList(eplist);
            this.m_tryConnect.sendConnectPackage();
        }
    }

    _changeState(newState, params) {
        let curState = this.m_state;
        if (curState === newState) {
            return ;
        }
        
        if (newState === BDTConnection.STATE.establish) {
            this._stopTryConnect();
            this._startHeartbeat();
            let onLastAck = () => {
                if (this.m_state === BDTConnection.STATE.establish) {
                    this._changeState(BDTConnection.STATE.closeWait);
                    if (!this.m_options.allowHalfOpen) {
                        // 不允许半开连接就自动关闭
                        this.close();
                    }
                } else if (this.m_state === BDTConnection.STATE.finWait1) {
                    this._changeState(BDTConnection.STATE.closing);
                } else if (this.m_state === BDTConnection.STATE.finWait2) {
                    this._changeState(BDTConnection.STATE.timeWait); 
                }
            };
            if (this.m_useTCP) {
                this.m_transfer = new TCPTransfer(this, this.m_remote.sender, onLastAck);
                TCPConnectionMgr.register(this.m_remote.sender.socket, this);
            } else {
                this.m_transfer = new BDTTransfer(this, onLastAck);
            }
            if (this.m_createFrom === BDTConnection.CREATE_FROM.acceptor) {
                this.m_acceptor._onConnection(this);
            } else {
                setImmediate(()=>{this.emit(BDTConnection.EVENT.connect);});
            }
        } else if (newState === BDTConnection.STATE.finWait1
                || newState === BDTConnection.STATE.lastAck) {
            this.m_transfer.sendFin(() => setImmediate(() => {
                if (this.m_state === BDTConnection.STATE.lastAck) {
                    this._changeState(BDTConnection.STATE.closed);
                } else if (this.m_state === BDTConnection.STATE.finWait1) {
                    this._changeState(BDTConnection.STATE.finWait2);
                } else if (this.m_state === BDTConnection.STATE.closing) {
                    this._changeState(BDTConnection.STATE.timeWait);
                }
            }));
        } else if (newState === BDTConnection.STATE.timeWait) {
            setTimeout(()=>{
                this._changeState(BDTConnection.STATE.closed);
            }, 2*this.m_stack._getOptions().msl);
        } else if (newState === BDTConnection.STATE.break) {
            let errorCode = params;
            setImmediate(()=>{this.emit(BDTConnection.EVENT.error, errorCode);});
            this._changeState(BDTConnection.STATE.closed);
        } else if (newState === BDTConnection.STATE.closed) {
            this.m_respPackages = {};
            this._stopTryConnect();
            this._stopHeartbeat();

            if (this.m_useTCP) {
                TCPConnectionMgr.unregister(this.m_remote.sender.socket, this);
            }

            if (this.m_transfer) {
                this.m_transfer.close();
                this.m_transfer = null;
            }
            if (this.m_createFrom === BDTConnection.CREATE_FROM.acceptor) {
                this.m_acceptor._unrefRemote(this.m_remote, this);
            } else if (this.m_createFrom === BDTConnection.CREATE_FROM.connect) {
                this.m_stack._releaseVPort(this.m_vport, this);
            }
            this.m_stack._releaseSessionid(this.m_sessionid, this);
            
            setImmediate(()=>{
                this.emit(BDTConnection.EVENT.close);
                this.removeAllListeners(BDTConnection.EVENT.connect);
                this.removeAllListeners(BDTConnection.EVENT.data);
                this.removeAllListeners(BDTConnection.EVENT.drain);
                this.removeAllListeners(BDTConnection.EVENT.error);
                this.removeAllListeners(BDTConnection.EVENT.end);
                this.removeAllListeners(BDTConnection.EVENT.close);
            });
        }
        
        blog.debug(`[BDT]: connection change state from ${BDTConnection.STATE.toString(this.m_state)} to ${BDTConnection.STATE.toString(newState)}`);
        this.m_state = newState;

        if (curState === BDTConnection.STATE.init) {
            if (newState === BDTConnection.STATE.waitAck) {
                let remoteSender = params;
                let seq = this._nextSeq(1);
                this._startTryConnect(remoteSender, this._createSynPackage(seq));
                // 自连接直接定向到本地eplist
                if (this.m_remote.peerid === this.m_stack.peerid) {
                    this._addRemoteEP(this.m_stack.eplist);
                } else {
                    this._startSNCall(seq);
                }
            } else if (newState === BDTConnection.STATE.waitAckAck) {
                let remoteSender = params;
                let synAck = this._createSynAckPackage(this._nextSeq(1));
                this.m_respPackages[synAck.header.cmdType] = synAck;
                this._startTryConnect(remoteSender, synAck);
            } 
        }
    }

    _onTCPDrain() {
        if (this.m_transfer) {
            this.m_transfer.trySendLeftData();
        }
    }

    _onTCPClose() {
        if (this.m_state === BDTConnection.STATE.establish) {
            this._changeState(BDTConnection.STATE.break, BDT_ERROR.timeout);
        }
    }
}


BDTConnection.STATE = {
    init: -1,
    closed: 0,
    waitAck: 1,
    waitAckAck: 2,
    break: 3,
    establish: 4,
    finWait1: 5,
    finWait2: 6,
    closing: 7,
    timeWait: 8,
    closeWait: 9,
    lastAck: 10,

    toString(state) {
        if (state === BDTConnection.STATE.init) {
            return 'init';
        } else if (state === BDTConnection.STATE.closed) {
            return 'closed';
        } else if (state === BDTConnection.STATE.waitAck) {
            return 'waitAck';
        } else if (state === BDTConnection.STATE.waitAckAck) {
            return 'waitAckAck';
        } else if (state === BDTConnection.STATE.break) {
            return 'break';
        } else if (state === BDTConnection.STATE.establish) {
            return 'establish';
        } else if (state === BDTConnection.STATE.finWait1) {
            return 'finWait1';
        } else if (state === BDTConnection.STATE.finWait2) {
            return 'finWait2';
        } else if (state === BDTConnection.STATE.closing) {
            return 'closing';
        } else if (state === BDTConnection.STATE.timeWait) {
            return 'timeWait';
        } else if (state === BDTConnection.STATE.closeWait) {
            return 'closeWait';
        } else if (state === BDTConnection.STATE.lastAck) {
            return 'lastAck';
        }
    }
};

BDTConnection.CREATE_FROM = {
    connect: 0,
    acceptor: 1,
};

BDTConnection.EVENT = {
    error: 'error',
    connect: 'connect',
    close: 'close',
    data: 'data',
    drain: 'drain',
    end: 'end' // 收到对端发来的'fin'包
};

module.exports = BDTConnection;