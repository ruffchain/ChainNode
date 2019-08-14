import {ErrorCode, LoggerInstance, Chain, Transaction, Block} from '../../core';

import {IElement, ElementOptions} from '../context/element';
import * as sqlite from 'better-sqlite3';
const assert = require('assert');

let initSql: string[] = [
    'CREATE TABLE IF NOT EXISTS "txview"("txhash" CHAR(64) PRIMARY KEY NOT NULL UNIQUE, "address" CHAR(64) NOT NULL, "blockheight" INTEGER NOT NULL, "blockhash" CHAR(64) NOT NULL);',
    'CREATE INDEX IF NOT EXISTS "index_blockheight" on "txview" ("blockheight")',
    'CREATE INDEX IF NOT EXISTS "index_address" on "txview" ("address")'
];

export class TxStorage implements IElement {
    private m_db?: sqlite.Database;
    private m_logger: LoggerInstance;
    private m_chain: Chain;

    constructor(options: ElementOptions) {
        this.m_chain = options.chain;
        this.m_logger = this.m_chain.logger;
    }

    public static ElementName: string = 'txview';

    public async init(db: sqlite.Database): Promise<ErrorCode> {
        this.m_db = db;

        try {
            this.m_db!.pragma('journal_mode = WAL');
            this.m_db!.pragma('synchronous = NORMAL');
            initSql.forEach(item => {
                this.m_db!.prepare(item).run();
            });
            //await this.m_db!.prepare(initSql).run()
        } catch (e) {
            this.m_logger.error(`txstorage init failed e=${e}`);
            return ErrorCode.RESULT_EXCEPTION;
        }

        return ErrorCode.RESULT_OK;
    }

    public async addBlock(block: Block): Promise<ErrorCode> {
        try {
            for (let tx of block.content.transactions) {
                this.m_db!
                    .prepare(`insert into txview (txhash, address, blockheight, blockhash) values ("${tx.hash}","${tx.address}", ${block.number}, "${block.hash}")`)
                    .run();
            }
        } catch (e) {
            this.m_logger.error(`txstorage, add exception,error=${e},blockhash=${block.hash}`);
            return ErrorCode.RESULT_EXCEPTION;
        }

        return ErrorCode.RESULT_OK;
    }

    public async revertToBlock(num: number): Promise<ErrorCode> {
        try {
            this.m_db!.prepare(`delete from txview where blockheight > ${num}`).run();
        } catch (e) {
            this.m_logger.error(`txstorage,remove exception,error=${e},height=${num}`);
            return ErrorCode.RESULT_EXCEPTION;
        }

        return ErrorCode.RESULT_OK;
    }

    public async get(txHash: string): Promise<{err: ErrorCode, blockhash?: string}> {
        try {
            let result = this.m_db!.prepare(`select blockhash from txview where txhash="${txHash}"`).get();
            if (!result || result.blockhash === undefined) {
                return {err: ErrorCode.RESULT_NOT_FOUND};
            }

            return {err: ErrorCode.RESULT_OK, blockhash: result.blockhash};
        } catch (e) {
            this.m_logger.error(`txstorage,get exception,error=${e},txHash=${txHash}`);
            return {err: ErrorCode.RESULT_EXCEPTION };
        }
    }

    public async getCountByAddress(address: string): Promise<{err: ErrorCode, count?: number}> {
        try {
            let result = this.m_db!.prepare(`select count(*) as value from txview where address="${address}"`).get();
            if (!result || result.value === undefined) {
                return {err: ErrorCode.RESULT_FAILED};
            }

            return {err: ErrorCode.RESULT_OK, count: result.value as number};
        } catch (e) {
            this.m_logger.error(`txstorage,getCountByAddress exception,error=${e},address=${address}`);
            return {err: ErrorCode.RESULT_EXCEPTION};
        }
    }

    public async getTransactionByAddress(address: string): Promise<{err: ErrorCode, txs?: Transaction[]}> {
        try {
            let result = this.m_db!.prepare(`select txhash from txview where address="${address}"`).all();
            if (!result || result.length === 0) {
                return {err: ErrorCode.RESULT_NOT_FOUND};
            }

            return {err: ErrorCode.RESULT_OK, txs: result};
        } catch (e) {
            this.m_logger.error(`txstorage,getTransactionByAddress exception,error=${e},address=${address}`);
            return {err: ErrorCode.RESULT_EXCEPTION};
        }
    }
}
