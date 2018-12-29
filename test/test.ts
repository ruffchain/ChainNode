import * as digest from '../src/core/lib/digest';
import { SqliteStorage } from '../src/core/storage_sqlite/storage';
import { initLogger } from '../src/core';

async function getHash(path: string) {
    let ss = new SqliteStorage({filePath: path, logger: initLogger({loggerOptions: {console: true}})});
    let ret = await ss.messageDigest();
    return ret.value;
}

async function test() {
    console.log(await getHash('data/miner1/temp.storage'));
    console.log(await getHash('data/miner1/temp.storage.1'));
    console.log(await getHash('data/miner1/storage/dump/1238f72ea9b793b3ddc9cd5fba802081cb24a09bb194d940383f8d0c238df577'));
}

test();
