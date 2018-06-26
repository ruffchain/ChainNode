import { getHeaderFromHeight } from "./headersTool";
import * as sqlite from 'sqlite';
import * as path from 'path';
import { BlockHeader } from "../../core/chain/block";

async function getAmount(dataDir: string, address: string|undefined, blockHeight: number) {
    console.log(`getting amounts...`)
    let header = await getHeaderFromHeight(dataDir, blockHeight, BlockHeader);

    let db = await sqlite.open(path.join(dataDir, 'storage', 'snapshot', header.storageHash));

    let amounts = new Map();

    if (address) {
        let ret = await db.get('select value from chain_info where name=$name', {$name: address});
        amounts.set(address, JSON.parse(ret.value));
    } else {
        let ret = await db.all('select name, value from chain_info');
        ret.forEach((value) => {
            amounts.set(value.name, JSON.parse(value.value));
        })
    }

    await db.close();

    amounts.forEach((v, k) => {
        console.log(`${k} : ${v}`);
    })
    
}

if (require.main === module) {
    if (!process.argv[2]) {
        console.log('Usage: node getAmount.js <dataDir> {address} {blockHeight}');
        process.exit(1);
    }
    
    async function main() {
        await getAmount(process.argv[2], process.argv[3], parseInt(process.argv[4]));
        console.log('finish.')
    }
    
    main();
}