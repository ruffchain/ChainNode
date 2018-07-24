
import * as process from 'process';

export function init() {
    process.on('unhandledRejection', (reason, p) => {
        console.error('Unhandled Rejection at: Promise ', p, ' reason: ', reason.stack);
    });
    
    process.on('uncaughtException', (err) => {
        console.error('uncaught exception at: ', err.stack);
    });    
}
