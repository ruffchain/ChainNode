import { DposViewContext } from "../../../../../src/core";
import { MinerMonitor, PeerMonitor, IfNodeInfo } from "./monitor";
import { func } from "@hapi/joi";

// make it accessible
export let monitor: MinerMonitor | PeerMonitor | undefined = undefined;

export function getMonitor() {
    return monitor;
}

export function startMinerMonitor(options: Map<string, any>) {

    monitor = new MinerMonitor(options);
    monitor.start();
}

export function startPeerMonitor(options: Map<string, any>) {
    monitor = new PeerMonitor(options);
    monitor.start();
}

export async function getNodeInfo(context: DposViewContext, params: any): Promise<any> {
    return monitor!.getNodeInfo();
}
export async function getConnInfo(context: DposViewContext, params: any): Promise<any> {

    return monitor!.getConnInfo();
}
export async function getProcessInfo(context: DposViewContext, params: any): Promise<any> {

    return monitor!.getProcessInfo();
}
export async function getContribInfo(context: DposViewContext, params: any): Promise<any> {

    return monitor!.getContribInfo();
}

