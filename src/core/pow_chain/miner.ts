import * as path from 'path';
import * as assert from 'assert';

import { ErrorCode } from '../error_code';
import {Workpool} from '../lib/workpool';
import { BufferWriter } from '../lib/writer';

import { Block } from '../chain/block';
import * as ValueMiner from '../value_chain/miner';
import {Storage} from '../storage/storage';

import { BlockHeader, INT32_MAX } from './block';
import * as POWConsensus from './consensus';
import { Chain, ChainOptions } from './chain';


export type MinerOptions = ChainOptions & ValueMiner.MinerOptions; 

export class Miner extends ValueMiner.Miner {
    private workpool: Workpool;

    constructor(options: MinerOptions) {
        super(options);
        const filename = path.resolve(__dirname, 'pow_worker.js');
        this.workpool = new Workpool(filename, 1);
    }

    protected _chainInstance(options: ChainOptions) {
        return new Chain(options);
    }

    get chain(): Chain {
        return <Chain>this.m_chain;
    }

    private _newHeader(): BlockHeader {
        let tip = <BlockHeader>this.m_chain.tipBlockHeader!;
        let blockHeader = new BlockHeader();
        blockHeader.setPreBlock(tip);
        blockHeader.timestamp = Date.now() / 1000;
        return blockHeader;
    }

    public async initialize(): Promise<ErrorCode> {
        let err = await super.initialize();
        if (err) {
            return err;
        }
        this._createBlock(this._newHeader());
        return ErrorCode.RESULT_OK;
    }

    protected async _mineBlock(block: Block): Promise<ErrorCode> {
        //这里计算bits
        this.m_logger.info(`${this.peerid} begin mine Block (${block.number})`);
        let tr = await POWConsensus.getTarget(<BlockHeader>block.header, this.m_chain);
        if (tr.err) {
            return tr.err;
        }
        assert(tr.target !== undefined);
        if (tr.target! === 0) {
            console.error(`cannot get target bits for block ${block.number}`);
            return ErrorCode.RESULT_INVALID_BLOCK;
        }
        (<BlockHeader>block.header).bits = tr.target!;
        // 使用一个workerpool来计算正确的nonce
        let ret = await this._calcuteBlockHashWorkpool(<BlockHeader>(block.header), {start: 0, end: INT32_MAX}, {start: 0, end: INT32_MAX});
        if (ret === ErrorCode.RESULT_OK) {
            block.header.updateHash();
            this.m_logger.info(`${this.peerid} mined Block (${block.number}) target ${(<BlockHeader>block.header).bits} : ${block.header.hash}`);
        }
        
        return ret;
    }

    /**
     * virtual 
     * @param chain 
     * @param tipBlock 
     */

    protected async _onTipBlock(chain: ValueMiner.Chain, tipBlock: BlockHeader): Promise<void> {
        this.m_logger.info(`${this.peerid} onTipBlock ${tipBlock.number} : ${tipBlock.hash}`);
        if (this.m_state === ValueMiner.MinerState.mining) {
            this.m_logger.info(`${this.peerid} cancel mining`)
            this.workpool.stop();
        } 
        this._createBlock(this._newHeader());
    }

    private async _calcuteBlockHashWorkpool(blockHeader: BlockHeader,
        nonceRange: { start: number, end: number },
        nonce1Range: { start: number, end: number }
    ):Promise<ErrorCode> {
        return new Promise<ErrorCode>((reslove, reject) => {
            let buffer = blockHeader.encode(new BufferWriter()).render();
            this.workpool.push({data: buffer, nonce:nonceRange, nonce1:nonce1Range}, (code, signal, ret) => {
                if (code === 0) {
                    let result = JSON.parse(ret);
                    blockHeader.nonce = result['nonce'];
                    blockHeader.nonce1 = result['nonce1'];
                    assert(blockHeader.verifyPOW());
                    reslove(ErrorCode.RESULT_OK);
                } else if(signal === 'SIGTERM') {
                    reslove(ErrorCode.RESULT_CANCELED);
                } else {
                    console.error(`worker error! code: ${code}, ret: ${ret}`);
                    reslove(ErrorCode.RESULT_FAILED);
                }
            });
        })
    }

    protected async _createGenesisBlock(block: Block, storage: Storage, options?: any): Promise<ErrorCode> {
        let err = await super._createGenesisBlock(block, storage, options);
        if (err) {
            return err;
        }
        (<BlockHeader>block.header).bits = 520159231;
        block.header.updateHash();
        return ErrorCode.RESULT_OK;
    }
}