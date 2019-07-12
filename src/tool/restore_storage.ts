#!/usr/bin/env node
import * as process from 'process';
import * as path from 'path';
import * as fs from 'fs-extra';
import {initUnhandledRejection, parseCommand, initLogger} from '../common';
import {initChainCreator, createValueDebuger, ErrorCode, stringifyErrorCode} from '../core';

const logger = initLogger({loggerOptions: {console: true}});
initUnhandledRejection(logger);

async function main() {
    const commandTip = `Usage: node restore_storage.js restore --dateDir [data dir] --height [block height] --output [output path]`;
    let command = parseCommand(process.argv);
    if (!command || !command.command) {
        console.log(commandTip);
    }

    if (command!.command === 'restore') {
        const dataDir = command!.options.get('dataDir');
        if (!dataDir) {
            console.log(commandTip);
            return ;
        }
        let output = command!.options.get('output');
        if (!output) {
            console.log(commandTip);
            return ;
        }
        if (!path.isAbsolute(output)) {
            output = path.join(process.cwd(), output);
        }
        const chainCreator = initChainCreator({logger});
        const ccir = await chainCreator.createChainInstance(dataDir, {readonly: false, initComponents: true});
        if (ccir.err) {
            chainCreator.logger.error(`create chain instance from ${dataDir} failed `, stringifyErrorCode(ccir.err));
            return ;
        }

        let height = parseInt(command!.options.get('height'));
        let headerRet = await ccir.chain!.headerStorage.getHeader(height);
        if (headerRet.err) {
            console.log(`get header error ${headerRet.err}, exit.`);
            return ;
        }
        console.log(`recovering storage for Block ${headerRet.header!.hash}...`);
        const csr = await ccir.chain!.storageManager.createStorage('temp', headerRet.header!.hash);
        if (csr.err) {
            console.log(`restore storage from redo log failed ${stringifyErrorCode(csr.err)}`);
            return ;
        }
        fs.ensureDirSync(output);
        await csr.storage!.uninit();
        fs.copyFileSync(csr.storage!.filePath, path.join(output, 'restore'));
        console.log(`restore complete.`);
    } else {
        console.log(commandTip);
    }

}
(async() => {
    await main();
    process.exit(0);
})()
