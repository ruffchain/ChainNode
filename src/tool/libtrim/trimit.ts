/*
    To trim the database to a state in block:height

*/

import winston = require("winston");
import { checkDatabaseBest } from "./check";
import { TrimDataBase, IfBestItem, IfHeadersItem } from "./trimdb";
import { runMethodOnDb, existsFile } from "./basic";
import { IFeedBack, ErrorCode } from "../../core";
// import * as path from 'path';
import * as fs from 'fs';
const util = require('util');
const exec = util.promisify(require('child_process').exec);
import * as pathlib from 'path';

const LOG_PATH = "storage/log/"
const DUMP_PATH = "storage/dump/"
const SAFE_GAP = 5;
const RESTORE_FILE_PATH = './data/dposbft/restore';
const BLOCK_DIR = 'Block/';

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

export async function trimMain(height: number, logger: winston.LoggerInstance, path: string, cfgOption: any) {
    let result = await checkHeightValid(height, logger, path);
    if (result !== 0) { return -1; }

    let bCheckTxView = cfgOption.txServer;
    let bIgnoreClean = cfgOption.ignoreClean;

    let trimItemLst: IfBestItem[] = [];
    async function fetchTrimItemsLst(mDb: TrimDataBase): Promise<IFeedBack> {
        console.log('\n--------------------------------')
        let retrn = await mDb.getBySQL(`select * from best where height > ${height}  order by height asc;`);
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

    if (trimItemLst.length === 0) {
        console.log('No need to trim, trimItemLst is empty.');
        return 0;
    }

    result = await trimDatabase(trimItemLst, logger, path);
    if (result !== 0) {
        logger.error('trim database failed');
        return -1;
    }



    result = await trimStorageLog(trimItemLst, logger, path);
    if (result !== 0) { logger.error('trim storage/log failed'); return -1; }

    result = await trimStorageDump(trimItemLst, logger, path);
    if (result !== 0) { logger.error('trim storage/dump failed'); return -1; }

    result = await generateStorageDump(height, logger, path);
    if (result !== 0) {
        logger.error('generate storage/dump 1 NOK'); return -1;
    }

    result = await generateStorageDump(height - 1, logger, path);
    if (result !== 0) {
        logger.error('generate storage/dump 2 NOK'); return -1;
    }

    result = await generateStorageDump(height - 2, logger, path);
    if (result !== 0) {
        logger.error('generate storage/dump 3 NOK'); return -1;
    }

    result = await generateStorageDump(height - 3, logger, path);
    if (result !== 0) {
        logger.error('generate storage/dump 4 NOK'); return -1;
    }

    result = await trimBlockDir(trimItemLst, logger, path);
    if (result !== 0) { logger.error('trim Block/ failed'); return -1; }

    // delete from best table
    console.log('\nClear best table');
    let hret = await trimDatabaseBest(height, logger, path);
    if (hret !== 0) { return -1; }

    if (bIgnoreClean === false || bIgnoreClean == null) {
        // delete redundant rows from headers which not exists in best table
        console.log('\nClear headers table according to best table');
        hret = await trimHeadersFromBest(logger, path);
        if (hret !== 0) { return -1; }

        // remove redundant block files from Block/ which not exists in best table
        console.log('\nClear Block/ files 0 size');
        hret = await clearEmptyBlocks(logger, path);
        if (hret !== 0) { return -1; }
    }


    // rm files under tmp/
    console.log('Delete files under tmp/')
    let files = fs.readdirSync(pathlib.join(path, "tmp"))
    files.forEach((v, i) => {
        fs.unlinkSync(pathlib.join(path, "tmp", v))
    })

    if (bCheckTxView) {
        console.log('check ', pathlib.join(path, "txview"))
        if (existsFile(pathlib.join(path, "txview")) === false) {
            logger.warn('No txview file found, so step out')
            return 0;
        }
        result = await trimTxview(trimItemLst, logger, path);
        if (result !== 0) {
            logger.error('trim txview failed');
            return -1;
        }
    }

    console.log('===================');
    console.log('    End of Trim    ')
    console.log('===================');
}
///////////////////////////////////////////////////////////////////////////////
/**
 * To clear Headers table in database
 * @param height 
 * @param logger 
 * @param path 
 */
async function trimHeadersFromBest(logger: winston.LoggerInstance, path: string): Promise<number> {
    async function funcMethod(mDb: TrimDataBase): Promise<IFeedBack> {
        let retn = await mDb.runBySQL(`delete from headers where headers.hash not in (select hash from best)`);
        if (retn.err) {
            logger.error('delete from headers fail');
            return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: null }
        }
        return { err: ErrorCode.RESULT_OK, data: null };
    }
    let result = await runMethodOnDb({ dbname: "database", logger: logger, path: path, method: funcMethod });

    if (result !== 0) { return -1; }
    return 0;
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
    let numBatch = 50;
    async function funcMethod(mDb: TrimDataBase): Promise<IFeedBack> {
        // itemLst.forEach(async (item: IfBestItem) => {
        //     let hash = item.hash;

        //     let retn = await mDb.runBySQL(`delete from headers where hash ="${hash}";`);
        //     if (retn.err) {
        //         flag = ErrorCode.RESULT_DB_TABLE_FAILED;
        //         return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: null };
        //     } else {
        //         console.log(`[${item.height}] ` + 'header deleted :', hash);
        //     }
        // });
        for (let i = 0; i < itemLst.length; i) {
            let start = i;
            let end = (i + numBatch) > itemLst.length ? itemLst.length : (i + numBatch);
            logger.debug('delete ' + start + ' to ' + end);
            await mDb.runBySQL('BEGIN;');

            for (let j = start; j < end; j++) {
                let hash = itemLst[j].hash;

                await mDb.runBySQL(`delete from headers where hash ="${hash}";`);
            }

            let hret = await mDb.runBySQL('COMMIT;')

            if (hret.err) {
                await mDb.runBySQL('ROLLBACK;');
                flag = ErrorCode.RESULT_DB_TABLE_FAILED;
                break;
            }

            i = i + numBatch;
        }
        return { err: flag, data: null };
    }
    let result = await runMethodOnDb({ dbname: "database", logger: logger, path: path, method: funcMethod });

    if (result !== 0) { return -1; }
    return 0;
}
async function trimDatabaseMiners(itemLst: IfBestItem[], logger: winston.LoggerInstance, path: string): Promise<number> {
    async function funcMethod(mDb: TrimDataBase): Promise<IFeedBack> {
        let flag = 0;
        // itemLst.forEach(async (item: IfBestItem) => {
        //     let height = item.height;

        //     let retn = await mDb.runBySQL(`delete from miners where irbheight ="${height}";`);
        //     if (retn.err) {
        //         flag = ErrorCode.RESULT_DB_TABLE_FAILED;
        //         return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: null };
        //     } else {
        //         console.log(`[${item.height}] ` + 'header deleted :', height);
        //     }
        // });

        let min = itemLst[0];
        let retn = await mDb.runBySQL(`delete from miners where irbheight >="${min.height}";`);
        if (retn.err) {
            flag = ErrorCode.RESULT_DB_TABLE_FAILED;
        } else {
            console.log(`[${min.height}] ` + 'header deleted :', min);
        }

        return { err: flag, data: null };
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

    console.log('\nTo trim database-miners:');
    result = await trimDatabaseMiners(itemLst, logger, path);
    if (result !== 0) { return -1; }

    console.log('\nTo trim database-best:', min.height);
    // delete best at the last step
    // let result = await trimDatabaseBest(min.height, logger, path);
    // if (result !== 0) { return -1; }

    return 0;
}

async function trimTxviewBlocks(itemLst: IfBestItem[], logger: winston.LoggerInstance, path: string): Promise<number> {
    async function funcMethod(mDb: TrimDataBase): Promise<IFeedBack> {
        let flag = 0;
        // itemLst.forEach(async (item: IfBestItem) => {
        //     let height = item.height;

        //     let retn = await mDb.runBySQL(`delete from blocks where number ="${height}";`);
        //     if (retn.err) {
        //         flag = ErrorCode.RESULT_DB_TABLE_FAILED;
        //         return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: null };
        //     } else {
        //         console.log(`[${item.height}] ` + 'block deleted :', height);
        //     }
        // });
        let min = itemLst[0];

        let retn = await mDb.runBySQL(`delete from blocks where number >="${min.height}";`);
        if (retn.err) {
            flag = ErrorCode.RESULT_DB_TABLE_FAILED;
        } else {
            console.log(`[${min.height}] ` + 'block deleted :', min);
        }

        return { err: flag, data: null };
    }
    let result = await runMethodOnDb({ dbname: "txview", logger: logger, path: path, method: funcMethod });

    if (result !== 0) { return -1; }
    return 0;
}
async function trimTxviewTxview(itemLst: IfBestItem[], logger: winston.LoggerInstance, path: string): Promise<number> {
    async function funcMethod(mDb: TrimDataBase): Promise<IFeedBack> {
        let flag = 0;
        // itemLst.forEach(async (item: IfBestItem) => {
        //     let height = item.height;

        //     let retn = await mDb.runBySQL(`delete from txview where blockheight ="${height}";`);
        //     if (retn.err) {
        //         flag = ErrorCode.RESULT_DB_TABLE_FAILED;
        //         return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: null };
        //     } else {
        //         console.log(`[${item.height}] ` + 'block deleted :', height);
        //     }
        // });
        let min = itemLst[0]
        let retn = await mDb.runBySQL(`delete from txview where blockheight >="${min.height}";`);
        if (retn.err) {
            flag = ErrorCode.RESULT_DB_TABLE_FAILED;
        } else {
            console.log(`[${min.height}] ` + 'block deleted :', min);
        }

        return { err: flag, data: null };
    }
    let result = await runMethodOnDb({ dbname: "txview", logger: logger, path: path, method: funcMethod });

    if (result !== 0) { return -1; }
    return 0;
}
async function trimTxview(itemLst: IfBestItem[], logger: winston.LoggerInstance, path: string): Promise<number> {

    console.log('\nTo trim txview-blocks:');
    let result = await trimTxviewBlocks(itemLst, logger, path);
    if (result !== 0) { return -1; }

    console.log('\nTo trim txview-txview:');
    result = await trimTxviewTxview(itemLst, logger, path);
    if (result !== 0) { return -1; }
    return 0;
}
async function trimStorageDump(itemLst: IfBestItem[], logger: winston.LoggerInstance, path1: string): Promise<number> {
    console.log('\nClear database under dump/');
    const dumpPath = pathlib.join(path1, DUMP_PATH);

    console.log('\nDelete databases')
    itemLst.forEach((item: IfBestItem) => {
        let filename = pathlib.join(dumpPath, item.hash);
        console.log('Delete dump ' + item.height + ' : ' + filename);
        if (fs.existsSync(filename)) {
            try {
                fs.unlinkSync(filename);
            } catch (e) {
                console.log('Failed delete')
            }
        } else {
            logger.debug('Not exist')
        }
    });

    return 0;
}
async function trimBlockDir(itemLst: IfBestItem[], logger: winston.LoggerInstance, path1: string): Promise<number> {
    console.log('\nClear Block/');

    itemLst.forEach(async (item: IfBestItem) => {
        let blockPath = pathlib.join(path1, BLOCK_DIR);
        let FILE = pathlib.join(blockPath, item.hash);
        if (fs.existsSync(FILE)) {
            // Do something
            await fs.unlinkSync(FILE);
            console.log('Delete ', FILE);
        }
        else {
            logger.debug('Not exist')
        }
    });
    return 0;
}
//  const { stdout, stderr } = await exec(
async function clearEmptyBlocks(logger: winston.LoggerInstance, path1: string): Promise<number> {
    logger.debug('Clear empty blocks from Blocks/');
    let mPath = pathlib.join(path1, BLOCK_DIR);
    // let result = await exec(`find ${mPath} -name "*" -type f -size 0c`);
    let result = await exec(`find ${mPath} -name "*" -type f -size 0c | xargs -n 1 rm -f`);
    logger.debug('Clear Done')
    return 0;
}
async function trimBlocksFromBest(logger: winston.LoggerInstance, path1: string): Promise<number> {
    console.log('\nClear redundant blocks from Block/')
    logger.debug('Clear redundant blocks from Block/');
    let files = fs.readdirSync(pathlib.join(path1, BLOCK_DIR))
    if (!files) {
        console.log('Get files list failed', path1)
        return -1
    }
    console.log('blocks num:', files.length)
    // read from database best table
    async function deleteBlockLst(mDb: TrimDataBase): Promise<IFeedBack> {
        console.log('\n--------------------------------')
        console.log('deleteBlockLst:')
        for (let i = 0; i < files.length; i++) {
            let value = files[i]

            // console.log('hash:', value)
            let retrn = await mDb.getBySQL(`select height from best where hash="${value}";`)
            if (!retrn.data) {
                fs.unlinkSync(pathlib.join(path1, BLOCK_DIR, value))
                console.log(value, 'Deleted')
            }
        }
        // let trimItemLst = retrn.data;
        return { err: ErrorCode.RESULT_OK, data: {} };
    }
    let result = await runMethodOnDb({ dbname: "database", logger: logger, path: path1, method: deleteBlockLst });
    if (result !== 0) {
        console.log('run failed trimBlocksFromBest')
        return -1
    }
    console.log('task done!')
    return 0;
}
async function trimStorageLog(itemLst: IfBestItem[], logger: winston.LoggerInstance, path1: string): Promise<number> {
    console.log('\nClear redo.log');
    const logPath = pathlib.join(path1, LOG_PATH);

    itemLst.forEach((item: IfBestItem) => {
        let filename = pathlib.join(logPath, item.hash + '.redo');
        console.log('Delete ' + item.height + ' : ' + filename);
        if (fs.existsSync(filename)) {
            try {
                fs.unlinkSync(filename);
            } catch (e) {
                console.log('Failed delete.', e)
            }
        } else {
            logger.debug('Not exist')
        }
    });

    return 0;
}
async function generateStorageDump(height: number, logger: winston.LoggerInstance, path1: string): Promise<number> {
    console.log('\nGenerate database under dump/');

    let trimHeightItem: IfBestItem = Object.create(null);
    async function fetchTrimItem(mDb: TrimDataBase): Promise<IFeedBack> {
        console.log('\n--------------------------------')
        let retrn = await mDb.getBySQL(`select * from best where height = ${height}`);
        if (retrn.err) {
            logger.error('query best for height failed');
            return { err: ErrorCode.RESULT_DB_RECORD_EMPTY, data: [] }
        }
        trimHeightItem = retrn.data[0];
        return { err: ErrorCode.RESULT_OK, data: retrn.data };
    }
    let result = await runMethodOnDb({ dbname: "database", logger: logger, path: path1, method: fetchTrimItem });

    if (result !== 0) { return -1; }

    console.log('height item:');
    console.log(trimHeightItem);
    const dumpPath = pathlib.join(path1, DUMP_PATH);

    // generate database and copy it to storage/dump/
    try {
        if (fs.existsSync(RESTORE_FILE_PATH)) {
            // Do something
            await fs.unlinkSync(RESTORE_FILE_PATH);
        }

        const { stdout, stderr } = await exec(`node ./dist/blockchain-sdk/src/tool/restore_storage.js  restore --dataDir ${path1} --height ${height} --output ./data/dposbft/`);
    } catch (e) {
        console.log('Not right')
        console.log(e);

    }
    if (!fs.existsSync(RESTORE_FILE_PATH)) {
        console.log("File not found")
        return -1;
    }
    let stats = fs.statSync(RESTORE_FILE_PATH)
    let fileSizeInBytes = stats["size"]
    console.log('resotre file created, ' + fileSizeInBytes)
    if (fileSizeInBytes < 10) {
        logger.error('Restore file generation failed!');
        return -1;
    }
    console.log('Copy restore to dump/ as: ', trimHeightItem.hash);
    let srcFile = RESTORE_FILE_PATH;
    let dstFile = pathlib.join(path1, DUMP_PATH + trimHeightItem.hash);
    await fs.copyFileSync(srcFile, dstFile);

    return 0;
}