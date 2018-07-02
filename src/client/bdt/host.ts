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
    let peerid = commandOptions.get('peerid');
    if (!peerid) {
        peerid = `${host}:${port}`
    }
    let snPeers = commandOptions.get('sn');
    if (!snPeers) {
        console.error('no sn');
        return ;
    }
    let snconfig = (<string>snPeers).split('@');
    if (snconfig.length !== 4) {
        console.error('invalid sn: <SN_PEERID>@<SN_IP>@<SN_TCP_PORT>@<SN_UDP_PORT>')
    }
    const snPeer = {
        peerid: `${snconfig[0]}`,
        eplist: [
            `4@${snconfig[1]}@${snconfig[2]}@t`,
            `4@${snconfig[1]}@${snconfig[3]}@u`
        ]
    }
    return new Node({host: host, port: port, peerid: peerid, snPeer: snPeer});
});