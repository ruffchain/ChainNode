import winston = require("winston");
import { TrimDataBase, IfBestItem, IfHeadersItem, IfMinersItem, IfTxviewBlocksItem, IfTxviewItem } from "./trimdb";
import { IFeedBack } from "../../core";


async function checkDatabase(logger: winston.LoggerInstance, path: string): Promise<number> {
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
    console.log('\n----------------------')
    let retrn = await mDb.getTable("best");
    if (retrn.err) {
        logger.error('Fetch best failed');
        await mDb.close();
        return -1;
    }
    let bestLst: IfBestItem[] = [];
    retrn.data.forEach((item: any) => {
        bestLst.push(item as IfBestItem)
    });

    const max = bestLst.reduce(function (prev, current) {
        return (prev.height > current.height) ? prev : current
    })

    console.log("Best tip is:", max);


    // check headers table
    console.log('\n----------------------------------------------')
    logger.info('Read headers table:')
    let hret2 = await mDb.getTable("headers");
    if (hret2.err) {
        logger.error('query headers failed');
        await mDb.close();
        return -1;
    }
    // console.log(hret2.data);
    let headersLst: IfHeadersItem[] = [];
    hret2.data.forEach((item: any) => {
        headersLst.push(item as IfHeadersItem)
    });
    // console.log(headersLst)

    // check miners table
    console.log('\n----------------------------------------------')
    let hret3 = await mDb.getTable("Miners");
    if (hret3.err) {
        logger.error('query miners failed');
        await mDb.close();
        return -1;
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

    result = await mDb.close();

    return 0;
}
async function checkTxview(logger: winston.LoggerInstance, path: string): Promise<number> {
    let mDb = new TrimDataBase(logger, {
        path: path,
        name: 'txview'
    });

    let result = await mDb.open();
    if (result.err) {
        logger.error('Open txview failed');
        return -1;
    }
    logger.info('txview opened');

    console.log('\n----------------------')
    let retrn = await mDb.getTable("blocks");
    if (retrn.err) {
        logger.error('Fetch blocks failed');
        await mDb.close();
        return -1;
    }
    // console.log(retrn.data);
    let blocksLst: IfTxviewBlocksItem[] = [];
    retrn.data.forEach((item: any) => {
        blocksLst.push(item as IfTxviewBlocksItem)
    });
    const max = blocksLst.reduce(function (prev, current) {
        return (prev.number > current.number) ? prev : current
    })
    console.log('max:', max)


    console.log('\n----------------------')
    console.log('txview:')
    let retrn2 = await mDb.getTable("txview");
    if (retrn2.err) {
        logger.error('Fetch blocks failed');
        await mDb.close();
        return -1;
    }
    console.log(retrn2.data);
    let txviewLst: IfTxviewItem[] = [];
    retrn2.data.forEach((item: any) => {
        txviewLst.push(item as IfTxviewItem)
    });
    const max2 = txviewLst.reduce(function (prev, current) {
        return (prev.blockheight > current.blockheight) ? prev : current
    })
    console.log('max2:', max2)

    return 0;
}
export async function checkMain(logger: winston.LoggerInstance, path: string) {
    // let retn = await checkDatabase(logger, path);
    // if (retn === -1) { return -1; }
    let retn2 = await checkTxview(logger, path);
    if (retn2 === -1) { return -1; }
}