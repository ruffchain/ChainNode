import * as assert from 'assert';
import * as fs from 'fs-extra';
import * as path from 'path';
import { ErrorCode } from '../error_code';
import { LoggerInstance, remove_db_files } from '../../common/';
import { IHeaderStorage} from '../block';
import { Storage, StorageOptions} from './storage';
const digest = require('../lib/digest');

// Added by Yang Jun 2019-2-21
type ByteString = string;

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
        remove_db_files(this.filePath!)
        return ErrorCode.RESULT_NOT_FOUND;
    }
}

export type StorageSnapshotManagerOptions = {
    path: string,
    headerStorage: IHeaderStorage,
    storageType: new (options: StorageOptions) => Storage,
    logger: LoggerInstance,
    readonly?: boolean
};

export interface IStorageSnapshotManager {
    getSnapshotFilePath(blockHash: string): string;
    init(): Promise<ErrorCode>;
    createSnapshot(from: Storage, blockHash: string): Promise<{err: ErrorCode, snapshot?: StorageDumpSnapshot}>;
    getSnapshot(blockHash: string): Promise<{err: ErrorCode, snapshot?: StorageDumpSnapshot}>;
    releaseSnapshot(blockHash: string): void;
    recycle(): void;
}
