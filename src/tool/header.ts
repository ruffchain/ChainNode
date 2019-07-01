import * as path from 'path';
import * as fs from 'fs-extra';
const assert = require('assert');
import * as sqlite from 'sqlite';
import * as sqlite3 from 'sqlite3';
import {Transaction, BlockStorage, BlockHeader, HeaderStorage, Receipt } from '../core';
import {initUnhandledRejection, parseCommand, initLogger} from '../common';
import {DposBftBlockHeader} from '../core/dpos_bft_chain';
const logger = initLogger({loggerOptions: {console: true}});
initUnhandledRejection(logger);

process.on('unhandledRejection', (reason, p) => {
    console.log('未处理的 rejection：', p, '原因：', reason);
});

let command = parseCommand(process.argv);
if (!command) {
    console.log(`Usage: node header.js {--height {height}  --data {dataDir} }`);
    process.exit();
}

(async() => {
    const logger = initLogger({loggerOptions: {console: true, level: 'error'}});

    let height;
    let dataDir;

    if (command!.options.has('height')) {
        height = parseInt(command!.options.get('height'));
    }

    if (command!.options.has('data')) {
        dataDir = command!.options.get('data');
    }

    const rootDir = path.join(process.cwd(), dataDir);
    let dbpath = path.join(rootDir, 'database');
    let db = await sqlite.open(dbpath, { mode: sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE });

    let headerStorage = new HeaderStorage({
                logger,
                blockHeaderType:DposBftBlockHeader,
                db,
                blockStorage: undefined!,
                readonly: true
            });

    let ret = await headerStorage.init();

    if (height) {
        let hr = await headerStorage.getHeader(height);
        console.log(hr);
    }
})()


