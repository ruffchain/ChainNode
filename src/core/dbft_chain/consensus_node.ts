import { EventEmitter } from 'events';
const assert = require('assert');
import { ErrorCode } from '../error_code';
import { LoggerInstance } from '../lib/logger_util';
import { BufferWriter } from '../lib/writer';
import {NodeConnection, PackageStreamWriter, Package, Block, BlockHeader} from '../chain';

import { SYNC_CMD_TYPE } from '../chain/chain_node';
import {ValidatorsNode} from './validators_node';
import {DbftBlockHeader, DbftBlockHeaderSignature} from './block';
import { isNullOrUndefined } from 'util';
import { DbftContext } from './context';
import { BufferReader } from '../lib/reader';
import * as libAddress from '../address';

export enum DBFT_SYNC_CMD_TYPE {
    prepareRequest = SYNC_CMD_TYPE.end + 1,
    prepareResponse = SYNC_CMD_TYPE.end + 2,
    changeview = SYNC_CMD_TYPE.end + 3,
    end = SYNC_CMD_TYPE.end + 4,
}

enum ConsensusState {
    none = 0,
    waitingCreate = 1,
    waitingProposal = 3,
    waitingVerify = 4,
    waitingAgree = 5,
    waitingBlock = 6,
    changeViewSent = 10,
}

type ConsensusBaseContext = {
    curView: number;
};

type WaitingCreateContext = ConsensusBaseContext & {

};

type WaitingProposalContext = ConsensusBaseContext & {

};

type WaitingAgreeContext = ConsensusBaseContext & {
    block: Block;
    signs: Map<string, DbftBlockHeaderSignature>;
};

type WaitingVerifyContext = ConsensusBaseContext & {
    block: Block;
    from: NodeConnection
};

export type DbftConsensusNodeOptions = {
    node: ValidatorsNode,
    globalOptions: any,
    secret: Buffer
};

type ConsensusTip = {
    header: DbftBlockHeader;
    totalView: number;
    nextMiners: string[];
};

export class DbftConsensusNode extends EventEmitter {
    constructor(options: DbftConsensusNodeOptions) {
        super();
        this.m_node = options.node;
        this.m_globalOptions = options.globalOptions;
        this.m_state = ConsensusState.none;
        this.m_secret = options.secret;
        this.m_address = libAddress.addressFromSecretKey(this.m_secret)!;
        this.m_pubkey = libAddress.publicKeyFromSecretKey(this.m_secret)!;
    }

    private m_node: ValidatorsNode;
    private m_globalOptions: any;
    private m_timer?: NodeJS.Timer;
    protected m_state: ConsensusState;
    protected m_context?: ConsensusBaseContext & any;
    protected m_tip?: ConsensusTip;
    protected m_genesisTime?: number;
    protected m_address: string;
    protected m_secret: Buffer;
    protected m_pubkey: Buffer;

    on(event: 'createBlock', listener: (header: DbftBlockHeader) => any): this;
    on(event: 'verifyBlock', listener: (block: Block) => any): this;
    on(event: 'mineBlock', listener: (block: Block, signs: DbftBlockHeaderSignature[]) => any): this;
    on(event: string, listener: any): this {
        return super.on(event, listener);
    }

    once(event: 'createBlock', listener: (header: DbftBlockHeader) => any): this;
    once(event: 'verifyBlock', listener: (block: Block) => any): this;
    once(event: 'mineBlock', listener: (block: Block, signs: DbftBlockHeaderSignature[]) => any): this;
    once(event: string, listener: any): this {
        return super.once(event, listener);
    }   

    get base(): ValidatorsNode {
        return this.m_node;
    }

    get logger(): LoggerInstance {
        return this.m_node.logger;
    }

    public async init(): Promise<ErrorCode> {
        await this.m_node.init();
        let hr = await this.m_node.headerStorage.getHeader(0);
        if (hr.err) {
            this.logger.error(`dbft consensus node init failed for ${hr.err}`);
            return hr.err;
        }
        this.m_genesisTime = hr.header!.timestamp;
        let err = await this.m_node.initialOutbounds();
        if (err) {
            this.logger.error(`dbft consensus node init failed for ${err}`);
            return err;
        }
        return ErrorCode.RESULT_OK;
    }

    protected _cancel() {
        this.m_state = ConsensusState.none;
        this.m_context = undefined;
        this._resetTimer();
    }

    updateTip(header: DbftBlockHeader, nextMiners: string[], totalView: number) {
        // TODO: 这里还需要比较两个header 的work，只有大的时候覆盖
        if (!this.m_tip || this.m_tip.header.hash !== header.hash) {
            this.m_tip = {
                header,
                nextMiners,
                totalView
            };
            if (this.m_state !== ConsensusState.none) {
                this.logger.warn(`dbft conensus update tip when in consensus `, this.m_context!);
                this._cancel();
            } else {
                this._resetTimer();
            }
            this.m_node.setValidators(nextMiners);
        }
    }

    async agreeProposal(block: Block): Promise<ErrorCode> {
        if (this.m_state !== ConsensusState.waitingVerify) {
            this.logger.warn(`skip agreeProposal in state `, this.m_state);
            return ErrorCode.RESULT_SKIPPED;
        } 
        let curContext = this.m_context as WaitingVerifyContext;
        assert(curContext && curContext.block && curContext.from);
        if (!curContext || !curContext.block || !curContext.from) {
            this.logger.error(`agreeProposal in invalid context `, curContext);
            return ErrorCode.RESULT_SKIPPED;
        }
        if (!curContext.block.header.isPreBlock(block.header)) {
            this.logger.error(`agreeProposal block ${block.header} ${block.number} in invalid context block ${curContext.block.hash} ${curContext.block.number}`);
            return ErrorCode.RESULT_SKIPPED;
        }
        const sign = libAddress.sign(block.hash, this.m_secret);
        this._sendPrepareResponse(curContext.from, curContext.block, sign);
        // TODO?要进入什么状态?
        return ErrorCode.RESULT_OK;
    }

    async newProposal(block: Block): Promise<ErrorCode> {
        assert(this.m_tip);
        if (!this.m_tip) {
            return ErrorCode.RESULT_SKIPPED;
        }
        if (this.m_state !== ConsensusState.waitingCreate) {
            this.logger.warn(`dbft conensus newProposal ${block.header.hash}  ${block.header.number} while not in waitingCreate state`);
            return ErrorCode.RESULT_SKIPPED;
        }
        if (!this.m_tip.header.isPreBlock(block.header)) {
            this.logger.warn(`dbft conensus newProposal ${block.header.hash}  ${block.header.number} while in another context ${this.m_tip.header.hash} ${this.m_tip.header.number}`);
            return ErrorCode.RESULT_SKIPPED;
        }
        this._sendPrepareRequest(block);
        this.m_state = ConsensusState.waitingAgree;
        let curContext: WaitingAgreeContext = {
            curView: 0,
            block,
            signs: new Map()
        };
        this.m_context = curContext;
        return ErrorCode.RESULT_OK;
    }

    protected async _resetTimer(): Promise<ErrorCode> {
        let tr = await this._nextTimeout();
        if (tr.err === ErrorCode.RESULT_SKIPPED) {
            return tr.err;
        }

        if (this.m_timer) {
            clearTimeout(this.m_timer);
            delete this.m_timer; 
        }
        
        this.m_timer = setTimeout(async () => {
            delete this.m_timer;
            this._resetTimer();
            this._onTimeout();
        }, tr.timeout!);
        return ErrorCode.RESULT_OK;
    }

    protected _isOneOfMiner(): boolean {
        return this.m_tip!.nextMiners.indexOf(this.m_address) >= 0;
    }

    protected _onTimeout() {
        assert(this.m_tip);
        if (!this.m_tip) {
            this.logger.warn(`bdft consensus has no tip when time out`);
            return;
        }
        if (this.m_state === ConsensusState.none) {
            if (!this._isOneOfMiner()) {
                this.logger.debug(`bdft consensus is not one of miner when time out`);
                return ;
            }
            let due = DbftContext.getDueNextMiner(this.m_globalOptions, this.m_tip.header, this.m_tip.nextMiners, 0);
            if (this.m_address === due) {
                this.m_state = ConsensusState.waitingCreate;
                let newContext: WaitingCreateContext = {
                    curView: 0
                };
                this.m_context = newContext;
                let now = Date.now() / 1000;
                let blockHeader = new DbftBlockHeader();
                blockHeader.setPreBlock(this.m_tip.header);
                blockHeader.timestamp = now;
                this.logger.debug(`bdft consensus enter waitingCreate ${blockHeader.hash} ${blockHeader.number}`);
                this.emit('createBlock', blockHeader);
            } else {
                this.m_state = ConsensusState.waitingProposal;
                let newContext: WaitingProposalContext = {
                    curView: 0
                };
                this.m_context = newContext;
                this.logger.debug(`bdft consensus enter waitingProposal ${this.m_tip.header.hash} ${this.m_tip.header.number}`);
            }
        } else if (this.m_state === ConsensusState.waitingAgree) {
            // 超时未能达成共识，触发提升view
        } else {
            // TODO:
            assert(false);
        }
    }

    protected async _sendPrepareRequest(block: Block) {
        let writer = new BufferWriter();
        let err = block.encode(writer);
        let data = writer.render();

        let pkg = PackageStreamWriter.fromPackage(DBFT_SYNC_CMD_TYPE.prepareRequest, {}, data.length).writeData(data);
        this.m_node.broadcastToValidators(pkg);
    }

    protected _sendPrepareResponse(to: NodeConnection, block: Block, sign: Buffer) {
        let writer = new BufferWriter();
        writer.writeBytes(this.m_pubkey);
        writer.writeBytes(sign);
        let data = writer.render();
        let pkg = PackageStreamWriter.fromPackage(DBFT_SYNC_CMD_TYPE.prepareResponse, {hash: block.hash}, data.length).writeData(data);
        to.addPendingWriter(pkg);
    }

    protected _beginSyncWithNode(conn: NodeConnection) {
        conn.on('pkg', async (pkg: Package) => {
            if (pkg.header.cmdType === DBFT_SYNC_CMD_TYPE.prepareRequest) {
                let block = this.base.newBlock();
                let reader = new BufferReader(pkg.copyData());
                let err = block.decode(reader);
                if (err) {
                    // TODO: ban it
                    // this.base.banConnection();
                    this.logger.error(`recv invalid prepareRequest from `, conn.getRemote());
                    return ;
                }
                if (!(block.header as DbftBlockHeader).verifySign()) {
                    // TODO: ban it
                    // this.base.banConnection();
                    this.logger.error(`recv invalid signature prepareRequest from `, conn.getRemote());
                    return ;
                }
                if (!block.verify()) {
                    // TODO: ban it
                    // this.base.banConnection();
                    this.logger.error(`recv invalid block in prepareRequest from `, conn.getRemote());
                    return ;
                }
                this._onPrepareRequest(conn, {block});
            } else if (pkg.header.cmdType === DBFT_SYNC_CMD_TYPE.prepareResponse) {
                const hash = pkg.body.hash;
                let reader = new BufferReader(pkg.copyData());
                let pubkey;
                let sign;
                try {
                    pubkey = reader.readBytes(33);
                    sign = reader.readBytes(64);
                } catch (e) {
                    // TODO: ban it
                    // this.base.banConnection();
                    this.logger.error(`decode prepareResponse failed `, e);
                    return ;
                }
                if (!libAddress.verify(hash, sign, pubkey)) {
                    // TODO: ban it
                    // this.base.banConnection();
                    this.logger.error(`prepareResponse verify sign invalid`);
                    return ;
                }
                if (libAddress.addressFromPublicKey(pubkey) === this.m_address) {
                    // TODO: ban it
                    // this.base.banConnection();
                    this.logger.error(`prepareResponse got my sign`);
                    return ;
                } 
                this._onPrepareResponse(conn, {hash, pubkey, sign});
            } else if (pkg.header.cmdType === DBFT_SYNC_CMD_TYPE.changeview) {
                this.emit('changeview', pkg.body);
            }
        });
    }

    protected _onPrepareRequest(from: NodeConnection, pkg: {block: Block}) {
        if (!this.m_tip) {
            this.logger.warn(`_onPrepareRequest while no tip`);
            return ;
        }
        if (this.m_state === ConsensusState.waitingProposal) {
            assert(this.m_context);
            let curContext = this.m_context as WaitingProposalContext;
            if (!this.m_tip.header.isPreBlock(pkg.block.header)) {
                this.logger.debug(`_onPrepareRequest got block ${pkg.block.header.hash} ${pkg.block.header.number} while tip is ${this.m_tip.header.hash} ${this.m_tip.header.number}`);
                return ;
            }
            let header = pkg.block.header as DbftBlockHeader;
            if (curContext.curView !== header.view) {
                // 有可能漏了change view，两边view 不一致
                this.logger.debug(`_onPrepareRequest got block ${header.hash} ${header.number} ${header.view} while cur view is ${curContext.curView}`);
                return ;
            }
            let due = DbftContext.getDueNextMiner(this.m_globalOptions, this.m_tip.header, this.m_tip.nextMiners, curContext.curView);
            if (header.miner !== due) {
                // TODO: ban it
                // this.base.banConnection();
                this.logger.error(`recv prepareRequest's block ${pkg.block.header.hash} ${pkg.block.header.number} ${header.miner} not match due miner ${due}`);
                return ;
            } 
            this.m_state = ConsensusState.waitingVerify;
            let newContext: WaitingVerifyContext = {
                curView: curContext.curView,
                block: pkg.block,
                from
            };
            this.m_context = newContext;
            this.logger.debug(`bdft consensus enter waitingVerify ${header.hash} ${header.number}`);
            this.emit('verifyBlock', pkg.block);
        } else {
            // 其他状态都忽略
            this.logger.warn(`_onPrepareRequest in invalid state `, this.m_state);
        }
    }

    protected _onPrepareResponse(from: NodeConnection, pkg: {hash: string, pubkey: Buffer, sign: Buffer}) {
        if (!this.m_tip) {
            this.logger.warn(`_onPrepareResponse while no tip`);
            return ;
        }
        if (this.m_state === ConsensusState.waitingAgree) {
            assert(this.m_context);
            let curContext = this.m_context as WaitingAgreeContext;
            if (curContext.block.hash !== pkg.hash) {
                this.logger.warn(`_onPrepareResponse got ${pkg.hash} while waiting ${curContext.block.hash}`);
                return ;
            }
            const address = libAddress.addressFromPublicKey(pkg.pubkey)!;
            if (this.m_tip!.nextMiners.indexOf(address) < 0) {
                this.logger.warn(`_onPrepareResponse got ${address} 's sign not in next miners`);
                // TODO: ban it
                // this.base.banConnection();
                return ;
            }
            if (curContext.signs.has(address)) {
                this.logger.warn(`_onPrepareResponse got ${address} 's duplicated sign`);
                return ;
            }
            curContext.signs.set(address, {pubkey: pkg.pubkey, sign: pkg.pubkey});
            if (DbftContext.isAgreeRateReached(this.m_globalOptions, this.m_tip!.nextMiners.length, curContext.signs.size + 1)) {
                this.logger.info(`bdft consensus node enter state waitingBlock ${curContext.block.hash} ${curContext.block.number}`);
                this.m_state = ConsensusState.waitingBlock;
                let signs = [];
                for (let s of curContext.signs.values()) {
                    signs.push(s);
                }
                this.emit('mineBlock', curContext.block, signs);
            }
        } else {
            // 其他状态都忽略
            this.logger.warn(`_onPrepareResponse in invalid state `, this.m_state);
        }
    }

    protected async _nextTimeout(): Promise<{err: ErrorCode, timeout?: number}> {
        if (!this.m_tip) {
            return {err: ErrorCode.RESULT_SKIPPED};
        }
        let blockInterval = this.m_globalOptions.blockInterval;
        let intervalCount = this.m_tip.totalView;
        if (this.m_context) {
            intervalCount += Math.pow(2, this.m_context!.curView!);
        } else {
            intervalCount += 1;
        }
        let nextTime = this.m_genesisTime! + intervalCount * blockInterval;
        let now = Date.now() / 1000;
        if (nextTime > now) {
            return {err: ErrorCode.RESULT_OK, timeout: (nextTime - now) * 1000};
        } else {
            return {err: ErrorCode.RESULT_SKIPPED};
        }
    }
}