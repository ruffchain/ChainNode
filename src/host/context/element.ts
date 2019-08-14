import {ErrorCode, Block, BlockHeader, Chain} from '../../core';
import * as sqlite from 'better-sqlite3';

export type ElementOptions = {
    chain: Chain;
};

export interface IElement {
    init(db: sqlite.Database): Promise<ErrorCode>;
    addBlock(block: Block): Promise<ErrorCode>;
    revertToBlock(num: number): Promise<ErrorCode>;
}
