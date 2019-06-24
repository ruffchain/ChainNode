#!/usr/bin/env node
import * as process from 'process';
import * as path from 'path';
import * as fs from 'fs';
import {createKeyPair, addressFromSecretKey, publicKeyFromSecretKey, addressFromPublicKey, initLogger} from '../host';
import {initUnhandledRejection, parseCommand} from '../common/';

initUnhandledRejection(initLogger({loggerOptions: {console: true}}));

function main() {
    let command = parseCommand(process.argv);
    if (!command || !command.command) {
        console.log(`Usage: node address.js <create | convert> {--num {num} --output {filename}} | {--secret {secret} | --pubkey {pubkey}}`);
        process.exit();
    }

    if (command!.command === 'create') {
       if (command!.options.has('num')) {
            let num = command!.options.get('num');
            let addrs = [];
            for (let i = 0; i < num; i++) {
                let [key, secret] = createKeyPair();
                let addr = addressFromSecretKey(secret);

                addrs.push({
                    address: addr,
                    secret: secret.toString('hex')
                });
            }
            let users = {users:addrs};
            if (command!.options.has('output')) {
                let outputFilename = command!.options.get('output');
                if (!path.isAbsolute(outputFilename)) {
                    outputFilename = path.join(process.cwd(), outputFilename);
                }
                fs.writeFileSync(outputFilename, JSON.stringify(users, null, 2));
            } else {
                console.log(JSON.stringify(users, null, 2));
            }
        } else {
            let [key, secret] = createKeyPair();
            let addr = addressFromSecretKey(secret);
            console.log(`address:${addr} secret:${secret.toString('hex')}`);
        }
        process.exit();
    } else {
        if (command!.options.has('secret')) {
            let pub = publicKeyFromSecretKey(command!.options.get('secret'));
            let addr = addressFromPublicKey(pub!);
            console.log(`address:${addr}\npubkey:${pub!.toString('hex')}`);
            process.exit();
        } else if (command!.options.has('pubkey')) {
            let addr = addressFromPublicKey(command!.options.get('pubkey'));
            console.log(`address:${addr}`);
            process.exit();
        } else {
            console.log(`Usage: node address.js <create | convert> {--secret {secret} | --pubkey {pubkey}}`);
            process.exit();
        }
    }
}

main();
