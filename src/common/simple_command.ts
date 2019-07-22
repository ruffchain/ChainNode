import * as process from 'process';
import * as path from 'path';
import * as fs from 'fs';

export type Options = Map<string, any>;

export type Command = {command?: string, options: Options};

function objToStrMap(obj:any): Map<string, any> {
    let strMap = new Map();
    for (let k of Object.keys(obj)) {
        strMap.set(k,obj[k]);
    }
    return strMap;
}

export function parseCommandFromCfgFile(cmd: Command): Command {

    if (cmd.options.has('cfgFile')) {
        let filePath = cmd.options.get('cfgFile');
        if (!path.isAbsolute(filePath)) {
            filePath = path.join(process.cwd(), filePath);
        }
        if (!fs.existsSync(filePath)) {
            throw new Error(`file ${filePath} not exist`);
        }
        let content = fs.readFileSync(filePath).toString();
        try {
            let obj = JSON.parse(content);
            let newCommand: Command = {command: cmd.command, options: objToStrMap(obj)};
            cmd.options.forEach((value, key) => {
                newCommand.options.set(key, value);
            });
            return newCommand;
        } catch(err) {
            throw new Error(`invalid config file ${filePath}`);
        }
    }
    return cmd;
}

export function parseCommand(argv: string[]): Command|undefined {
    if (argv.length < 3) {
        console.log('no enough command');
        return ;
    }
    let command: Command = {options: new Map()};
    let start = 2;
    let firstArg = argv[2];
    if (!firstArg.startsWith('--')) {
        command.command = firstArg;
        start = 3;
    }

    let curKey: string|undefined;
    while (start < argv.length) {
        let arg = argv[start];
        if (arg.startsWith('--')) {
            // if (curKey) {
            //     command.options.set(curKey, true);
            // }
            curKey = arg.substr(2);
            command.options.set(curKey, true);
        } else {
            if (curKey) {
                command.options.set(curKey, arg);
                curKey = undefined;
            } else {
                console.error(`error command ${arg}, key must start with --`);
                return undefined;
            }
        }
        ++start;
    }
    return command;
}
