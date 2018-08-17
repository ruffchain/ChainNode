import {ErrorCode} from '../error_code';
import {IReadableStorage, IReadWritableStorage, Chain} from '../value_chain';
import {LoggerInstance} from '../lib/logger_util';
import * as Address from '../address';
import * as digest from '../lib/digest';

export class DBFTSProxy {
    public static kvDBFT: string = 'dbft';
    public static keyCandidate: string = 'candidate';
    public static keyMiners: string = 'miner';

    constructor(protected storage: IReadableStorage, protected globalOptions: any, protected logger: LoggerInstance) {

    }

    public static async signData(hash: Buffer, secret: Buffer): Promise<{err: ErrorCode, sign?: Buffer}> {
        let sign: Buffer = Address.signBufferMsg(Buffer.from(digest.md5(hash).toString('hex')), secret);
        return {err: ErrorCode.RESULT_OK, sign};
    }

    public static async verifySign(hash: Buffer, pubkey: Buffer, sign: Buffer): Promise<ErrorCode> {
        return Address.verifyBufferMsg(Buffer.from(digest.md5(hash).toString('hex')), sign, pubkey) ? ErrorCode.RESULT_OK : ErrorCode.RESULT_VERIFY_NOT_MATCH;
    }

    public async init(miners: {address: string, pubkey: string}[]): Promise<{err: ErrorCode}> {
        let storage = this.storage as IReadWritableStorage;
        let dbr = await storage.getReadWritableDatabase(Chain.dbSystem);
        if (dbr.err) {
            this.logger.error(`get system database failed ${dbr.err}`);
            return {err: dbr.err};
        }
        let kvr = await dbr.value!.getReadWritableKeyValue(DBFTSProxy.kvDBFT);
        if (kvr.err) {
            this.logger.error(`get dbft keyvalue failed ${dbr.err}`);
            return {err: kvr.err};
        }
        let kvDBFT = kvr.kv!;
        for (let m of miners) {
            let data: any = {pubkey: m.pubkey, blockheight: 0};
            let {err} = await kvDBFT.hset(DBFTSProxy.keyCandidate, m.address, data);
            if (err) {
                return {err};
            }
        }
        return {err: ErrorCode.RESULT_OK};
    }

    static getElectionBlockNumber(globalOptions: any, n: number) {
        if (n === 0) {
            return 0;
        }
        return Math.floor((n - 1) / globalOptions.reSelectionBlocks) * globalOptions.reSelectionBlocks;
    }

    static isElectionBlockNumber(globalOptions: any, n: number): boolean {
        // n=0的时候为创世块，config里面还没有值呢
        if (n === 0) {
            return true;
        }
        return  n % globalOptions.reSelectionBlocks === 0;
    }

    public async getMiners(): Promise<{err: ErrorCode, miners?: {address: string, pubkey: string}[]}> {
        let dbr = await this.storage.getReadableDataBase(Chain.dbSystem);
        if (dbr.err) {
            this.logger.error(`get system database failed ${dbr.err}`);
            return {err: dbr.err};
        }
        let kvr = await dbr.value!.getReadableKeyValue(DBFTSProxy.kvDBFT);
        if (kvr.err) {
            this.logger.error(`get dbft keyvalue failed ${dbr.err}`);
            return {err: kvr.err};
        }
        let kvDBFT = kvr.kv!;
        let gm = await kvDBFT.get(DBFTSProxy.keyMiners);
        if (gm.err) {
            this.logger.error(`getMinersFromStorage failed,errcode=${gm.err}`);
            return {err: gm.err};
        }
        
        return {err: ErrorCode.RESULT_OK, miners: gm.value};
    }

    public async isMiners(address: string): Promise<{err: ErrorCode, isminer?: boolean}> {
        let dbr = await this.storage.getReadableDataBase(Chain.dbSystem);
        if (dbr.err) {
            this.logger.error(`get system database failed ${dbr.err}`);
            return {err: dbr.err};
        }
        let kvr = await dbr.value!.getReadableKeyValue(DBFTSProxy.kvDBFT);
        if (kvr.err) {
            this.logger.error(`get dbft keyvalue failed ${dbr.err}`);
            return {err: kvr.err};
        }
        let kvDBFT = kvr.kv!;
        let gm = await kvDBFT.get(DBFTSProxy.keyMiners);
        if (gm.err) {
            if (gm.err  === ErrorCode.RESULT_NOT_FOUND) {
                return {err: ErrorCode.RESULT_OK, isminer: false};
            } else {
                return {err: gm.err};
            }
        }
        let miners: {address: string, pubkey: string}[] = gm.value!;
        for (let m of miners) {
            if (m.address === address) {
                return {err: ErrorCode.RESULT_OK, isminer: true};
            }
        }
        return {err: ErrorCode.RESULT_OK, isminer: false};
    }

    async registerToCandidate(blockheight: number, address: string, pubkey: Buffer, pubkeySign: Buffer): Promise<ErrorCode> {
        let sysPubkey: string = this.globalOptions.systemPubkey;
        if (sysPubkey.length === 0) {
            this.logger.error(`registerToCandidate failed,not found system  pubkey, address=${address}, pubkey=${pubkey.toString('hex')}`);
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        if (await DBFTSProxy.verifySign(pubkey, Buffer.from(sysPubkey, 'hex'), pubkeySign)) {
            this.logger.error(`registerToCandidate failed,not found system  pubkey, address=${address}, pubkey=${pubkey.toString('hex')}`);
            return ErrorCode.RESULT_VERIFY_NOT_MATCH;
        }

        let storage = this.storage as IReadWritableStorage;
        let dbr = await storage.getReadWritableDatabase(Chain.dbSystem);
        if (dbr.err) {
            this.logger.error(`get system database failed ${dbr.err}`);
            return dbr.err;
        }
        let kvr = await dbr.value!.getReadWritableKeyValue(DBFTSProxy.kvDBFT);
        if (kvr.err) {
            this.logger.error(`get dbft keyvalue failed ${dbr.err}`);
            return kvr.err;
        }
        let kvDBFT = kvr.kv!;
        let data: any = {pubkey: pubkey.toString('hex'), blockheight};
        let {err} = await kvDBFT.hset(DBFTSProxy.keyCandidate, address, data);

        return err;
    }

    async unRegisterToCandidate(address: string, addressSign: Buffer): Promise<ErrorCode> {
        let sysPubkey: string = this.globalOptions.systemPubkey;
        if (sysPubkey.length === 0) {
            this.logger.error(`unRegisterToCandidate failed,not found system  pubkey, address=${address}`);
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        if (await DBFTSProxy.verifySign(Buffer.from(address, 'hex'), Buffer.from(sysPubkey, 'hex'), addressSign)) {
            this.logger.error(`unRegisterToCandidate failed,not found system  pubkey, address=${address}`);
            return ErrorCode.RESULT_VERIFY_NOT_MATCH;
        }

        let storage = this.storage as IReadWritableStorage;
        let dbr = await storage.getReadWritableDatabase(Chain.dbSystem);
        if (dbr.err) {
            this.logger.error(`get system database failed ${dbr.err}`);
            return dbr.err;
        }
        let kvr = await dbr.value!.getReadWritableKeyValue(DBFTSProxy.kvDBFT);
        if (kvr.err) {
            this.logger.error(`get dbft keyvalue failed ${dbr.err}`);
            return kvr.err;
        }
        let kvDBFT = kvr.kv!;

        let her = await kvDBFT.hexists(DBFTSProxy.keyCandidate, address);
        if (her.err) {
            return kvr.err;
        }
        if (!her.value) {
            this.logger.error(`unRegisterToCandidate failed,not found address in candidate, address=${address}`);
            return ErrorCode.RESULT_NOT_FOUND;
        }
        let {err} = await kvDBFT.hdel(DBFTSProxy.keyCandidate, address);

        return err;
    }

    public async updateCandidate(blockheight: number): Promise<ErrorCode> {
        let storage = this.storage as IReadWritableStorage;
        let dbr = await storage.getReadWritableDatabase(Chain.dbSystem);
        if (dbr.err) {
            this.logger.error(`get system database failed ${dbr.err}`);
            return dbr.err;
        }
        let kvr = await dbr.value!.getReadWritableKeyValue(DBFTSProxy.kvDBFT);
        if (kvr.err) {
            this.logger.error(`get dbft keyvalue failed ${dbr.err}`);
            return kvr.err;
        }
        let kvDBFT = kvr.kv!;

        let ga = await kvDBFT.hgetall(DBFTSProxy.keyCandidate);
        if (ga.err) {
            this.logger.error(`updateCandidate failed,hgetall errcode=${ga.err}`);
            return ga.err;
        }
        let minWaitBlocksToMiner: number = this.globalOptions.minWaitBlocksToMiner;
        let miners: any = [];
        ga.value!.forEach((v) => {
            let info: any = v.value;
            if (blockheight - info.blockheight >= minWaitBlocksToMiner) {
                miners.push({address: v.key, pubkey: info.pubkey});
            }
        });
        let minValidator: number = this.globalOptions.minValidator;
        let maxValidator: number = this.globalOptions.maxValidator;
        if (minValidator > miners.length) {
            this.logger.error(`updateCandidate failed, valid miners not enough, length ${miners.length} minValidator ${minValidator}`);
            return ErrorCode.RESULT_NOT_ENOUGH;
        }
        if (miners.length > maxValidator) {
            miners = miners.slice(maxValidator);
        }
        let {err} = await kvDBFT.set(DBFTSProxy.keyMiners, miners);

        return err;  
    }
}