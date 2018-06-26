import {Options as CommandOptions} from '../lib/simple_command';

import {Chain, ChainOptions} from '../../core/dpos_chain/chain';
import {Miner, MinerOptions} from '../../core/dpos_chain/miner';

import chainHost = require('../host/chain_host');

import * as fs from 'fs-extra';

chainHost.registerConsensus('dpos', {
    chain(options: any, commandOptions: CommandOptions):Chain {
        // let powOptions: ChainOptions = Object.create(options);
        return new Chain(options);
    }, 
    miner(options: any, commandOptions: CommandOptions):Miner {
        let secret = commandOptions.get('minerSecret');
        if (secret) {
            options.minerSecret = Buffer.from(secret, 'hex');
        }
        return new Miner(options);
    },
    create(command: CommandOptions):any {
        if (!command.has('genesisFile')) {
            throw new Error('dpos create MUST have genesis file!');
        }
        return fs.readJSONSync(command.get('genesisFile'));
    }
});

