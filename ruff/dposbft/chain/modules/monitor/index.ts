import { DposViewContext } from "../../../../../src/core";
import { Monitor } from "./monitor";
import { string } from "@hapi/joi";

// make it accessible
export let monitor = new Monitor();

export function startMinerMonitor(options: Map<string, any>) {
    let host = options.get('rpchost');
    let port = options.get('port')
    let peerid = options.get('peerid')
    monitor.start();
}

export function startPeerMonitor(options: Map<string, any>) {
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

