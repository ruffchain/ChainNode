/*
    To trim the database to a state in block:height

*/

import winston = require("winston");
import { checkDatabaseBest } from "./check";
import { TrimDataBase, IfBestItem, IfHeadersItem } from "./trimdb";
import { runMethodOnDb } from "./basic";
import { IFeedBack, ErrorCode } from "../../core";

const LOG_PATH = "storage/log"
const DUMP_PATH = "storage/dump"
const SAFE_GAP = 5;

async function checkHeightValid(height: number, logger: winston.LoggerInstance, path: string): Promise<number> {
    let retn = await checkDatabaseBest(logger, path);
    if (retn.err !== 0) {
        logger.error('get best height failed')
        return -1;
    }
    if ((height + SAFE_GAP) > retn.data) {
        logger.error('best:' + retn.data + ' trim-height:' + height + ', Not satisfy safe gap:' + SAFE_GAP)
        return -1;
    }
    return 0;
}


export async function trimMain(height: number, logger: winston.LoggerInstance, path: string) {
    let result = await checkHeightValid(height, logger, path);
    if (result !== 0) { return -1; }

    let trimItemLst: IfBestItem[] = [];
    async function fetchTrimItemsLst(mDb: TrimDataBase): Promise<IFeedBack> {
        console.log('\n--------------------------------')
        let retrn = await mDb.getBySQL(`select * from best where height > ${height}`);
        if (retrn.err) {
            logger.error('query best for height failed');
            return { err: ErrorCode.RESULT_DB_RECORD_EMPTY, data: [] }
        }
        trimItemLst = retrn.data;
        return { err: ErrorCode.RESULT_OK, data: retrn.data };
    }
    result = await runMethodOnDb({ dbname: "database", logger: logger, path: path, method: fetchTrimItemsLst });

    if (result !== 0) { return -1; }

    console.log('\nTo trim below ' + trimItemLst.length + ' blocks:')
    console.log(trimItemLst);

    result = await trimDatabase(trimItemLst, logger, path);
    if (result !== 0) {
        logger.error('trim database failed');
        return -1;
    }

    result = await trimTxview(trimItemLst, logger, path);
    if (result !== 0) {
        logger.error('trim txview failed');
        return -1;
    }

    result = await trimStorageDump(trimItemLst, logger, path);
    if (result !== 0) { logger.error('trim storage/dump failed'); return -1; }

    result = await trimStorageLog(trimItemLst, logger, path);
    if (result !== 0) { logger.error('trim storage/log failed'); return -1; }
}
async function trimDatabaseBest(height: number, logger: winston.LoggerInstance, path: string): Promise<number> {
    async function funcMethod(mDb: TrimDataBase): Promise<IFeedBack> {
        let retn = await mDb.runBySQL(`delete from best where height > ${height}`);
        if (retn.err) {
            logger.error('delete best fail');
            return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: null }
        }
        return { err: ErrorCode.RESULT_OK, data: null };
    }
    let result = await runMethodOnDb({ dbname: "database", logger: logger, path: path, method: funcMethod });

    if (result !== 0) { return -1; }
    return 0;
}
async function trimDatabaseHeaders(itemLst: IfBestItem[], logger: winston.LoggerInstance, path: string): Promise<number> {
    let flag = 0;
    async function funcMethod(mDb: TrimDataBase): Promise<IFeedBack> {
        itemLst.forEach(async (item: IfBestItem) => {
            let hash = item.hash;

            let retn = await mDb.runBySQL(`delete from headers where hash ="${hash}";`);
            if (retn.err) {
                flag = ErrorCode.RESULT_DB_TABLE_FAILED;
                return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: null };
            } else {
                console.log(`[${item.height}] ` + 'header deleted :', hash);
            }
        });

        return { err: flag, data: null };
    }
    let result = await runMethodOnDb({ dbname: "database", logger: logger, path: path, method: funcMethod });

    if (result !== 0) { return -1; }
    return 0;
}
async function trimDatabaseMiners(itemLst: IfBestItem[], logger: winston.LoggerInstance, path: string): Promise<number> {
    async function funcMethod(mDb: TrimDataBase): Promise<IFeedBack> {

        return { err: ErrorCode.RESULT_OK, data: null };
    }
    let result = await runMethodOnDb({ dbname: "database", logger: logger, path: path, method: funcMethod });

    if (result !== 0) { return -1; }
    return 0;
}
async function trimDatabase(itemLst: IfBestItem[], logger: winston.LoggerInstance, path: string): Promise<number> {
    let min = itemLst.reduce((prev, curr) => {
        return (prev.height < curr.height) ? prev : curr;
    });

    console.log('\nTo trim database-headers:');
    let result = await trimDatabaseHeaders(itemLst, logger, path);
    if (result !== 0) { return -1; }

    console.log('\nTo trim database-best:', min.height);
    // delete best at the last step
    // let result = await trimDatabaseBest(min.height, logger, path);
    // if (result !== 0) { return -1; }

    return 0;
}
async function trimTxview(itemLst: IfBestItem[], logger: winston.LoggerInstance, path: string): Promise<number> {


    return 0;
}
async function trimStorageDump(itemLst: IfBestItem[], logger: winston.LoggerInstance, path: string): Promise<number> {


    return 0;
}
async function trimStorageLog(itemLst: IfBestItem[], logger: winston.LoggerInstance, path: string): Promise<number> {


    return 0;
}