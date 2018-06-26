import * as process from 'process';

export type Options = Map<string, any>;

export type Command = {command?: string, options: Options};

export function parseCommand(): Command|undefined {
    if (process.argv.length < 3) {
        console.log('invalid command');
        return ;
    }
    let command: Command = {options: new Map()};
    let start = 2;
    let firstArg = process.argv[2];
    if (!firstArg.startsWith('--')) {
        command.command = firstArg;
        start = 3;
    }

    let curKey: string|undefined;
    while (start < process.argv.length) {
        let arg = process.argv[start];
        if (arg.startsWith('--')) {
            if (curKey) {
                command.options.set(curKey, true);
            }
            curKey = arg.substr(2);
        } else {
            if (curKey) {
                command.options.set(curKey, arg);
                curKey = undefined;
            } else {
                console.error('invalid command');
                return undefined;
            }
        }
        ++start;
    } 
    return command;
}