import * as sqlite from 'sqlite';
import * as path from 'path';
import * as assert from 'assert';
import {getBestHeadersHash} from './headersTool'
const Combinatorics = require('js-combinatorics')

async function compareHeaders(dir1: string, dir2: string) {
    let headers1 = await getBestHeadersHash(dir1);
    let headers2 = await getBestHeadersHash(dir2);

    assert(headers1.length === headers2.length, `${dir1} chain length ${headers1.length} not equal to ${dir2} chain length ${headers1.length}`);

    for (let index = 0; index < headers1.length; index++) {
        console.log(`check ${dir1} ${index}: ${headers1[index]} --- ${dir2} ${index}: ${headers2[index]}`);
        assert(headers1[index] === headers2[index], `${dir1} header ${index}: ${headers1[index]} mismatch ${dir2} header ${index}: ${headers2[index]}`)        
    }

    console.log(`check ${dir1} --- ${dir2} data success`)
}

async function main() {
    if (process.argv.length < 4) {
        console.log('Usage: node checkMinerStorage.js <dataDir1> <dataDir2> ...');
    }
    let dirs = process.argv.slice(2);
    let cmb = Combinatorics.combination(dirs, 2); 
    let a: any = undefined;
    while (a=cmb.next()) {
        compareHeaders(a[0], a[1])
    }
}

main()

