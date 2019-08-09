


export interface NodeInfo {
    role: string;

}
// base info
abstract class Monitor {
    protected nodeInfo: NodeInfo;


    constructor(options: Map<string, any>) {
        this.nodeInfo = { role: 'node' }
    }
    public abstract start(): void;
}
// miner
export class MinerMonitor extends Monitor {
    constructor(options: Map<string, any>) {
        super(options);
        this.nodeInfo.role = 'miner';
    }
    public start() {

    }
}
// peer
export class PeerMonitor extends Monitor {
    constructor(options: Map<string, any>) {
        super(options)
        this.nodeInfo.role = 'peer';
    }
    public start() {

    }
}