
/**
 * 以相对平滑稳定的节奏发送数据包
 */
const EventEmitter = require('events');
const {TimeHelper} = require('../base/util');

class PaceSender extends EventEmitter {
    constructor(options) {
        super();

        this.m_options = {
            alpha: 0.125,
            maxPkgInterval: 100,
            minPkgInterval: 2,
            periodInterval: 10,
            maxDelay: 500,
        };

        this.m_lastPkgTime = 0;
        this.m_lastSendTime = 0;
        this.m_maxTimeout = 0;
        this.m_pkgInterval = this.m_options.minPkgInterval;

        this.m_queue = [];
        this.m_timer = null;
    }

    start() {
        if (!this.m_timer) {
            this.m_timer = setInterval(() => this._period(), this.m_options.periodInterval);
            this.removeAllListeners(PaceSender.EVENT.pop);
        }
    }

    stop() {
        if (!this.m_timer) {
            this.m_queue = [];
            clearInterval(this.m_timer);
            this.m_timer = null;
        }
    }

    push(pkg, eplist, options) {
        let now = Date.now();

        // update (pkgInterval, this.m_lastPkgTime)
        let pkgInterval = Math.min(now - this.m_lastPkgTime, this.m_options.maxPkgInterval);
        if (pkgInterval < 0) {
            pkgInterval = 0;
        }
        this.m_pkgInterval = pkgInterval * this.m_options.alpha + this.m_pkgInterval * (1 - this.m_options.alpha);
        this.m_lastPkgTime = now;

        if (!options || !options.timeout || options.timeout < 0 || (this.m_queue.length === 0 && pkgInterval >= this.m_options.minPkgInterval)) {
            this.emit(PaceSender.EVENT.pop, pkg, eplist, options);
            return;
        }

        let pkgTimeout = now + options.timeout;
        if (this.m_maxTimeout < pkgTimeout) {
            this.m_maxTimeout = pkgTimeout;
        }
        this.m_queue.push({pkg, eplist, options, sendTime: now});
    }

    _period() {
        /**
         * 发送数量 = max(总包数/(m_maxTimeout-now)*(now-m_lastSendTime), (now-m_lastSendTime)/平均包间隔，总包数)
         */
        let now = Date.now();
        let sendInterval = Math.min(now - this.m_lastSendTime, this.m_options.maxPkgInterval);
        if (sendInterval < 0) {
            sendInterval = this.m_options.maxPkgInterval;
        }
        
        let delay = this.m_maxTimeout - now;
        if (delay < 0) {
            delay = this.m_options.maxDelay
        } else if (delay === 0) {
            delay = 1;
        } else if (delay > this.m_options.maxDelay) {
            delay = this.m_options.maxDelay;
            this.m_maxTimeout = now + this.m_options.maxDelay;
        }

        let limitCount = Math.max(this.m_queue.length * sendInterval / delay, sendInterval / this.m_pkgInterval);
        if (limitCount < 1) {
            if (sendInterval < this.m_pkgInterval) {
                return;
            } else {
                limitCount = 1;
            }
        } else {
            limitCount = Math.ceil(limitCount);
        }

        this.m_lastSendTime = now;
        let sendPkgs = this.m_queue.splice(0, limitCount);
        for (let stub of sendPkgs) {
            this.emit(PaceSender.EVENT.pop, stub.pkg, stub.eplist, stub.options);
        }
    }
};

PaceSender.EVENT = {
    pop: 'pop',
};

module.exports = PaceSender;