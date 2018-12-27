import {ErrorCode} from '../error_code';
import {DposMiner, DposMinerInstanceOptions} from '../dpos_chain';
import {DposBftChain, DposBftMinerChain} from './chain';
import {DposBftChainNode} from './dpos_bft_node';
import {DposBftNetwork} from './network';
import {DposBftBlockHeaderSignature, DposBftBlockHeader} from './block';
import * as libAddress from '../address';
import {DposBftChainTipState} from './chain_state';
import {Block} from '../block';

export type DposBftSignEntry = {
    number: number,
    bInBestChain: boolean,
    sign: DposBftBlockHeaderSignature
};
export class DposBftMiner extends DposMiner {
    private m_bftNode?: DposBftChainNode;
    private m_minerSigns: Map<string, DposBftSignEntry> = new Map();
    private m_pubkey: Buffer | undefined;
    private m_checkTimes: number = 0;
    private m_libOnBest: number = -1;

    protected _chainInstance(): DposBftChain {
        return new DposBftMinerChain(this.m_constructOptions);
    }

    protected createHeader(): DposBftBlockHeader {
        return new DposBftBlockHeader();
    }

    protected async _createBlock(header: DposBftBlockHeader): Promise<{err: ErrorCode, block?: Block}> {
        let cts: DposBftChainTipState = this.chain.chainTipState as DposBftChainTipState;
        if (cts.irreversible >= cts.bftIrreversibleBlockNum) {
            header.bftSigns = cts.bftSigns;
        }

        return await super._createBlock(header);
    }

    protected maybeNewBftIrreversibleNumber() {
        let checkImpl = async () => {
            let signs: DposBftBlockHeaderSignature[] = [];
            for (let [_, entry] of this.m_minerSigns) {
                if (entry.bInBestChain) {
                    signs.push(entry.sign);
                }
            }
            let err = await (this.chain.chainTipState as DposBftChainTipState).maybeNewBftIrreversibleNumber(signs);
            if (err) {
                return;
            }

            let lib: number = this.chain.chainTipState.irreversible;
            let temp = this.m_minerSigns;
            for (let [m, entry] of temp) {
                if (entry.number > lib) {
                    this.m_minerSigns.set(m, entry);
                }
            }

            if (this.m_libOnBest !== lib) {
                this.m_libOnBest = lib;
                await this.sendSign();
            }

            this.m_logger.info(`---------------------checkImpl end  bftLib=${(this.chain.chainTipState as DposBftChainTipState).bftIrreversibleBlockNum} dposLib=${(this.chain.chainTipState as DposBftChainTipState).dposIrreversibleBlockNum}`);
        };

        let check = async () => {
            if (this.m_checkTimes > 0) {
                this.m_checkTimes++;
                return;
            }
            this.m_checkTimes = 1;
            await checkImpl();
            this.m_checkTimes--;
            if (this.m_checkTimes > 0) {
                this.m_checkTimes = 0;
                this.maybeNewBftIrreversibleNumber();
            }
        };
        check();
    }

    public async initialize(options: DposMinerInstanceOptions): Promise<ErrorCode> {
        let err = await super.initialize(options);
        if (err) {
            this.m_logger.error(`dbft miner super initialize failed, errcode ${err}`);
            return err;
        } 

        this.m_pubkey = libAddress.publicKeyFromSecretKey(this.m_secret!)!;
        this.m_bftNode = new DposBftChainNode({
            network: this.m_chain!.node.getNetwork() as DposBftNetwork,
            globalOptions: this.m_chain!.globalOptions,
            secret: this.m_secret!
        });

        this.m_bftNode.on('tipSign', async (sign: DposBftBlockHeaderSignature) => {
            let address = libAddress.addressFromPublicKey(sign.pubkey)!;
            this.m_logger.info(`===============tipSign from ${address} hash=${sign.hash}`);
            let entry: DposBftSignEntry = {number: -1, bInBestChain: false, sign};
            let hr = await this.chain.getHeader(sign.hash);
            if (!hr.err) {
                if (hr.header!.number <= (this.chain.chainTipState as DposBftChainTipState).bftIrreversibleBlockNum) {
                    return;
                }
                entry.number = hr.header!.number;
                hr = await this.chain.getHeader(hr.header!.number);
                if (!hr.err) {
                    entry.bInBestChain = true;
                }
            }
            this.m_minerSigns.set(address, entry);
            this.maybeNewBftIrreversibleNumber();
        });

        return ErrorCode.RESULT_OK;
    }

    protected async sendSign() {
        if (this.chain.tipBlockHeader!.hash === this.chain.chainTipState.irreversibleHash) {
            return ;
        }
        let hr = await this.chain.getHeader(this.chain.chainTipState.irreversible + 1);
        if (hr.err) {
            return;
        }

        const sign = libAddress.sign(hr.header!.hash, this.m_secret!);
        this.m_bftNode!.broadcastTip(this.m_pubkey!, sign, hr.header! as DposBftBlockHeader);

        let entry: DposBftSignEntry = { number: hr.header!.number, bInBestChain: true, sign: { hash: hr.header!.hash, pubkey: this.m_pubkey!, sign } };
        this.m_minerSigns.set(this.address, entry);
        this.maybeNewBftIrreversibleNumber();
    }

    protected async _onTipBlock(chain: DposBftMinerChain, tipBlock: DposBftBlockHeader): Promise<void> {
        // 处理bInBestChain
        for (let [_, entry] of this.m_minerSigns) {
            if (entry.sign.hash === tipBlock.hash) {
                entry.bInBestChain = true;
                entry.number = tipBlock.number;
            }
        }
        await super._onTipBlock(chain, tipBlock);

        await this.sendSign();

        // miners得更新会延迟一个块
        let gm = await this.chain.getMiners(tipBlock);
        if (gm.err) {
            this.m_logger.error(`dpos_bft_chain getminers error`);
            return;
        }
        (this.m_chain!.node.getNetwork() as DposBftNetwork).setValidators(gm.creators!);
    }
}