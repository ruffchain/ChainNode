import * as path from 'path';
import * as assert from 'assert';

import { ErrorCode } from '../error_code';
import {Workpool} from '../lib/workpool';
import { BufferWriter } from '../lib/writer';

import { Block, ValueMiner, ValueMinerOptions, Chain, BlockHeader, MinerState, Storage } from '../value_chain';

import { PowBlockHeader } from './block';
import * as consensus from './consensus';
import { PowChain } from './chain';
import {ChainCreator} from '../chain/chain_creator';

export class PowMiner extends ValueMiner {
    private workpool: Workpool;

    constructor(options: ValueMinerOptions) {
        super(options);
        const filename = path.resolve(__dirname, 'pow_worker.js');
        this.workpool = new Workpool(filename, 1);
    }

    protected async _chainInstance(chainCreator: ChainCreator, commandOptions: Map<string, any>): Promise<{err: ErrorCode, chain?: Chain}> {
        let cc = await chainCreator.createChain(commandOptions, PowChain);
        if (cc.err) {
            return {err: cc.err};
        }

        return {err: ErrorCode.RESULT_OK, chain: cc.chain as PowChain};
    }

    protected async _genesisChainInstance(chainCreator: ChainCreator, commandOptions: Map<string, any>): Promise<{err: ErrorCode, chain?: Chain}> {
        let cc = await chainCreator.createGenesis(commandOptions, PowChain);
        if (cc.err) {
            return {err: cc.err};
        }

        return {err: ErrorCode.RESULT_OK, chain: cc.chain as PowChain};
    }

    get chain(): PowChain {
        return this.m_chain as PowChain;
    }

    private _newHeader(): PowBlockHeader {
        let tip = this.m_chain!.tipBlockHeader! as PowBlockHeader;
        let blockHeader = new PowBlockHeader();
        blockHeader.setPreBlock(tip);
        blockHeader.timestamp = Date.now() / 1000;
        return blockHeader;
    }

    public async initialize(chainCreator: ChainCreator, commandOptions: Map<string, any>): Promise<ErrorCode> {
        let err = await super.initialize(chainCreator, commandOptions);
        if (err) {
            return err;
        }
        this._createBlock(this._newHeader());
        return ErrorCode.RESULT_OK;
    }

    protected async _mineBlock(block: Block): Promise<ErrorCode> {
        // 这里计算bits
        this.m_logger.info(`${this.peerid} begin mine Block (${block.number})`);
        let tr = await consensus.getTarget(block.header as PowBlockHeader, this.m_chain!);
        if (tr.err) {
            return tr.err;
        }
        assert(tr.target !== undefined);
        if (tr.target! === 0) {
            console.error(`cannot get target bits for block ${block.number}`);
            return ErrorCode.RESULT_INVALID_BLOCK;
        }
        (block.header as PowBlockHeader).bits = tr.target!;
        // 使用一个workerpool来计算正确的nonce
        let ret = await this._calcuteBlockHashWorkpool((block.header as PowBlockHeader), {start: 0, end: consensus.INT32_MAX}, {start: 0, end: consensus.INT32_MAX});
        if (ret === ErrorCode.RESULT_OK) {
            block.header.updateHash();
            this.m_logger.info(`${this.peerid} mined Block (${block.number}) target ${(block.header as PowBlockHeader).bits} : ${block.header.hash}`);
        }
        
        return ret;
    }

    /**
     * virtual 
     * @param chain 
     * @param tipBlock 
     */

    protected async _onTipBlock(chain: Chain, tipBlock: BlockHeader): Promise<void> {
        this.m_logger.info(`${this.peerid} onTipBlock ${tipBlock.number} : ${tipBlock.hash}`);
        if (this.m_state === MinerState.mining) {
            this.m_logger.info(`${this.peerid} cancel mining`);
            this.workpool.stop();
        } 
        this._createBlock(this._newHeader());
    }

    private async _calcuteBlockHashWorkpool(blockHeader: PowBlockHeader, nonceRange: { start: number, end: number }, nonce1Range: { start: number, end: number }): Promise<ErrorCode> {
        return new Promise<ErrorCode>((reslove, reject) => {
            let buffer = blockHeader.encode(new BufferWriter()).render();
            this.workpool.push({data: buffer, nonce: nonceRange, nonce1: nonce1Range}, (code, signal, ret) => {
                if (code === 0) {
                    let result = JSON.parse(ret);
                    blockHeader.nonce = result['nonce'];
                    blockHeader.nonce1 = result['nonce1'];
                    assert(blockHeader.verifyPOW());
                    reslove(ErrorCode.RESULT_OK);
                } else if (signal === 'SIGTERM') {
                    reslove(ErrorCode.RESULT_CANCELED);
                } else {
                    console.error(`worker error! code: ${code}, ret: ${ret}`);
                    reslove(ErrorCode.RESULT_FAILED);
                }
            });
        });
    }

    protected async _createGenesisBlock(block: Block, storage: Storage, options?: any): Promise<ErrorCode> {
        let err = await super._createGenesisBlock(block, storage, options);
        if (err) {
            return err;
        }

        let kvr = await storage.getReadWritableKeyValue(Chain.kvConfig);
        if (kvr.err) {
            return kvr.err;
        }

        assert(options.consensus, 'options must have consensus');

        await kvr.kv!.set('retargetInterval', options!.consensus.retargetInterval);
        await kvr.kv!.set('targetTimespan', options!.consensus.targetTimespan);
        await kvr.kv!.set('basicBits', options!.consensus.basicBits);
        await kvr.kv!.set('limit', options!.consensus.limit);

        (block.header as PowBlockHeader).bits = 520159231;
        block.header.updateHash();
        return ErrorCode.RESULT_OK;
    }
}