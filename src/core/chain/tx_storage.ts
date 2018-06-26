import * as sqlite from 'sqlite';
import {ErrorCode} from '../error_code';
import { BlockHeader,Block } from './block';
import { LoggerInstance } from 'winston';
import {BlockStorage} from './block_storage';

const initSql = 'CREATE TABLE IF NOT EXISTS "txview"("txhash" CHAR(64) PRIMARY KEY NOT NULL UNIQUE, "blockheight" INTEGER NOT NULL, "blockhash" CHAR(64) NOT NULL);';

export class TxStorage {
    private m_db: sqlite.Database;
    private m_logger: LoggerInstance;
    private m_blockStorage: BlockStorage;

    constructor(options: {
        logger: LoggerInstance;
        db: sqlite.Database;
        blockstorage: BlockStorage;
    }) {
        this.m_db = options.db;
        this.m_logger = options.logger;
        this.m_blockStorage = options.blockstorage;
    }

    public async init(): Promise<ErrorCode> {
        try {
            await this.m_db.run(initSql);
        } catch (e) {
            this.m_logger.error(e);
            return ErrorCode.RESULT_EXCEPTION;
        }

        return ErrorCode.RESULT_OK;
    }

    public async add(blockhash: string): Promise<ErrorCode> {
        let block: Block|null = await this.m_blockStorage.get(blockhash);
        if (!block) {
            return ErrorCode.RESULT_NOT_FOUND;
        } 

        try {
            for (let tx of block.content.transactions) { 
                await this.m_db.run(`insert into txview (txhash, blockheight, blockhash) values ("${tx.hash}", ${block.number}, "${block.hash}")`);
            }    
        } catch (e) {
            this.m_logger.error(e);
            return ErrorCode.RESULT_EXCEPTION;
        }

        return ErrorCode.RESULT_OK;
    }

    public async remove(nBlockHeight: number): Promise<ErrorCode> {
        try {
            await this.m_db.run(`delete from txview where blockheight > ${nBlockHeight}`);
        } catch (e) {
            this.m_logger.error(e);
            return ErrorCode.RESULT_EXCEPTION;
        }

        return ErrorCode.RESULT_OK;
    }

    public async get(txHash: string): Promise<{err: ErrorCode, blockhash?: string}> {
        try {
            let result = await this.m_db.get(`select blockhash from txview where txhash="${txHash}"`);
            if (!result || result.blockhash === undefined) { 
                return {err: ErrorCode.RESULT_NOT_FOUND};
            }

            return {err: ErrorCode.RESULT_OK, blockhash: result.blockhash};
        } catch (e) {
            this.m_logger.error(e);
            return {err: ErrorCode.RESULT_EXCEPTION };
        }
    }
}