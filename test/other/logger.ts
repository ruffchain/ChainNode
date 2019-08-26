import * as winston from 'winston';
import * as DailyRotateFile from 'winston-daily-rotate-file';

interface IfLoggerInit {
    path: string;
}
export class Logger {
    public static logger: any;
    public static bCreated: boolean = false;

    public static init(options: IfLoggerInit) {
        if (Logger.bCreated === true) {
            return Logger.logger;
        }
        Logger.logger = new winston.Logger({
            transports: [
            ]
        });
        Logger.logger.configure({
            level: 'verbose',
            transports: [
                new winston.transports.Console(),
                new DailyRotateFile({
                    dirname: options.path,
                    filename: 'info-%DATE%.log',
                    datePattern: 'YYYY-MM-DD',
                    zippedArchive: true,
                    maxSize: '100m',
                    maxFiles: '15'
                })
            ]
        });
        Logger.bCreated = true;
        return Logger.logger as winston.LoggerInstance;
    }

}
