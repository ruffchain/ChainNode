import * as fs from 'fs-extra';
import * as path from 'path';
import assert = require('assert');

import {ErrorCode} from '../error_code';
import {LoggerInstance} from '../lib/logger_util';
import { BufferWriter, BufferReader } from '../serializable';
import {StorageLogger} from './logger';
import {JStorageLogger} from './js_log';

import { Storage, StorageOptions } from './storage';
import { IStorageSnapshotManager, StorageDumpSnapshot, StorageSnapshotManagerOptions } from './dump_snapshot';
import { StorageDumpSnapshotManager } from './dump_snapshot_manager';
import {HeaderStorage} from '../chain/header_storage';

export class SnapshotManager implements IStorageSnapshotManager {
    constructor(options: StorageSnapshotManagerOptions) {
        this.m_logPath = path.join(options.path, 'log');
        this.m_dumpManager = new StorageDumpSnapshotManager(options);
        this.m_headerStorage = options.headerStorage;
        this.m_storageType = options.storageType;
        this.m_logger = options.logger;
    }

    private m_logPath: string;
    private m_headerStorage: HeaderStorage;
    private m_dumpManager: StorageDumpSnapshotManager;
    private m_storageType: new (options: StorageOptions) => Storage;
    private m_logger: LoggerInstance;
    private m_snapshots: Map<string, {ref: number}> = new Map();

    public recycle() {
        let recycledMap = new Map(this.m_snapshots);
        for (let [blockHash, stub] of recycledMap.entries()) {
            if (!stub.ref) {
                this.m_dumpManager.removeSnapshot(blockHash);
                this.m_snapshots.delete(blockHash);
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
        return csr;
        
    }

    getSnapshotFilePath(blockHash: string): string {
        return this.m_dumpManager.getSnapshotFilePath(blockHash);
    }

    getLogPath(blockHash: string): string {
        return path.join(this.m_logPath, blockHash + '.redo');
    }

    public getRedoLog(blockHash: string): JStorageLogger|undefined {
        let redoLogRaw = fs.readFileSync(this.getLogPath(blockHash));
        if ( !redoLogRaw ) {
            return undefined;
        }

        let redoLog = new JStorageLogger();
        let err = redoLog.decode(new BufferReader(redoLogRaw));
        if (err) {
            this.m_logger.error(`decode redo log ${blockHash} from storage failed`);
            return undefined;
        }

        return redoLog;
    }

    // 保存redolog文件
    // 文件内容来源是 从其他节点请求来， 并不是本地节点自己运行的redolog
    public writeRedoLog(blockHash: string, redoLog: StorageLogger) {
        let filepath = this.getLogPath(blockHash);
        let writer = new BufferWriter();
        redoLog.encode(writer);
        fs.writeFileSync(filepath, writer.render());
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
            let _ssr = await this.m_dumpManager.getSnapshot(header.hash);
            if (!_ssr.err) {
                nearestSnapshot = _ssr.snapshot!;
                err = _ssr.err;
                break;
            } else if (_ssr.err !== ErrorCode.RESULT_NOT_FOUND) {
                err = _ssr.err;
                break;
            }
            let _hr = await this.m_headerStorage.loadHeader(header.preBlockHash);
            if (_hr.err) {
                err = ErrorCode.RESULT_INVALID_BLOCK;
                break;
            }
            header = _hr.header!;
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
        for (let _blockHash of blockPath.reverse()) {
            if (!fs.existsSync(this.getLogPath(_blockHash))) {
                err = ErrorCode.RESULT_NOT_FOUND;
                break;
            }
            let log = fs.readFileSync(this.getLogPath(_blockHash));
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
            assert(stub.ref > 0);
            if (stub.ref > 0) {
                --stub.ref;
            }
        }
    }
}
