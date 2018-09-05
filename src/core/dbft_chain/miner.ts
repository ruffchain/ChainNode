const assert = require('assert');
import { ErrorCode } from '../error_code';
import { Lock } from '../lib/Lock';
import { LoggerOptions } from '../lib/logger_util';
import { addressFromSecretKey } from '../address';
import { Chain, ValueMinerInstanceOptions, ValueMiner, Block, Storage, MinerState, INode } from '../value_chain';

import { DbftBlockHeader, DbftBlockHeaderSignature } from './block';
import { DbftContext } from './context';
import { DbftChain } from './chain';
import { ValidatorsNode } from './validators_node';
import { DbftConsensusNode } from './consensus_node';

class DbftMinerChain extends DbftChain {
    protected _createChainNode() {
        let node = new ValidatorsNode({
            node: this.m_instanceOptions!.node,
            minConnectionRate: this.globalOptions.agreeRate,
            dataDir: this.m_dataDir!,
            logger: this.m_logger,
            headerStorage: this.m_headerStorage!,
            blockHeaderType: this._getBlockHeaderType(),
            transactionType: this._getTransactionType(),
            receiptType: this._getReceiptType(),
        });
        // 这里用sa的adderss初始化吧， sa部署的时候过略非miner地址的连接；
        //      因为没有同步之前无法知道当前的validators是哪些
        node.setValidators([this.globalOptions.superAdmin]);

        return node;
    }

    get headerStorage() {
        return this.m_headerStorage!;
    }
}

export type DbftMinerInstanceOptions = { minerSecret: Buffer } & ValueMinerInstanceOptions;

export class DbftMiner extends ValueMiner {
    private m_secret?: Buffer;
    private m_address?: string;
    private m_consensusNode?: DbftConsensusNode;
    private m_mineLock = new Lock();
    private m_verifyLock = new Lock();
    private m_miningBlocks: Map<string, (err: ErrorCode) => void> = new Map();

    get chain(): DbftMinerChain {
        return this.m_chain as DbftMinerChain;
    }

    get address(): string {
        return this.m_address!;
    }

    protected _chainInstance(): Chain {
        return new DbftChain({logger: this.m_logger!});
    }
    
    constructor(options: LoggerOptions) {
        super(options);
    }

    public parseInstanceOptions(node: INode, instanceOptions: Map<string, any>): {err: ErrorCode, value?: any} {
        let {err, value} = super.parseInstanceOptions(node, instanceOptions);
        if (err) {
            return {err};
        }
        if (!instanceOptions.get('minerSecret')) {
            this.m_logger.error(`invalid instance options not minerSecret`);
            return {err: ErrorCode.RESULT_INVALID_PARAM};
        }
        value.minerSecret = Buffer.from(instanceOptions.get('minerSecret'), 'hex');
        return {err: ErrorCode.RESULT_OK, value};
    }

    public async initialize(options: DbftMinerInstanceOptions): Promise<ErrorCode> {
        this.m_secret = options.minerSecret;
        this.m_address = addressFromSecretKey(this.m_secret);
        if (!options.coinbase) {
            this.coinbase = this.m_address;
        }

        let err = await super.initialize(options);
        if (err) {
            this.m_logger.error(`dbft miner super initialize failed, errcode ${err}`);
            return err;
        }  
        this.m_consensusNode = new DbftConsensusNode({
            node: this.m_chain!.node.base as ValidatorsNode,
            globalOptions: this.m_chain!.globalOptions,
            secret: this.m_secret!
        });
        let tip = this.chain.tipBlockHeader! as DbftBlockHeader;
        err = await this._updateTip(tip);
        if (err) {
            this.m_logger.error(`dbft miner initialize failed, errcode ${err}`);
            return err;
        } 
        this.m_consensusNode.on('createBlock', async (header: DbftBlockHeader) => {
            // TODO:有可能重入么？先用lock
            if (header.preBlockHash !== this.chain.tipBlockHeader!.hash) {
                this.m_logger.warn(`mine block skipped`);
                return ;
            }
            this.m_mineLock.enter();
            this.m_logger.info(`begin create block ${header.hash} ${header.number} ${header.view}`);
            let cbr = await this._createBlock(header);
            if (cbr.err) {
                this.m_logger.error(`create block failed `, cbr.err);
            } else {
                this.m_logger.info(`create block finsihed `);
            }
            this.m_mineLock.leave();
        });
        this.m_consensusNode.on('verifyBlock', async (block: Block) => {
            // TODO:有可能重入么？先用lock
            let hr = await this.chain.headerStorage.getHeader(block.header.hash);
            if (!hr.err) {
                this.m_logger.error(`verify block already added to chain ${block.header.hash} ${block.header.number}`);
                return ;
            } else if (hr.err !== ErrorCode.RESULT_NOT_FOUND) {
                this.m_logger.error(`get header failed for `, hr.err);
                return ;
            }
            this.m_logger.info(`begin verify block ${block.hash} ${block.number}`);
            this.m_verifyLock.enter();
            let vr = await this.chain.verifyBlock(block, {storageName: 'consensVerify', ignoreSnapshot: true});
            this.m_verifyLock.leave();
            if (vr.err) {
                this.m_logger.error(`verify block failed `, vr.err);
                return ;
            }
            if (vr.verified) {
                this.m_consensusNode!.agreeProposal(block);
            } else {
                // TODO: 传回去？
            }
        });
        this.m_consensusNode.on('mineBlock', async (block: Block, signs: DbftBlockHeaderSignature[]) => {
            assert(this.m_miningBlocks.has(block.hash));
            const resolve = this.m_miningBlocks.get(block.hash)!;
            resolve(ErrorCode.RESULT_OK);
        });
        return this.m_consensusNode.init();
    }

    protected async _updateTip(tip: DbftBlockHeader): Promise<ErrorCode> {
        let gnmr = await this.chain.dbftHeaderStorage.getNextMiners(tip);
        if (gnmr.err) {
            this.m_logger.error(`dbft miner initialize failed for `, gnmr.err);
            return gnmr.err;
        }
        let gtvr = await this.chain.dbftHeaderStorage.getTotalView(tip);
        if (gtvr.err) {
            this.m_logger.error(`dbft miner initialize failed for `, gtvr.err);
            return gnmr.err;
        }
        this.m_consensusNode!.updateTip(tip, gnmr.miners!, gtvr.totalView!);
        return ErrorCode.RESULT_OK;
    }

    protected async _onTipBlock(chain: DbftChain, tipBlock: DbftBlockHeader): Promise<void> {
        await this._updateTip(tipBlock);
    }

    protected async _mineBlock(block: Block): Promise<ErrorCode> {
        this.m_logger.info(`${this.peerid} create block, sign ${this.m_address}`);
        (block.header as DbftBlockHeader).signBlock(this.m_secret!);
        block.header.updateHash();
        this.m_consensusNode!.newProposal(block);
        return new Promise<ErrorCode>((resolve) => {
            assert(!this.m_miningBlocks.has(block.hash));
            if (this.m_miningBlocks.has(block.hash)) {
                resolve(ErrorCode.RESULT_SKIPPED);
                return ;
            }
            this.m_miningBlocks.set(block.hash, resolve);
        });
    }
}
