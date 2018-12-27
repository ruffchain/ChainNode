import * as fs from 'fs-extra';
import * as path from 'path';
import {ErrorCode, stringifyErrorCode} from './error_code';
import {BigNumber} from 'bignumber.js';
import { TmpManager } from './lib/tmp_manager';
import {ChainCreator} from './chain_creator';
import {JsonStorage} from './storage_json/storage';
import {SqliteStorage} from './storage_sqlite/storage';
import { LoggerInstance } from './lib/logger_util';
import {Chain, Block, Transaction, BlockHeader, Receipt, BlockHeightListener} from './chain';
import {ValueTransaction, ValueBlockHeader, ValueBlockExecutor, ValueReceipt, BlockContent} from './value_chain';
import {createKeyPair, addressFromSecretKey} from './address';
import {Storage, StorageDumpSnapshotManager, StorageManager, StorageLogSnapshotManager} from './storage';
import { isArray, isNullOrUndefined } from 'util';

export class ValueChainDebugSession {
    constructor(private readonly debuger: ValueChainDebuger) {
        
    }
    private m_dumpSnapshotManager?: StorageDumpSnapshotManager;
    private m_storageManager?: StorageManager;
    async init(options: {storageDir: string}): Promise<ErrorCode> {
        const chain = this.debuger.chain;
        const dumpSnapshotManager = new StorageDumpSnapshotManager({
            logger: chain.logger,
            path: options.storageDir
        });
        this.m_dumpSnapshotManager = dumpSnapshotManager;
        const snapshotManager = new StorageLogSnapshotManager({
            path: chain.storageManager.path,
            headerStorage: chain.headerStorage, 
            storageType: JsonStorage,
            logger: chain.logger,
            dumpSnapshotManager
        });
        const tmpManager = new TmpManager({
            root: options.storageDir, 
            logger: chain.logger
        });
        let err = tmpManager.init({clean: true});
        if (err) {
            chain.logger.error(`ValueChainDebugSession init tmpManager init failed `, stringifyErrorCode(err));
            return err;
        }
        const storageManager = new StorageManager({
            tmpManager, 
            path: options.storageDir,
            storageType: JsonStorage,
            logger: chain.logger,
            snapshotManager
        });
        this.m_storageManager = storageManager;
        err = await this.m_storageManager.init();
        if (err) {
            chain.logger.error(`ValueChainDebugSession init storageManager init failed `, stringifyErrorCode(err));
            return err;
        }
        const ghr = await chain.headerStorage.getHeader(0);
        if (ghr.err) {
            chain.logger.error(`ValueChainDebugSession init get genesis header failed `, stringifyErrorCode(ghr.err));
            return ghr.err;
        }

        const genesisHash = ghr.header!.hash;
        const gsr = await this.m_dumpSnapshotManager.getSnapshot(genesisHash);
        if (!gsr.err) {
            return ErrorCode.RESULT_OK;
        } else if (gsr.err !== ErrorCode.RESULT_NOT_FOUND) {
            chain.logger.error(`ValueChainDebugSession init get gensis dump snapshot err `, stringifyErrorCode(gsr.err));
            return gsr.err;
        }

        const gsvr = await chain.storageManager.getSnapshotView(genesisHash);
        if (gsvr.err) {
            chain.logger.error(`ValueChainDebugSession init get gensis dump snapshot err `, stringifyErrorCode(gsvr.err));
            return gsvr.err;
        }
        const srcStorage = gsvr.storage as SqliteStorage;
        let csr = await storageManager.createStorage('genesis');
        if (csr.err) {
            chain.logger.error(`ValueChainDebugSession init create genesis memory storage failed `, stringifyErrorCode(csr.err));
            return csr.err;
        }
        const dstStorage = csr.storage as JsonStorage;
        const tjsr = await srcStorage.toJsonStorage(dstStorage);
        if (tjsr.err) {
            chain.logger.error(`ValueChainDebugSession init transfer genesis memory storage failed `, stringifyErrorCode(tjsr.err));
            return tjsr.err;
        }

        csr = await this.m_storageManager.createSnapshot(dstStorage, genesisHash, true);
        if (csr.err) {
            chain.logger.error(`ValueChainDebugSession init create genesis memory dump failed `, stringifyErrorCode(csr.err));
            return csr.err;
        }

        return ErrorCode.RESULT_OK;
    }

    async block(hash: string): Promise<{err: ErrorCode}> {
        const chain = this.debuger.chain;
        const block = chain.blockStorage.get(hash);
        if (!block) {
            chain.logger.error(`block ${hash} not found`);
            return {err: ErrorCode.RESULT_NOT_FOUND};
        }
        const csr = await this.m_storageManager!.createStorage(hash, block.header.preBlockHash);
        if (csr.err) {
            chain.logger.error(`block ${hash} create pre block storage failed `, stringifyErrorCode(csr.err));
        }
        const {err} = await this.debuger.debugBlock(csr.storage as JsonStorage, block);
        csr.storage!.remove();
        return {err};
    }

    async transaction(hash: string): Promise<{err: ErrorCode}> {
        const chain = this.debuger.chain;
        const gtrr = await chain.getTransactionReceipt(hash);
        if (gtrr.err) {
            chain.logger.error(`transaction ${hash} get receipt failed `, stringifyErrorCode(gtrr.err));
            return {err: gtrr.err};
        }
        return this.block(gtrr.block!.hash);
    }

    async view(from: string, method: string, params: any): Promise<{err: ErrorCode, value?: any}> {
        const chain = this.debuger.chain;
        
        let hr = await chain.headerStorage.getHeader(from);
        if (hr.err !== ErrorCode.RESULT_OK) {
            chain.logger!.error(`view ${method} failed for load header ${from} failed for ${hr.err}`);
            return {err: hr.err};
        }
        let header = hr.header!;
        let svr = await this.m_storageManager!.getSnapshotView(header.hash);
        if (svr.err !== ErrorCode.RESULT_OK) {
            chain.logger!.error(`view ${method} failed for get snapshot ${header.hash} failed for ${svr.err}`);
            return { err: svr.err };
        }
        const ret = await this.debuger.debugView(svr.storage as JsonStorage, header, method, params);

        this.m_storageManager!.releaseSnapshotView(header.hash);

        return ret;
    }
}

export class ValueIndependDebugSession {
    private m_storage?: Storage;
    private m_curBlock?: {
        header: ValueBlockHeader,
        transactions: ValueTransaction[],
        receipts: Receipt[]
    };
    private m_accounts?: Buffer[];
    private m_interval?: number;
    private m_fakeNonces: Map<string, number>;
    constructor(private readonly debuger: ValueChainDebuger) {
        this.m_fakeNonces = new Map();
    }

    async init(options: {
        height: number, 
        accounts: Buffer[] | number, 
        coinbase: number,
        interval: number,
        preBalance?: BigNumber,
        memoryStorage?: boolean,
        storageDir?: string
    }): Promise<{err: ErrorCode, blocks?: Block[]}> {
        const storageOptions = Object.create(null);
        storageOptions.memory = options.memoryStorage;
        if (!(isNullOrUndefined(options.memoryStorage) || options.memoryStorage)) {
            const storageDir = options.storageDir!;
            fs.ensureDirSync(storageDir);
            const storagePath = path.join(storageDir, `${Date.now()}`);
            storageOptions.path = storagePath;
        }
        const csr = await this.debuger.createStorage(storageOptions);
        if (csr.err) {
            return {err: csr.err};
        }
        this.m_storage = csr.storage!;
        this.m_storage.createLogger();
        if (isArray(options.accounts)) {
            this.m_accounts = options.accounts.map((x) => Buffer.from(x));
        } else {
            this.m_accounts = [];
            for (let i = 0; i < options.accounts; ++i) {
                this.m_accounts.push(createKeyPair()[1]);
            }
        }
        this.m_interval = options.interval;
        const chain = this.debuger.chain;
        let gh = chain.newBlockHeader() as ValueBlockHeader;
        gh.timestamp = Date.now() / 1000;
        let block = chain.newBlock(gh);

        let genesissOptions: any = {};
        genesissOptions.candidates = [];
        genesissOptions.miners = [];
        genesissOptions.coinbase = addressFromSecretKey(this.m_accounts[options.coinbase]);
        if (options.preBalance) {
            genesissOptions.preBalances = [];
            this.m_accounts.forEach((value) => {
                genesissOptions.preBalances.push({address: addressFromSecretKey(value), amount: options.preBalance});
            });
        }  
        const err = await chain.onCreateGenesisBlock(block, csr.storage!, genesissOptions);
        if (err) {
            chain.logger.error(`onCreateGenesisBlock failed for `, stringifyErrorCode(err));
            return {err};
        }
        block.header.updateHash();
        const dber = await this.debuger.debugBlockEvent(this.m_storage!, block.header, {preBlock: true});
        if (dber.err) {
            return {err};
        }
        this.m_curBlock = {
            header: block.header as ValueBlockHeader,
            transactions: [],
            receipts: []
        };
        this.m_curBlock.receipts.push(...dber.receipts!);
        if (options.height > 0) {
            return await this.updateHeightTo(options.height, options.coinbase);
        }
        return {err: ErrorCode.RESULT_OK};
    }

    get curHeader(): ValueBlockHeader {
        return this.m_curBlock!.header;
    }

    get storage(): Storage {
        return this.m_storage!;
    }

    async updateHeightTo(height: number, coinbase: number): Promise<{err: ErrorCode, blocks?: Block[]}> {
        if (height <= this.m_curBlock!.header.number) {
            this.debuger.chain.logger.error(`updateHeightTo ${height} failed for current height ${this.m_curBlock!.header.number} is larger`); 
            return {err: ErrorCode.RESULT_INVALID_PARAM};
        }
        const offset = height - this.m_curBlock!.header.number;
        let blocks = [];
        for (let i = 0; i < offset; ++i) {
            const nhr = await this._nextHeight(coinbase, []);
            if (nhr.err) {
                return {err: nhr.err};
            }
            blocks.push(nhr.block!);
        }
        return {err: ErrorCode.RESULT_OK, blocks};
    }

    nextHeight(coinbase: number, transactions: ValueTransaction[]): Promise<{err: ErrorCode, block?: Block}> {
        return this._nextHeight(coinbase, transactions);
    }

    protected async _nextHeight(coinbase: number, transactions: ValueTransaction[]): Promise<{err: ErrorCode, block?: Block}> {
        let curHeader =  this.m_curBlock!.header;

        for (let tx of transactions) {
            const dtr = await this.debuger.debugTransaction(this.m_storage!, curHeader, tx);
            if (dtr.err) {
                return {err: dtr.err};
            }
            this.m_curBlock!.transactions.push(tx);
            this.m_curBlock!.receipts.push(dtr.receipt!);
        }

        let dber = await this.debuger.debugBlockEvent(this.m_storage!, curHeader, {postBlock: true});
        if (dber.err) {
            return {err: dber.err};
        }
        this.m_curBlock!.receipts.push(...dber.receipts!);

        let block = this.debuger.chain.newBlock(this.m_curBlock!.header);
        for (const tx of this.m_curBlock!.transactions) {
            block.content.addTransaction(tx);
        }
        block.content.setReceipts(this.m_curBlock!.receipts);
        block.header.updateHash();
        
        let header = this.debuger.chain.newBlockHeader() as ValueBlockHeader;
        header.timestamp = curHeader.timestamp + this.m_interval!;
        header.coinbase = addressFromSecretKey(this.m_accounts![coinbase])!;
        header.setPreBlock(block.header);
        this.m_curBlock = {
            header: header as ValueBlockHeader,
            transactions: [],
            receipts: []
        };
        dber = await this.debuger.debugBlockEvent(this.m_storage!, curHeader, 
            {preBlock: true});
        if (dber.err) {
            return {err: dber.err};
        }
        this.m_curBlock!.receipts.push(...dber.receipts!);
        return {err: ErrorCode.RESULT_OK, block};
    }

    createTransaction(options: {caller: number|Buffer, method: string, input: any, value: BigNumber, fee: BigNumber, nonce?: number}): ValueTransaction {
        const tx = new ValueTransaction();
        tx.fee = new BigNumber(0);
        tx.value = new BigNumber(options.value);
        tx.method = options.method;
        tx.input = options.input;
        tx.fee = options.fee;
        let pk: Buffer;
        if (Buffer.isBuffer(options.caller)) {
            pk = options.caller;
        } else {
            pk = this.m_accounts![options.caller]!;
        }
        tx.nonce = isNullOrUndefined(options.nonce) ? 0 : options.nonce;
        tx.sign(pk);
        return tx;
    }

    async transaction(options: {caller: number|Buffer, method: string, input: any, value: BigNumber, fee: BigNumber, nonce?: number}): Promise<{err: ErrorCode, receipt?: Receipt}> {
        let pk: Buffer;
        if (Buffer.isBuffer(options.caller)) {
            pk = options.caller;
        } else {
            pk = this.m_accounts![options.caller]!;
        }
        let addr = addressFromSecretKey(pk)!;
        const nonce = this.m_fakeNonces.has(addr) ? this.m_fakeNonces.get(addr)! : 0;
        this.m_fakeNonces.set(addr, nonce + 1);
        const txop = Object.create(options);
        txop.nonce = nonce;
        const tx = this.createTransaction(txop);
        const dtr = await this.debuger.debugTransaction(this.m_storage!, this.m_curBlock!.header, tx);
        if (dtr.err) {
            return {err: dtr.err};
        } 
        this.m_curBlock!.transactions.push(tx);
        this.m_curBlock!.receipts.push(dtr.receipt!);
        return dtr;
    }

    wage(): Promise<{err: ErrorCode}> {
        return this.debuger.debugMinerWageEvent(this.m_storage!, this.m_curBlock!.header!);
    }

    view(options: {method: string, params: any}): Promise<{err: ErrorCode, value?: any}> {
        return this.debuger.debugView(this.m_storage!, this.m_curBlock!.header, options.method, options.params);
    }

    getAccount(index: number): string {
        return addressFromSecretKey(this.m_accounts![index])!;
    }
}

class ChainDebuger {
    constructor(public readonly chain: Chain, protected readonly logger: LoggerInstance) {

    }

    async createStorage(options: {memory?: boolean, path?: string}): Promise<{err: ErrorCode, storage?: Storage}> {
        const inMemory = (isNullOrUndefined(options.memory) || options.memory);
        let storage: Storage;
        if (inMemory) {
            storage = new JsonStorage({
                filePath: '',
                logger: this.logger
            });
        } else {
            storage = new SqliteStorage({
                filePath: options.path!,
                logger: this.logger
            });
        }
        
        const err = await storage.init();
        if (err) {
            this.chain.logger.error(`init storage failed `, stringifyErrorCode(err));
            return {err};
        }
        storage.createLogger();
        return {err: ErrorCode.RESULT_OK, storage};
    }

    async debugTransaction(storage: Storage, header: BlockHeader, tx: Transaction): Promise<{err: ErrorCode, receipt?: Receipt}> {
        const block = this.chain.newBlock(header);
        
        const nber = await this.chain.newBlockExecutor({block, storage});
        if (nber.err) {
            return {err: nber.err};
        }
        const etr = await nber.executor!.executeTransaction(tx, {ignoreNoce: true});
        if (etr.err) {
            return {err: etr.err};
        }

        await nber.executor!.finalize();
        
        return {err: ErrorCode.RESULT_OK, receipt: etr.receipt};
    }

    async debugBlockEvent(storage: Storage, header: BlockHeader, options: {
            listener?: BlockHeightListener,
            preBlock?: boolean,
            postBlock?: boolean
        }): Promise<{err: ErrorCode, receipts?: Receipt[]}> {
        const block = this.chain.newBlock(header);
        
        const nber = await this.chain.newBlockExecutor({block, storage});
        if (nber.err) {
            return {err: nber.err};
        }

        let result;
        do {
            
            if (options.listener) {
                const ebr = await nber.executor!.executeBlockEvent(options.listener);
                if (ebr.err) {
                    result = {err: ebr.err};
                    break;
                } else {
                    result = {err: ErrorCode.RESULT_OK, receipts: [ebr.receipt!]};
                    break;
                }
            } else {
                let receipts = [];
                if (options.preBlock) {
                    const ebr = await nber.executor!.executePreBlockEvent();
                    if (ebr.err) {
                        result = {err: ebr.err};
                        break;
                    }
                    receipts.push(...ebr.receipts!);
                }
                if (options.postBlock) {
                    const ebr = await nber.executor!.executePostBlockEvent();
                    if (ebr.err) {
                        result = {err: ebr.err};
                        break;
                    }
                    receipts.push(...ebr.receipts!);
                }
                result = {err: ErrorCode.RESULT_OK, receipts};
            }
        } while (false);

        await nber.executor!.finalize();
        return result;
    }

    async debugView(storage: Storage, header: BlockHeader, method: string, params: any): Promise<{err: ErrorCode, value?: any}> {
        const nver = await this.chain.newViewExecutor(header, storage, method, params);

        if (nver.err) {
            return {err: nver.err};
        }

        return nver.executor!.execute();
    }

    async debugBlock(storage: Storage, block: Block): Promise<{err: ErrorCode}> {
        const nber = await this.chain.newBlockExecutor({block, storage});
        if (nber.err) {
            return {err: nber.err};
        }

        const err = await nber.executor!.execute();

        await nber.executor!.finalize();

        return {err};
    }
}

export class ValueChainDebuger extends ChainDebuger {
    async debugMinerWageEvent(storage: Storage, header: BlockHeader): Promise<{err: ErrorCode}> {
        const block = this.chain.newBlock(header);
        
        const nber = await this.chain.newBlockExecutor({block, storage});
        if (nber.err) {
            return {err: nber.err};
        }

        const err = await (nber.executor! as ValueBlockExecutor).executeMinerWageEvent();
        
        await nber.executor!.finalize();
        
        return {err};

    }

    createIndependSession(): ValueIndependDebugSession {
        return new ValueIndependDebugSession(this);
    }

    async createChainSession(storageDir: string): Promise<{err: ErrorCode, session?: ValueChainDebugSession}> {
        let err = await this.chain.initComponents();
        if (err) {
            return {err};
        }
        const session = new ValueChainDebugSession(this);
        err = await session.init({storageDir});
        if (err) {
            return {err};
        }
        return {err: ErrorCode.RESULT_OK, session};
    }
}

export async function createValueDebuger(chainCreator: ChainCreator, dataDir: string): Promise<{err: ErrorCode, debuger?: ValueChainDebuger}> {
    const ccir = await chainCreator.createChainInstance(dataDir, {readonly: true, initComponents: false});
    if (ccir.err) {
        chainCreator.logger.error(`create chain instance from ${dataDir} failed `, stringifyErrorCode(ccir.err));
        return {err: ccir.err};
    }
    return {err: ErrorCode.RESULT_OK, debuger: new ValueChainDebuger(ccir.chain!, chainCreator.logger)};
}