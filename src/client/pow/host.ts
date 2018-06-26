import {Options as CommandOptions} from '../lib/simple_command';

import {Chain, ChainOptions} from '../../core/pow_chain/chain';
import {Miner, MinerOptions} from '../../core/pow_chain/miner';

import chainHost = require('../host/chain_host');

chainHost.registerConsensus('pow', {
    chain(options: any, commandOptions: CommandOptions):Chain {
        // let powOptions: ChainOptions = Object.create(options);
        return new Chain(options);
    }, 
    miner(options: any, commandOptions: CommandOptions):Miner {
        return new Miner(options);
    },
    create(command: CommandOptions):any {
        return {};
    }
});

