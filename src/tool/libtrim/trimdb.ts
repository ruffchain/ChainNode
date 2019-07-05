import { CUDataBase, IfCUDataBaseOptions } from "./cudatabase";
import winston = require("winston");
import { IFeedBack, ErrorCode } from "../../core";

export interface IfBestItem {
    height: number;
    hash: string;
    timestamp: number;
}
export interface IfHeadersItem {
    hash: string;
    pre: string;
    verified: number;
    raw: Buffer;
}
export interface IfMinersItem {
    hash: string;
    miners: string;
    irbhash: string;
    irbheight: number;
}
export interface IfTxviewBlocksItem {
    number: number;
    hash: string;
}
export interface IfTxviewItem {
    txhash: string;
    address: string;
    blockheight: number;
    blockhash: string;
}

export class TrimDataBase {
    private db: CUDataBase;

    constructor(logger: winston.LoggerInstance, options: IfCUDataBaseOptions) {
        this.db = new CUDataBase(logger, options);
    }
    public async open() {
        return this.db.open();
    }
    public async close() {
        return this.db.close();
    }

    public async getTable(table: string): Promise<IFeedBack> {
        let sql = `select * from ${table};`
        let hret = await this.db.getAllRecords(sql);
        if (hret.err) {
            this.db.logger.error('query ' + table + ' failed');
            return { err: ErrorCode.RESULT_DB_RECORD_EMPTY, data: [] };
        }
        return { err: ErrorCode.RESULT_OK, data: hret.data };
    }
    public async getBySQL(sql: string): Promise<IFeedBack> {
        let hret = await this.db.getAllRecords(sql);
        if (hret.err) {
            this.db.logger.error('query  failed');
            return { err: ErrorCode.RESULT_DB_RECORD_EMPTY, data: [] };
        }
        return { err: ErrorCode.RESULT_OK, data: hret.data };
    }
    public async runBySQL(sql: string): Promise<IFeedBack> {
        let hret = await this.db.execRecord(sql, {});
        if (hret.err) {
            this.db.logger.error('runBySQL  failed');
            return { err: ErrorCode.RESULT_DB_TABLE_FAILED, data: [] };
        }
        return { err: ErrorCode.RESULT_OK, data: hret.data };
    }

    // public async deleteFromTable(table: string): Promise<IFeedBack> {
    //     return { err: ErrorCode.RESULT_OK, data: hret.data };
    // }
}