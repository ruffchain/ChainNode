import * as fs from 'fs-extra';
import * as path from 'path';

import {ErrorCode} from '../error_code';
import {LoggerInstance} from '../lib/logger_util';
import { BufferWriter, BufferReader } from '../serializable';

import { Storage, StorageOptions } from './storage';
import { IStorageSnapshotManager, StorageDumpSnapshot } from "./dump_snapshot";
import { StorageDumpSnapshotManager } from './dump_snapshot_manager';
import {HeaderStorage} from '../chain/header_storage';




export class SnapshotManager implements IStorageSnapshotManager {
    constructor(options: {
        path: string,
        headerStorage: HeaderStorage, 
        storageType: new (options: StorageOptions) => Storage,
        recycleHandler: (blockHash: string) => Promise<{err: ErrorCode, recycle?: boolean}>, 
        logger: LoggerInstance}) {
        this.m_logPath = path.join(options.path, 'log');
        this.m_dumpManager = new StorageDumpSnapshotManager(options);
        this.m_headerStorage = options.headerStorage;
        this.m_storageType = options.storageType;
        this.m_logger = options.logger;
        this.m_recycleHandler = options.recycleHandler;
    }

    private m_logPath: string;
    private m_headerStorage: HeaderStorage;
    private m_dumpManager: StorageDumpSnapshotManager;
    private m_storageType: new (options: StorageOptions) => Storage;
    private m_logger: LoggerInstance;
    private m_snapshots: Map<string, {ref: number}> = new Map();
    private m_recycleHandler: (blockHash: string) => Promise<{err: ErrorCode, recycle?: boolean}>;

    protected _checkRecycle() {
        for (let blockHash of this.m_snapshots.keys()) {
            let stub = this.m_snapshots.get(blockHash)!;
            if (!stub.ref) {
                this.m_recycleHandler(blockHash).then((rhr: {err: ErrorCode, recycle?: boolean}) => {
                    if (!rhr.err && !stub!.ref && rhr.recycle) {
                        this.m_dumpManager.removeSnapshot(blockHash);
                        this.m_snapshots.delete(blockHash);
                    }
                });
            }
        }
    }
    async init(): Promise<ErrorCode> {
        fs.ensureDirSync(this.m_logPath);
        let err = await this.m_dumpManager.init();
        if (err) {
            return err;
        }
        let snapshots = this.m_dumpManager.listSnapshots();
        for (let ss of snapshots) {
            this.m_snapshots.set(ss.blockHash, {ref: 0});
        }
        this._checkRecycle();
        return ErrorCode.RESULT_OK;
    }

    async createSnapshot(from: Storage, blockHash: string): Promise<{err: ErrorCode, snapshot?: StorageDumpSnapshot}> {
        let csr = await this.m_dumpManager.createSnapshot(from, blockHash);
        if (csr.err) {
            return csr;
        }
        
        let logger = from.storageLogger;
        if (logger) {
            let writer = new BufferWriter();
            logger.finish();
            logger.encode(writer);
            fs.writeFileSync(this.getLogPath(blockHash), writer.render());
        }
        this.m_snapshots.set(blockHash, {ref: 0});
        this._checkRecycle();
        return csr;
        
    }

    getSnapshotFilePath(blockHash: string): string {
        return this.m_dumpManager.getSnapshotFilePath(blockHash);
    }

    getLogPath(blockHash: string): string {
        return path.join(this.m_logPath, blockHash + '.redo');
    }

    async getSnapshot(blockHash: string): Promise<{err: ErrorCode, snapshot?: StorageDumpSnapshot}> {
        // 只能在storage manager 的实现中调用，在storage manager中保证不会以相同block hash重入
        let ssr = await this.m_dumpManager.getSnapshot(blockHash);
        if (!ssr.err || ssr.err !== ErrorCode.RESULT_NOT_FOUND) {
            ++this.m_snapshots.get(blockHash)!.ref; 
            return ssr;
        }
        let hr = await this.m_headerStorage.loadHeader(blockHash);
        if (hr.err) {
            return {err: hr.err};
        }
        let blockPath = [];
        blockPath.push(blockHash);
        let header = hr.header!;
        let err = ErrorCode.RESULT_NOT_FOUND;
        let nearestSnapshot: StorageDumpSnapshot;
        do {
            let hr = await this.m_headerStorage.loadHeader(header.preBlockHash);
            if (hr.err) {
                err = ErrorCode.RESULT_INVALID_BLOCK;
                break;
            }
            let ssr = await this.m_dumpManager.getSnapshot(header.hash);
            if (!ssr.err) {
                nearestSnapshot = ssr.snapshot!;
                break;
            } else if (ssr.err !== ErrorCode.RESULT_NOT_FOUND) {
                err = ssr.err;
                break;
            }
            header = hr.header!;
            blockPath.push(header.hash);
        } while (true);
        if (err) {
            return {err};
        }
        
        let storage = new this.m_storageType({
            filePath: this.m_dumpManager.getSnapshotFilePath(blockHash), 
            logger: this.m_logger}
        );
        fs.copyFileSync(nearestSnapshot!.filePath, storage.filePath);
        err = await storage.init();
        if (err) {
            return {err};
        }
        for (let blockHash of blockPath.reverse()) {
            if (!fs.existsSync(this.getLogPath(blockHash))) {
                err = ErrorCode.RESULT_NOT_FOUND;
                break;
            }
            let log = fs.readFileSync(this.getLogPath(blockHash));
            err = await storage.redo(log);
            if (err) {
                break;
            }
        }  
        await storage.uninit();
        if (err) {
            await storage.remove();
            return {err};
        }
        this.m_snapshots.set(blockHash, {ref: 1});
        return {err: ErrorCode.RESULT_OK, 
            snapshot: new StorageDumpSnapshot(blockHash, storage.filePath)};
    }

    releaseSnapshot(blockHash: string): void {
        let stub = this.m_snapshots.get(blockHash);
        if (stub) {
            --stub.ref;
            if (!stub.ref) {
                this.m_recycleHandler(blockHash).then((rhr: {err: ErrorCode, recycle?: boolean}) => {
                    if (!rhr.err && !stub!.ref && rhr.recycle) {
                        this.m_dumpManager.removeSnapshot(blockHash);
                        this.m_snapshots.delete(blockHash);
                    }
                });
            }
        }
    }
}


