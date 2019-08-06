import 'mocha';
import * as path from 'path';
import * as fs from 'fs-extra';
const assert = require('assert');
import * as sqlite from 'better-sqlite3';
import {Transaction, BlockStorage, BlockHeader, initLogger, Receipt } from '../../src/core';
import { HeaderStorage } from '../../src/core/block/header_storage';
process.on('unhandledRejection', (reason, p) => {
    console.log('未处理的 rejection：', p, '原因：', reason);
    // 记录日志、抛出错误、或其他逻辑。
});

class TestHeaderStorage extends HeaderStorage {
    constructor(options: any) {
        super(options);
    }
}

describe('headerStorage', () => {
    let headerStorage: HeaderStorage;
    const logger = initLogger({loggerOptions: {console: true, level: 'error'}});
    before((done) => {
        async function __test() {
            const rootDir = path.join(__dirname, '../../../../data/test/testHeaderStorage');
            fs.removeSync(rootDir);
            fs.ensureDirSync(rootDir);
            let dbpath = path.join(rootDir, 'database');
            let db = new sqlite(dbpath);
            db.pragma('journal_mode = WAL');
            let blockStorage = new BlockStorage({
                path: rootDir,
                blockHeaderType: BlockHeader,
                transactionType: Transaction,
                receiptType: Receipt,
                logger
            });
            headerStorage = new TestHeaderStorage({
                blockStorage,
                logger,
                blockHeaderType: BlockHeader,
                db});
        }
        __test().then(done);
    });

    it('init', (done) => {
        async function __test() {
            assert(!(await headerStorage.init()), `init err`);
        }
        __test().then(done);
    });

    it('changeBest', (done) => {
        async function __test() {
            let gh = new BlockHeader();
            let t = 0;
            gh.timestamp = 0;
            gh.updateHash();
            let err = await headerStorage.createGenesis(gh);
            assert(!err, `createGenesis error`);
            let best = 0;
            let ph = gh;
            console.log(`save 10 headers`);
            let count = 2000;
            for (let ix = 0; ix < count; ++ix) {
                let h = new BlockHeader();
                h.setPreBlock(ph);
                h.timestamp = ++t;
                h.updateHash();
                ph = h;
                let start = Date.now();
                assert(!(await headerStorage.saveHeader(h)), `${ix} save header err`);
                let end = Date.now();
                console.log('delta is', end - start);
                assert(!(await headerStorage.changeBest(h)), `${ix} changeBest err`);
                best = h.number;
                let _hr = await headerStorage.getHeader(h.number);
                assert(!_hr.err, `${ix} getHeader err`);
                assert(_hr.header!.hash === h.hash, `${ix} saveHeader value err`);
            }
            let start = Date.now();
            let hr = await headerStorage.getHeader(best - 3);
            let end = Date.now();
            console.log('delta is', end - start);
            assert(!hr.err, `get ${best - 3} header err`);
            let fork = hr.header!;
            ph = fork;
            let fh = [];
            console.log(`fork from ${best - 3}`);
            for (let ix = 0; ix < 10; ++ix) {
                let h = new BlockHeader();
                h.setPreBlock(ph);
                h.timestamp = ++t;
                h.updateHash();
                ph = h;
                const _err = await headerStorage.saveHeader(h);
                assert(!_err, `${ix} saveHeader err`);
                fh.push(h);
            }
            let nh = new BlockHeader();
            nh.setPreBlock(ph);
            nh.timestamp = ++t;
            nh.updateHash();
            err = await headerStorage.saveHeader(nh);
            assert(!err, `saveHeader err`);
            err = await headerStorage.changeBest(nh);
            assert(!err, `changeBest err`);

            await headerStorage.commitConsistency();
            for (let h of fh) {
                const _hr = await headerStorage.getHeader(h.number);
                assert(!_hr.err, `getHeader err`);
                assert(_hr.header!.hash === h.hash, `getHeader value err`);
            }
        }
        __test().then(done);
    });
});
