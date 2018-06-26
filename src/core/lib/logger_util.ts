import {transports, LoggerInstance, Logger} from 'winston';
export {LoggerInstance} from 'winston';
import * as path from 'path';
import * as fs from 'fs-extra';

export type LoggerOptions = {
    logger?: LoggerInstance;
    loggerOptions?: {console: boolean, file?: {root: string}, level?: string};
};


export function initLogger(options: LoggerOptions): LoggerInstance  {
    if (options.logger) {
        return options.logger;
    } else if (options.loggerOptions) {
        const loggerTransports = [];
        if (options.loggerOptions.console) {
            loggerTransports.push(new transports.Console({
                level: 'info',
                timestamp: true,
                handleExceptions: true,
                humanReadableUnhandledException: true
            }));
        }
        if (options.loggerOptions.file) {
            fs.ensureDirSync(options.loggerOptions.file.root);
            loggerTransports.push(new transports.File({
                json: false,
                level: 'info',
                timestamp: true,
                filename: path.join(options.loggerOptions.file.root, `info.log`),
                datePattern: 'yyyy-MM-dd.',
                prepend: true,
                handleExceptions: true,
                humanReadableUnhandledException: true
            }));
        }
        
            
        // loggerTransports.push(new transports.DailyRotateFile({
        //     name: 'error',
        //     json: false,
        //     level: 'error',
        //     timestamp: true,
        //     handleExceptions: true,
        //     filename: options.dataDir + `/log/error.log`,
        //     datePattern: 'yyyy-MM-dd.',
        //     prepend: true
        // }));
        const logger = new Logger({
            level: options.loggerOptions.level ? options.loggerOptions.level : 'info',
            transports: loggerTransports
        });
        return logger;
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
        return logger;
    }
}