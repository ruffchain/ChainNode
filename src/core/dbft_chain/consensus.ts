import {ErrorCode} from '../error_code';
import {EventEmitter} from 'events';
import {DbftChainNode, SYNC_CMD_TYPE} from './chain_node';
import {LoggerInstance} from '../lib/logger_util';
import * as Address from '../address';

export interface IConsensus {
    signData(hash: Buffer, secret: Buffer): Promise<{err: ErrorCode, sign?: Buffer}>;
    verifySign(buf: Buffer, hash: Buffer, pubkey: Buffer, sign: Buffer): Promise<ErrorCode>;
    newProposal(): Promise<ErrorCode>;
    checkProposal(buf: Buffer, hash: Buffer): Promise<ErrorCode>;
    finishProposal(buf: Buffer, hash: Buffer, signs: {address: string, sign: string}[]): Promise<ErrorCode>;
}

export type ConsensusOptions = {
    intervalTime: number;
    chainNode: DbftChainNode;
    secret: Buffer;
    logger: LoggerInstance;
    consensus: IConsensus;
    minValidator?: number;
    maxValidator?: number;
};

type PrepareRequestParam = {
    view: number;
    seq: number;
    buf: Buffer;
    hash: Buffer; // buff的摘要
    sign: string;
    address: string;
};

type PrepareResponseParam = {
    view: number;
    seq: number;
    hash: Buffer;
    sign: string;
    address: string;
};

type ChangeViewParam = {
    view: number;
    seq: number;
    address: string;
    newView: number;
};

enum ConsensusState {
    none = 0,
    sendRequest = 1,
    sendResponse = 2,
    sendChangeView = 3,
    finishConsensus = 4,
}

export class Consensus extends EventEmitter {
    protected m_blockHeight: number = 0;
    protected m_intervalTime: number = 0;
    protected m_validators: Map<string, Buffer> = new Map();
    protected m_ids: string[] = [];
    protected m_minValidator: number = 3;
    protected m_maxValidator: number = 21;
    protected m_chainNode?: DbftChainNode;
    protected m_secret?: Buffer;
    protected m_logger?: LoggerInstance;
    protected m_bActive: boolean = false;
    protected m_address: string = '';
    protected m_iConsensus: IConsensus = Object.create(null);

    protected m_monitorTimer: any = 0;
    protected m_newProposalTimer: any = 0;
    // 共识上下文
    protected m_view: number = 0;
    protected m_buf: Buffer = new Buffer(0);
    protected m_hash: Buffer = new Buffer(0);
    protected m_seq: number = 0;
    protected m_signs: {address: string, sign: string}[] = [];
    protected m_state: ConsensusState = ConsensusState.none;

    protected m_changeViewContext: Map<string, ChangeViewParam> = new Map();

    constructor() {
        super();
        this.resetConsensusContext(0);
    }

    public async initialize(options: ConsensusOptions): Promise<ErrorCode> {
        this.m_intervalTime = options.intervalTime;
        this.m_logger = options.logger;
        this.m_chainNode = options.chainNode;
        this.m_secret = options.secret;
        this.m_address = Address.addressFromSecretKey(this.m_secret!)!;
        this.m_iConsensus = options.consensus;
        // if (options.minValidator && options.minValidator > 2) {
        if (options.minValidator) {
            this.m_minValidator = options.minValidator;
        }
        // if (options.maxValidator && options.maxValidator <= 21) {
        if (options.maxValidator) {
            this.m_maxValidator = options.maxValidator;
        }
        // if (this.m_minValidator > this.m_maxValidator) {
        //     this.m_minValidator = 2;
        //     this.m_maxValidator = 21;
        // }

        this.m_chainNode.on('prepareRequest', (msg: PrepareRequestParam) => {
            this.recvPrepareRequest(msg);
        });

        this.m_chainNode.on('prepareResponse', (msg: PrepareResponseParam) => {
            this.recvPrepareResponse(msg);
        });

        this.m_chainNode.on('changeview', (msg: ChangeViewParam) => {
            this.recvChangeView(msg);
        });

        return ErrorCode.RESULT_OK;
    }

    public updateValidators(validators: {address: string, pubkey: Buffer}[]): ErrorCode {
        if (this.m_state !== ConsensusState.none && this.m_state !== ConsensusState.finishConsensus) {
            this.m_logger!.error(`updateValidators failed, state ${this.m_state} error`);
            return ErrorCode.RESULT_FAILED;
        }
        if (validators.length < this.m_minValidator || validators.length > this.m_maxValidator) {
            this.m_logger!.error(`updateValidators failed, length err,length should between ${this.m_minValidator} and ${this.m_maxValidator}, but ${validators.length}`);
            return ErrorCode.RESULT_INVALID_PARAM;
        }

        this.m_validators = new Map<string, Buffer>();
        this.m_ids = [];
        let bSelf: boolean = false;
        for (let v of validators) {
            this.m_validators.set(v.address, v.pubkey);
            this.m_ids.push(v.address);
            if (!bSelf && v.address === this.m_address) {
                bSelf = true;
            }
        }

        if (bSelf) {
            this.m_bActive = true;
            if (this._getPrimaryValidator(this.m_seq) === this.m_address) {
                this.beginNewProposalTimer();
            } else {
                this.beginMonitorTimer();
            }
        } else {
            this.m_bActive = false;
            this.endMonitorTimer();
            this.endNewProposalTimer();
        }

        return ErrorCode.RESULT_OK;
    }

    public updateSeq(seq: number) {
        this.m_seq = seq;
    }

    public getPrimaryValidator(): { err: ErrorCode, address?: string } {
        if (this.m_ids.length === 0) {
            return { err: ErrorCode.RESULT_FAILED };
        }

        return {err: ErrorCode.RESULT_OK, address: this._getPrimaryValidator(this.m_seq)};
    }
    
    protected _getPrimaryValidator(seq: number): string {
        let primaryIndex = (this.m_seq % this.m_ids.length + this.m_view) % this.m_ids.length;
        return this.m_ids[primaryIndex];
    }

    public async sendPrepareRequest(buf: Buffer, hash: Buffer): Promise<ErrorCode> {
        if (!this.m_bActive) {
            this.m_logger!.error(`sendPrepareRequest failed, not active`);
            return ErrorCode.RESULT_FAILED;
        }
        if (this.m_state !== ConsensusState.none) {
            this.m_logger!.error(`sendPrepareRequest failed, should be state ${ConsensusState.none} but ${this.m_state}`);
            return ErrorCode.RESULT_FAILED;
        }
        if (this.m_ids.length === 0) {
            this.m_logger!.error(`recvPrepareRequest failed, not exist validator`);
            return ErrorCode.RESULT_FAILED;
        }
        
        if (this._getPrimaryValidator(this.m_seq) !== this.m_address) {
            this.m_logger!.error(`recvPrepareRequest failed, it is not my turn, should be address ${this._getPrimaryValidator(this.m_seq)}`);
            return ErrorCode.RESULT_FAILED;
        }

        let sd = await this.m_iConsensus.signData(hash, this.m_secret!);
        if (sd.err) {
            this.m_logger!.error(`recvPrepareRequest failed, sign failed, errcode=${sd.err}`);
            return sd.err;
        }
        let sign: string = sd.sign!.toString('hex');
        let msg: PrepareRequestParam = {view: this.m_view, buf, hash, seq: this.m_seq, sign, address: this.m_address};
        this.m_state = ConsensusState.sendRequest;
        this.m_buf = buf;
        this.m_hash = hash;
        this.addSign(this.m_address, sign);

        this.m_logger!.info(`${this.m_address} send prepareRequest, view ${this.m_view}, seq ${this.m_seq}, hash=${hash.toString('hex')}, sign=${sign}`);
        await this.m_chainNode!.sendConsensusMsg(SYNC_CMD_TYPE.prepareRequest, msg, this.m_ids);

        // 为了调试
        await this.verifySigns();
        return ErrorCode.RESULT_OK;
    }

    protected async recvPrepareRequest(param: PrepareRequestParam): Promise<ErrorCode> {
        let strHash = param.hash.toString('hex');
        if (!this.m_bActive) {
            this.m_logger!.error(`recvPrepareRequest failed, not active,hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }
        if (this.m_state !== ConsensusState.none) {
            this.m_logger!.error(`recvPrepareRequest failed, should be state ${ConsensusState.none} but ${this.m_state},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }
        if (this.m_ids.length === 0) {
            this.m_logger!.error(`recvPrepareRequest failed, not exist validator`);
            return ErrorCode.RESULT_FAILED;
        }

        if (this.m_view !== param.view) {
            this.m_logger!.error(`recvPrepareRequest failed, should be view ${this.m_view} but ${param.view},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }

        if (this.m_seq !== param.seq) {
            this.m_logger!.error(`recvPrepareRequest failed, should be seq ${this.m_seq} but ${param.seq},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }

        if (this._getPrimaryValidator(this.m_seq) !== param.address) {
            this.m_logger!.error(`recvPrepareRequest failed, it is not ${param.address} turns, should be address ${this._getPrimaryValidator(this.m_seq)},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }

        if (!this.m_validators.has(param.address)) {
            this.m_logger!.error(`recvPrepareRequest failed, not found validator, from address ${param.address},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }

        if (await this.m_iConsensus.verifySign(param.buf, param.hash, this.m_validators.get(param.address)!, Buffer.from(param.sign, 'hex')) !== ErrorCode.RESULT_OK) {
            this.m_logger!.error(`recvPrepareRequest failed, verify sign failed, from address ${param.address},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }

        try {
            let err = await this.m_iConsensus.checkProposal(param.buf, param.hash);
            if (err) {
                this.m_logger!.error(`recvPrepareRequest failed, checkProposal failed,errcode ${err},from address=${param.address},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
                return ErrorCode.RESULT_FAILED;
            }
        } catch (error) {
            this.m_logger!.error(`recvPrepareRequest failed, checkProposal exception,error=${error}from address=${param.address},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return ErrorCode.RESULT_EXCEPTION;
        }

        this.m_logger!.info(`${this.m_address} recv prepareRequest, from ${param.address} view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
        this.m_buf = param.buf;
        this.m_hash = param.hash;
        this.addSign(param.address, param.sign);
        let sd = await this.m_iConsensus.signData(param.hash, this.m_secret!);
        if (sd.err) {
            this.m_logger!.error(`recvPrepareRequest failed, sign failed, errcode=${sd.err}, from ${param.address} view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return sd.err;
        }
        let sign: string = sd.sign!.toString('hex');
        this.addSign(this.m_address, sign);

        // 发送response
        let answer: PrepareResponseParam = {view: this.m_view, seq: this.m_seq, hash: param.hash, sign, address: this.m_address};
        this.m_state = ConsensusState.sendResponse;
        this.m_logger!.info(`${this.m_address} send prepareResponse, view ${this.m_view}, seq ${this.m_seq}, sign=${sign}, hash=${strHash}`);
        await this.m_chainNode!.sendConsensusMsg(SYNC_CMD_TYPE.prepareResponse, answer, this.m_ids);

        await this.verifySigns();
        // 检查是否足够的签名
        return ErrorCode.RESULT_OK;
    }

    protected async sendPrepareResponse(param: PrepareResponseParam): Promise<ErrorCode> {
        return ErrorCode.RESULT_OK;
    }

    protected async recvPrepareResponse(param: PrepareResponseParam): Promise<ErrorCode> {
        let strHash = param.hash.toString('hex');
        if (!this.m_bActive) {
            this.m_logger!.error(`recvPrepareResponse failed, not active,hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }
        
        if (this.m_ids.length === 0) {
            this.m_logger!.error(`recvPrepareResponse failed, not exist validator`);
            return ErrorCode.RESULT_FAILED;
        }

        if (this.m_view !== param.view) {
            this.m_logger!.error(`recvPrepareResponse failed, should be view ${this.m_view} but ${param.view},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }

        if (this.m_seq !== param.seq) {
            this.m_logger!.error(`recvPrepareResponse failed, should be seq ${this.m_seq} but ${param.seq},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }

        if (this.m_hash.toString('hex') !== param.hash.toString('hex')) {
            this.m_logger!.error(`recvPrepareResponse failed, should be hash ${strHash} but ${param.hash},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }

        if (!this.m_validators.has(param.address)) {
            this.m_logger!.error(`recvPrepareResponse failed, not found validator, from address ${param.address},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }

        if (await this.m_iConsensus.verifySign(this.m_buf, param.hash, this.m_validators.get(param.address)!, Buffer.from(param.sign, 'hex')) !== ErrorCode.RESULT_OK) {
            this.m_logger!.error(`recvPrepareResponse failed, verify sign failed, from address ${param.address},view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
            return ErrorCode.RESULT_FAILED;
        }

        this.m_logger!.info(`${this.m_address} recv prepareResponse, from ${param.address} view ${this.m_view}, seq ${this.m_seq}, hash=${strHash}`);
        this.m_signs.push({address: param.address, sign: param.sign});

        await this.verifySigns();
        return ErrorCode.RESULT_OK;
    }

    protected async sendChangeView(): Promise<ErrorCode> {
        let expectedView = this.m_view + 1;
        if (this.m_changeViewContext.has(this.m_address)) {
            expectedView = this.m_changeViewContext.get(this.m_address)!.newView++;
        }
        let msg: ChangeViewParam = {view: this.m_view, seq: this.m_seq, address: this.m_address, newView: expectedView};
        this.m_logger!.info(`${this.m_address} sendChangeView, expectedview ${expectedView} view ${this.m_view}, seq ${this.m_seq}`);
        this.m_changeViewContext.set(this.m_address, msg);
        await this.m_chainNode!.sendConsensusMsg(SYNC_CMD_TYPE.changeview, msg, this.m_ids);
        return ErrorCode.RESULT_OK;
    }

    protected async recvChangeView(param: ChangeViewParam): Promise<ErrorCode> {
        if (!this.m_bActive) {
            this.m_logger!.error(`recvChangeView failed, not active, from ${param.address}, newView ${param.newView} newSeq ${param.seq} view ${this.m_view} seq ${this.m_seq}`);
            return ErrorCode.RESULT_FAILED;
        }
        
        if (this.m_ids.length === 0) {
            this.m_logger!.error(`recvChangeView failed, not exist validator, from ${param.address}, newView ${param.newView} newSeq ${param.seq} view ${this.m_view} seq ${this.m_seq}`);
            return ErrorCode.RESULT_FAILED;
        }

        if (param.view < this.m_view || param.seq < this.m_seq) {
            this.m_logger!.error(`recvChangeView failed, view or seq error, from ${param.address}, newView ${param.newView} newSeq ${param.seq} view ${this.m_view} seq ${this.m_seq}`);
            return ErrorCode.RESULT_FAILED;
        }

        this.m_logger!.info(`recvChangeView succ, from ${param.address}, newView ${param.newView} newSeq ${param.seq} view ${this.m_view} seq ${this.m_seq}`);
        this.m_changeViewContext.set(param.address, param);

        this.verifyChangeView();

        return ErrorCode.RESULT_OK;
    }

    protected resetConsensusContext(view: number) {
        this.m_view = view;
        this.m_buf = new Buffer(0);
        this.m_hash = new Buffer(0);
        this.m_signs = [];
        this.m_state = ConsensusState.none;
    }

    protected addSign(address: string, sign: string) {
        for (let s of this.m_signs) {
            if (s.address === address) {
                return ;
            }
        }
        this.m_signs.push({address, sign});
    }

    protected async verifySigns() {
        if (this.m_state !== ConsensusState.sendRequest && this.m_state !== ConsensusState.sendResponse) {
            return;
        }

        let m: number = Math.floor(this.m_ids.length * 2 / 3);
        if (m * 3 < this.m_ids.length * 2) {
            m = m + 1;
        }

        if (this.m_signs.length >= m) {
            try {
                this.m_state = ConsensusState.finishConsensus;
                let err = await this.m_iConsensus.finishProposal(this.m_buf, this.m_hash, this.m_signs);
                this.m_logger!.info(`${this.m_address} finishConsensus,errcode ${err}, view ${this.m_view}, seq ${this.m_seq}, hash=${this.m_hash.toString('hex')}`);
            } catch (error) {
                this.m_logger!.error(`verifySigns exception,error=${error} view ${this.m_view}, seq ${this.m_seq}, hash=${this.m_hash.toString('hex')}`);
            }
            this.m_seq++;
            this.resetConsensusContext(0);
        }
    }

    protected verifyChangeView() {
        let m: number = Math.floor(this.m_ids.length * 2 / 3);
        if (m * 3 < this.m_ids.length * 2) {
            m = m + 1;
        }

        let maxView: number = 0;
        let maxCount: number = 0;
        let counts: Map<number, number> = new Map();
        for (let [address, param] of this.m_changeViewContext) {
            let count: number = 0;
            if (counts.has(param.view)) {
                count = counts.get(param.view)! + 1;
            } else {
                count = 1;
            }
            counts.set(param.view, count);
            if (maxCount < count) {
                maxView = param.view;
                maxCount = count;
            }
        }

        if (maxCount >= m) {
            this.resetConsensusContext(maxView);
            if (this._getPrimaryValidator(this.m_seq) === this.m_address) {
                this.beginNewProposalTimer();
            } else {
                this.beginMonitorTimer();
            }
        }
    }

    protected async onTimeout() {
        if (this._getPrimaryValidator(this.m_seq) === this.m_address) {
            try {
                let err = await this.m_iConsensus.newProposal();
                if (err) {
                    this.m_logger!.error(`newProposal failed,errcode ${err},view ${this.m_view}, seq ${this.m_seq}`);
                    return ;
                }
            } catch (error) {
                this.m_logger!.error(`newProposal exception, errmsg ${error},view ${this.m_view}, seq ${this.m_seq}`);
            }
            this.beginMonitorTimer();
        } else {
            await this.sendChangeView();
            this.beginMonitorTimer();
        }
    }

    protected beginMonitorTimer() {
        this.endMonitorTimer();
        this.m_monitorTimer = setTimeout(() => {
            this.onTimeout();
        }, (this.m_intervalTime * 1000) << (this.m_view + 1));
    }

    protected endMonitorTimer() {
        if (this.m_monitorTimer !== 0) {
            clearTimeout(this.m_monitorTimer);
            this.m_monitorTimer = 0;
        }
    }

    protected beginNewProposalTimer() {
        this.endMonitorTimer();
        this.endNewProposalTimer();
        this.m_newProposalTimer = setTimeout(() => {
            this.onTimeout();
        }, this.m_intervalTime * 1000);
    }

    protected endNewProposalTimer() {
        if (this.m_newProposalTimer !== 0) {
            clearTimeout(this.m_newProposalTimer);
            this.m_newProposalTimer = 0;
        }
    }
}