import {Options as CommandOptions} from '../lib/simple_command';

import {instance as staticOutInstance } from '../../core/net/static_out_node';
import {Node} from '../../core/net_tcp/node';
import chainHost = require('../host/chain_host');

chainHost.registerNet('tcp', (commandOptions: CommandOptions): any=>{
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
        peers = (<string>peers).split(';');
    }
    let nodeType = staticOutInstance(Node);
    return new nodeType({host, port}, peers);
});