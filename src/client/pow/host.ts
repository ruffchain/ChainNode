import {Options as CommandOptions} from '../lib/simple_command';

import {ValueChain, ValueMiner, PowMiner, PowChain, ChainCreator} from '../../core';
import chainHost = require('../host/chain_host');

chainHost.registerConsensus('pow', {
    async chain(commandOptions: CommandOptions): Promise<ValueChain|undefined> {
        let creator: ChainCreator = new ChainCreator();
        let cc = await creator.createChain(commandOptions, PowChain);
        if (!cc.err) {
            return cc.chain as ValueChain;
        }
    }, 
    miner(options: any, commandOptions: CommandOptions): ValueMiner {
        return new PowMiner(options);
    },
    create(command: CommandOptions): any {
        let json: any = {};
        json.consensusname = 'pow';

        json.consensus = {};
        json.consensus.retargetInterval = command.has('retargetInterval') ? command.get('retargetInterval') : 10;
        json.consensus.targetTimespan = command.has('targetTimespan') ? command.get('targetTimespan') : 60;
        json.consensus.basicBits = command.has('basicBits') ? command.get('basicBits') : 520159231;
        json.consensus.limit = command.has('limit') ? command.get('limit') : '0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
        return json;
    }
});