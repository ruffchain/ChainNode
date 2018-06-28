import * as readline from 'readline';
import * as process from 'process';
import '../../../src/client/lib/unhandled_rejection';
import {parseCommand, Command} from '../../../src/client/lib/simple_command';
import {ChainClient, BigNumber, ErrorCode, addressFromSecretKey, Transaction} from '../../../src/client/client/client';

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
    let userAddress = addressFromSecretKey(secret)!;
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
        getAddress: () => {
            console.log(userAddress);
        },
        getBalance: async (address?: string) => {
            let ret = await chainClient.view({
                method: 'getBalance',
                params: {address: address || userAddress}
            });
            if (ret.err) {
                console.error(`get balance failed for ${ret.err};`);
                return ;
            }
            console.log(`${ret.value!}`);
        },
        transferTo: async (to: string, amount: string, fee: string)=> {
            let tx = new Transaction();
            tx.method = 'transferTo',
            tx.value = new BigNumber(amount);
            tx.fee = new BigNumber(fee);
            tx.input = {to};
            let {err, nonce} = await chainClient.getNonce({address:userAddress});
            if (err) {
                console.error(`transferTo failed for ${err}`);
                return ;
            }
            tx.nonce = nonce! + 1;
            tx.sign(secret);
            err = await chainClient.sendTrasaction({tx});
            if (err) {
                console.error(`transferTo failed for ${err}`);
                return ;
            }
            console.log(`send transferTo tx: ${tx.hash}`);
        },
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

    let rl = readline.createInterface(process.stdin, process.stdout);
    rl.on('line', (cmd: string)=>{
        runCmd(cmd);
    });
}

main();
