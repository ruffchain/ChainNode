import {ErrorCode} from '../error_code';
import {ValueBlockExecutor, ValueBlockHeader} from '../value_chain';
import {DBFTSProxy} from './dbftProxy';

export class DbftBlockExecutor extends ValueBlockExecutor {
   
    protected async _executePostBlockEvent(): Promise<ErrorCode> {
        if (this.m_block.number > 0) {
            let dbftProxy: DBFTSProxy = new DBFTSProxy(this.m_storage, this.m_globalOptions, this.m_logger);
            if (DBFTSProxy.isElectionBlockNumber(this.m_globalOptions, this.m_block.number)) {
                await dbftProxy.updateCandidate(this.m_block.number);
            }
        }
        return super._executePostBlockEvent();
    }    
}
