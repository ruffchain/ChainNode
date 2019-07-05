import winston = require("winston");
import { TrimDataBase, IfBestItem, IfHeadersItem, IfMinersItem, IfTxviewItem, IfTxviewBlocksItem } from "./trimdb";
import { IFeedBack, ErrorCode } from "../../core";
import { runMethodOnDb } from "./basic";

async function checkDatabaseBest(logger: winston.LoggerInstance, path: string): Promise<IFeedBack> {
    let mData;
    async function checkBest(mDb: TrimDataBase): Promise<IFeedBack> {
        // check best table
        console.log('\n----------------------')
        let retrn = await mDb.getTable("best");
        if (retrn.err) {
            logger.error('Fetch best failed');
            return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: null };
        }
        let bestLst: IfBestItem[] = [];
        retrn.data.forEach((item: any) => {
            bestLst.push(item as IfBestItem)
        });

        const max = bestLst.reduce(function (prev, current) {
            return (prev.height > current.height) ? prev : current
        })

        console.log("Best tip is:", max);
        mData = max;
        return { err: ErrorCode.RESULT_OK, data: max }
    }
    let result = await runMethodOnDb({ dbname: "database", logger: logger, path: path, method: checkBest });
    if (result !== 0) { return { err: result, data: null }; }
    return { err: 0, data: mData };
}
async function checkDatabaseHeaders(logger: winston.LoggerInstance, path: string): Promise<IFeedBack> {
    async function funcMethod(mDb: TrimDataBase): Promise<IFeedBack> {
        // check headers table
        console.log('\n----------------------------------------------')
        logger.info('Read headers table:')
        let hret2 = await mDb.getTable("headers");
        if (hret2.err) {
            logger.error('query headers failed');
            return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: null };
        }
        // console.log(hret2.data);
        let headersLst: IfHeadersItem[] = [];
        hret2.data.forEach((item: any) => {
            headersLst.push(item as IfHeadersItem)
        });
        return { err: ErrorCode.RESULT_OK, data: 0 }
    }
    let result = await runMethodOnDb({ dbname: "database", logger: logger, path: path, method: funcMethod });
    return { err: 0, data: null };
}
async function checkDatabaseMiners(logger: winston.LoggerInstance, path: string): Promise<IFeedBack> {
    let mData;
    async function funcMethod(mDb: TrimDataBase): Promise<IFeedBack> {
        // check miners table
        console.log('\n----------------------------------------------')
        let hret3 = await mDb.getTable("Miners");
        if (hret3.err) {
            logger.error('query miners failed');
            return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: null };
        }

        logger.info("Read miners");
        let minersLst: IfMinersItem[] = [];
        hret3.data.forEach((item: any) => {
            minersLst.push(item as IfMinersItem)
        });
        // console.log(minersLst)
        const maxIrb = minersLst.reduce(function (prev, current) {
            return (prev.irbheight > current.irbheight) ? prev : current
        })
        console.log('Irb:', maxIrb)
        mData = maxIrb;
        return { err: ErrorCode.RESULT_OK, data: 0 }
    }
    let result = await runMethodOnDb({ dbname: "database", logger: logger, path: path, method: funcMethod });
    return { err: 0, data: mData };
}
async function checkDatabase(logger: winston.LoggerInstance, path: string): Promise<number> {
    await checkDatabaseBest(logger, path);
    await checkDatabaseHeaders(logger, path);
    await checkDatabaseMiners(logger, path);
    return 0;
}
async function checkTxviewBlocks(logger: winston.LoggerInstance, path: string): Promise<IFeedBack> {
    let mData;
    async function funcMethod(mDb: TrimDataBase): Promise<IFeedBack> {
        let retrn = await mDb.getTable("blocks");
        if (retrn.err) {
            logger.error('Fetch blocks failed');
            return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: null };
        }
        //console.log(retrn.data);
        let txLst: IfTxviewBlocksItem[] = [];
        retrn.data.forEach((item: any) => {
            txLst.push(item as IfTxviewBlocksItem)
        });
        const maxIrb = txLst.reduce(function (prev, current) {
            return (prev.number > current.number) ? prev : current
        })
        console.log('txview-blocks max block number:', maxIrb)
        mData = maxIrb;
        return { err: ErrorCode.RESULT_OK, data: 0 }
    }

    let result = await runMethodOnDb({ dbname: "txview", logger: logger, path: path, method: funcMethod });
    return { err: 0, data: mData };
}
async function checkTxviewTxview(logger: winston.LoggerInstance, path: string): Promise<IFeedBack> {
    let mData;
    async function funcMethod(mDb: TrimDataBase): Promise<IFeedBack> {
        console.log('\n----------------------')
        let retrn = await mDb.getTable("txview");
        if (retrn.err) {
            logger.error('Fetch blocks failed');
            return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: null };
        }
        // console.log(retrn.data);
        let txLst: IfTxviewItem[] = [];
        retrn.data.forEach((item: any) => {
            txLst.push(item as IfTxviewItem)
        });
        const maxIrb = txLst.reduce(function (prev, current) {
            return (prev.blockheight > current.blockheight) ? prev : current
        })
        console.log('txview-txview max block number:', maxIrb)
        mData = maxIrb;
        return { err: ErrorCode.RESULT_OK, data: 0 }
    }

    let result = await runMethodOnDb({ dbname: "txview", logger: logger, path: path, method: funcMethod });
    return { err: 0, data: mData };
}

async function checkTxview(logger: winston.LoggerInstance, path: string): Promise<number> {
    let retn = await checkTxviewBlocks(logger, path);
    if (retn.err !== 0) { return -1; }
    retn = await checkTxviewTxview(logger, path);
    if (retn.err !== 0) { return -1; }
    return 0;
}
export async function checkMain(logger: winston.LoggerInstance, path: string) {
    let retn = await checkDatabase(logger, path);
    if (retn === -1) { return -1; }

    retn = await checkTxview(logger, path);
    if (retn === -1) { return -1; }
}