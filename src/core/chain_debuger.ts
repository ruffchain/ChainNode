import {ErrorCode, stringifyErrorCode} from './error_code';
import {BigNumber} from 'bignumber.js';
import {ChainCreator} from './chain_creator';
import {JsonStorage} from './storage_json/storage';
import { LoggerInstance } from './lib/logger_util';
import {Chain, Transaction, BlockHeader, Receipt, BlockHeightListener} from './chain';
import {ValueTransaction, ValueBlockHeader, ValueHandler, ValueBlockExecutor} from './value_chain';
import {createKeyPair, addressFromSecretKey} from './address';
import { isArray } from 'util';

export class ValueMemoryDebugSession {
    private m_storage?: JsonStorage;
    private m_curHeader?: ValueBlockHeader;
    private m_accounts?: Buffer[];
    private m_interval?: number;
    constructor(private readonly debuger: ValueMemoryDebuger) {

    }

    async init(options: {
        height: number, 
        accounts: Buffer[] | number, 
        coinbase: number,
        interval: number
    }): Promise<ErrorCode> {
        const csr = await this.debuger.createStorage();
        if (csr.err) {
            return csr.err;
        }
        this.m_storage = csr.storage!;
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
        
        const err = await chain.onCreateGenesisBlock(block, csr.storage!, {coinbase: addressFromSecretKey(this.m_accounts[options.coinbase])});
        if (err) {
            chain.logger.error(`onCreateGenesisBlock failed for `, stringifyErrorCode(err));
            return err;
        }
        gh.updateHash();
        if (options.height > 0) {
            const _err = this.updateHeightTo(options.height, options.coinbase);
            if (_err) {
                return _err;
            }
        } else {
            this.m_curHeader = block.header as ValueBlockHeader;
        }
        return ErrorCode.RESULT_OK;
    }

    updateHeightTo(height: number, coinbase: number): ErrorCode {
        if (height <= this.m_curHeader!.number) {
            this.debuger.chain.logger.error(`updateHeightTo ${height} failed for current height ${this.m_curHeader!.number} is larger`); 
            return ErrorCode.RESULT_INVALID_PARAM;
        }
        let curHeader = this.m_curHeader!;
        const offset = height - curHeader.number;
        for (let i = 0; i <= offset; ++i) {
            let header = this.debuger.chain.newBlockHeader() as ValueBlockHeader;
            header.timestamp = curHeader.timestamp + this.m_interval!;
            header.coinbase = addressFromSecretKey(this.m_accounts![coinbase])!;
            header.setPreBlock(curHeader);
            curHeader = header;
        }
        this.m_curHeader = curHeader;
        return ErrorCode.RESULT_OK;
    }

    transaction(options: {caller: number, method: string, input: any, value: BigNumber}): Promise<{err: ErrorCode, receipt?: Receipt}> {
        const tx = new ValueTransaction();
        tx.fee = new BigNumber(0);
        tx.value = new BigNumber(options.value);
        tx.method = options.method;
        tx.input = options.input;
        tx.sign(this.m_accounts![options.caller]!);
        return this.debuger.debugTransaction(this.m_storage!, this.m_curHeader!, tx);
    }

    wage(): Promise<{err: ErrorCode}> {
        return this.debuger.debugMinerWageEvent(this.m_storage!, this.m_curHeader!);
    }

    view(options: {method: string, params: any}): Promise<{err: ErrorCode, value?: any}> {
        return this.debuger.debugView(this.m_storage!, this.m_curHeader!, options.method, options.params);
    }

    getAccount(index: number): string {
        return addressFromSecretKey(this.m_accounts![index])!;
    }
}

class MemoryDebuger {
    constructor(public readonly chain: Chain, protected readonly logger: LoggerInstance) {

    }

    async createStorage(): Promise<{err: ErrorCode, storage?: JsonStorage}> {
        const storage = new JsonStorage({
            filePath: '',
            logger: this.logger
        });
        const err = await storage.init();
        if (err) {
            this.chain.logger.error(`init storage failed `, stringifyErrorCode(err));
            return {err};
        }
        storage.createLogger();
        return {err: ErrorCode.RESULT_OK, storage};
    }

    async debugTransaction(storage: JsonStorage, header: BlockHeader, tx: Transaction): Promise<{err: ErrorCode, receipt?: Receipt}> {
        const block = this.chain.newBlock(header);
        
        const nber = await this.chain.newBlockExecutor(block, storage);
        if (nber.err) {
            return {err: nber.err};
        }
        const etr = await nber.executor!.executeTransaction(tx, {ignoreNoce: true});
        if (etr.err) {
            return {err: etr.err};
        }
        
        return {err: ErrorCode.RESULT_OK, receipt: etr.receipt};
    }

    async debugBlockEvent(storage: JsonStorage, header: BlockHeader, listener: BlockHeightListener): Promise<{err: ErrorCode}> {
        const block = this.chain.newBlock(header);
        
        const nber = await this.chain.newBlockExecutor(block, storage);
        if (nber.err) {
            return {err: nber.err};
        }

        const err = await nber.executor!.executeBlockEvent(listener);
        return {err};

    }

    async debugView(storage: JsonStorage, header: BlockHeader, method: string, params: any): Promise<{err: ErrorCode, value?: any}> {
        const nver = await this.chain.newViewExecutor(header, storage, method, params);

        if (nver.err) {
            return {err: nver.err};
        }

        return nver.executor!.execute();
    }
}

class ValueMemoryDebuger extends MemoryDebuger {
    async debugMinerWageEvent(storage: JsonStorage, header: BlockHeader): Promise<{err: ErrorCode}> {
        const block = this.chain.newBlock(header);
        
        const nber = await this.chain.newBlockExecutor(block, storage);
        if (nber.err) {
            return {err: nber.err};
        }

        const err = await (nber.executor! as ValueBlockExecutor).executeMinerWageEvent();
        return {err};

    }

    createSession(): ValueMemoryDebugSession {
        return new ValueMemoryDebugSession(this);
    }
}

export async function createValueMemoryDebuger(chainCreator: ChainCreator, dataDir: string): Promise<{err: ErrorCode, debuger?: ValueMemoryDebuger}> {
    const ccir = await chainCreator.createChainInstance(dataDir);
    if (ccir.err) {
        chainCreator.logger.error(`create chain instance from ${dataDir} failed `, stringifyErrorCode(ccir.err));
        return {err: ccir.err};
    }
    const err = await ccir.chain!.setGlobalOptions(ccir.globalOptions!);
    if (err) {
        chainCreator.logger.error(`setGlobalOptions failed `, stringifyErrorCode(err));
        return {err};
    }
    return {err: ErrorCode.RESULT_OK, debuger: new ValueMemoryDebuger(ccir.chain!, chainCreator.logger)};
}