import { ErrorCode } from '../error_code';
import { ValueBlockExecutor, BlockExecutorOptions, Chain, Receipt, IReadableStorage } from '../value_chain';
import * as consensus from './consensus';
import { DposBlockHeader } from './block';

export type DposBlockExecutorOptions = BlockExecutorOptions;

export class DposBlockExecutor extends ValueBlockExecutor {
    constructor(options: DposBlockExecutorOptions) {
        super(options);
    }

    protected get _libStorage(): IReadableStorage {
        return this.m_externParams[0].value as IReadableStorage;
    }

    public async executePostBlockEvent(): Promise<{ err: ErrorCode, receipt?: Receipt }> {
        let ebr = await super.executePostBlockEvent();
        if (ebr.err) {
            return { err: ebr.err };
        }
        if (this.m_block.number > 0) {
            let dbr = await this.m_storage.getReadWritableDatabase(Chain.dbSystem);
            if (dbr.err) {
                this.m_logger.error(`execute block failed for get system database from curr storage ,code=${dbr.err}`);
                return { err: dbr.err };
            }
            let denv = new consensus.Context({currDatabase: dbr.value!, globalOptions: this.m_globalOptions, logger: this.m_logger});
            // 修改miner的最后一次出块时间
            // 创世快不算时间，因为创世快产生后可能很长时间才开始出其他块的
            await denv.updateProducerTime((this.m_block.header as DposBlockHeader).miner, this.m_block.header.timestamp);

            // 维护被禁用miner信息
            if (this.m_block.number % this.m_globalOptions.unbanBlocks === 0) {
                await denv.unbanProducer(this.m_block.header.timestamp);
            }

            await denv.checkIfNeedBan(this.m_block.header.timestamp);

            let bReSelect = false;
            if (this.m_block.number % this.m_globalOptions.reSelectionBlocks === 0) {
                // 先禁用那些超过最长时间不出块的miner
                await denv.banProducer(this.m_block.header.timestamp);
                // 更新选举结果

                let hr = await this._libStorage.getReadableDataBase(Chain.dbSystem);
                if (hr.err) {
                    this.m_logger.error(`execute block failed for get system database from lib storage ,code=${dbr.err}`);
                    return { err: hr.err };
                }

                let ber = await denv.finishElection(hr.value!, this.m_block.header.timestamp.toString());
                if (ber.err) {
                    return { err: ber.err };
                }
                bReSelect = true;
            }

            if (this.m_block.number === 1 || bReSelect) {
                // 维护miner时间信息
                await denv.maintain_producer(this.m_block.header.timestamp);
            }
        }

        return ebr;
    }
}
