import {Options as CommandOptions} from '../lib/simple_command';

import {instance as staticOutInstance } from '../../core/net/static_out_node';
import {Node} from '../../core/net_bdt/node';
import chainHost = require('../host/chain_host');

chainHost.registerNet('bdt', (commandOptions: CommandOptions): any=>{
    let host = commandOptions.get('host');
    if (!host) {
        console.error('invalid bdt host');
        return ;
    }
    let port = commandOptions.get('port');
    if (!port) {
        console.error('invalid bdt port');
        return ;
    }
    let nodeType = staticOutInstance(Node);
    return new nodeType({host, port});
});