const Base = require('../base/base.js');
const BaseUtil = require('../base/util.js');
const LOG_INFO = Base.BX_INFO;
const LOG_WARN = Base.BX_WARN;
const LOG_DEBUG = Base.BX_DEBUG;
const LOG_CHECK = Base.BX_CHECK;
const LOG_ASSERT = Base.BX_ASSERT;
const LOG_ERROR = Base.BX_ERROR;

class ResendQueue {
    constructor({MAX_PACKAGE_COUNT = 1024 * 4} = {})
    {
        this.MAX_PACKAGE_COUNT = MAX_PACKAGE_COUNT;
        this.m_packageInfos = new Map();
    }

    // 注意addPackage/confirmPackage的packageID配对
    static genPackageID(cmdType, remotePeeridHash, seq)
    {
        let id = `${cmdType}:${remotePeeridHash}:${seq}`;
        LOG_INFO(`genPackageID:${id}`);
        return id;
    }

    addPackage(packageID, buffer, server, remoteAddr, interval, times, onTimeOut) {
        if (this.m_packageInfos.size > this.MAX_PACKAGE_COUNT) {
            let maxResendTimes = 0;
            let maxResendPackageID = '';

            for (let [k, v] of this.m_packageInfos.entries()) {
                if (v.times > maxResendTimes) {
                    maxResendTimes = v.times;
                    maxResendPackageID = k;
                }
            }

            // 如果队列满了就删掉重试次数最多的
            if (maxResendTimes >= 2) {
                this.m_packageInfos.delete(maxResendPackageID);
            } else {
                LOG_WARN('resend queue full!,drop package.');
                return;
            }
        }

        let now = Date.now();
        let info = {
            id: packageID,
            buffer: buffer,
            server: server,
            remoteEP: BaseUtil.EndPoint.toString(remoteAddr),
            interval: interval,
            times: 0,
            onTimeOut: onTimeOut,
            timeOutDelay: interval * times,
            createTime: now,
            lastSend: now,
        };

        this.m_packageInfos.set(packageID, info);
    }

    confirmPackage(packageID) {
        this.m_packageInfos.delete(packageID);
    }

    onTimer() {
        let now = Date.now();
        let willRemove = [];
        let k = null;
        for (let [k, v] of this.m_packageInfos.entries()) {
            if(now - v.createTime > v.timeOutDelay) {
                if(v.onTimeOut) {
                    v.onTimeOut();
                }
                LOG_INFO(`package(${k}) is timeout!!!!`);
                willRemove.push(k);
            } else {
                if (now - v.lastSend > v.interval * (v.times + 1)) {
                    v.times = v.times + 1;
                    v.lastSend = now;
                    LOG_INFO(`resend a req package(${k})`);
                    v.server.send(
                        v.buffer,
                        [v.remoteEP],
                        true
                    );
                }
            }
        }

        for (let id of willRemove) {
            this.m_packageInfos.delete(id);
        }
    }
}

module.exports = ResendQueue;