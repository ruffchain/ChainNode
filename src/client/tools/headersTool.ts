import * as sqlite from 'sqlite';
import * as path from 'path';
import { BlockHeader } from '../../core/chain/block';
import { BufferReader } from '../../core/lib/reader';

async function getdb(data: string | sqlite.Database): Promise<[sqlite.Database, boolean]> {
    if (typeof data === 'string') {
        return [await sqlite.open(path.join(data, 'database')), true];
    } else {
        return [data, false];
    }
}

export async function getRawFromHash(dataDir: string | sqlite.Database, hash: string, headersType: new () => BlockHeader) {
    let [db, needClose] = await getdb(dataDir);

    let rawRet = await db.get('select raw from headers where hash=$hash', {$hash: hash});
    let header = new headersType();
    header.decode(new BufferReader(rawRet.raw));

    if (needClose) {
        await db.close();
    }

    return header;
}

export async function getMaxHeight(dataDir: string | sqlite.Database) {
    let [db, needClose] = await getdb(dataDir);

    let ret = await db.get('select max(height) AS height from best');

    if (needClose) {
        await db.close();
    }

    return ret.height;
}

export async function getHeadersHashFromHeight(dataDir: string | sqlite.Database, height: number) {
    let [db, needClose] = await getdb(dataDir);

    if (isNaN(height)) {
        height = await getMaxHeight(db);
    }

    let ret = await db.get('select hash from best where height=$height', {$height: height});

    if (needClose) {
        await db.close();
    }

    return ret.hash;
}

export async function getHeaderFromHeight(dataDir: string | sqlite.Database, height: number, headersType: new () => BlockHeader) {
    let [db, needClose] = await getdb(dataDir);

    let hash = await getHeadersHashFromHeight(db, height);

    let ret = await getRawFromHash(db, hash, headersType);

    if (needClose) {
        await db.close();
    }

    return ret;
}

export async function getBestHeadersHash(dataDir: string | sqlite.Database): Promise<Array<string>> {
    let [db, needClose] = await getdb(dataDir);

    let results = await db.all('select hash from best order by height asc');

    if (needClose) {
        await db.close();
    }

    return results.map((value, index) => {
        return value.hash;
    })
}

export async function getBestHeaders(dataDir: string | sqlite.Database, headersType: new () => BlockHeader): Promise<Array<BlockHeader>> {
    let [db, needClose] = await getdb(dataDir);

    let headers = await getBestHeadersHash(db);

    let results: Array<BlockHeader> = [];

    for (let index = 0; index < headers.length; index++) {
        let header = await getRawFromHash(db, headers[index], headersType);
        results.push(header);
    }

    if (needClose) {
        await db.close();
    }

    return results;
}

if (require.main === module) {
    if (!process.argv[2]) {
        console.log('Usage: node getBestHeaders.js <dataDir>');
    }
    
    async function main() {
        let headers: Array<string> = await getBestHeadersHash(process.argv[2]);
    
        headers.forEach((value, index) => {
            console.log(`${index}:${value}`)
        })
    }
    
    main();
}

