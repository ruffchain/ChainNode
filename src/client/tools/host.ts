import * as process from 'process';
import {init as initUnhandledRejection} from '../lib/unhandled_rejection';
import {parseCommand} from '../lib/simple_command';

import chainhost = require('../host/chain_host');
import '../tcp/host';
import '../bdt/host';
import '../pow/host';
import '../dpos/host';

initUnhandledRejection();

Error.stackTraceLimit = 1000;

async function main() {
    let command = parseCommand();
    if (!command) {
        console.error(`parse command error, exit.`);
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
        console.error(`invalid action command ${command.command}`);
        exit = true;
    }
    if (exit) {
        process.exit();
    }
}

main();