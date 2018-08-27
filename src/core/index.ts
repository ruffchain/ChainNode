export {BigNumber} from 'bignumber.js';
export * from './serializable';
export * from './error_code';
export * from './address';
export * from './lib/logger_util';
export * from './lib/decimal_transfer';
export * from './chain';
export * from './value_chain';
export * from './pow_chain';
export * from './dpos_chain';
export * from './net';
export * from './dbft_chain';
export {TcpNode} from './net_tcp/node';
export {BdtNode} from './net_bdt/node';
export {ChainCreator} from './chain_creator';

import { ChainCreator } from './chain_creator';
import { ChainTypeOptions, ValueHandler } from './value_chain';
import { PowChain, PowMiner } from './pow_chain';
import { DposChain, DposMiner } from './dpos_chain';
import { DbftChain, DbftMiner } from './dbft_chain';
import { LoggerOptions } from './lib/logger_util';

export function initChainCreator(options: LoggerOptions): ChainCreator {
    let _creator = new ChainCreator(options);
    _creator.registerChainType('pow', { 
        newHandler(creator: ChainCreator, typeOptions: ChainTypeOptions): ValueHandler {
            return new ValueHandler();
        }, 
        newChain(creator: ChainCreator, typeOptions: ChainTypeOptions): PowChain {
            return new PowChain({logger: creator.logger});
        },
        newMiner(creator: ChainCreator, typeOptions: ChainTypeOptions): PowMiner {
            return new PowMiner({logger: creator.logger});
        }
    });
    _creator.registerChainType('dpos', { 
        newHandler(creator: ChainCreator, typeOptions: ChainTypeOptions): ValueHandler {
            return new ValueHandler();
        }, 
        newChain(creator: ChainCreator, typeOptions: ChainTypeOptions): DposChain {
            return new DposChain({logger: creator.logger});
        },
        newMiner(creator: ChainCreator, typeOptions: ChainTypeOptions): DposMiner {
            return new DposMiner({logger: creator.logger});
        }
    });
    _creator.registerChainType('dbft', { 
        newHandler(creator: ChainCreator, typeOptions: ChainTypeOptions): ValueHandler {
            return new ValueHandler();
        }, 
        newChain(creator: ChainCreator, typeOptions: ChainTypeOptions): DbftChain {
            return new DbftChain({logger: creator.logger});
        },
        newMiner(creator: ChainCreator, typeOptions: ChainTypeOptions): DbftMiner {
            return new DbftMiner({logger: creator.logger});
        }
    });
    return _creator;
}

export * from './chain_debuger';
