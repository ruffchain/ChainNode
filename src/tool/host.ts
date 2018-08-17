#!/usr/bin/env node
import * as process from 'process';
import {initUnhandledRejection, parseCommand, host as chainhost} from '../client';

initUnhandledRejection();

Error.stackTraceLimit = 1000;

export async function run(argv: string[]) {
    let command = parseCommand(argv);
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

if (require.main === module) {
    run(process.argv);
}