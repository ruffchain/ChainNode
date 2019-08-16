import { DposViewContext, LoggerInstance, Chain, ChainGlobalOptions } from "../../../../../src/core";
import { MinerMonitor, PeerMonitor, IfNodeInfo } from "./monitor";

// make it accessible
let monitor: MinerMonitor | PeerMonitor | undefined = undefined;

export function getMonitor() {
    return monitor;
}

export function startMinerMonitor(logger: LoggerInstance, chain: Chain, options: Map<string, any>, global?: ChainGlobalOptions) {
    logger.info('Monitor startMinerMonitor');
    // console.log(global);
    monitor = new MinerMonitor(logger, chain, options, global);
    monitor.start();
}

export function startPeerMonitor(logger: LoggerInstance, chain: Chain, options: Map<string, any>, global?: ChainGlobalOptions) {
    logger.info('Monitor startPeerMonitor');
    // console.log(global);
    monitor = new PeerMonitor(logger, chain, options, global);
    monitor.start();
}

export async function getNodeInfo(logger: LoggerInstance, params: any): Promise<any> {
    return monitor!.getNodeInfo();
}
export async function getConnInfo(logger: LoggerInstance, params: any): Promise<any> {

    if (params.index === undefined || (typeof params.index) !== 'number') {
        logger.error('wrong params.index');
        return {};
    }

    return monitor!.getConnInfo(params.index);
}
export async function getProcessInfo(logger: LoggerInstance, params: any): Promise<any> {
    if (params.index === undefined || (typeof params.index) !== 'number') {
        logger.error('wrong params.index');
        return {};
    }
    return monitor!.getProcessInfo(params.index);
}
export async function getContribInfo(logger: LoggerInstance, params: any): Promise<any> {
    if (params.index === undefined || (typeof params.index) !== 'number') {
        logger.error('wrong params.index');
        return {};
    }
    return monitor!.getContribInfo(params.index);
}

