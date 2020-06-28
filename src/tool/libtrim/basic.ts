import { IFeedBack } from "../../core";
import { TrimDataBase } from "./trimdb";
import winston = require("winston");
import * as fs from 'fs'

export async function runMethodOnDb({ dbname, logger, path, method }: { dbname: string; logger: winston.LoggerInstance; path: string; method: (mdb: TrimDataBase) => Promise<IFeedBack> }): Promise<number> {
    let mDb = new TrimDataBase(logger, {
        path: path,
        name: dbname
    });

    let result = await mDb.open();
    if (result.err) {
        logger.error('Open database failed' + `${dbname}`);
        return -1;
    }
    logger.info('database opened');
    console.log('\n----------------------')
    let retrn = await method(mDb);
    await mDb.close();
    logger.info('database closed');
    if (retrn.err) {
        logger.error('Fetch table failed' + `${dbname}`);
        return -1;
    }
    return 0;
}

export function existsFile(filename: string): Boolean {
    let out = fs.existsSync(filename);
    console.log("existsFile:", out)
    return out
}