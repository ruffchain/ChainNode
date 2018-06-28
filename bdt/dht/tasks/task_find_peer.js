'use strict';

const Base = require('../../base/base.js');
const {EndPoint} = require('../../base/util.js');
const {HashDistance, Result: DHTResult} = require('../util.js');
const Peer = require('../peer.js');
const {TouchNodeConvergenceTask} = require('./task_touch_node_recursion.js');
const DHTPackage = require('../packages/package.js');
const DHTCommandType = DHTPackage.CommandType;

const LOG_TRACE = Base.BX_TRACE;
const LOG_INFO = Base.BX_INFO;
const LOG_WARN = Base.BX_WARN;
const LOG_DEBUG = Base.BX_DEBUG;
const LOG_CHECK = Base.BX_CHECK;
const LOG_ASSERT = Base.BX_ASSERT;
const LOG_ERROR = Base.BX_ERROR;

class FindPeerTask extends TouchNodeConvergenceTask {
    constructor(owner, peerid, isImmediately) {
        super(owner, isImmediately);

        this.m_peerid = peerid;

        this.m_foundPeerList = new Map();
    }

    get peerid() {
        return this.m_peerid;
    }

    _processImpl(response, remotePeer) {
        LOG_INFO(`LOCALPEER:(${this.bucket.localPeer.peerid}:${this.servicePath}) remotePeer:${response.common.src.peerid} responsed FindPeer(${this.m_peerid})`);
        // 合并当前使用的address到eplist，然后恢复response内容
        // 如果address是TCP地址，可能没有记录到eplist，但这个地址可能是唯一可用连接地址
        let srcEPList = response.common.src.eplist;
        response.common.src.eplist = remotePeer.eplist;
        if (remotePeer.address) {
            Peer.Peer.unionEplist(response.common.src.eplist, EndPoint.toString(remotePeer.address));
        }
        let foundPeer = new Peer.Peer(response.common.src);
        response.common.src.eplist = srcEPList;

        // 判定该peer是否在该服务子网
        let serviceDescriptor = foundPeer.findService(this.servicePath);
        let isInService = serviceDescriptor && serviceDescriptor.isSigninServer();

        // TODO
        // 集成bdt到chainSDK的时候, 节点需要快速建立和销毁
        // sn 尽量快速返回所有(或尽可能多的peer)
        // 然后让调用方(chainSDK)自己去尝试握手peer,然后connect
        // 后续再想一下更好的方法去做集成的测试
        if ( response.body.n_nodes ) {
            this.n_nodes = response.body.n_nodes;
        }

        if (isInService) {
            this.m_foundPeerList.set(response.common.src.peerid, foundPeer);
        }
        if (isInService && response.common.src.peerid === this.m_peerid) {
            this._onComplete(DHTResult.SUCCESS);
        } else {
            super._processImpl(response, remotePeer);
        }
    }

    _onCompleteImpl(result) {
        LOG_INFO(`LOCALPEER:(${this.bucket.localPeer.peerid}:${this.servicePath}) FindPeer complete:${this.m_foundPeerList.size}`);
        let foundPeerList = [...this.m_foundPeerList.values()];
        HashDistance.sortByDistance(foundPeerList, {hash: HashDistance.checkHash(this.m_peerid)});
        this._callback(result, foundPeerList, this.n_nodes);
    }

    _createPackage() {
        let cmdPackage = this.packageFactory.createPackage(DHTCommandType.FIND_PEER_REQ);
        cmdPackage.body = {
            taskid: this.m_id,
            target: this.m_peerid
        };
        return cmdPackage;
    }

    get _targetKey() {
        return this.m_peerid;
    }

    _stopImpl() {
    }
}

module.exports = FindPeerTask;