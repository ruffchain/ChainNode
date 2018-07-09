import * as process from 'process';
import '../lib/unhandled_rejection';
import {parseCommand} from '../lib/simple_command';

import chainhost = require('./chain_host');
import '../tcp/host';
import '../bdt/host';
import '../pow/host';
import '../dpos/host';

Error.stackTraceLimit = 1000;

async function main() {
    let command = parseCommand();
    if (!command) {
        process.exit();
        return ;
    }
    let exit: boolean = false;
    if (command.command === 'peer') {
        exit = !await chainhost.initPeer(command.options);
    } else if (command.command === 'miner') {
        exit = !await chainhost.initMiner(command.options);
    } else if (command.command === 'create') {
        await chainhost.createGenesis(command.options);
        exit = true;
    } else {
        console.error('invalid command');
        exit = true;
    }
    if (exit) {
        process.exit();
    }
}

main();



