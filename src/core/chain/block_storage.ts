import { Block, BlockHeader, BlockContent } from './block';
import { BufferWriter, BufferReader } from '../serializable';
import { LoggerInstance } from '../lib/logger_util';
import { Transaction } from './transaction';
import * as fs from 'fs-extra';
import * as path from 'path';

export class BlockStorage {
    constructor(options: {
        path: string,
        blockHeaderType: new () => BlockHeader,
        transactionType: new () => Transaction,
        logger: LoggerInstance
    }) {
        this.m_path = path.join(options.path, 'Block');
        this.m_blockHeaderType = options.blockHeaderType;
        this.m_transactionType = options.transactionType;
        this.m_logger = options.logger;
    }

    private m_blockHeaderType: new () => BlockHeader;
    private m_transactionType: new () => Transaction;
    private m_path: string;
    private m_logger: LoggerInstance;

    public init() {
        fs.mkdirsSync(this.m_path);
    }

    public has(blockHash: string): boolean {
        return fs.existsSync(this._pathOfBlock(blockHash));
    }

    private _pathOfBlock(hash: string): string {
        return path.join(this.m_path, hash);
    }

    public get(blockHash: string): Block | undefined {
        let blockRaw = fs.readFileSync(this._pathOfBlock(blockHash));
        if (blockRaw) {
            let block = new Block({ headerType: this.m_blockHeaderType, transactionType: this.m_transactionType });
            let err = block.decode(new BufferReader(blockRaw));
            if (err) {
                this.m_logger.error(`load block ${blockHash} from storage failed!`);
                return undefined;
            }
            return block;
        } else {
            return undefined;
        }
    }

    private _add(hash: string, blockRaw: Buffer) {
        fs.writeFileSync(this._pathOfBlock(hash), blockRaw);
    }

    public add(block: Block) {
        let hash = block.hash;
        if (this.has(hash)) {
            return;
        }
        let writer = new BufferWriter();
        block.encode(writer);
        this._add(hash, writer.render());
    }

    public getSize(blockHash: string): number {
        if (!this.has(blockHash)) {
            return -1;
        }
        let stat = fs.statSync(this._pathOfBlock(blockHash));
        return stat.size;
    }
}