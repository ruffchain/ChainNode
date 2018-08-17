import * as assert from 'assert';

import { ErrorCode } from '../error_code';

import { Chain, ValueMinerInstanceOptions, ValueMiner, Block, Storage, MinerState, INode } from '../value_chain';
import { DbftChain } from './chain';
import { IConsensus, Consensus } from './consensus';
import { DbftChainNode } from './chain_node';
import { DbftBlockHeader } from './block';
import { BufferWriter } from '../lib/writer';
import { BufferReader } from '../lib/reader';
import { DBFTSProxy } from './dbftProxy';
import { LoggerOptions } from '../lib/logger_util';
import { addressFromSecretKey } from '../address';

export type DbftMinerInstanceOptions = { minerSecret: Buffer } & ValueMinerInstanceOptions;

export class DbftMiner extends ValueMiner implements IConsensus {
    private m_secret?: Buffer;
    private m_address?: string;
    private m_consensus: Consensus;

    get chain(): DbftChain {
        return this.m_chain as DbftChain;
    }

    get address(): string {
        return this.m_address!;
    }

    protected _chainInstance(): Chain {
        return new DbftChain({logger: this.m_logger!});
    }
    
    constructor(options: LoggerOptions) {
        super(options);
        this.m_consensus = new Consensus();
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
        let err = await super.initialize(options);
        if (err) {
            this.m_logger.error(`dbft miner super initialize failed, errcode ${err}`);
            return err;
        }

        if (!this.chain.tipBlockHeader) {
            this.m_logger.error(`dbft miner not found tipblockheader`);
            return ErrorCode.RESULT_NOT_FOUND;
        }

        this.m_secret = options.minerSecret;
        this.m_address = addressFromSecretKey(this.m_secret);
        if (!options.coinbase) {
            this.coinbase = this.m_address;
        }
        err = await this.m_consensus.initialize({
            intervalTime: this.chain.globalOptions.blockInterval,
            chainNode: this.chain.node as DbftChainNode,
            secret: this.m_secret!,
            logger: this.m_logger!,
            consensus: this,
            minValidator: this.chain.globalOptions.minValidator,
            maxValidator: this.chain.globalOptions.maxValidator
        });
        if (err) {
            this.m_logger.error(`dbft miner consensus initialize failed, errcode ${err}`);
            return err;
        }

        let prepareMiners = async (header: DbftBlockHeader) => {
            let gm = await this.chain.getNextMiners(header);
            if (gm.err) {
                this.m_logger!.error(`getMiners from chain failed, errcode=${gm.err}`);
                return;
            }
            let miners: { address: string, pubkey: Buffer }[] = [];
            let peerids: string[] = [];
            for (let v of gm.miners!) {
                miners.push({ address: v.address, pubkey: Buffer.from(v.pubkey, 'hex') });
                if (v.address !== this.m_address) {
                    peerids.push(v.address);
                }
            }
            if (peerids.length > 0) {
                await new Promise(async (resolve) => {
                    this.chain.node.connectTo(peerids, (count: number) => {
                        resolve(true);
                    }); // 这里如果链接失败了会怎么样？？？
                });
            }
            this.m_consensus.updateValidators(miners);
        };

        this.chain.on('minerChange', (header: DbftBlockHeader) => {
            prepareMiners(header);
        });

        let glh = await this.chain.getHeader('latest');
        if (glh.err) {
            this.m_logger!.error(`get latest header from chain failed, errcode=${glh.err}`);
            return glh.err;
        }
        this.m_consensus.updateSeq(this.chain.tipBlockHeader.number);
        prepareMiners(glh.header! as DbftBlockHeader);

        return ErrorCode.RESULT_OK;
    }

    protected async _onTipBlock(chain: DbftChain, tipBlock: DbftBlockHeader): Promise<void> {
        // 给新加入的miner一个同步seq状态的机会
        this.m_consensus.updateSeq(tipBlock.number);
    }

    protected async _mineBlock(block: Block): Promise<ErrorCode> {
        // 只需要给block签名
        this.m_logger.info(`${this.peerid} create block, sign ${this.m_address}`);
        (block.header as DbftBlockHeader).signBlock(this.m_secret!);
        block.header.updateHash();
        return ErrorCode.RESULT_OK;
    }

    protected async _createGenesisBlock(block: Block, storage: Storage, globalOptions: any, genesisOptions: any): Promise<ErrorCode> {
        let err = await super._createGenesisBlock(block, storage, globalOptions, genesisOptions);
        if (err) {
            return err;
        }

        let gkvr = await storage.getKeyValue(Chain.dbSystem, Chain.kvConfig);
        if (gkvr.err) {
            return gkvr.err;
        }
        let rpr = await gkvr.kv!.set('consensus', 'dbft');
        if (rpr.err) {
            return rpr.err;
        }

        let dbr = await storage.getReadWritableDatabase(Chain.dbSystem);
        if (dbr.err) {
            return dbr.err;
        }
        // storage的键值对要在初始化的时候就建立好
        let kvr = await dbr.value!.createKeyValue(DBFTSProxy.kvDBFT);
        if (kvr.err) {
            return kvr.err;
        }
        let denv = new DBFTSProxy(storage, this.m_chain!.globalOptions, this.m_logger);

        let ir = await denv.init(genesisOptions.miners);
        if (ir.err) {
            return ir.err;
        }
        return ErrorCode.RESULT_OK;
    }

    public async signData(hash: Buffer, secret: Buffer): Promise<{err: ErrorCode, sign?: Buffer}> {
        return await DBFTSProxy.signData(hash, secret);
    }

    public async verifySign(hash: Buffer, pubkey: Buffer, sign: Buffer): Promise<ErrorCode> {
        return await DBFTSProxy.verifySign(hash, pubkey, sign);
    }

    public async newProposal(): Promise<ErrorCode> {
        let now = Date.now() / 1000;
        let tip = this.m_chain!.tipBlockHeader! as DbftBlockHeader;
        let blockHeader = new DbftBlockHeader();
        blockHeader.setPreBlock(tip);
        blockHeader.timestamp = now;
        let cb = await this._createBlock(blockHeader);
        if (cb.err) {
            this.m_logger.error(`onNewProposal, _createBlock failed, errcode=${cb.err}`);
            return cb.err;
        }

        let writer: BufferWriter = new BufferWriter();
        cb.block!.encode(writer);
        return await this.m_consensus.sendPrepareRequest(writer.render(), Buffer.from(cb.block!.hash, 'hex'));
    }

    public async checkProposal(buf: Buffer, hash: Buffer): Promise<ErrorCode> {
        let reader: BufferReader = new BufferReader(buf);
        let blockHeader: DbftBlockHeader = this.chain.newBlockHeader() as DbftBlockHeader;
        let block: Block = this.chain.newBlock(blockHeader);
        block.decode(reader);

        if (block.hash !== hash.toString('hex')) {
            return ErrorCode.RESULT_FAILED;
        }

        if (!this.chain.tipBlockHeader || block.number !== this.chain.tipBlockHeader!.number || block.header.preBlockHash !== this.chain.tipBlockHeader!.preBlockHash) {
            return ErrorCode.RESULT_FAILED;
        }

        let vb = await this.chain.verifyBlock(block);
        if (vb.err) {
            return vb.err;
        }
        await this.chain.storageManager.releaseSnapshotView(block.hash);

        return vb.verified! ? ErrorCode.RESULT_OK : ErrorCode.RESULT_FAILED;
    }

    public async finishProposal(buf: Buffer, hash: Buffer, signs: { address: string, sign: string }[]): Promise<ErrorCode> {
        let reader: BufferReader = new BufferReader(buf);
        let blockHeader: DbftBlockHeader = this.chain.newBlockHeader() as DbftBlockHeader;
        blockHeader.addSigns(signs);
        let block: Block = this.chain.newBlock(blockHeader);
        block.decode(reader);

        // 超过了2/3的miner认为是正确的，但是和自己的信息匹配不上
        if (!this.chain.tipBlockHeader || block.number !== this.chain.tipBlockHeader!.number || block.header.preBlockHash !== this.chain.tipBlockHeader!.preBlockHash) {
            // 自己的块信息太落后了
            if (!this.chain.tipBlockHeader) {
                return ErrorCode.RESULT_OK;
            }
            if (block.number > this.chain.tipBlockHeader!.number) {
                return ErrorCode.RESULT_OK;
            }

            // 自己超前，这中情况下只应该有一块是错的吧，会出现多块么？
            // TODO: 回退一个block，再让他自己更新
            return ErrorCode.RESULT_OK;
        }

        let gssv = await this.chain.storageManager.getSnapshot(block.hash);
        if (gssv.err) {
            return gssv.err;
        }

        await this.chain.addMinedBlock(block, gssv.snapshot!);
        return ErrorCode.RESULT_OK;
    }
}
