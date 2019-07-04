import winston = require("winston");
import { TrimDataBase, IfBestItem, IfHeadersItem, IfMinersItem } from "./trimdb";
import { IFeedBack } from "../../core";

// async function readTable(logger: winston.LoggerInstance, db: TrimDataBase, tableName: string): Promise<IFeedBack> {
//     let result = await db.open();
//     if (result.err) {
//         logger.error('Open database failed');
//         return -1;
//     }
// }

export async function checkMain(logger: winston.LoggerInstance, path: string) {
    let mDb = new TrimDataBase(logger, {
        path: path,
        name: 'database'
    });

    let result = await mDb.open();
    if (result.err) {
        logger.error('Open database failed');
        return -1;
    }
    logger.info('database opened');

    // check best table
    let sql = "select * from best;"
    let hret = await mDb.getAllRecords(sql);
    if (hret.err) {
        logger.error('query best failed');
        return -1;
    }
    let bestLst: IfBestItem[] = [];
    hret.data.forEach((item: any) => {
        bestLst.push(item as IfBestItem)
    });

    const max = bestLst.reduce(function (prev, current) {
        return (prev.height > current.height) ? prev : current
    })

    console.log("Best tip is:", max);


    // check headers table
    sql = "select * from headers;"
    let hret2 = await mDb.getAllRecords(sql);
    if (hret2.err) {
        logger.error('query headers failed');
        return -1;
    }
    // console.log(hret2.data);
    let headersLst: IfHeadersItem[] = [];
    hret2.data.forEach((item: any) => {
        headersLst.push(item as IfHeadersItem)
    });
    console.log(headersLst)

    // check miners table
    sql = "select * from miners;"
    let hret3 = await mDb.getAllRecords(sql);
    if (hret3.err) {
        logger.error('query miners failed');
        return -1;
    }
    // console.log(hret3.data);

    let minersLst: IfMinersItem[] = [];
    hret3.data.forEach((item: any) => {
        minersLst.push(item as IfMinersItem)
    });
    console.log(minersLst)

    result = await mDb.close();


    return 0;
}