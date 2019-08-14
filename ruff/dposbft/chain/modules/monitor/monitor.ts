import { IFeedBack, ErrorCode } from "../../../../../src/core";

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
    dataDirSize: number;
    cpuInfo: string;
}
export interface IfPeerInfo {
    id: string;
    ip: string;
}
export interface IfConnInfo {
    inbound: number;
    outbound: number;
    peers: IfPeerInfo[];
}
// processed in an hour
export interface IfProcessInfo {
    timestamp: number;
    timeDelta: number;
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
    recvTxs: number;
    sendTxs: number;
    recvRpcs: number;
    sendRpcs: number;
}

// base info
abstract class Monitor {
    static MAX_PROCESS_INFO = 24;
    static LOOP_INTERVAL = 1 * 60; // in seconds
    protected nodeInfo: IfNodeInfo | {};
    protected connInfo: IfConnInfo | {};
    protected processInfoLst: IfProcessInfo[];
    protected contribInfoLst: IfContribInfo[];

    constructor(options: Map<string, any>) {
        this.nodeInfo = {};
        this.initNodeInfo('dataDir', 'string', options);
        this.initNodeInfo('peerid', 'string', options);
        this.initNodeInfo('loggerLevel', 'string', options);
        this.initNodeInfo('rpcport', 'number', options);
        this.initNodeInfo('minOutBound', 'number', options);
        this.initNodeInfo('port', 'string', options);
        this.initNodeInfo('sn', 'string', options);
        this.initNodeInfo('txServer', 'boolean', options);

        (this.nodeInfo as IfNodeInfo).version = "v1.0";
        (this.nodeInfo as IfNodeInfo).bootTime = new Date().getTime();


        this.connInfo = {
            inbound: 0,
            outbound: 0,
            peers: []
        };

        this.processInfoLst = [];

        this.contribInfoLst = [];
    }
    private initNodeInfo(key: string, type: string, options: Map<string, any>): void {
        let o = this.nodeInfo as any;
        if (options.get(key)) {
            o[key] = options.get(key);
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
    public abstract start(): void;
    public getNodeInfo() {
        return this.nodeInfo;
    }
    public getConnInfo() {
        return this.connInfo;
    }
    public getProcessInfo() {
        return this.processInfoLst;
    }
    public getContribInfo() {
        return this.contribInfoLst;
    }
}
// miner
export class MinerMonitor extends Monitor {
    constructor(options: Map<string, any>) {
        super(options);
        (this.nodeInfo as IfNodeInfo).role = 'miner';
    }
    private async loopWork() {
        console.log('MinerMonitor loopWork');
    }

    public async start() {
        console.log('MinerMonitor start ...')
        while (true) {
            await DelayPromise(Monitor.LOOP_INTERVAL);
            this.loopWork();
        }
    }
}
// peer
export class PeerMonitor extends Monitor {
    constructor(options: Map<string, any>) {
        super(options);
        (this.nodeInfo as IfNodeInfo).role = 'peer';
    }
    private async loopWork() {
        console.log('PeerMonitor loopWork');
    }
    public async start() {
        console.log('PeerMonitor start ...')
        while (true) {
            await DelayPromise(Monitor.LOOP_INTERVAL);
            this.loopWork();
        }
    }
}