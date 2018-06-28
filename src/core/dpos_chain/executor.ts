import {ErrorCode} from '../error_code';
import * as ValueExecutor from '../value_chain/executor';
import * as Consensus from './consensus';
import {BlockHeader} from './block';


export class BlockExecutor extends ValueExecutor.BlockExecutor {
   
    protected async _executeEvent(bBeforeBlock: boolean): Promise<ErrorCode> {
        let err = await super._executeEvent(bBeforeBlock);
        if (err) {
            return err;
        }
        if (!bBeforeBlock) {
            let denv = new Consensus.Context();

            if(this.m_block.number > 0) {
                //修改miner的最后一次出块时间
                //创世快不算时间，因为创世快产生后可能很长时间才开始出其他块的
                await denv.updateProducerTime(this.m_storage, (this.m_block.header as BlockHeader).coinbase, this.m_block.header.timestamp);
            }

            //维护被禁用miner信息
            if (((this.m_block.number + 1) % Consensus.unbanBlocks) === 0) {
                await denv.unbanProducer(this.m_storage, this.m_block.header.timestamp);
            }

            if (((this.m_block.number + 1) % Consensus.reSelectionBlocks) === 0) {
                //先禁用那些超过最长时间不出块的miner
                await denv.banProducer(this.m_storage, this.m_block.header.timestamp);
                //更新选举结果
                let ber = await denv.finishElection(this.m_storage, this.m_block.header.hash);
                if (ber.err) {
                    return ber.err;
                }
            }

            if (this.m_block.number === 1 || (this.m_block.number + 1) % Consensus.reSelectionBlocks === 0) {
                //维护miner时间信息
                await denv.maintain_producer(this.m_storage, this.m_block.header.timestamp);
            }
        }
        return ErrorCode.RESULT_OK;
    }    
}
