#!/usr/bin/env node
import * as process from 'process';
import * as path from 'path';
import { host as chainhost } from '../host';
import { initUnhandledRejection, parseCommand, parseCommandFromCfgFile, initLogger } from '../common/';

Error.stackTraceLimit = 1000;

async function main() {
    let ret = await run(process.argv);
    if (ret !== 0) {
        process.exit(ret);
    }

}

export async function run(argv: string[]) {
    let command = parseCommand(argv);
    if (!command) {
        console.error(`parse command error, exit.`);
        // process.exit(-1);
        return -1;
    }

    command = parseCommandFromCfgFile(command);

    if (command.options.has('dataDir')) {
        // initUnhandledRejection(initLogger({

        //     loggerOptions: {
        //         console: true,
        //         file: { root: path.join(process.cwd(), command.options.get('dataDir')), filename: 'exception.log' },
        //         dumpStack: true
        //     }

        // }));
        if (command.options.has('vmLogLevel')) {
            process.env['RUFFVM_LOG_LEVEL'] = command.options.get('vmLogLevel').toUpperCase();
            process.env['RUFFVM_LOG_FILE'] = path.join(process.cwd(), command.options.get('dataDir'), 'vm.log');
        }
    }
    let exit: boolean = false;
    if (command.command === 'peer') {

        exit = !(await chainhost.initPeer(command.options)).ret;

    } else if (command.command === 'miner') {

        exit = !(await chainhost.initMiner(command.options)).ret;

    } else if (command.command === 'create') {
        await chainhost.createGenesis(command.options);
        exit = true;
    } else {
        console.error(`invalid action command ${command.command}`);
        exit = true;
    }
    if (!exit) {
        // process.exit();
        return 0;
    } else {
        return -3;
    }
}

if (require.main === module) {
    main();
}
