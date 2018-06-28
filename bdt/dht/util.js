'use strict';

const BaseUtil = require('../base/util.js');

const Result = {
    SUCCESS: 0,
    PENDING: 1,
    STOPPED: 2,
    FAILED: 3,
    TIMEOUT: 4,
    INVALID_ARGS: 5,
    INVALID_PACKAGE: 6,
};

const MAX_SAFE_INTEGER = 0xFFFFFFFFFFFFF;
const MAX_UINT32 = 0xFFFFFFFF;

const Config = {
    Hash: {
        BitCount: BaseUtil.HashDistance.HASH_BIT_COUNT,
    },

    Peer: {
        epTimeout: 600000,
        symEPCount: 5,
        NATTypeTime: 600000,
        recommandNeighborTime: 10000, // 上线10秒钟内可能推荐一次邻居
    },

    Bucket: {
        BucketCount: 16,
        BucketSize: 8,
        PeerTimeoutMS: 600000,
        FindPeerCount: 8,
        ResponcePeerCount: 3, // 响应搜索返回peer数
    },
    
    ValueTable: {
        TableCount: 16,
        TableSize: 8,
        TotalValueCount: 128,
        ValueTimeoutMS: 3600000,
        ValueUpdateIntervalMS: 600000,
        FindCloseKeyCount: 5,
    },

    SaveValue: {
        DupCount: 5,
    },

    GetValue: {
    },

    Broadcast: {
        TimeoutMS: 600000,
        LimitPeerCountOnce: 32, // 一次同时通知peer数
    },

    Package: {
        MagicNum: 0x8084,
        MaxTTL: 1,
        MinSeq: 1,
        MaxSeq: MAX_UINT32,
        Timeout: 10000,
        RetryInterval: 1000,
        RetryTimes: 3,
        InitRRT: 1000,
    },

    Task: {
        TimeoutMS: 600000,
        MaxIdleTimeMS: 500,
        MinTaskID: 1,
        MaxTaskID: MAX_UINT32,
    },

    Handshake: {
        TimeoutMS: 5000,
    },

    RouteTable: {
        ExpandIntervalMS: {
            Min: 2000,
            Max: 600000,
            dynamic(peerCount, peerDelta) { // 根据当前peer数和上次扩充peer增量动态调整扩充频率
                let interval = 600000;
                if (peerCount <= 16) {
                    interval = 2000;
                } else if (peerCount <= 32) {
                    interval = 300000;
                }

                if (peerDelta <= 4) {
                    interval = Math.max(interval, 300000);
                } else if (peerDelta <= 8) {
                    interval *= 2;
                }
                return Math.min(interval, Config.RouteTable.ExpandIntervalMS.Max);
            },
        },
        PingIntervalMS: {
            Min: 40000,
            Max: 540000,
            Retry: 10000,
            dynamic(distRank) { // 根据与目标peer的距离动态调整ping间隔
                let ms = Config.RouteTable.PingIntervalMS.Min + 20000 * distRank;
                return Math.min(ms, Config.RouteTable.PingIntervalMS.Max);
            }
        }
    }
};

const RandomGenerator = {
    // 默认去掉了容易混淆的字符oOLl,9gq,Vv,Uu,I1
    CHAR_SET: 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678',

    string(length = 32) {
        let maxPos = RandomGenerator.CHAR_SET.length;
        let result = '';
        for (let i = 0; i < length; i++) {
            result += RandomGenerator.CHAR_SET.charAt(RandomGenerator.integer(maxPos));
        }
        return result;
    },

    integer(max, min = 0) {
        let result = Math.round(Math.random() * (max - min)) + min;
        if (result > max) {
            result = max;
        }
        return result;
    }
};

class SequenceIncreaseGenerator {
    constructor(lowBound, upBound) {
        this.m_lowBound = lowBound;
        this.m_upBound = upBound;
        this.m_nextSeq = RandomGenerator.integer(upBound, lowBound);
    }

    genSeq() {
        let seq = this.m_nextSeq++;
        if (this.m_nextSeq > this.m_upBound) {
            this.m_nextSeq = this.m_lowBound;
        }
        return seq;
    }
}

// SaveValue(tableName, OBJECT_KEY, value) : table[OBJECT_KEY] = value
// SaveValue(tableName, TOTAL_KEY, value): not support 不支持更新整个表，防止有人恶意刷新整个表导致整个表内容丢失
// DeleteValue(tableName, OBJECT_KEY) : table.delete(OBJECT_KEY) 删除本地发起SaveValue的OBJECT_KEY
// DeleteValue(tableName, TOTAL_KEY): 删除所有本地发起SaveValue的表名为tableName的数据
// GetValue(tableName, OBJECT_KEY): return table[OBJECT_KEY]
// GetValue(tableName, TOTAL_KEY): return table
const OBJECT_KEY = 'DHTValueTable.Object';
const TOTAL_KEY = 'DHTValueTable.TotalTable';

const FLAG_PRECISE = 0x1

module.exports.Result = Result;
module.exports.MAX_SAFE_INTEGER = MAX_SAFE_INTEGER; // 2^53-1 最大安全整数
module.exports.MAX_UINT32 = MAX_UINT32;
module.exports.FLAG_PRECISE = FLAG_PRECISE;
module.exports.OBJECT_KEY = OBJECT_KEY;
module.exports.TOTAL_KEY = TOTAL_KEY;
module.exports.Config = Config;
module.exports.SequenceIncreaseGenerator = SequenceIncreaseGenerator;
module.exports.EndPoint = BaseUtil.EndPoint;
module.exports.RandomGenerator = RandomGenerator;
module.exports.HashDistance = BaseUtil.HashDistance;
