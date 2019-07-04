
// import * as Sqlite3 from 'sqlite3';
import { ErrorCode, IFeedBack } from '../../core/error_code';
import winston = require('winston');
import * as path from 'path';

/**
 * @var sqlite3 
 */
var sqlite3 = require('sqlite3').verbose();

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
            this.db = new sqlite3.Database(path.join(this.options.path, this.options.name), (err: any) => {
                if (err) {
                    this.logger.error(err);

                    resolv({ err: ErrorCode.RESULT_FAILED, data: err });
                } else {
                    resolv({ err: ErrorCode.RESULT_OK, data: null });
                }
            });
        });
    }

    public close(): Promise<IFeedBack> {
        return new Promise<IFeedBack>((resolv, reject) => {
            this.db.close(() => {
                resolv({ err: ErrorCode.RESULT_OK, data: null });
                this.logger.info('db closed');
            });
        });
    }

    // database table API
    public createTable(tableName: string, schema: string): Promise<IFeedBack> {
        return new Promise<IFeedBack>((resolv, reject) => {
            this.db.run(`CREATE TABLE IF NOT EXISTS ${tableName} ${schema}`,
                (err: any) => {
                    if (err) {
                        this.logger.error(err);
                        resolv({ err: ErrorCode.RESULT_DB_TABLE_FAILED, data: err });
                    } else {
                        resolv({ err: ErrorCode.RESULT_OK, data: null });
                    }
                });
        });
    }

    // You can not insert a same priv key record
    public insertRecord(sql: string, params: any): Promise<IFeedBack> {
        return new Promise<IFeedBack>((resolv) => {
            this.db.run(sql, params,
                (err: any) => {
                    if (err) {
                        this.logger.error(err);
                        resolv({ err: ErrorCode.RESULT_DB_TABLE_INSERT_FAILED, data: err });
                    } else {
                        resolv({ err: ErrorCode.RESULT_OK, data: null });
                    }
                });
        });
    }
    // You should check if it exists!
    public updateRecord(sql: string) {
        return new Promise<IFeedBack>((resolv) => {
            this.db.run(sql,
                (err: any) => {
                    if (err) {
                        this.logger.error(err);
                        resolv({ err: ErrorCode.RESULT_DB_TABLE_UPDATE_FAILED, data: err });
                    } else {
                        resolv({ err: ErrorCode.RESULT_OK, data: null });
                    }
                });
        });
    }
    public insertOrReplaceRecord(sql: string, params: any) {
        return new Promise<IFeedBack>((resolv) => {
            this.db.run(sql, params,
                (err: any) => {
                    if (err) {
                        this.logger.error('Error =>', err);
                        resolv({ err: ErrorCode.RESULT_DB_TABLE_INSERTREPLACE_FAILED, data: err });
                    } else {
                        resolv({ err: ErrorCode.RESULT_OK, data: null });
                    }
                });
        });
    }
    public execRecord(sql: string, params: any) {
        return new Promise<IFeedBack>((resolv) => {
            this.db.run(sql,
                params,
                (err: any) => {
                    if (err) {
                        this.logger.error(err);
                        resolv({ err: ErrorCode.RESULT_DB_TABLE_FAILED, data: err });
                    } else {
                        resolv({ err: ErrorCode.RESULT_OK, data: null });
                    }
                });
        });
    }
    public removeRecord(sql: string, params: any) {
        return new Promise<IFeedBack>((resolv) => {
            this.db.run(sql,
                params,
                (err: any) => {
                    if (err) {
                        this.logger.error(err);
                        resolv({ err: ErrorCode.RESULT_DB_TABLE_REMOVE_FAILED, data: err });
                    } else {
                        resolv({ err: ErrorCode.RESULT_OK, data: null });
                    }
                });
        });
    }
    public getRecord(sql: string): Promise<IFeedBack> {
        return new Promise<IFeedBack>((resolv) => {
            this.db.get(sql, (err: any, row: any) => {
                this.logger.info('getRecord', err, row)
                if (err) {
                    resolv({ err: ErrorCode.RESULT_DB_TABLE_GET_FAILED, data: err })
                } else if (!row) {
                    resolv({ err: ErrorCode.RESULT_DB_RECORD_EMPTY, data: err })
                } else {
                    resolv({ err: ErrorCode.RESULT_OK, data: row });
                }
            });
        });
    }
    public getAllRecords(sql: string): Promise<IFeedBack> {
        return new Promise<IFeedBack>((resolv) => {
            this.db.all(sql, (err: any, rows: any) => {
                // this.logger.info('getAllRecords', err, rows)
                if (err) {
                    resolv({ err: ErrorCode.RESULT_DB_TABLE_GET_FAILED, data: err })
                } else if (!rows) {
                    resolv({ err: ErrorCode.RESULT_DB_RECORD_EMPTY, data: err })
                } else {
                    resolv({ err: ErrorCode.RESULT_OK, data: rows });
                }
            });
        });
    }
    // atomic transaction
    public execTransaction2(sql1: string, sql2: string) {
        return new Promise<IFeedBack>((resolv) => {
            this.db.serialize(() => {
                this.db.exec('BEGIN', (err: any) => {

                });
                this.db.run(sql1, (err: any) => {

                });
                this.db.run(sql2, (err: any) => {

                });
                this.db.exec('COMMIT', (err: any) => {
                    if (err) {
                        resolv({ err: ErrorCode.RESULT_SYNC_TX_EXEC2, data: null })
                    } else {
                        resolv({ err: ErrorCode.RESULT_OK, data: null })
                    }
                });
            });
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
