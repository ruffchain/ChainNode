import {Options as CommandOptions} from '../lib/simple_command';

import {StaticOutNode, TcpNode } from '../../core';

import chainHost = require('../host/chain_host');

chainHost.registerNet('tcp', (commandOptions: CommandOptions): any => {
    let host = commandOptions.get('host');
    if (!host) {
        console.error('invalid tcp host');
        return ;
    }
    let port = commandOptions.get('port');
    if (!port) {
        console.error('invalid tcp port');
        return ;
    }
    let peers = commandOptions.get('peers');
    if (!peers) {
        peers = [];
    } else {
        peers = (peers as string).split(';');
    }
    let nodeType = StaticOutNode(TcpNode);
    return new nodeType({host, port}, peers);
});