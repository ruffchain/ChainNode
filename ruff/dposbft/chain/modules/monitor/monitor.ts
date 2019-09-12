import { IFeedBack, ErrorCode, Chain, ChainGlobalOptions } from "../../../../../src/core";
const util = require('util');
const exec = util.promisify(require('child_process').exec);
import { LoggerInstance } from "../../../../../src/core";
const fs = require('fs-extra');

export function DelayPromise(n: number) {
    return new Promise<IFeedBack>((resolv) => {
        setTimeout(() => {
            resolv({ err: ErrorCode.RESULT_OK, data: null })
        }, n * 1000)
    });
}


export interface IfNodeInfo {
    role: string; // miner , peer

    // get from genesis.json
    dataDir: string;
    peerid: string;
    loggerLevel: string;
    rpcport: number;
    minOutBound: number;
    port: string; // "13101|13000"
    sn: string;
    txServer: boolean;

    version: string;
    bootTime: number;

    name: string;
    location: string;
    url: string;

    osType: string; // ubuntu 16.04
    dockerVersion: string;
    cpuInfo: string;
    memInfo: string;
}
// export interface IfPeerInfo {
//     id: string;
//     ip: string;
// }
export interface IfConnInfo {
    timestamp: number;
    timeDelta: number;
    dataDirSize: number;
    inbound: string[];
    outbound: string[];
}
// processed in an hour
export interface IfProcessInfo {
    timestamp: number;
    timeDelta: number;
    blocksMined: number;
    blocks: number;
    blockSizeMax: number;
    blockSizeMin: number;
    blockSizeAvg: number;
    txs: number;
    txSizeMax: number;
    txSizeMin: number;
    txSizeAvg: number;
    errors: number;

}

export interface IfContribInfo {
    timestamp: number;
    timeDelta: number;
    recvBlocks: number;
    sendBlocks: number;
    recvHeaders: number;
    sendHeaders: number;
    recvTxs: number;
    sendTxs: number;
    recvRpcs: number;
    sendRpcs: number;
}

let counterTx = 0;
let counterSizeTx = 0;

// base info
abstract class Monitor {
    static MAX_PROCESS_INFO = 24;
    static LOOP_INTERVAL = 10; // in minutes
    // static VERY_BIG = 1000000000;
    protected nodeInfo: IfNodeInfo | {};
    protected connInfoLst: IfConnInfo[];
    protected processInfoLst: IfProcessInfo[];
    protected contribInfoLst: IfContribInfo[];


    public connInfo: IfConnInfo;
    public processInfo: IfProcessInfo;
    public contribInfo: IfContribInfo;

    public logger: LoggerInstance;
    public chain: Chain;
    public commandOptions: any;
    public globalOptions: any;
    public genesisOptions: any;

    constructor(m_logger: LoggerInstance, m_chain: Chain, options: Map<string, any>, global?: any) {
        this.nodeInfo = {};
        this.initNodeInfo('dataDir', 'string', options);
        this.initNodeInfo('peerid', 'string', options);
        this.initNodeInfo('loggerLevel', 'string', options);
        this.initNodeInfo('rpcport', 'number', options);
        this.initNodeInfo('minOutBound', 'number', options);
        this.initNodeInfo('port', 'string', options);
        this.initNodeInfo('sn', 'string', options);
        this.initNodeInfo('txServer', 'boolean', options);


        this.connInfo = {
            timestamp: 0,
            timeDelta: 0,
            dataDirSize: 0,
            inbound: [],
            outbound: []
            // peers: [] you can get from getPeers
        };

        this.processInfo = {
            timestamp: 0,
            timeDelta: 0,
            blocksMined: 0,
            blocks: 0,
            blockSizeMax: 0,
            blockSizeMin: 0,
            blockSizeAvg: 0,
            txs: 0,
            txSizeMax: 0,
            txSizeMin: 0,
            txSizeAvg: 0,
            errors: 0
        }

        this.contribInfo = {
            timestamp: 0,
            timeDelta: 0,
            recvBlocks: 0,
            sendBlocks: 0,
            recvHeaders: 0,
            sendHeaders: 0,
            recvTxs: 0,
            sendTxs: 0,
            recvRpcs: 0,
            sendRpcs: 0
        }

        this.connInfoLst = [];

        this.processInfoLst = [];

        this.contribInfoLst = [];

        this.logger = m_logger;
        this.chain = m_chain;
        this.globalOptions = global;
        this.commandOptions = options;
    }
    protected resetConnInfo() {

        this.connInfo = {
            timestamp: 0,
            timeDelta: 0,
            dataDirSize: 0,
            inbound: [],
            outbound: []
        };
    }
    protected resetProcessInfo() {
        counterTx = 0;
        counterSizeTx = 0;

        this.processInfo = {
            timestamp: 0,
            timeDelta: 0,
            blocksMined: 0,
            blocks: 0,
            blockSizeMax: 0,
            blockSizeMin: 0,
            blockSizeAvg: 0,
            txs: 0,
            txSizeMax: 0,
            txSizeMin: 0,
            txSizeAvg: 0,
            errors: 0
        }
    }
    protected resetContribInfo() {
        this.contribInfo = {
            timestamp: 0,
            timeDelta: 0,
            recvBlocks: 0,
            sendBlocks: 0,
            recvHeaders: 0,
            sendHeaders: 0,
            recvTxs: 0,
            sendTxs: 0,
            recvRpcs: 0,
            sendRpcs: 0
        }
    }
    protected addToLst(lst: IfConnInfo[] | IfProcessInfo[] | IfContribInfo[], item: IfConnInfo | IfProcessInfo | IfContribInfo) {
        let obj: any = {}
        let itemAny: any = item as any;

        this.logger.debug('\n');
        for (let key of Object.keys(itemAny)) {
            obj[key] = itemAny[key]
            this.logger.debug(key + ' ' + obj[key]);
        }
        console.log(obj);
        (lst as Array<any>).push(obj);

        if (lst.length > Monitor.MAX_PROCESS_INFO) {
            lst.shift();
        }
    }
    private async fillNodeInfo() {
        // get version
        (this.nodeInfo as IfNodeInfo).version = this.getVersionFromPackage();
        (this.nodeInfo as IfNodeInfo).bootTime = new Date().getTime();

        let name = this.commandOptions.get('nodeName');
        (this.nodeInfo as IfNodeInfo).name = name === undefined ? 'Noname' : name;

        let url = this.commandOptions.get('nodeUrl');
        (this.nodeInfo as IfNodeInfo).url = url === undefined ? 'http://notsetyet.com' : url;

        let location = this.commandOptions.get('nodeLocation');
        (this.nodeInfo as IfNodeInfo).location = location === undefined ? 'No where, in space' : location;

        (this.nodeInfo as IfNodeInfo).osType = await this.getOsType();
        (this.nodeInfo as IfNodeInfo).dockerVersion = await this.getDockerVersion();
        (this.nodeInfo as IfNodeInfo).cpuInfo = await this.getCpuInfo();
        (this.nodeInfo as IfNodeInfo).memInfo = await this.getRamInfo();
    }
    private initNodeInfo(key: string, type: string, options: Map<string, any>): void {
        let o = this.nodeInfo as any;
        if (options.get(key)) {
            o[key] = options.get(key)
        } else if (type === 'string') {
            o[key] = '';
        } else if (type === 'number') {
            o[key] = 0;
        } else if (type === 'boolean') {
            o[key] = false;
        } else {
            throw new Error('Wrong type of NodeInfo: ' + type);
        }
    }

    public getNodeInfo() {
        return this.nodeInfo;
    }
    public getConnInfo(index: number) {
        if (this.connInfoLst.length === 0 || index > this.connInfoLst.length) {
            this.logger.error('Not ready or wrong index');
            return {}
        } else {
            this.logger.info(this.connInfoLst.length + ' length')
            this.logger.info(JSON.stringify(this.connInfoLst[this.connInfoLst.length - 1 - index]));
            return this.connInfoLst[this.connInfoLst.length - 1 - index];
        }
    }
    public getProcessInfo(index: number) {
        let len = this.processInfoLst.length;
        if (len === 0 || index > len) {
            return {}
        } else {
            return this.processInfoLst[len - 1 - index];
        }
    }
    public getContribInfo(index: number) {
        let len = this.contribInfoLst.length;
        if (len === 0 || index > len) {
            return {}
        } else {
            return this.contribInfoLst[len - 1 - index];
        }
    }
    public async getDataDirSize(path: string): Promise<IFeedBack> {
        const { stdout, stderr } = await exec(`du -s ${path}`);
        // console.log(stdout);
        // console.log(stderr);
        if (stderr) {
            return { err: ErrorCode.RESULT_EXCEPTION, data: 0 }
        } else {
            let nSize: number = 0;
            try {
                let strMatch = stdout.match(/^([0-9]+)/g);
                this.logger.debug(strMatch[0]);
                nSize = parseInt(strMatch[0]);
            } catch (e) {
                this.logger.debug('monitor getDataDirSize ' + e);
            }
            return { err: ErrorCode.RESULT_OK, data: nSize }
        }
    }
    public getVersionFromPackage(): string {
        let config = fs.readJSONSync('./package.json');
        if (config) {
            return config.version;
        } else {
            this.logger.warn('version not found in ./package.json');
            return '';
        }
    }
    private async getOsType(): Promise<string> {
        const { stdout, stderr } = await exec(`uname -v`);
        if (stderr) {
            this.logger.warn('Run uname failed');
            return '';
        } else {
            return stdout;
        }
    }
    private async getDockerVersion(): Promise<string> {
        try {
            const { stdout, stderr } = await exec(`docker --version`);
            if (stderr) {
                this.logger.warn('Run docker --version failed');
                return '';
            } else {
                return stdout;
            }
        } catch (e) {
            this.logger.error('Error, getDockerVersion()');
            return 'known';
        }

    }

    private async getCpuInfo(): Promise<string> {
        try {
            const { stdout, stderr } = await exec(`cat /proc/cpuinfo | grep "model name"`);
            if (stderr) {
                this.logger.warn('Get /proc/cpuinfo failed');
                return '';
            } else {
                // how to get model name 
                // let strLst = stdout.split('\n');
                // let numCpu = 0;
                // for (let i = 0; i < strLst.length; i++) {
                //     if (strLst[i].length > 1) {
                //         numCpu++;
                //     }
                // }
                // let out = numCpu + ' core' + (numCpu > 1) ? 's ' : ' ' + strLst[0];
                let out = stdout;
                return out;
            }
        } catch (e) {
            this.logger.error('Error getCpuInfo()');
            return '';
        }

    }
    private async getRamInfo(): Promise<string> {
        try {
            const { stdout, stderr } = await exec(`cat /proc/meminfo| grep "MemTotal"`);
            if (stderr) {
                this.logger.warn('Get /proc/meminfo failed');
                return '';
            } else {
                // how to get model name 
                let out = stdout;
                return out;
            }
        } catch (e) {
            this.logger.error('Error getRamInfo()');
            return '';
        }

    }
    protected async loopWork(deltaSeconds: number): Promise<IFeedBack> {
        this.logger.debug('Monitor loopWork');
        let timestamp = new Date().getTime();

        // update connInfo

        let feedback = await this.getDataDirSize('./data');
        if (feedback.err) {
            this.connInfo.dataDirSize = 0;
        } else {
            this.connInfo.dataDirSize = feedback.data;
        }

        this.connInfo.timestamp = timestamp;
        this.connInfo.timeDelta = deltaSeconds;
        this.connInfo.inbound = this.chain.node.getNetwork()!.node.dumpInConns();
        this.connInfo.outbound = this.chain.node.getNetwork()!.node.dumpOutConns();

        // this.logger.debug('connInfo');
        // console.log(this.connInfo);

        this.addToLst(this.connInfoLst, this.connInfo);

        // update processInfo
        this.processInfo.timestamp = timestamp;
        this.processInfo.timeDelta = deltaSeconds;

        this.addToLst(this.processInfoLst, this.processInfo);

        // update contribInfo
        this.contribInfo.timestamp = timestamp;
        this.contribInfo.timeDelta = deltaSeconds;

        this.addToLst(this.contribInfoLst, this.contribInfo);

        return { err: ErrorCode.RESULT_OK, data: null }
    }
    public async start() {
        this.logger.debug('Monitor start ...')
        this.logger.debug('update nodeinfo')
        await this.fillNodeInfo();

        let cycleMinutes = Monitor.LOOP_INTERVAL;
        this.logger.debug('MonitorReportCycle: ' + cycleMinutes);

        let cycleMinutesPeriod: number = 0; // in minutes
        if (cycleMinutes === undefined || cycleMinutes > 60 || cycleMinutes < 5) {
            this.logger.warn('Wrong monitorReporCycle value: ' + cycleMinutes);
            cycleMinutesPeriod = 60;
        } else {
            cycleMinutesPeriod = cycleMinutes;
        };
        this.logger.debug('cycleMinutesPeriod: ' + cycleMinutesPeriod);

        while (true) {
            let date = new Date();
            let minutes = date.getMinutes();
            let seconds = date.getSeconds();

            let remainMinutes = minutes % cycleMinutesPeriod;

            let delaySeconds = (remainMinutes === 0) ? (cycleMinutes * 60) : 60 * (cycleMinutesPeriod - remainMinutes);
            this.logger.debug('Monitor delay ' + (delaySeconds - seconds));

            await DelayPromise(delaySeconds - seconds);
            await this.loopWork(delaySeconds - seconds);

            this.resetConnInfo();
            this.resetProcessInfo();
            this.resetContribInfo();
        }
    }
    public updateOutbounds(remoteLst: string[]) {
        this.logger.debug('Monitor updateOutbounds');
        // this.connInfo.outbound = remoteLst;
    }
    public updateInbounds(remoteLst: string[]) {
        this.logger.debug('Monitor updateInbounds');
        // this.connInfo.inbound = remoteLst;
    }
    public updateBlocksMined(num: number) {
        this.logger.debug('Monitor updateBlocksMined ' + num);
        this.processInfo.blocksMined++;
    }
    public updateBlock(txNum: number) {
        this.logger.debug('Monitor updateBlock : ' + txNum);
        counterTx += txNum;
        this.processInfo.blocks++;

        this.processInfo.blockSizeAvg = parseFloat((counterTx / this.processInfo.blocks).toFixed(2));

        if (this.processInfo.blockSizeMax === 0) {
            this.processInfo.blockSizeMax = txNum;
        }

        if (this.processInfo.blockSizeMin === 0) {
            this.processInfo.blockSizeMin = txNum;
        }

        if (txNum > this.processInfo.blockSizeMax) {
            this.processInfo.blockSizeMax = txNum;
        }
        if (txNum < this.processInfo.blockSizeMin) {
            this.processInfo.blockSizeMin = txNum;
        }
    }
    public updateTx(txInputSize: number) {
        this.logger.debug('Monitor updateTx: ' + txInputSize);
        this.processInfo.txs++;
        counterSizeTx += txInputSize;

        this.processInfo.txSizeAvg = parseFloat((counterSizeTx / this.processInfo.txs).toFixed(2));

        if (this.processInfo.txSizeMax === 0) {
            this.processInfo.txSizeMax = txInputSize;
        }

        if (this.processInfo.txSizeMin === 0) {
            this.processInfo.txSizeMin = txInputSize;
        }

        if (txInputSize > this.processInfo.txSizeMax) {
            this.processInfo.txSizeMax = txInputSize;
        }
        if (txInputSize < this.processInfo.txSizeMin) {
            this.processInfo.txSizeMin = txInputSize;
        }
    }

    public updateRecvBlocks(num: number) {
        this.logger.debug('Monitor updateRecvBlocks');

        if (num === undefined) {
            this.contribInfo.recvBlocks++;
        } else {
            this.contribInfo.recvBlocks += num;
        }

    }
    public updateSendBlocks(num: number) {
        this.logger.debug('Monitor updateSendBlocks');
        if (num === undefined) {
            this.contribInfo.sendBlocks++;
        } else {
            this.contribInfo.sendBlocks += num;
        }

    }
    public updateRecvHeaders(num: number) {
        this.logger.debug('Monitor updateRecvHeaders');
        if (num === undefined) {
            this.contribInfo.recvHeaders++;
        } else {
            this.contribInfo.recvHeaders += num;
        }

    }
    public updateSendHeaders(num: number) {
        this.logger.debug('Monitor updateSendHeaders');
        if (num === undefined) {
            this.contribInfo.sendHeaders++;
        } else {
            this.contribInfo.sendHeaders += num;
        }
    }
    public updateRecvTxs(num: number) {
        this.logger.debug('Monitor updateRecvTxs');
        if (num === undefined) {
            this.contribInfo.recvTxs++;
        } else {
            this.contribInfo.recvTxs += num!;
        }

    }
    public updateSendTxs(num: number) {
        this.logger.debug('Monitor updateSendTxs');
        if (num === undefined) {
            this.contribInfo.sendTxs++;
        } else {
            this.contribInfo.sendTxs += num;
        }
    }
    public updateRecvRpcs() {
        this.logger.debug('Monitor updateRecvRpcs');
        this.contribInfo.recvRpcs++;
    }
    public updateSendRpcs() {
        this.logger.debug('Monitor updateSendRpcs');
        this.contribInfo.sendRpcs++;
    }
}
// miner
export class MinerMonitor extends Monitor {
    constructor(logger: LoggerInstance, chain: Chain, options: Map<string, any>, global?: any) {
        super(logger, chain, options, global);
        (this.nodeInfo as IfNodeInfo).role = 'miner';
    }
}
// peer
export class PeerMonitor extends Monitor {
    constructor(logger: LoggerInstance, chain: Chain, options: Map<string, any>, global?: any) {
        super(logger, chain, options, global);
        (this.nodeInfo as IfNodeInfo).role = 'peer';
    }
}