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
    let address = addressFromSecretKey(secret)!;
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

    let watchingTx: string[] = [];
    chainClient.on('tipBlock', async (tipBlock)=>{
        console.log(`client onTipBlock, height ${tipBlock.number}`);
        for (let tx of watchingTx.slice()) {
            let {err, block, receipt} = await chainClient.getTransactionReceipt({tx});
            if (!err) {
                if (receipt.returnCode !== 0) {
                    console.error(`tx:${tx} failed for ${receipt.returnCode}`);
                    watchingTx.splice(watchingTx.indexOf(tx), 1);
                } else {
                    let confirm = tipBlock.number - block.number + 1;
                    if (confirm < 6) {
                        console.log(`tx:${tx} ${confirm} confirm`);
                    } else {
                        console.log(`tx:${tx} confirmed`);
                        watchingTx.splice(watchingTx.indexOf(tx), 1);
                    }
                }
            }
        }
    });

    chainClient._beginWatchTipBlock();

    let runEnv = {
        getAddress: () => {
            console.log(address);
        }, 
        getBalance: async (_address: string) => {
            if (!_address) {
                _address = address;
            }
            let ret = await chainClient.view({
                method: 'getBalance',
                params: {address: _address}
            });
            if (ret.err) {
                console.error(`get balance failed for ${ret.err};`);
                return ;
            }
            console.log(`${_address}\`s Balance: ${ret.value!}`);
        },
        transferTo: async (to: string, amount: string, fee: string)=> {
            let tx = new Transaction();
            tx.method = 'transferTo',
            tx.value = new BigNumber(amount);
            tx.fee = new BigNumber(fee);
            tx.input = {to};
            let {err, nonce} = await chainClient.getNonce({address});
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
            watchingTx.push(tx.hash);
        },

        vote: async (candidates: string[], fee: string) => {
            let tx = new Transaction();
            tx.method = 'vote';
            tx.fee = new BigNumber(fee);
            tx.input = candidates;
            let {err, nonce} = await chainClient.getNonce({address});
            if (err) {
                console.error(`vote failed for ${err}`);
                return ;
            }
            tx.nonce = nonce! + 1;
            tx.sign(secret);
            err = await chainClient.sendTrasaction({tx});
            if (err) {
                console.error(`vote failed for ${err}`);
                return ;
            }
            console.log(`send vote tx: ${tx.hash}`);
            watchingTx.push(tx.hash);
        },

        mortgage: async (amount: string, fee: string) => {
            let tx = new Transaction();
            tx.method = 'mortgage';
            tx.fee = new BigNumber(fee);
            tx.input = amount;
            let {err, nonce} = await chainClient.getNonce({address});
            if (err) {
                console.error(`mortgage failed for ${err}`);
                return ;
            }
            tx.nonce = nonce! + 1;
            tx.sign(secret);
            err = await chainClient.sendTrasaction({tx});
            if (err) {
                console.error(`mortgage failed for ${err}`);
                return ;
            }
            console.log(`send mortgage tx: ${tx.hash}`);
            watchingTx.push(tx.hash);
        },

        unmortgage: async (amount: string, fee: string) => {
            let tx = new Transaction();
            tx.method = 'unmortgage';
            tx.fee = new BigNumber(fee);
            tx.input = amount;
            let {err, nonce} = await chainClient.getNonce({address});
            if (err) {
                console.error(`unmortgage failed for ${err}`);
                return ;
            }
            tx.nonce = nonce! + 1;
            tx.sign(secret);
            err = await chainClient.sendTrasaction({tx});
            if (err) {
                console.error(`unmortgage failed for ${err}`);
                return ;
            }
            console.log(`send unmortgage tx: ${tx.hash}`);
            watchingTx.push(tx.hash);
        },

        getVote: async () => {
            let ret = await chainClient.view({
                method: 'getVote',
                params: {}
            });
            if (ret.err) {
                console.error(`getVote failed for ${ret.err};`);
                return ;
            }
            console.log(`${ret.value!}`);
        },

        getStoke: async (_address: string) => {
            let ret = await chainClient.view({
                method: 'getStoke',
                params: {address:_address}
            });
            if (ret.err) {
                console.error(`getStoke failed for ${ret.err};`);
                return ;
            }
            console.log(`${ret.value!}`);
        },

        getCandidates: async () => {
            let ret = await chainClient.view({
                method: 'getCandidates',
                params: {}
            });
            if (ret.err) {
                console.error(`getCandidates failed for ${ret.err};`);
                return ;
            }
            console.log(`${ret.value!}`);
        },
    };

    function runCmd(cmd: string) {
        let chain = runEnv;
        try {
            eval(cmd);
        } catch(e) {
            console.error('e='+e.message);
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