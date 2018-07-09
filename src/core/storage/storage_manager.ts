
import * as fs from 'fs-extra';
import * as path from 'path';

import { isString } from 'util';

import { ErrorCode } from '../error_code';
import {LoggerInstance} from '../lib/logger_util';

import {IStorageSnapshotManager, StorageSnapshotManagerOptions, StorageDumpSnapshot} from './dump_snapshot';
import {IReadableStorage, IReadWritableStorage, Storage, StorageOptions} from './storage';
import {SnapshotManager} from './log_snapshot_manager';

export {StorageDumpSnapshot, IStorageSnapshotManager} from './dump_snapshot';
export {IReadableStorage, IReadWritableStorage, Storage, StorageOptions} from './storage';


export type StorageManagerOptions = {
    path: string;
    storageType: new (options:StorageOptions) => Storage;
    logger: LoggerInstance;
} & StorageSnapshotManagerOptions;

export class StorageManager {
    constructor(options: StorageManagerOptions) {
        this.m_path = options.path;
        this.m_storageType = options.storageType;
        this.m_logger = options.logger;
        this.m_snapshotManager = new SnapshotManager(options);
    }
    private m_path: string;
    private m_storageType: new (options:StorageOptions) => Storage;
    private m_snapshotManager: IStorageSnapshotManager;
    private m_logger: LoggerInstance;
    private m_views: Map<string, {storage: Storage, ref: number}> = new Map();

    public async init(): Promise<ErrorCode> {
        let err = await this.m_snapshotManager.init();
        if (err) {
            return err;
        }

        return ErrorCode.RESULT_OK;
    }

    async createSnapshot(from: Storage, blockHash: string, remove?: boolean): Promise<{err: ErrorCode, snapshot?: StorageDumpSnapshot}> {
        let csr = await this.m_snapshotManager.createSnapshot(from, blockHash);
        if (csr.err) {
            return csr;
        }
        // assert((await csr.snapshot!.messageDigest()).value !== (await from.messageDigest()).value);
        await from.remove();
        return csr;
    }

    public async createStorage(name: string, from?: Storage|string): Promise<{err: ErrorCode, storage?: Storage}> {
        let storage = new this.m_storageType({
            filePath: path.join(this.m_path, name),
            logger: this.m_logger}
        );
        await storage.remove();
        let err: ErrorCode;
        if (!from) {
            err = await storage.init();
        } else if (isString(from)) {
            let ssr = await this._getSnapshotStorage(from);
            if (ssr.err) {
                err = ssr.err;
            } else {
                fs.copyFileSync(ssr.storage!.filePath, storage.filePath);
                this.releaseSnapshotView(from);
                err = await storage.init();
            }
        } else if (from instanceof Storage) {
            fs.copyFileSync(from.filePath, storage.filePath);
            err = await storage.init();
        } else {
            return {err: ErrorCode.RESULT_INVALID_PARAM};
        }
        if (err) {
            return {err};
        }
        return {err: ErrorCode.RESULT_OK, storage};
    }

    protected async _getSnapshotStorage(blockHash: string): Promise<{err: ErrorCode, storage?: Storage}> {
        let stub = this.m_views.get(blockHash);
        if (stub) {
            ++stub.ref;
            if (stub.storage.isInit) {
                return {err: ErrorCode.RESULT_OK, storage: stub.storage};
            } else {
                return new Promise<{err: ErrorCode, storage?: Storage}>((resolve) =>{
                    stub!.storage!.once('init', (err: ErrorCode) => {
                        if (err) {
                            resolve({err});
                        } else {
                            resolve({err, storage: stub!.storage});
                        }
                    });
                });
            }
        }

        stub = {
            storage: new this.m_storageType({
                filePath: this.m_snapshotManager.getSnapshotFilePath(blockHash),
                logger: this.m_logger}),
            ref: 1
        };
        this.m_views.set(blockHash, stub);

        let ret = new Promise<{err: ErrorCode, storage?: Storage}>((resolve) =>{
            stub!.storage.once('init', (err)=>{
                if (err) {
                    this.m_views.delete(blockHash);
                    resolve({err});
                } else {
                    resolve({err, storage: stub!.storage});
                }
            });
        })
        await this.m_snapshotManager.getSnapshot(blockHash);
        stub!.storage.init(true);

        return ret;
    }

    public async getSnapshotView(blockHash: string): Promise<{err: ErrorCode, storage?: IReadableStorage}> {
        return await this._getSnapshotStorage(blockHash);
    }

    public async releaseSnapshotView(blockHash: string) {
        let stub = this.m_views.get(blockHash);
        if (stub) {
            --stub.ref;
            if (!stub.ref) {
                this.m_views.delete(blockHash);
                // 这里await也不能保证互斥， 可能在uninit过程中再次创建，只能靠readonly保证在一个path上创建多个storage 实例
                await stub.storage.uninit();
                this.m_snapshotManager.releaseSnapshot(blockHash);
            }
        }
    }

    public recycleSnapShot() {
        return this.m_snapshotManager.recycle();
    }
}