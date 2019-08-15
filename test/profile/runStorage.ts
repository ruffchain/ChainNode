import { SqliteStorage } from '../../src/core/storage_sqlite/storage';
import { initLogger } from '../../src/core';
import {BigNumber} from 'bignumber.js';
import * as fs from 'fs-extra';

const logger = initLogger({loggerOptions: {console: true}});
const count = 1000;
async function run() {
    try {
        fs.removeSync('teststorage');
    } catch (error) {

    }

    let begin = process.uptime() * 1000;
    let storage = new SqliteStorage({filePath: 'teststorage', logger });
    await storage.init(false, false);
    let db = (await storage.createDatabase('testdb')).value!;
    let kv = (await db.createKeyValue('testkv')).kv!;

    await kv.set('main', new BigNumber(10000000));
    console.log(`begin to run ${count} times...`);

    for (let index = 0; index < count; index++) {
        let transcation = (await storage.beginTransaction()).value!;
        let mainMoney = (await kv.get('main')).value!;
        await kv.set('main', mainMoney.minus(1));
        await kv.set(`sub${index}`, 1);
        await transcation.commit();
    }

    let end = process.uptime() * 1000;
    console.log(`run ${count} times, spend ${end - begin} millseconds, average ${(end - begin) / count} millseconds`);
}

run();
