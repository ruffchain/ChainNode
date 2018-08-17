import {ErrorCode} from '../error_code';
import {isNullOrUndefined} from 'util';
import {Chain, ChainTypeOptions, ValueChain, BaseHandler, Block, ValueTransactionContext, ValueEventContext, ValueViewContext, IReadableStorage, Storage, BlockExecutor, BlockHeader, ViewExecutor} from '../value_chain';
import {DbftChainNode} from './chain_node';
import {DbftBlockHeader} from './block';
import {DBFTSProxy} from './dbftProxy';
import {LRUCache} from '../lib/LRUCache';
import {DbftBlockExecutor} from './executor';
import * as ValueContext from '../value_chain/context';
import {LoggerOptions} from '../lib/logger_util';

const initMinersSql = 'CREATE TABLE IF NOT EXISTS "miners"("hash" CHAR(64) PRIMARY KEY NOT NULL UNIQUE, "miners" TEXT NOT NULL);';
const updateMinersSql = 'REPLACE INTO miners (hash, miners) values ($hash, $miners)';
const getMinersSql = 'SELECT miners FROM miners WHERE hash=$hash';

export type DbftTransactionContext = {
    register: (address: string, pubkey: string, pubkeySign: string) => Promise<ErrorCode>;
    unregister: (address: string, addressSign: string) => Promise<ErrorCode>;
} & ValueTransactionContext;

export type DbftEventContext = {
    register: (address: string, pubkey: string, pubkeySign: string) => Promise<ErrorCode>;
    unregister: (address: string, addressSign: string) => Promise<ErrorCode>;
} & ValueEventContext;

export type DbftViewContext = {
    getMiners: () => Promise<{address: string, pubkey: string}[]>;
    isMiner: (address: string) => Promise<boolean>;
} & ValueViewContext;

type MinerType = {address: string, pubkey: string};

export class DbftChain extends ValueChain {
    protected m_minerCache: LRUCache<string, MinerType[]> = new LRUCache(12);
    constructor(options: LoggerOptions) {
        super(options);
    }

    on(event: 'tipBlock', listener: (chain: DbftChain, block: DbftBlockHeader) => void): this;
    on(event: 'minerChange', listener: (header: DbftBlockHeader) => void): this;
    on(event: string, listener: any): this {
        super.on(event as 'tipBlock', listener);
        return this;
    }

    public async newBlockExecutor(block: Block, storage: Storage): Promise<{err: ErrorCode, executor?: BlockExecutor}> {
        let kvBalance = (await storage.getKeyValue(Chain.dbSystem, ValueChain.kvBalance)).kv!;

        let ve = new ValueContext.Context(kvBalance);
        let externalContext = Object.create(null);
        externalContext.getBalance = async (address: string): Promise<BigNumber> => {
            return await ve.getBalance(address);
        };
        externalContext.transferTo = async (address: string, amount: BigNumber): Promise<ErrorCode> => {
            return await ve.transferTo(ValueChain.sysAddress, address, amount);
        };
        
        let dbftProxy: DBFTSProxy = new DBFTSProxy(storage, this.globalOptions, this.logger);
        externalContext.register = async (address: string, pubkey: string, pubkeySign: string): Promise<ErrorCode> => {
           return await dbftProxy.registerToCandidate(block.number, address, Buffer.from(pubkey, 'hex'), Buffer.from(pubkeySign, 'hex'));
        };
        externalContext.unregister = async (address: string, addressSign: string): Promise<ErrorCode> => {
            return await dbftProxy.unRegisterToCandidate(address, Buffer.from(addressSign, 'hex'));
        };

        externalContext.getMiners = async (): Promise<{address: string, pubkey: string}[]> => {
            let gm = await dbftProxy.getMiners();
            if (gm.err) {
               throw Error('newBlockExecutor getMiners failed errcode ${gm.err}');
            }

            return gm.miners!;
        };

        externalContext.isMiner = async (address: string): Promise<boolean> => {
            let im = await dbftProxy.isMiners(address);
            if (im.err) {
                throw Error('newBlockExecutor isMiner failed errcode ${gm.err}');
            }

            return im.isminer!;
        };

        let executor = new DbftBlockExecutor({logger: this.logger, block, storage, handler: this.handler, externContext: externalContext, globalOptions: this.globalOptions});
        return {err: ErrorCode.RESULT_OK, executor: executor as BlockExecutor};
    }

    public async newViewExecutor(header: BlockHeader, storage: IReadableStorage, method: string, param: Buffer|string|number|undefined): Promise<{err: ErrorCode, executor?: ViewExecutor}> {
        let nvex = await super.newViewExecutor(header, storage, method, param);
        let externalContext = nvex.executor!.externContext;

        let dbftProxy: DBFTSProxy = new DBFTSProxy(storage, this.globalOptions, this.logger);
        externalContext.getMiners = async (): Promise<{address: string, pubkey: string}[]> => {
            let gm = await dbftProxy.getMiners();
            if (gm.err) {
               throw Error('newBlockExecutor getMiners failed errcode ${gm.err}');
            }

            return gm.miners!;
        };

        externalContext.isMiner = async (address: string): Promise<boolean> => {
            let im = await dbftProxy.isMiners(address);
            if (im.err) {
                throw Error('newBlockExecutor isMiner failed errcode ${gm.err}');
            }

            return im.isminer!;
        };

        return nvex;
    }

    protected async _createChainNode(): Promise<{err: ErrorCode, node?: DbftChainNode}> {
        let node: DbftChainNode = new DbftChainNode({
            node: this.m_instanceOptions!.node,
            blockHeaderType: this._getBlockHeaderType(),
            transactionType: this._getTransactionType(),
            blockStorage: this.blockStorage,
            headerStorage: this.headerStorage,
            storageManager: this.storageManager,
            logger: this.logger,
            minOutbound: this.m_instanceOptions!.minOutbound,
            blockTimeout: this.m_instanceOptions!.blockTimeout,
            dataDir: this.dataDir,
        });

        return {err: ErrorCode.RESULT_OK, node};
    }

    public async initComponents(dataDir: string, handler: BaseHandler): Promise<ErrorCode> {
        let err = await super.initComponents(dataDir, handler);
        if (err) {
            return err;
        }

        try {
            await this.m_db!.run(initMinersSql);
            return ErrorCode.RESULT_OK;
        } catch (e) {
            this.logger.error(e);
            return ErrorCode.RESULT_EXCEPTION;
        }
    }

    public async getMiners(header: DbftBlockHeader): Promise<{err: ErrorCode, miners?: {address: string, pubkey: string}[]}> {
        return await this._getMiners(header, false);
    }

    public async getNextMiners(header: DbftBlockHeader): Promise<{err: ErrorCode, miners?: {address: string, pubkey: string}[]}> {
        return await this._getMiners(header, true);
    }

    protected async _getMiners(header: DbftBlockHeader, bNext: boolean): Promise<{err: ErrorCode, miners?: {address: string, pubkey: string}[]}> {
        let en = DBFTSProxy.getElectionBlockNumber(this.globalOptions, bNext ? header.number + 1 : header.number);
        let electionHeader: DbftBlockHeader;
        if (header.number === en) {
            electionHeader = header;
        } else {
            let hr = await this.getHeader(header.preBlockHash, en - header.number + 1);
            if (hr.err) {
                this.logger.error(`dbft get electionHeader error,number=${header.number},prevblockhash=${header.preBlockHash}`);
                return { err: hr.err };
            }
            electionHeader = hr.header as DbftBlockHeader;
        }

        let miners: MinerType[] | null = this.m_minerCache.get(electionHeader.hash);
        if (miners) {
            return {err: ErrorCode.RESULT_OK, miners};
        }

        try {
            const gm = await this.m_db!.get(getMinersSql, {$hash: electionHeader.hash});
            if (!gm || !gm.miners) {
                this.logger.error(`getMinersSql error,election block hash=${electionHeader.hash},en=${en},header.height=${header.number}`);
                return {err: ErrorCode.RESULT_NOT_FOUND};
            }

            this.m_minerCache.set(electionHeader.hash, JSON.parse(gm.miners));
            return {err: ErrorCode.RESULT_OK, miners: JSON.parse(gm.miners)};
        } catch (e) {
            this.logger.error(e);
            return {err: ErrorCode.RESULT_EXCEPTION};
        }
    }

    protected async _onVerifiedBlock(block: Block): Promise<ErrorCode> {
        let b = DBFTSProxy.isElectionBlockNumber(this.globalOptions, block.number);
        if (!DBFTSProxy.isElectionBlockNumber(this.globalOptions, block.number)) {
            return ErrorCode.RESULT_OK;
        }

        let gs = await this.storageManager.getSnapshotView(block.hash);
        if (gs.err) {
            return gs.err;
        }

        let minersInfo = await (new DBFTSProxy(gs.storage!, this.globalOptions, this.m_logger)).getMiners();
        this.storageManager.releaseSnapshotView(block.hash);
        if (minersInfo.err) {
            return minersInfo.err;
        }
        try {
            await this.m_db!.run(updateMinersSql, {$hash: block.hash, $miners: JSON.stringify(minersInfo.miners!)});
            if (DBFTSProxy.isElectionBlockNumber(this.globalOptions, block.number)) {
                this.emit('minerChange', block.header);
            }
            return ErrorCode.RESULT_OK;
        } catch (e) {
            this.logger.error(e);
            return ErrorCode.RESULT_EXCEPTION;
        }
    }

    protected _getBlockHeaderType() {
        return DbftBlockHeader;
    }

    onCheckGlobalOptions(globalOptions: any): boolean {
        if (!super.onCheckGlobalOptions(globalOptions)) {
            return false;
        }
        if (isNullOrUndefined(globalOptions.minValidator)) {
            this.m_logger.error(`globalOptions should has minValidator`);
            return false;
        }
        if (isNullOrUndefined(globalOptions.maxValidator)) {
            this.m_logger.error(`globalOptions should has maxValidator`);
            return false;
        }
        if (isNullOrUndefined(globalOptions.reSelectionBlocks)) {
            this.m_logger.error(`globalOptions should has reSelectionBlocks`);
            return false;
        }
        if (isNullOrUndefined(globalOptions.blockInterval)) {
            this.m_logger.error(`globalOptions should has blockInterval`);
            return false;
        }
        if (isNullOrUndefined(globalOptions.minWaitBlocksToMiner)) {
            this.m_logger.error(`globalOptions should has minWaitBlocksToMiner`);
            return false;
        }
        if (isNullOrUndefined(globalOptions.systemPubkey)) {
            this.m_logger.error(`globalOptions should has systemPubkey`);
            return false;
        }
        return true;
    }

    protected _onCheckTypeOptions(typeOptions: ChainTypeOptions): boolean {
        return typeOptions.consensus === 'dbft';
    }
}