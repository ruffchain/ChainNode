#!/usr/bin/env node
import * as process from 'process';
import * as path from 'path';
import * as fs from 'fs';
import { host as chainhost } from '../host';
import { initUnhandledRejection, parseCommand, parseCommandFromCfgFile, initLogger } from '../common/';

const prompt = require('prompts-ex');
const keyStore = require('../../js/key-store');

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

        if (command.options.has('keyStore')) {
            let keyFilePath = command.options.get('keyStore');
            if (!path.isAbsolute(keyFilePath)) {
                keyFilePath = path.join(process.cwd(), keyFilePath);
            }
            try {
                let content = fs.readFileSync(keyFilePath).toString();

                const response = await prompt({
                    type: 'password',
                    name: 'secret',
                    message: 'password',
                    validate: (value: string) => value.length < 8 ? 'password length must >= 8' : true
                });

                if (response.secret) {
                    let secretKey = keyStore.fromV3Keystore(content, response.secret);
                    command.options.set('minerSecret', secretKey);
                }
            } catch (err) {
                console.log(`invalie keyFilePath ${keyFilePath}`);
                return -3;
            }
        }
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
