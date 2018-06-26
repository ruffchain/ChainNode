'use strict';

const net = require('net');
const os = require('os');
const assert = require('assert');
const Crypto = require('crypto');

/**
 * Simple object check.
 * @param item
 * @returns {boolean}
 */
function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

const EndPoint = {
    PROTOCOL: {
        udp: 'u',
        tcp: 't',
    },

    toString(address, protocol) {
        let ipv = 0;
        if (address.family === 'IPv6') {
            ipv = 6;
        } else if (address.family === 'IPv4') {
            ipv = 4;
        }

        assert(protocol || address.protocol);
        return `${ipv}@${address.address}@${address.port}@${protocol || address.protocol || EndPoint.PROTOCOL.udp}`;
    },

    toAddress(epString) {
        let el = epString.split('@');
        if (el.length >= 3) {
            let addr = {};
            if (net.isIPv4(el[1])) {
                addr.family = 'IPv4';
            } else if (net.isIPv6(el[1])) {
                addr.family = 'IPv6';
            } else {
                if (el[0] === '4') {
                    addr.family = 'IPv4';
                } else if (el[0] === '6') {
                    addr.family = 'IPv6';
                }
            }
            addr.address = el[1];
            addr.port = parseInt(el[2]);
            assert(el.length === 4);
            addr.protocol = EndPoint.PROTOCOL.udp;
            if (el.length >= 4) {
                addr.protocol = el[3];
            }
            return addr;
        } else {
            return null;
        }        
    },

    isZero(address) {
        let host = '';
        if (typeof address === 'string') {
            let el = address.split('@');
            host = el[1];
        } else {
            host = address.address;
        }

        return host === '0.0.0.0';
    },

    isLoopback(address) {
        let host = '';
        if (typeof address === 'string') {
            let el = address.split('@');
            host = el[1];
        } else {
            host = address.address;
        }

        return host === '127.0.0.1';
    },

    isNAT(address) {
        if (typeof address === 'string') {
            let el = address.split('@');
            address = {};
            switch(el[0]) {
                case '4': address.family = 'IPv4'; break;
                case '6': address.family = 'IPv6'; break;
                default: break;
            }
            address.family = el[0];
            address.address = el[1];
            address.port = el[2];
        }

        if (EndPoint.isZero(address) || EndPoint.isLoopback(address)) {
            return true;
        }

        if (!address.family || address.family == 'IPv4') {
            let el = address.address.split('.');
            if (el.length === 4) {
                let el1 = parseInt(el[1]);
                switch(el[0]) {
                    case '10': return true;
                    case '172': return el1 >= 0 && el1 <= 31;
                    case '192': return el1 === 168;
                }
            }
        }
        return false;
    },

    // 猜测一个内网监听地址的公网访问地址
    // 如果一个endpoint的ip是0地址或者内网ip
    // 并且这个endpoint的协议是tcp协议,
    // 就返回一个判断结果和NAT的ip:port( 公网ip:声明时的监听端口 )
    // @return [bool 是否达成NAT条件, string 可能的公网访问endpoint]
    // 比如：监听TCP '0.0.0.0:1234'，并把端口映射到公网；从本地向外发起连接，通过对方反馈可发现自己的公网IP 'a.b.c.d'；
    // 这时可以猜测其他peer可能可以通过'a.b.c.d:1234'连接进来，当然也可能连不进来；
    // 同样的，也可能从本地对局域网内peer发起连接发现自己的局域网IP，然后猜测自己的地址。
    conjectureEndPoint(endpoint, internetAddress) {
        // make endpoint to be an object
        if ( typeof endpoint == 'string' ) {
            endpoint = EndPoint.toAddress(endpoint);
        } else if ( Array.isArray(endpoint) ) {
            endpoint = EndPoint.toAddress(endpoint.join('@'));
        }

        const isNAT = EndPoint.isNAT(endpoint);
        const isZero = EndPoint.isZero(endpoint);
        const isTCP = EndPoint.PROTOCOL.tcp == endpoint.protocol;

        if ( ( isNAT || isZero ) &&  isTCP ) {
            let tcpListenerAddress = {
                family: internetAddress.family,
                address: internetAddress.address,
                port: endpoint.port,
                protocol: endpoint.protocol,
            };
            // 拼接公网ip和绑定端口
            const newEp = EndPoint.toString(tcpListenerAddress);
            return [true, newEp];
        }

        return [false, ''];
    }
};


// 高阶函数, 生成检查protocol的check函数
// @param 用作检查的类型
// @return function 检查函数
function generateProtocolCheck(protocol) {
    return function(address) {
        if ( address != null && typeof address === 'object' ) {
            // 如果address是对象,直接比较protocol即可
            return address.protocol === protocol;
        } else if ( typeof address === 'string' ) {
            // 如果address 是 'u' 或者 't'
            // 直接比较即可
            // 如果address 字符串形式的endpoint, 则需要转化
            if ( address.length == 1 ) {
                return address === protocol;
            } else {
                return EndPoint.toAddress(address).protocol === protocol;
            }
        }

        return false;
    }
}

EndPoint.isTCP = generateProtocolCheck(EndPoint.PROTOCOL.tcp);
EndPoint.isUDP = generateProtocolCheck(EndPoint.PROTOCOL.udp);

const NetHelper = {
    getLocalIPs(withInternal) {
        let ips = [];
        let netInterface = os.networkInterfaces();
        for (let name of Object.keys(netInterface)) {
            netInterface[name].forEach(info => {
                // 127.0.0.1和::1是回环地址，由参数指定是否过滤
                if (withInternal || !info.internal) {
                    if (info.family === 'IPv4') {
                        let el = info.address.split('.');
                        // 去掉0.x.x.x和169.254.x.x
                        if (el.length !== 4 ||
                            parseInt(el[0]) === 0 ||
                            (parseInt(el[0]) === 169 && parseInt(el[1]) === 254)) {
                            return;
                        }
                    } else if (info.family === 'IPv6') {
                        let el = info.address.split(':');
                        if (el.length === 0 ||
                            parseInt(el[0], 16) === 0xfe80) {
                            return;
                        }
                    }
                    ips.push(info.address);
                }
            });
        }
        return ips;
    },

    getLocalIPV4(withInternal) {
        return NetHelper.getLocalIPs(withInternal).filter(ip => net.isIPv4(ip))
    }
}

const algorithm = {
    /**
     * Deep merge two objects.
     * @param target
     * @param ...sources
     */
    mergeDeep(target, ...sources) {
        if (!sources.length) return target;
        const source = sources.shift();

        if (isObject(target) && isObject(source)) {
            for (const key in source) {
                if (isObject(source[key])) {
                    if (!target[key]) Object.assign(target, { [key]: {} });
                    algorithm.mergeDeep(target[key], source[key]);
                } else {
                    Object.assign(target, { [key]: source[key] });
                }
            }
        }

        return algorithm.mergeDeep(target, ...sources);
    },

    binarySearch(target, arr, compare, low, count) {
        if (!compare) {
            compare = (target, cursor) => target - cursor;
        }
        if (!low) {
            low = 0;
        }
        if (!count && count !== 0) {
            count = arr.length - low;
        }
        if (count < 0 || low < 0) {
            assert(false, `arg error:low=${low},count=${count}`);
            return [-1, -1];
        }

        if (count === 0) {
            return [-1, low];
        }

        const search = (low, high) => {
            if (low <= high) {
                let sub = compare(target, arr[low]);
                if (sub < 0) {
                    return [-1, low];
                } else if (sub === 0) {
                    return [low, low + 1];
                }
        
                sub = compare(target, arr[high]);
                if (sub > 0) {
                    return [-1, high + 1];
                } else if (sub === 0) {
                    return [high, high + 1];
                }
                
                let mid = (high + low) >> 1;
                sub = compare(target, arr[mid]);
                if (sub === 0) {
                    return [mid, mid + 1];
                } else if (sub > 0) {
                    return search(mid + 1, high);
                } else {
                    return search(low, mid - 1);
                }
            }
            return [-1, low];
        }
        return search(low, low + count - 1);
    },
    
    UInt(n) {
        return n >>> 0;
    }
}

const TimeHelper = {
    createTimeUpdateDetector(deviation, expectInterval) {
        let lastTime = Date.now();
        return interval => {
            interval = interval || expectInterval;
            let now = Date.now();
            let nowString = new Date(now);
            let lastTimeString = new Date(lastTime);
            let delta = now - lastTime;
            lastTime = now;
            if (delta < interval - deviation || delta > interval + deviation) {
                return [now, delta - interval];
            }
            return [now, 0];
        }
    },
}

/**
 * 用于计算两个KEY（STRING）之间距离的HASH
 * HASH长度暂时只取MD5的32位；便于计算，同时按距离分组时数量也不会太多
 * 考虑到以后可能需要扩展到更多位数，不可以把HASH值直接当作32位整数处理（如：比较，位运算等）；
 * 需要任何运算时要在HashDistance类中添加函数；
 * 如果真要扩展，已经使用的HASH应该放在最高位，或者直接顺着MD5值往后启用更多位，这样不会影响旧版本中两个距离远近比较和分组
 */
const HashDistance = {
    calcDistance(key1, key2) {
        return HashDistance.calcDistanceByHash(HashDistance.checkHash(key1), HashDistance.checkHash(key2));
    },

    hash(key, bitCount = HashDistance.HASH_BIT_COUNT) {
        assert(typeof key === 'string' && (bitCount === 32 || bitCount === 16), `The key(${key}) must be a string.and bitCount(${bitCount}) must be 16 or 32.`);

        let md5 = Crypto.createHash('md5');
        md5.update(key);
        let md5Hash = md5.digest();
        let hash = md5Hash.readUInt32BE(0);
        if (bitCount === 16) {
            hash = md5Hash.readUInt16BE(0);
        }
        return algorithm.UInt(hash & (~HashDistance.HIGH_BIT_MASK));
    },
    
    checkHash(key) {
        if (typeof key === 'number') {
            return key;
        } else {
            return HashDistance.hash(key);
        }
    },

    calcDistanceByHash(hash1, hash2) {
        return algorithm.UInt(hash1 ^ hash2);
    },

    firstDifferentBit(hash1, hash2) {
        if (hash1 === hash2) {
            return HashDistance.HASH_BIT_COUNT;
        }

        let bits = 0;
        let xor = hash1 ^ hash2;
        let highBitMask = HashDistance.HIGH_BIT_MASK;
        while ((xor & (highBitMask >>> bits)) == 0) { // +-0
            bits++;
        }
        return bits;
    },

    hashBit(hash, bitPos, bitCount = 1) {
        // value << 32 == value?
        if (bitCount == 0 || bitPos >= HashDistance.HASH_BIT_COUNT) {
            return 0;
        }

        if (bitCount > HashDistance.HASH_BIT_COUNT - bitPos) {
            bitCount = HashDistance.HASH_BIT_COUNT - bitPos;
        }
        
        // mask = 0x1111111000000
        //                 |(bitCount)
        let mask = (HashDistance.HASH_MASK << (HashDistance.HASH_BIT_COUNT - bitCount));
        // mask = 0x0000111000000
        //              | |(bitPos+bitCount)
        //              |bitPos
        mask = (mask >>> bitPos);
        return algorithm.UInt(hash & mask);
    },

    isBitSet(hash, bitPos) {
        return !!HashDistance.hashBit(hash, bitPos);
    },

    // 仅仅用于在网络上得到两个理论上应该相等的hash值，这时候不检查最高位
    checkEqualHash(hash1, hash2) {
        return ((hash1 ^ hash2) & (~HashDistance.HIGH_BIT_MASK)) == 0; // +-0
    },

    compareHash(hash1, hash2) {
        return hash1 - hash2;
    },

    sortByDistance(hashObjArray, targetHashObj) {
        let targetHash = targetHashObj.hash || HashDistance.checkHash(targetHashObj.peerid);
        hashObjArray.sort((obj1, obj2) => {
            let distance1 = HashDistance.calcDistance(targetHash, obj1.hash || HashDistance.checkHash(obj1.peerid));
            let distance2 = HashDistance.calcDistance(targetHash, obj2.hash || HashDistance.checkHash(obj2.peerid));
            let compare = HashDistance.compareHash(distance1, distance2);
            if (compare === 0) {
                if (!obj1.peerid) {
                    return 1;
                } else if (!obj2.peerid) {
                    return -1;
                }
                if (obj1.peerid > obj2.peerid) {
                    return 1;
                }
                return -1;
            }
            return compare;
        });

        // <TODO> 删除测试代码
        let lastDistance = 0;
        hashObjArray.forEach(obj => {
            let distance = HashDistance.calcDistance(targetHash, obj.hash || HashDistance.checkHash(obj.peerid));
            assert(distance >= lastDistance);
            lastDistance = distance;
        });
    },

    HASH_BIT_COUNT: 32,
    HASH_MASK: 0xFFFFFFFF,//((1 << HASH_BIT_COUNT) - 1);
    HIGH_BIT_MASK: 0x80000000,//(1 << (HASH_BIT_COUNT - 1));
    MAX_HASH: 0xFFFFFFFF, // HASH_MASK
};

module.exports.EndPoint = EndPoint;
module.exports.NetHelper = NetHelper;
module.exports.algorithm = algorithm;
module.exports.TimeHelper = TimeHelper;
module.exports.HashDistance = HashDistance;

if (require.main === module) {
    console.log(NetHelper.getLocalIPs(false));

    let arr = [{a:3}, {a:5}, {a:6}, {a:7}, {a:9}, {a:12}, {a:15}];
    let compare = (target, cursor) => target - cursor.a;
    console.log(algorithm.binarySearch(12, arr, compare));
    console.log(algorithm.binarySearch(15, arr, compare));
    console.log(algorithm.binarySearch(3, arr, compare));
    console.log(algorithm.binarySearch(1, arr, compare));
    console.log(algorithm.binarySearch(17, arr, compare));
}
