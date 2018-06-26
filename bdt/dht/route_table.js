'use strict';

const {Config, RandomGenerator, EndPoint} = require('./util.js');
const DHTPackage = require('./packages/package.js');
const Base = require('../base/base.js');
const Peer = require('./peer.js');
const assert = require('assert');
const LOG_WARN = Base.BX_WARN;
const LOG_INFO = Base.BX_INFO;

const RouteTableConfig = Config.RouteTable;

class RouteTable {
    constructor({taskExecutor, bucket, packageFactory, packageSender}) {
        this.m_taskExecutor = taskExecutor;
        this.m_bucket = bucket;
        this.m_packageFactory = packageFactory;
        this.m_packageSender = packageSender;
        this.m_nextExpandTime = 0;
        this.m_peerCountLastExpand = -128; // 最后一次扩充路由表时的peer数，初始置负数，保证第一次及时更新扩充路由表
        this.m_time4LastPackageFromInternet = 0;
        this.m_lastPingTime = 0;
    }

    refresh() {
        this._expand();
        this._pingAllTimeoutPeers();
    }

    ping(peer) {
        let pingPackage = this.m_packageFactory.createPackage(DHTPackage.CommandType.PING_REQ);
        this.m_packageSender.sendPackage(peer, pingPackage, false, RouteTableConfig.PingIntervalMS.Retry);
    }

    onRecvPackage(cmdPackage, socket, remotePeer, remoteAddress) {
        if (!EndPoint.isNAT(remoteAddress)) {
            this.m_time4LastPackageFromInternet = Date.now();
        }
    }

    static _randomPeerid() {
        let length = RandomGenerator.integer(16, 4);
        return RandomGenerator.string(length);
    }

    _expand() {
        let now = Date.now();
        let maxInterval = this._maxExpandInterval();

        if (isFinite(this.m_nextExpandTime) && this.m_nextExpandTime - now > maxInterval) {
            this.m_nextExpandTime = now;
        }

        if (this.m_nextExpandTime <= now) {
            this.m_nextExpandTime = Infinity;
            this.m_peerCountLastExpand = this.m_bucket.peerCount;
            this.m_taskExecutor.findPeer(RouteTable._randomPeerid(), false,
                () => this.m_nextExpandTime = Date.now() + RandomGenerator.integer(this._maxExpandInterval(), RouteTableConfig.ExpandIntervalMS.Min)
            );
        }
    }

    // 查询周期随peer数量增多变长
    _maxExpandInterval() {
        let peerCount = this.m_bucket.peerCount;
        return RouteTableConfig.ExpandIntervalMS.dynamic(peerCount, peerCount - this.m_peerCountLastExpand);
    }

    // 受限/对称NAT应该对较多节点进行高频的ping维持穿透；
    // 全锥形NAT，只要近期有对外recv包即可维持穿透，维持相对长时间的ping间隔测试其他在线状态
    // 公网Peer不需要维持穿透状态，只要定时测试其他peer在线状态即可
    _pingAllTimeoutPeers() {
        let now = Date.now();
        let pingPackage = null;
        let pingInterval4NATType = RouteTableConfig.PingIntervalMS.Max; // 按本地peer网络环境定制ping频率，置0表示要按需求动态调整
        let localPeer = this.m_bucket.localPeer;
        switch (localPeer.natType) {
            case Peer.NAT_TYPE.unknown: // fallthrough
            case Peer.NAT_TYPE.restrictedNAT: // fallthrough
            case Peer.NAT_TYPE.symmetricNAT: // fallthrough
                pingInterval4NATType = 0;
                break;
            case Peer.NAT_TYPE.NAT:
            case Peer.NAT_TYPE.internet:
            if (now - this.m_time4LastPackageFromInternet > RouteTableConfig.PingIntervalMS.Min) {
                    pingInterval4NATType = 0; // 很长时间没收到来自公网的包了，按受限NAT频率ping一遍
                }
                break;
            default:
                break;
        }

        let pingCount = 0;
        if (this.m_lastPingTime > now) {
            this.m_lastPingTime = 0;
        }
        let maxPingCount = this.m_peerCountLastExpand * (now - this.m_lastPingTime) / RouteTableConfig.PingIntervalMS.Min;
        if (maxPingCount < 1) {
            return;
        }

        // 近期离线
        let isOfflineRecently = (peer) => {
            return !peer.isOnline(this.m_bucket.TIMEOUT_MS) // 不在线
                && now - peer.lastRecvTime < this.m_bucket.TIMEOUT_MS + RouteTableConfig.PingIntervalMS.Retry * 3;
        }

        let shoudRetry = (peer, bucketDistRank) => {
            let pingInterval = pingInterval4NATType || RouteTableConfig.PingIntervalMS.dynamic(bucketDistRank);
            // 在一个ping周期略长的时间内没有收到包，很可能是ping包丢失；
            // 近期离线的也应该retry，可能还能救回
            return (now - peer.lastRecvTime >= pingInterval && now - peer.lastRecvTime < pingInterval + RouteTableConfig.PingIntervalMS.Retry * 3) ||
                isOfflineRecently(peer);
        }

        let lastRank = {
            rank: -1,
            recentRecvPeer: null,
            recentRecvTime: 0,
        };

        let ping = (peer) => {
            if (!pingPackage) {
                pingPackage = this.m_packageFactory.createPackage(DHTPackage.CommandType.PING_REQ);
            }
            // 太长时间没有收到UDP包，也没有发出UDP包，忽略之前发送路由缓存，对该peer所有地址发送一遍
            let ignoreCache = (now - peer.lastRecvTimeUDP >= RouteTableConfig.PingIntervalMS.Max &&
                now - peer.lastSendTimeUDP >= RouteTableConfig.PingIntervalMS.Max / 2);
            this.m_packageSender.sendPackage(peer, pingPackage, ignoreCache, false, RouteTableConfig.PingIntervalMS.Retry);
            pingCount++;
        }

        this.m_bucket.forEachPeer(peer => {
            if (pingCount >= maxPingCount) {
                return;
            }

            // 按距离确定ping时间间隔，刚刚超时的peer可能只是丢包，最近抓紧时间重试几次
            // 每个距离等级上都保留一个相对高频的ping，提高远距离peer之间的连通率
            let subBucket = this.m_bucket.findOwnerSubBucketOfPeer(peer);
            if (!subBucket) {
                assert(!this.m_bucket.findPeer(peer.peerid));
                return;
            }
            if (subBucket.distRank != lastRank.rank) {
                let pingInterval = (pingInterval4NATType || RouteTableConfig.PingIntervalMS.Min);
                if (lastRank.recentRecvPeer &&
                    now - lastRank.recentRecvTime > pingInterval &&
                    now - lastRank.recentRecvPeer.lastSendTime > pingInterval) {
                    ping(lastRank.recentRecvPeer);
                }
                lastRank.rank = subBucket.distRank;
                lastRank.recentRecvPeer = peer;
                lastRank.recentRecvTime = peer.lastRecvTime;
            } else if (peer.lastRecvTime > lastRank.recentRecvTime) {
                lastRank.recentRecvTime = peer.lastRecvTime;
                lastRank.recentRecvPeer = peer;
            }

            let pingInterval = pingInterval4NATType || RouteTableConfig.PingIntervalMS.dynamic(subBucket.distRank);
            if (now - peer.lastSendTime >= pingInterval ||
                (shoudRetry(peer, subBucket.distRank) && now - peer.lastSendTime >= RouteTableConfig.PingIntervalMS.Retry)) {

                if (now - peer.lastSendTime > RouteTableConfig.PingIntervalMS.Max) {
                    // LOG_WARN(`Ping stopped. ${this.m_bucket.localPeer.peerid}=>${peer.peerid}, last send package time:${new Date(peer.lastSendTime).toDateString()}`);
                }
                if (!peer.isOnline(this.m_bucket.TIMEOUT_MS)) {
                    peer.address = null;
                    // LOG_WARN(`Ping stopped. ${this.m_bucket.localPeer.peerid}=>${peer.peerid}, last send package time:${new Date(peer.lastSendTime).toDateString()}`);
                }
                ping(peer);

                // 已经ping了，不需要再ping
                if (peer === lastRank.recentRecvPeer) {
                    lastRank.recentRecvPeer = null;
                }
            }
        });

        if (pingCount > 0) {
            this.m_lastPingTime = now;
        }
    }
}

module.exports = RouteTable;