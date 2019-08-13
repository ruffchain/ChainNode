import { DposViewContext } from "../../../../../src/core";
import { MinerMonitor, PeerMonitor } from "./monitor";

// make it accessible


export function startMinerMonitor(options: Map<string, any>) {
    let host = options.get('rpchost');
    let port = options.get('port')
    let peerid = options.get('peerid')

    let monitor = new MinerMonitor(options);
    monitor.start();
}

export function startPeerMonitor(options: Map<string, any>) {
    let monitor = new PeerMonitor(options);
    monitor.start();
}

export async function getNodeInfo(context: DposViewContext, params: any): Promise<Buffer | undefined> {

    return undefined;
}
export async function getConnInfo(context: DposViewContext, params: any): Promise<Buffer | undefined> {

    return undefined;
}
export async function getProcessInfo(context: DposViewContext, params: any): Promise<Buffer | undefined> {

    return undefined;
}
export async function getContribInfo(context: DposViewContext, params: any): Promise<Buffer | undefined> {

    return undefined;
}

