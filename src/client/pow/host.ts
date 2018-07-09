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
        let json:any = {};
        json.consensusname = 'pow';

        json.consensus = {};
        json.consensus.retargetInterval = command.has('retargetInterval')? command.get('retargetInterval') : 10;
        json.consensus.targetTimespan = command.has('targetTimespan')? command.get('targetTimespan') : 60;
        json.consensus.basicBits = command.has('basicBits')? command.get('basicBits') : 520159231;
        json.consensus.limit = command.has('limit')? command.get('limit') : '0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
        return json;
    }
});

