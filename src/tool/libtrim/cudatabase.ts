
// import * as Sqlite3 from 'sqlite3';
import { ErrorCode, IFeedBack } from '../../core/error_code';
import winston = require('winston');
import * as path from 'path';

/**
 * @var sqlite3
 */
var sqlite3 = require('better-sqlite3');

export interface IfCUDataBaseOptions {
    path: string;
    name: string;
}
/**
 * @class CUDataBase
 */
export class CUDataBase {
    /**
     *
     */
    public logger: any;
    public db: any;
    private options: IfCUDataBaseOptions;

    constructor(loggerpath: winston.LoggerInstance, options: IfCUDataBaseOptions) {
        this.db = null;
        this.logger = loggerpath;
        this.options = options;
    }
    public open(): Promise<IFeedBack> {
        return new Promise<IFeedBack>((resolv, reject) => {
            this.logger.info('filename:', path.join(this.options.path, this.options.name));
            try {
                this.db = new sqlite3(path.join(this.options.path, this.options.name));
                resolv({ err: ErrorCode.RESULT_OK, data: null });
           } catch (err) {
                this.logger.error(err);
                resolv({ err: ErrorCode.RESULT_FAILED, data: err });
            }
        });
    }

    public close(): Promise<IFeedBack> {
        return new Promise<IFeedBack>((resolv, reject) => {
            try {
                this.db.close();
                this.logger.info('db closed');
                resolv({ err: ErrorCode.RESULT_OK, data: null });
            } catch (err) {
                resolv({ err: ErrorCode.RESULT_FAILED, data: null });
            };
        });
    }

    // database table API
    public createTable(tableName: string, schema: string): Promise<IFeedBack> {
        return new Promise<IFeedBack>((resolv, reject) => {
            try {
                this.db.prepare.run(`CREATE TABLE IF NOT EXISTS ${tableName} ${schema}`);
                resolv({ err: ErrorCode.RESULT_OK, data: null });
            } catch (err) {
                this.logger.error(err);
                resolv({ err: ErrorCode.RESULT_DB_TABLE_FAILED, data: err });
            }
        });
    }

    // You can not insert a same priv key record
    public insertRecord(sql: string, params: any): Promise<IFeedBack> {
        return new Promise<IFeedBack>((resolv) => {
            try {
                this.db.prepare(sql).run(params);
                resolv({ err: ErrorCode.RESULT_OK, data: null });
            } catch (err) {
                console.log(err);
                resolv({ err: ErrorCode.RESULT_DB_TABLE_INSERT_FAILED, data: err });
            }
        });
    }
    // You should check if it exists!
    public updateRecord(sql: string) {
        return new Promise<IFeedBack>((resolv) => {
            try {
                this.db.prepare(sql).run();
                resolv({ err: ErrorCode.RESULT_OK, data: null });
            } catch (err) {
                this.logger.error(err);
                resolv({ err: ErrorCode.RESULT_DB_TABLE_UPDATE_FAILED, data: err });
            }
        });
    }
    public insertOrReplaceRecord(sql: string, params: any) {
        return new Promise<IFeedBack>((resolv) => {
            try {
                this.db.prepare(sql).run(params);
                resolv({ err: ErrorCode.RESULT_OK, data: null });
            } catch (err) {
                this.logger.error('Error =>', err);
                resolv({ err: ErrorCode.RESULT_DB_TABLE_INSERTREPLACE_FAILED, data: err });
            }
        });
    }
    public execRecord(sql: string, params: any) {
        return new Promise<IFeedBack>((resolv) => {
            try {
                this.db.prepare(sql).run(params);
                resolv({ err: ErrorCode.RESULT_OK, data: null });
            } catch (err) {
                this.logger.error(err);
                resolv({ err: ErrorCode.RESULT_DB_TABLE_FAILED, data: err });
            }
        });
    }
    public removeRecord(sql: string, params: any) {
        return new Promise<IFeedBack>((resolv) => {
            try {
                this.db.prepare(sql).run(params);
                resolv({ err: ErrorCode.RESULT_OK, data: null });
            } catch (err) {
                this.logger.error(err);
                resolv({ err: ErrorCode.RESULT_DB_TABLE_REMOVE_FAILED, data: err });
            }
        });
    }
    public getRecord(sql: string): Promise<IFeedBack> {
        return new Promise<IFeedBack>((resolv) => {
            try {
                let row = this.db.prepare(sql).get();
                this.logger.info('getRecord', row)
                if (!row) {
                    resolv({ err: ErrorCode.RESULT_DB_RECORD_EMPTY, data: null });
                } else {
                    resolv({ err: ErrorCode.RESULT_OK, data: row });
                }
            } catch (err) {
                this.logger.error(err);
                resolv({ err: ErrorCode.RESULT_DB_TABLE_GET_FAILED, data: err })
            }
        });
    }
    public getAllRecords(sql: string): Promise<IFeedBack> {
        return new Promise<IFeedBack>((resolv) => {
            try {
                let rows = this.db.prepare(sql).all();
                this.logger.info('getRecord', rows)
                if (!rows) {
                    resolv({ err: ErrorCode.RESULT_DB_RECORD_EMPTY, data: null });
                } else {
                    resolv({ err: ErrorCode.RESULT_OK, data: rows });
                }
            } catch (err) {
                this.logger.error(err);
                resolv({ err: ErrorCode.RESULT_DB_TABLE_GET_FAILED, data: err })
            }
        });
    }
    // atomic transaction
    public execTransaction2(sql1: string, sql2: string) {
        return new Promise<IFeedBack>((resolv) => {
            let transaction = this.db.transaction((sql1: string, sql2: string) => {
                this.db.prepare(sql1).run();
                this.db.prepare(sql2).run();
            });
            try {
                transaction(sql1, sql2);
                resolv({ err: ErrorCode.RESULT_OK, data: null })
            } catch (err) {
                resolv({ err: ErrorCode.RESULT_SYNC_TX_EXEC2, data: null })
            }
        });
    }
    //   public matchWriteFunc(task: IfTask) {
    //     // task is in the closure
    //     return () => {
    //       return new Promise<ErrorCode>((resolve, reject) => {
    //         resolve();
    //       });
    //     };
    //   }
    //   public matchReadFunc(task: IfTask) {
    //     return () => {
    //       return new Promise<ErrorCode>((resolve, reject) => {
    //         resolve();
    //       });
    //     };
    //   }
}
