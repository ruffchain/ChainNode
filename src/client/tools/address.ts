import * as process from 'process';
import '../lib/unhandled_rejection';
import {parseCommand} from '../lib/simple_command';

import * as address from '../../core/address';

function main() {
    let command = parseCommand();
    if (!command || !command.command) {
        console.log(`Usage: node address.js <create | --secret {secret} | --pubkey {pubkey}>`);
        process.exit();
    }

    if (command!.command === 'create') {
        let [key, secret] = address.createKeyPair();
        let addr = address.addressFromSecretKey(secret);
        console.log(`address:${addr} secret:${secret.toString('hex')}`);
        process.exit();
    } else {
        if (command!.options.has('secret')) {
            let pub = address.publicKeyFromSecretKey(command!.options.get('secret'));
            let addr = address.addressFromPublicKey(pub!);
            console.log(`address:${addr}\npubkey:${pub!.toString('hex')}`);
            process.exit();
        } else if(command!.options.has('pubkey')) {
            let addr = address.addressFromPublicKey(command!.options.get('pubkey'));
            console.log(`address:${addr}`);
            process.exit();
        } else {
            console.log(`Usage: node address.js <create | convert> {--secret {secret} | --pubkey {pubkey}}`);
            process.exit();
        }
    }
}


main();