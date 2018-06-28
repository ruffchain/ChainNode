'use strict';

const Base = require('../../base/base.js');
const {Result: DHTResult, Config} = require('../util.js');
const Task = require('./task.js');
const DHTPackage = require('../packages/package.js');
const {ResendControlor} = require('../package_sender.js');
const {Peer} = require('../peer.js');
const DHTCommandType = DHTPackage.CommandType;

const LOG_TRACE = Base.BX_TRACE;
const LOG_INFO = Base.BX_INFO;
const LOG_WARN = Base.BX_WARN;
const LOG_DEBUG = Base.BX_DEBUG;
const LOG_CHECK = Base.BX_CHECK;
const LOG_ASSERT = Base.BX_ASSERT;
const LOG_ERROR = Base.BX_ERROR;

const SaveValueConfig = Config.SaveValue;
const BroadcastConfig = Config.Broadcast;

class BroadcastEventTask extends Task {
    constructor(owner, eventName, params, sourcePeer, taskid, {timeout = BroadcastConfig.TimeoutMS, passPeerid = null} = {}) {
        super(owner, {timeout});

        this.m_id = (taskid || Task.genGlobalTaskID(this.bucket.localPeer.peerid, this.m_id));
        this.m_eventName = eventName;
        this.m_params = params;
        this.m_sourcePeer = sourcePeer;
        this.m_package = null;
        this.m_passPeerid = passPeerid;

        this.m_pendingPeerMap = new Map();
    }

    _processImpl(response, remotePeer) {
        LOG_INFO(`LOCALPEER:(${this.bucket.localPeer.peerid}:${this.servicePath}) remotePeer:${response.common.src.peerid} responsed broadcast event(${this.m_eventName}:${this.m_params}), servicePath:${response.servicePath}`);
        if (this.m_arrivePeeridSet.size >= this.m_arrivePeerCount) {
            if (response.body.r_nodes) {
                response.body.r_nodes.forEach(peerid => this.m_arrivePeeridSet.add(peerid));
            }
            this.m_arrivePeeridSet.add(response.common.src.peerid);

            this._onComplete(DHTResult.SUCCESS);
        } else {
            super._processImpl(response, remotePeer);
        }
    }
    
    _startImpl() {
        this.m_package = this._createPackage();

        this.bucket.forEachPeer(peer => {
            if (peer.peerid === this.m_sourcePeer.peerid ||
                (this.m_passPeerid && peer.peerid === this.m_passPeerid)) {
                return;
            }
            let resender = new ResendControlor(peer,
                this.m_package,
                this.packageSender,
                Peer.retryInterval(this.bucket.localPeer, peer),
                Config.Package.RetryTimes,
                false);

            this.m_pendingPeerMap.set(peer.peerid, resender);
        });

        this._sendPackage();
    }

    _processImpl(response, remotePeer) {
        LOG_INFO(`LOCALPEER:(${this.bucket.localPeer.peerid}:${this.servicePath}) remotePeer:${response.common.src.peerid} responsed BroadcastEventTask(${this.m_id})`);
        this.m_pendingPeerMap.delete(remotePeer.peerid);
        // 即使全部广播到位也不完成，因为可能收到其他PEER转发过来的广播通知，任务留下来防止重复广播
        this._sendPackage();
    }

    _retryImpl() {
        this._sendPackage();
    }
        
    _onCompleteImpl(result) {
    }

    _createPackage() {
        let cmdPackage = this.packageFactory.createPackage(DHTCommandType.BROADCAST_EVENT_REQ);

        cmdPackage.body = {
            taskid: this.m_id,
            event: this.m_eventName,
            source: {peerid: this.m_sourcePeer.peerid, eplist: this.m_sourcePeer.eplist},
            timeout: (this.deadline - Date.now()),
        };

        if (this.m_params !== undefined && this.m_params !== null) {
            cmdPackage.body.params = this.m_params;
        }
        return cmdPackage;
    }

    _stopImpl() {
    }

    _sendPackage() {
        this.m_package.body.timeout = this.deadline - Date.now();

        let sendCount = 0;
        let timeoutPeerids = [];
        for (let [peerid, resender] of this.m_pendingPeerMap) {
            let tryTimes = resender.tryTimes;
            resender.send();
            if (resender.tryTimes !== tryTimes) {
                sendCount++;
            }
            if (resender.isTimeout()) {
                timeoutPeerids.push(peerid);
            }
            if (sendCount >= Config.Broadcast.LimitPeerCountOnce) {
                break;
            }
        }
        timeoutPeerids.forEach(peerid => this.m_pendingPeerMap.delete(peerid));
    }
}

module.exports = BroadcastEventTask;