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
            //修改miner的最后一次出块时间
            await denv.updateProducerTime(this.m_storage, (this.m_block.header as BlockHeader).miner, this.m_block.header.timestamp);

            if (((this.m_block.number + 1) % Consensus.reSelectionBlocks) === 0) {
                //更新选举结果
                let ber = await denv.finishElection(this.m_storage, this.m_block.header.hash);
                if (ber.err) {
                    return ber.err;
                }

                //封禁miner、维护miner时间信息
                await denv.maintain_producer(this.m_storage, this.m_block.header.timestamp);
            }

            //维护被禁用miner信息
            if (((this.m_block.number + 1) % Consensus.unbanBlocks) === 0) {
                await denv.unbanProducer(this.m_storage, this.m_block.header.timestamp);
            }
        }
        return ErrorCode.RESULT_OK;
    }    
}
