import {Options as CommandOptions} from '../lib/simple_command';

import {Chain, ChainOptions} from '../../core/dpos_chain/chain';
import {Miner, MinerOptions} from '../../core/dpos_chain/miner';

import chainHost = require('../host/chain_host');

import * as fs from 'fs-extra';

chainHost.registerConsensus('dpos', {
    chain(options: any, commandOptions: CommandOptions):Chain {
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
        let json =  fs.readJSONSync(command.get('genesisFile'));
        json.consensusname = 'dpos';
/*
        json.consensus = {};
        json.consensus.minCreateor = command.has('minCreateor')? command.get('minCreateor') : 2;
        json.consensus.maxCreateor = command.has('maxCreateor')? command.get('maxCreateor') : 21;
        json.consensus.reSelectionBlocks = command.has('reSelectionBlocks')? command.get('reSelectionBlocks') : 10;
        json.consensus.blockInterval = command.has('blockInterval')? command.get('blockInterval') : 10;
        json.consensus.timeOffsetToLastBlock = command.has('timeOffsetToLastBlock')? command.get('timeOffsetToLastBlock') : 24*60*60;
        json.consensus.timeBan = command.has('timeBan')? command.get('timeBan') : 30*24*60*60;
        json.consensus.unbanBlocks = command.has('unbanBlocks')? command.get('unbanBlocks') : 100;
        json.consensus.dposVoteMaxProducers = command.has('dposVoteMaxProducers')? command.get('dposVoteMaxProducers') : 30;
        json.consensus.maxBlockIntervalOffset = command.has('maxBlockIntervalOffset')? command.get('maxBlockIntervalOffset') : 1;
*/
        return json;
    }
});

