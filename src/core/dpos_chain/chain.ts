import { BigNumber } from 'bignumber.js';
import { ErrorCode } from '../error_code';
import { Chain, ChainTypeOptions, Block, ValueTransactionContext, ValueEventContext, ValueViewContext, ValueChain, Storage, BlockExecutor, BlockHeader, IReadableStorage, ViewExecutor, ChainContructOptions, ChainInstanceOptions, BlockExecutorExternParam } from '../value_chain';

import { DposBlockHeader } from './block';
import * as consensus from './consensus';
import * as ValueContext from '../value_chain/context';
import { DposBlockExecutor, DposBlockExecutorOptions } from './executor';
import { DposChainTipState } from './chain_state';
import { DposChainTipStateManager, IChainStateStorage, StorageIrbEntry } from './chain_state_manager';
import { LRUCache } from '../lib/LRUCache';
import { DposBftChainTipState } from '../dpos_bft_chain/chain_state';
import { SVTContext, SVTViewContext } from './svt';
import { SqliteReadWritableDatabase, SqliteReadableDatabase } from '../storage_sqlite/storage';

export type DposTransactionContext = {
    vote: (from: string, candiates: string) => Promise<ErrorCode>;
    mortgage: (from: string, amount: BigNumber) => Promise<ErrorCode>;
    unmortgage: (from: string, amount: BigNumber) => Promise<ErrorCode>;
    register: (from: string) => Promise<ErrorCode>;
    unregister: (from: string) => Promise<ErrorCode>;
    // getVote: () => Promise<Map<string, BigNumber>>;
    // getStake: (address: string) => Promise<BigNumber>;
    // getCandidates: () => Promise<string[]>;
    // getMiners(): Promise<string[]>;
} & ValueTransactionContext;

// export type DposEventContext = {
//     vote: (from: string, candiates: string) => Promise<ErrorCode>;
//     mortgage: (from: string, amount: BigNumber) => Promise<ErrorCode>;
//     unmortgage: (from: string, amount: BigNumber) => Promise<ErrorCode>;
//     register: (from: string) => Promise<ErrorCode>;
//     getVote: () => Promise<Map<string, BigNumber>>;
//     getStake: (address: string) => Promise<BigNumber>;
//     getCandidates: () => Promise<string[]>;
//     getMiners(): Promise<string[]>;
// } & ValueEventContext;

export type DposViewContext = {
    getVote: () => Promise<Map<string, BigNumber>>;
    getStake: (address: string) => Promise<BigNumber>;
    getTicket: (address: string) => Promise<any>;
    getCandidates: () => Promise<string[]>;
    getMiners(): Promise<string[]>;
} & ValueViewContext;

const initMinersSql = 'CREATE TABLE IF NOT EXISTS "miners"("hash" CHAR(64) PRIMARY KEY NOT NULL UNIQUE, "miners" TEXT NOT NULL default \'[]\', "irbhash" CHAR(64) default \'\', "irbheight" INTEGER NOT NULL default -1)';
const updateMinersSql = 'REPLACE INTO miners (hash, miners) values ($hash, $miners)';
const getMinersSql = 'SELECT miners FROM miners WHERE hash=$hash';
const saveIrbSqlUpdate = 'update "miners" set irbhash=$irbhash, irbheight=$irbheight where hash=$hash';
const saveIrbSqlReplace = 'REPLACE INTO miners (hash, irbhash, irbheight) values ($hash, $irbhash, $irbheight)';
const getIrbSql = 'select * from "miners" where hash=$hash';
const getLatestIrbSql = 'select * from "miners" where irbhash !=\'\' and irbheight != -1 order by irbheight desc';

export class DposChain extends ValueChain implements IChainStateStorage {
    protected m_epochTime: number = 0;
    protected m_stateManager: DposChainTipStateManager | undefined;
    protected m_cacheIRB: LRUCache<string, StorageIrbEntry> = new LRUCache(500);

    constructor(options: ChainContructOptions) {
        super(options);
    }

    get epochTime(): number {
        return this.m_epochTime;
    }

    get stateManager(): DposChainTipStateManager {
        return this.m_stateManager!;
    }

    get chainTipState(): DposChainTipState {
        return this.m_stateManager!.getBestChainState()!;
    }
    // DPOS中，只广播tipheader
    protected get _broadcastDepth() {
        return 0;
    }

    protected get _ignoreVerify() {
        // return true;
        // Yang Jun change at 3-5-2019
        return false;
    }

    public async initialize(instanceOptions: ChainInstanceOptions): Promise<ErrorCode> {
        let err = await super.initialize(instanceOptions);
        if (err) {
            return err;
        }
        let hr = await this.getHeader(0);
        if (hr.err) {
            return hr.err;
        }
        this.m_epochTime = hr.header!.timestamp;
        console.log('Yang Jun -- epochtime:', this.m_epochTime);
        return ErrorCode.RESULT_OK;
    }

    public async initComponents(options?: { readonly?: boolean }): Promise<ErrorCode> {
        let err = await super.initComponents(options);
        if (err) {
            return err;
        }

        const readonly = options && options.readonly;
        if (!readonly) {
            try {
                await this.m_db!.run(initMinersSql);
            } catch (e) {
                this.logger.error(e);
                return ErrorCode.RESULT_EXCEPTION;
            }
        }
        this.m_stateManager = this._createTipStateManager();
        err = await this.m_stateManager.init();
        if (!this.m_tip) {
            return ErrorCode.RESULT_OK;
        }

        return err;
    }

    protected _createTipStateManager() {
        return new DposChainTipStateManager({
            logger: this.m_logger,
            headerStorage: this.m_headerStorage!,
            getMiners: (h) => this.getMiners(h),
            globalOptions: this.m_globalOptions,
            stateStorage: this
        });
    }

    async prepareExternParams(block: Block, storage: Storage): Promise<{ err: ErrorCode, params?: BlockExecutorExternParam[] }> {
        this.m_logger.debug(`begin prepare executor extern params for ${block.hash}`);
        if (block.number === 0 || block.number % this.globalOptions.reSelectionBlocks !== 0) {
            return { err: ErrorCode.RESULT_OK, params: [] };
        }
        const csr = await this.executorParamCreator.createStorage({
            storageManager: this.storageManager,
            blockHash: this.chainTipState.IRB.hash
        });
        if (csr.err) {
            return { err: csr.err };
        }
        return { err: ErrorCode.RESULT_OK, params: [csr.param!] };
    }

    protected async _newBlockExecutor(block: Block, storage: Storage, externParams: BlockExecutorExternParam[]): Promise<{ err: ErrorCode, executor?: BlockExecutor }> {
        let kvBalance = (await storage.getKeyValue(Chain.dbSystem, ValueChain.kvBalance)).kv!;

        let ve = new ValueContext.Context(kvBalance);

        // Create context hooks
        let externalContext = Object.create(null);

        // getbalance
        externalContext.getBalance = async (address: string): Promise<BigNumber> => {
            return await ve.getBalance(address);
        };

        // transferTo
        externalContext.transferTo = async (address: string, amount: BigNumber): Promise<ErrorCode> => {
            return await ve.transferTo(ValueChain.sysAddress, address, amount);
        };

        let dbr = await storage.getReadWritableDatabase(Chain.dbSystem);
        if (dbr.err) {
            return { err: dbr.err };
        }

        // Add by Yang Jun 2019-5-21
        let dbvote = await storage.getReadWritableDatabase(Chain.dbVote);
        if (dbvote.err) {
            return { err: dbvote.err };
        }

        let dbsvt = await storage.getReadWritableDatabase(Chain.dbSVT);
        if (dbsvt.err) {
            return { err: dbsvt.err };
        }

        let dsvt = new SVTContext({
            svtDatabase: dbsvt.value!,
            voteDatabase: dbvote.value!,
            systemDatabase: dbr.value!,
            logger: this.m_logger,
            chain: this
        });

        /////////////////////////////////////////////////////////////

        let de = new consensus.Context({ currDatabase: dbr.value!, globalOptions: this.globalOptions, logger: this.m_logger! });

        // vote
        externalContext.vote = async (from: string, candiates: string[]): Promise<ErrorCode> => {
            // let vr = await de.vote(from, candiates);
            let vr = await dsvt.vote(from, candiates);
            if (vr.err) {
                throw new Error();
            }
            return vr.returnCode!;
        };

        // mortgage
        externalContext.mortgage = async (from: string, amount: BigNumber): Promise<ErrorCode> => {
            // let mr = await de.mortgage(from, amount);
            let mr = await dsvt.mortgage(from, amount);
            if (mr.err) {
                return mr.err;
            }
            return mr.returnCode!;
        };

        // unmortgage
        externalContext.unmortgage = async (from: string, amount: BigNumber): Promise<ErrorCode> => {
            // let mr = await de.unmortgage(from, amount);
            console.log('Yang Jun -- unmortgage dsvt');
            let mr = await dsvt.unmortgage(from, amount);
            if (mr.err) {
                return mr.err;
            }

            return mr.returnCode!;
        };

        // register
        externalContext.register = async (from: string): Promise<ErrorCode> => {
            // let mr = await de.registerToCandidate(from);
            // Add by Yang Jun 
            let mr = await dsvt.register(from);
            if (mr.err) {
                return mr.err;
            }

            return mr.returnCode!;
        };
        // Add by Yang Jun 2019-5-21

        // unregister
        externalContext.unregister = async (from: string): Promise<ErrorCode> => {
            let mr = await dsvt.unregister(from);
            if (mr.err) {
                // throw new Error();
                return mr.err;
            }

            return mr.returnCode!;
        };
        // externalContext.getVote = async (): Promise<Map<string, BigNumber>> => {
        //     let gvr = await de.getVote();
        //     if (gvr.err) {
        //         throw new Error();
        //     }
        //     return gvr.vote!;
        // };
        // externalContext.getStake = async (address: string): Promise<BigNumber> => {
        //     let gsr = await de.getStake(address);
        //     // Add by Yang Jun 2019-5-21
        //     console.log('Yang Jun --')
        //     console.log('_newBlockExecutor getStake');
        //     // let gsr = await dsvt.getStake(address);

        //     if (gsr.err) {
        //         throw new Error();
        //     }
        //     return gsr.stake!;
        // };
        // externalContext.getCandidates = async (): Promise<string[]> => {
        //     let gc = await de.getCandidates();
        //     if (gc.err) {
        //         throw Error();
        //     }
        //     return gc.candidates!;
        // };

        // externalContext.getMiners = async (): Promise<string[]> => {
        //     let gm = await de.getNextMiners();
        //     if (gm.err) {
        //         throw Error();
        //     }

        //     return gm.creators!;
        // };

        let options: DposBlockExecutorOptions = {
            logger: this.logger,
            block,
            storage,
            handler: this.m_handler,
            externContext: externalContext,
            globalOptions: this.m_globalOptions,
            externParams
        };
        let executor = new DposBlockExecutor(options);
        return { err: ErrorCode.RESULT_OK, executor: executor as BlockExecutor };
    }

    public async newViewExecutor(header: BlockHeader, storage: IReadableStorage, method: string, param: Buffer | string | number | undefined): Promise<{ err: ErrorCode, executor?: ViewExecutor }> {
        // Add by Yang Jun 2019-5-21
        let dbvote = await storage.getReadableDataBase(Chain.dbVote);
        if (dbvote.err) {
            return { err: dbvote.err };
        }

        let dbsvt = await storage.getReadableDataBase(Chain.dbSVT);
        if (dbsvt.err) {
            return { err: dbsvt.err };
        }

        let dbr = await storage.getReadableDataBase(Chain.dbSystem);
        if (dbr.err) {
            return { err: dbr.err };
        }

        let dsvt = new SVTViewContext({
            svtDatabase: dbsvt.value!,
            voteDatabase: dbvote.value!,
            systemDatabase: dbr.value!,
            logger: this.m_logger,
            chain: this
        });
        console.log('Yang Jun -- epochTime', this.epochTime);

        ////////////////////////////

        let nvex = await super.newViewExecutor(header, storage, method, param);

        let externalContext = nvex.executor!.externContext;

        let de = new consensus.ViewContext({ currDatabase: dbr.value!, globalOptions: this.m_globalOptions, logger: this.logger });

        // getvote
        externalContext.getVote = async (): Promise<Map<string, BigNumber>> => {
            let gvr = await de.getVote();
            if (gvr.err) {
                throw new Error();
            }
            return gvr.vote!;
        };

        // getticket
        // externalContext.getTicket = async (address: string): Promise<Map<string, BigNumber>> => {
        //     let gvr = await dsvt.getTicket(address);
        //     if (gvr.err) {
        //         throw new Error();
        //     }
        //     return gvr.value!;
        // };

        // getstake
        externalContext.getStake = async (address: string): Promise<BigNumber> => {
            // let gsr = await de.getStake(address);
            // Add by Yang Jun 2019-5-21
            console.log('Yang Jun --');
            console.log('newViewExecutor getStake');

            let gsr = await dsvt.getStake(address);
            if (gsr.err) {
                throw new Error();
            }
            return gsr.stake!;
        };

        // getticket
        externalContext.getTicket = async (address: string): Promise<any> => {
            let gvr = await dsvt.getTicket(address);
            if (gvr.err) {
                // throw new Error();
                console.log('Error: getticket()', gvr.err);
            }
            return gvr.value!;
        };

        // getcandidates
        externalContext.getCandidates = async (): Promise<string[]> => {
            let gc = await de.getCandidates();
            if (gc.err) {
                throw Error();
            }

            return gc.candidates!;
        };

        // getminers
        externalContext.getMiners = async (): Promise<string[]> => {
            let gm = await de.getNextMiners();
            if (gm.err) {
                throw Error();
            }

            return gm.creators!;
        };

        return nvex;
    }

    protected async _verifyAndSaveHeaders(headers: BlockHeader[]): Promise<{ err: ErrorCode, toRequest?: BlockHeader[] }> {
        if (headers.length === 0) {
            return await super._verifyAndSaveHeaders(headers);
        }

        let header = headers[headers.length - 1];
        let now = Math.ceil(Date.now() / 1000);
        if (header.timestamp > now) {
            this.logger.error(`dpos chain _verifyAndSaveHeaders last block time ${header.timestamp} must small now ${now}`);
            return { err: ErrorCode.RESULT_INVALID_BLOCK };
        }
        let hr = await this.getHeader(headers[0].preBlockHash);
        if (hr.err) {
            this.logger.warn(`dpos chain _verifyAndSaveHeaders get prev header failed prevhash=${headers[0].preBlockHash} hash=${headers[0].hash}`);
            return { err: hr.err };
        }
        if (headers[0].timestamp - hr.header!.timestamp < this.globalOptions.blockInterval) {
            this.logger.error(`1 dpos chain _verifyAndSaveHeaders curr block time ${headers[0].timestamp} - prevtime ${hr.header!.timestamp} small blockinterval ${this.globalOptions.blockInterval}`);
            return { err: ErrorCode.RESULT_INVALID_BLOCK };
        }

        for (let i = 1; i < headers.length; i++) {
            if (headers[i].timestamp - headers[i - 1].timestamp < this.globalOptions.blockInterval) {
                this.logger.error(`2 dpos chain _verifyAndSaveHeaders curr block time ${headers[i].timestamp} - prevtime ${headers[i - 1].timestamp} small blockinterval ${this.globalOptions.blockInterval}`);
                return { err: ErrorCode.RESULT_INVALID_BLOCK };
            }
        }

        return await super._verifyAndSaveHeaders(headers);
    }

    protected async _compareWork(comparedHeader: DposBlockHeader, bestChainTip: DposBlockHeader): Promise<{ err: ErrorCode, result?: number }> {
        let hr = await this.m_stateManager!.compareIRB(comparedHeader, bestChainTip);
        if (hr.err) {
            return { err: hr.err };
        }
        if (hr.result !== 0) {
            return hr;
        }
        // 不可逆点相同，更长的链优先
        let height = comparedHeader.number - bestChainTip.number;
        if (height !== 0) {
            return { err: ErrorCode.RESULT_OK, result: height };
        }
        // 高度相同更晚的优先
        let leftIndex = comparedHeader.getTimeIndex(this);
        let rightIndex = bestChainTip.getTimeIndex(this);
        let time = leftIndex - rightIndex;
        if (time !== 0) {
            return { err: ErrorCode.RESULT_OK, result: time };
        }
        // 时间戳都相同， 就算了， 很罕见吧， 随缘
        return { err: ErrorCode.RESULT_OK, result: time };
    }

    protected async _calcuteReqLimit(fromHeader: string, limit: number) {
        let hr = await this.getHeader(fromHeader);
        let reSelectionBlocks = this.globalOptions!.reSelectionBlocks;
        return reSelectionBlocks - (hr.header!.number % reSelectionBlocks);
    }

    protected async _onMorkSnapshot(options: { tip: BlockHeader, toMork: Set<string> }): Promise<{ err: ErrorCode }> {
        options.toMork.add(this.chainTipState.IRB.hash);
        return { err: ErrorCode.RESULT_OK };
    }

    public async getMiners(header: DposBlockHeader): Promise<{ err: ErrorCode, header?: DposBlockHeader, creators?: string[] }> {
        let en = consensus.ViewContext.getElectionBlockNumber(this.globalOptions, header.number);
        let electionHeader: DposBlockHeader;
        if (header.number === en) {
            electionHeader = header;
        } else {
            let hr = await this.getHeader(header.preBlockHash, en - header.number + 1);
            if (hr.err) {
                this.logger.error(`get electionHeader error,number=${header.number},prevblockhash=${header.preBlockHash}`);
                return { err: hr.err };
            }
            electionHeader = hr.header as DposBlockHeader;
        }

        try {
            const gm = await this.m_db!.get(getMinersSql, { $hash: electionHeader.hash });
            if (!gm || !gm.miners) {
                this.logger.error(`getMinersSql error,election block hash=${electionHeader.hash},en=${en},header.height=${header.number}`);
                return { err: ErrorCode.RESULT_NOT_FOUND };
            }

            let creators = JSON.parse(gm.miners);
            if (!creators.length) {
                this.logger.error(`getMinersSql error,election block hash=${electionHeader.hash},en=${en},header.height=${header.number}, length=0`);
                return { err: ErrorCode.RESULT_NOT_FOUND };
            }

            return { err: ErrorCode.RESULT_OK, header: electionHeader, creators };
        } catch (e) {
            this.logger.error(`getMiners exception, e=${e}`);
            return { err: ErrorCode.RESULT_EXCEPTION };
        }
    }

    protected async _onUpdateTip(header: BlockHeader): Promise<ErrorCode> {
        const err = await super._onUpdateTip(header);
        if (err) {
            return err;
        }
        if (header.number === 0) {
            return ErrorCode.RESULT_OK;
        }
        let hr = await this.m_stateManager!.onUpdateTip(header as DposBlockHeader);
        if (hr.err) {
            return hr.err;
        }
        this.logger.info(`==========dpos chain state=${this.chainTipState.dump()}`);
        // Added by yang Jun 2019-3-30
        // 
        // this.logger.info('Yang Jun output:');
        // console.log('iRB: ', this.chainTipState.getIRB());
        // console.log('proposedIRB ', this.chainTipState.getProposedIRB());
        // console.log('bftirb ', (this.chainTipState as DposBftChainTipState).getBftIRB());
        return ErrorCode.RESULT_OK;
    }

    public async saveIRB(header: DposBlockHeader, irbHeader: DposBlockHeader): Promise<ErrorCode> {
        try {
            if (header.number === 0 || header.number % this.globalOptions.reSelectionBlocks === 0) {
                await this.m_db!.run(saveIrbSqlUpdate, { $hash: header.hash, $irbhash: irbHeader.hash, $irbheight: irbHeader.number });
            } else {
                await this.m_db!.run(saveIrbSqlReplace, { $hash: header.hash, $irbhash: irbHeader.hash, $irbheight: irbHeader.number });
            }
        } catch (e) {
            this.logger.error(`dpos chain save irb failed, e=${e}`);
            return ErrorCode.RESULT_EXCEPTION;
        }
        let entry: StorageIrbEntry = { tipHash: header.hash, irbHash: irbHeader.hash, irbHeight: irbHeader.number };
        this.m_cacheIRB.set(header.hash, entry);
        return ErrorCode.RESULT_OK;
    }

    public async getIRB(blockHash: string): Promise<{ err: ErrorCode, irb?: StorageIrbEntry }> {
        let irb = this.m_cacheIRB.get(blockHash);
        if (irb) {
            return { err: ErrorCode.RESULT_OK, irb };
        }
        try {
            let gh: any;
            if (blockHash === 'latest') {
                gh = await this.m_db!.get(getLatestIrbSql);
            } else {
                gh = await this.m_db!.get(getIrbSql, { $hash: blockHash });
            }
            if (!gh || !gh.irb || !gh.irbhash.length || gh.irb.irbheight === -1) {
                return { err: ErrorCode.RESULT_NOT_FOUND };
            }

            let entry: StorageIrbEntry = { tipHash: gh.hash, irbHash: gh.irbhash, irbHeight: gh.irbheight };
            this.m_cacheIRB.set(blockHash, entry);
            return { err: ErrorCode.RESULT_OK, irb: entry };
        } catch (e) {
            this.m_logger.error(`dpos chain get irb exception, e=${e}`);
            return { err: ErrorCode.RESULT_EXCEPTION };
        }
    }

    protected async _onBestBlock(header: BlockHeader): Promise<ErrorCode> {
        return await this._saveMiners(header);
    }

    protected async _onForkBlock(header: BlockHeader): Promise<ErrorCode> {
        return await this._saveMiners(header);
    }

    protected async _saveMiners(header: BlockHeader): Promise<ErrorCode> {
        if (header.number !== 0 && header.number % this.globalOptions.reSelectionBlocks !== 0) {
            return ErrorCode.RESULT_OK;
        }

        let gs = await this.storageManager.getSnapshotView(header.hash);
        if (gs.err) {
            return gs.err;
        }
        let dbr = await gs.storage!.getReadableDataBase(Chain.dbSystem);
        if (dbr.err) {
            return dbr.err;
        }
        let viewDenv = new consensus.ViewContext({ currDatabase: dbr.value!, globalOptions: this.globalOptions, logger: this.m_logger! });
        let minersInfo = await viewDenv.getNextMiners();
        this.storageManager.releaseSnapshotView(header.hash);
        if (minersInfo.err) {
            return minersInfo.err;
        }
        try {
            await this.m_db!.run(updateMinersSql, { $hash: header.hash, $miners: JSON.stringify(minersInfo.creators!) });
            return ErrorCode.RESULT_OK;
        } catch (e) {
            this.logger.error(e);
            return ErrorCode.RESULT_EXCEPTION;
        }
    }

    protected _onCheckGlobalOptions(globalOptions: any): boolean {
        if (!super._onCheckGlobalOptions(globalOptions)) {
            return false;
        }
        return consensus.onCheckGlobalOptions(globalOptions);
    }

    protected _getBlockHeaderType() {
        return DposBlockHeader;
    }

    protected _onCheckTypeOptions(typeOptions: ChainTypeOptions): boolean {
        return typeOptions.consensus === 'dpos';
    }

    async onCreateGenesisBlock(block: Block, storage: Storage, genesisOptions: any): Promise<ErrorCode> {
        let err = await super.onCreateGenesisBlock(block, storage, genesisOptions);
        if (err) {
            return err;
        }
        let gkvr = await storage.getKeyValue(Chain.dbSystem, Chain.kvConfig);
        if (gkvr.err) {
            return gkvr.err;
        }
        let rpr = await gkvr.kv!.set('consensus', 'dpos');
        if (rpr.err) {
            return rpr.err;
        }

        let dbr = await storage.getReadWritableDatabase(Chain.dbSystem);
        if (dbr.err) {
            return dbr.err;
        }
        // storage的键值对要在初始化的时候就建立好
        let kvr = await dbr.value!.createKeyValue(consensus.ViewContext.kvDPOS);
        if (kvr.err) {
            return kvr.err;
        }

        let denv = new consensus.Context({ currDatabase: dbr.value!, globalOptions: this.globalOptions, logger: this.m_logger! });

        let ir = await denv.init(genesisOptions.candidates, genesisOptions.miners);
        if (ir.err) {
            return ir.err;
        }

        return ErrorCode.RESULT_OK;
    }

    getLIB(): DposBlockHeader {
        return this.chainTipState.IRB;
    }
    // Yang Jun 2019-3-18
    getCustomLIB(): number {
        return this.chainTipState.getIRB();
    }
}
