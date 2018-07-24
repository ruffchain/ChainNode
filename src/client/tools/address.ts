import * as process from 'process';
import {init as initUnhandledRejection} from '../lib/unhandled_rejection';
import {parseCommand} from '../lib/simple_command';
import * as core from '../../core';

initUnhandledRejection();

function main() {
    let command = parseCommand();
    if (!command || !command.command) {
        console.log(`Usage: node address.js <create | convert> {--secret {secret} | --pubkey {pubkey}}`);
        process.exit();
    }

    if (command!.command === 'create') {
        let [key, secret] = core.createKeyPair();
        let addr = core.addressFromSecretKey(secret);
        console.log(`address:${addr} secret:${secret.toString('hex')}`);
        process.exit();
    } else {
        if (command!.options.has('secret')) {
            let pub = core.publicKeyFromSecretKey(command!.options.get('secret'));
            let addr = core.addressFromPublicKey(pub!);
            console.log(`address:${addr}\npubkey:${pub!.toString('hex')}`);
            process.exit();
        } else if (command!.options.has('pubkey')) {
            let addr = core.addressFromPublicKey(command!.options.get('pubkey'));
            console.log(`address:${addr}`);
            process.exit();
        } else {
            console.log(`Usage: node address.js <create | convert> {--secret {secret} | --pubkey {pubkey}}`);
            process.exit();
        }
    }
}

main();