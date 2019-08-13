import { transports, LoggerInstance, Logger, TransportInstance } from 'winston';
export { LoggerInstance } from 'winston';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as DailyRotateFile from 'winston-daily-rotate-file';
const { LogShim } = require('./log_shim');

export type LoggerOptions = {
    logger?: LoggerInstance;
    loggerOptions?: { console: boolean, file?: { root: string, filename?: string }, level?: string, dumpStack?: boolean};
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
                maxFiles: '60'
            }));
        }

        logger.configure({
            level: options.loggerOptions.level ? options.loggerOptions.level : 'info',
            transports: loggerTransports,
        });
        let shimOption = { enableGetStack: false}
        if (options.loggerOptions.dumpStack) {
            shimOption = { enableGetStack: true }
        };
        return new LogShim(logger, shimOption).log;
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
