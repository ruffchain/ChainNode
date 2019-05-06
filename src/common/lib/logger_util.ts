import { transports, LoggerInstance, Logger, TransportInstance } from 'winston';
export { LoggerInstance } from 'winston';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as DailyRotateFile from 'winston-daily-rotate-file';
const { LogShim } = require('./log_shim');

export type LoggerOptions = {
    logger?: LoggerInstance;
    loggerOptions?: { console: boolean, file?: { root: string, filename?: string }, level?: string };
};

export function initLogger(options: LoggerOptions): LoggerInstance {
    if (options.logger) {
        return options.logger;
    } else if (options.loggerOptions) {
        const loggerTransports = [];
        if (options.loggerOptions.console) {
            loggerTransports.push(new transports.Console({
                level: options.loggerOptions.level ? options.loggerOptions.level : 'info',
                timestamp: true,
                handleExceptions: true,
                humanReadableUnhandledException: true
            }));
        }
        //if (options.loggerOptions.file) {
        //    fs.ensureDirSync(options.loggerOptions.file.root);
        //    loggerTransports.push(new transports.File({
        //        json: false,
        //        level: options.loggerOptions.level ? options.loggerOptions.level : 'info',
        //        timestamp: true,
        //        filename: path.join(options.loggerOptions.file.root, options.loggerOptions.file.filename || 'info.log'),
        //        datePattern: 'yyyy-MM-dd.',
        //        prepend: true,
        //        handleExceptions: true,
        //        humanReadableUnhandledException: true
        //    }));
        //}
        // Yang Jun 2019-3-15
        //
        //const logger = new Logger({
        //    level: options.loggerOptions.level || 'info',
        //    transports: loggerTransports
        //});
        let logger: any;
        logger = new Logger({
            transports: []
        });

        if (options.loggerOptions.file) {
            fs.ensureDirSync(options.loggerOptions.file!.root);
            loggerTransports.push(new DailyRotateFile({
                dirname: options.loggerOptions.file!.root,
                filename: 'info-%DATE%.log',
                datePattern: 'YYYY-MM-DD',
                zippedArchive: true,
                maxSize: '100m',
                maxFiles: '15'
            }));
        }

        logger.configure({
            level: options.loggerOptions.level ? options.loggerOptions.level : 'info',
            transports: loggerTransports,
        });
        return new LogShim(logger).log;
    } else {
        const loggerTransports = [];
        loggerTransports.push(new transports.Console({
            level: 'info',
            timestamp: true,
            handleExceptions: true
        }));
        const logger = new Logger({
            level: 'info',
            transports: loggerTransports
        });
        return new LogShim(logger).log;
    }
}

export { LogShim };
