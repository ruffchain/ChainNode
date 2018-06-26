import { Block, BlockHeader, BlockContent } from './block';
import { BufferWriter, BufferReader } from '../serializable';
import { Transaction } from './transaction';
import * as fs from 'fs-extra';
import * as path from 'path';

export class BlockStorage {
    constructor(options: {
        path: string,
        blockHeaderType: new () => BlockHeader,
        transactionType: new () => Transaction
    }) {
        this.m_path = path.join(options.path, 'Block');
        this.m_blockHeaderType = options.blockHeaderType;
        this.m_transactionType = options.transactionType;
    }

    private m_blockHeaderType: new () => BlockHeader;
    private m_transactionType: new () => Transaction;
    private m_path: string;

    public init() {
        fs.mkdirsSync(this.m_path);
    }

    public has(blockHash: string): boolean {
        return fs.existsSync(this._pathOfBlock(blockHash));
    }

    private _pathOfBlock(hash: string): string {
        return path.join(this.m_path, hash);
    }

    public get(blockHash: string): Block | null {
        let blockRaw = fs.readFileSync(this._pathOfBlock(blockHash));
        if (blockRaw) {
            let block = new Block({ headerType: this.m_blockHeaderType, transactionType: this.m_transactionType });
            block.decode(new BufferReader(blockRaw));
            return block;
        } else {
            return null;
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