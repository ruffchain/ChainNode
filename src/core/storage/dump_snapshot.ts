import * as assert from 'assert';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ErrorCode } from '../error_code';
import {LoggerInstance} from '../lib/logger_util';
import {HeaderStorage} from '../chain/header_storage';
import { Storage, StorageOptions} from './storage';
const digest = require('../lib/digest');

export class StorageDumpSnapshot {
    constructor(blockHash: string, filePath: string) {
        this.m_blockHash = blockHash;
        this.m_filePath = filePath;
    }

    private m_blockHash: string;
    private m_filePath: string;

    get blockHash(): string {
        return this.m_blockHash;
    }

    get filePath(): string {
        return this.m_filePath;
    }

    public exists(): boolean {
        return fs.existsSync(this.m_filePath);
    }

    public async messageDigest(): Promise<{ err: ErrorCode, value: ByteString }> {
        let buf = await fs.readFile(this.m_filePath);
        let hash = digest.hash256(buf).toString('hex');
        return { err: ErrorCode.RESULT_OK, value: hash };
    }

    public remove(): ErrorCode {
        if (fs.existsSync(this.filePath!)) {
            fs.removeSync(this.filePath!);
            return ErrorCode.RESULT_OK;
        }
        return ErrorCode.RESULT_NOT_FOUND;
    }
}


export type StorageSnapshotManagerOptions = {
    path: string,
    headerStorage: HeaderStorage, 
    storageType: new (options: StorageOptions) => Storage,
    recycleHandler: (blockHash: string) => Promise<{err: ErrorCode, recycle?: boolean}>, 
    logger: LoggerInstance
};

export interface IStorageSnapshotManager {
    getSnapshotFilePath(blockHash: string): string;
    init(): Promise<ErrorCode>;
    createSnapshot(from: Storage, blockHash: string): Promise<{err: ErrorCode, snapshot?: StorageDumpSnapshot}>;
    getSnapshot(blockHash: string): Promise<{err: ErrorCode, snapshot?: StorageDumpSnapshot}>;
    releaseSnapshot(blockHash: string): void;
}