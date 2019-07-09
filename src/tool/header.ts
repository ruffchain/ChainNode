import * as path from 'path';
import * as fs from 'fs-extra';
const assert = require('assert');
import * as sqlite from 'sqlite';
import * as sqlite3 from 'sqlite3';
import {Transaction, BlockStorage, BlockHeader, HeaderStorage, Receipt } from '../core';
import {initUnhandledRejection, parseCommand, initLogger} from '../common';
import {DposBftBlockHeader} from '../core/dpos_bft_chain';
import {ValueTransaction, ValueReceipt} from '../core/value_chain/transaction';
import {Block,EventLog, ErrorCode} from '../core';
import {BufferReader} from '../common/lib/reader';
//import { ErrorCode } from '../core/error_code';

const digest = require('../common/lib/digest');
const logger = initLogger({loggerOptions: {console: true}});
initUnhandledRejection(logger);

process.on('unhandledRejection', (reason, p) => {
    console.log('未处理的 rejection：', p, '原因：', reason);
});

function dumpBftSign(header: DposBftBlockHeader) {
    let printEnd = false;
    header.bftSigns.forEach((sign, num) => {
        if (num == 0) {
            console.log('=== BFT Sign Begin ===');
            printEnd = true;
        }
        console.log('\tsign num: ', num);
        console.log('\thash: ', sign.hash);
        console.log('\tpubkey: ', sign.pubkey.toString('hex'));
        console.log('\tsign: ', sign.sign.toString('hex'));
    });
    if (printEnd) {
        console.log('=== BFT Sign End ===');
    }
}

function dumpBlock(blockRaw: Buffer) {
    let block = new Block({
        header: undefined,
        headerType: DposBftBlockHeader,
        transactionType: ValueTransaction,
        receiptType: ValueReceipt
    });
    let err = block.decode(new BufferReader(blockRaw));

    if (err == ErrorCode.RESULT_OK) {
        let res: any = { transactions: null, eventLogs: null };
        console.log(block.header.stringify());

        console.log('transactions:', block.content.transactions);

        dumpBftSign(block.header as DposBftBlockHeader)
        res.transactions = block.content.transactions.map((tr: Transaction) => {
            tr.stringify()
        });
        res.eventLogs = block.content.eventLogs.map((log: EventLog) => log.stringify());
        console.log(JSON.stringify(res, null, 4));
    }
    return block;
}

let command = parseCommand(process.argv);
if (!command) {
    console.log(`Usage: node header.js {--height {height}  --data {dataDir} --dump {dumpPath} --block {blockPath} }`);
    process.exit();
}

(async() => {
    const logger = initLogger({loggerOptions: {console: true, level: 'error'}});

    let height;
    let dataDir;
    let dumpPath;
    let blockPath;

    if (command!.options.has('height')) {
        height = parseInt(command!.options.get('height'));
    }

    if (command!.options.has('data')) {
        dataDir = command!.options.get('data');
        if (!path.isAbsolute(dataDir)) {
            dataDir = path.join(process.cwd(), dataDir);
        }

    }

    if (command!.options.has('dump')) {
        dumpPath = command!.options.get('dump');
        if (!path.isAbsolute(dumpPath)) {
            dumpPath = path.join(process.cwd(), dumpPath);
        }
    }

    if (command!.options.has('block')) {
        blockPath = command!.options.get('block');
        if (!path.isAbsolute(blockPath)) {
            blockPath = path.join(process.cwd(), blockPath);
        }
    }

    if (height && dataDir) {
        let dbpath = path.join(dataDir, 'database');
        let db = await sqlite.open(dbpath, { mode: sqlite3.OPEN_CREATE | sqlite3.OPEN_READWRITE });

        let headerStorage = new HeaderStorage({
                    logger,
                    blockHeaderType:DposBftBlockHeader,
                    db,
                    blockStorage: undefined!,
                    readonly: true
                });

        let ret = await headerStorage.init();

        let hr = await headerStorage.getHeader(height);
        if (!hr.err) {
            console.log(hr.header!.stringify());
            dumpBftSign(hr.header! as DposBftBlockHeader);
        }
    }

    if (dumpPath) {
        let buf = fs.readFileSync(dumpPath);
        const sqliteHeaderSize: number = 100;
        const content = Buffer.from(buf.buffer as ArrayBuffer, sqliteHeaderSize, buf.length - sqliteHeaderSize);
        let hash = digest.hash256(content).toString('hex');
        //let hash = digest.hash256(buf).toString('hex');
        console.log('dump snapshot', hash);
    }

    if (blockPath) {
        let buf = fs.readFileSync(blockPath);
        dumpBlock(buf);
    }
})()


