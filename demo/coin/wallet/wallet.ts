import * as process from 'process';
import '../../../src/client/lib/unhandled_rejection';
import {parseCommand, Command} from '../../../src/client/lib/simple_command';
import {ChainClient, ErrorCode, addressFromSecretKey} from '../../../src/client/client/client';

function main() {
    let command = parseCommand();
    if (!command) {
        console.error('invalid command');
        process.exit();
        return ;
    }
    let secret = command.options.get('secret');
    if (!secret) {
        console.error('no scret');
        process.exit();
        return ;
    }
    let host = command.options.get('host');
    let port = command.options.get('port');
    if (!host || !port) {
        console.error('no host');
        process.exit();
        return ;
    }

    let chainClient = new ChainClient({
        host: host,
        port: port
    });

    let runEnv = {
        getBalance: async () => {
            let ret = await chainClient.view({
                method: 'getBalance',
                params: {address: addressFromSecretKey(secret)!}
            });
            if (ret.err) {
                console.error(`get balance failed for ${ret.err};`);
                return ;
            }
            console.log(`${ret.value!}`);
        }
    };

    function runCmd(cmd: string) {
        let chain = runEnv;
        try {
            eval(cmd);
        } catch(e) {
            console.error(e.message);
        }
    }
    
    let cmd = command.options.get('run');
    if (cmd) {
        runCmd(cmd);
    }
}

main();