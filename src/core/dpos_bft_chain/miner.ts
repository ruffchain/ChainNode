import { ErrorCode } from '../error_code';
import { DposMiner, DposMinerInstanceOptions, PackageStreamWriter, PackageTipSignBody, Package, MAX_PACKAGE_TIPSIGN_DEPTH } from '../dpos_chain';
import { DposBftChain, DposBftMinerChain } from './chain';
import { DposBftChainNode, DPOS_BFT_SYNC_CMD_TYPE } from './dpos_bft_node';
import { DposBftNetwork } from './network';
import { DposBftBlockHeaderSignature, DposBftBlockHeader, DposBftBlockHeaderPkg } from './block';
import * as libAddress from '../address';
import { DposBftChainTipState } from './chain_state';
import { DposBftChainTipStateManager } from './chain_state_manager';
import { Block } from '../block';
import { BufferReader } from '..';

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

    public static RANDOM_ADDRESS = [
        'April',
        'Block',
        'Cat',
        'Dog',
        'Egg',
        'Flower',
        'Goat',
        'Hook',
        'Igloo',
        'Jack',
        'King',
        'Lion',
        'Mew',
        'Noodle',
        'Oppo',
        'Pep',
        'Queen',
        'Rest',
        'Seed',
        'Tud',
        'Ugg'
    ];
    public static MAX_NODE_NUM = 21;

    // Yang Jun 2019-10-25
    private m_tipSignCache: Set<string> = new Set();

    protected _chainInstance(): DposBftChain {
        return new DposBftMinerChain(this.m_constructOptions);
    }

    protected createHeader(): DposBftBlockHeader {
        return new DposBftBlockHeader();
    }

    protected async _createBlock(header: DposBftBlockHeader): Promise<{ err: ErrorCode, block?: Block }> {
        let cts: DposBftChainTipState = this.chain.chainTipState as DposBftChainTipState;
        if (cts.IRB.number >= cts.bftIRB.number) {
            header.bftSigns = cts.bftSigns;
        }

        return await super._createBlock(header);
    }

    protected maybeNewBftIRB() {
        let checkImpl = async () => {
            let signs: DposBftBlockHeaderSignature[] = [];

            for (let [_, entry] of this.m_minerSigns) {
                if (entry.bInBestChain) {
                    signs.push(entry.sign);
                }
            }
            let err = await (this.chain.stateManager as DposBftChainTipStateManager).maybeNewBftIRB(signs);
            if (err) {
                return;
            }

            let lib: number = this.chain.chainTipState.IRB.number;

            let temp = this.m_minerSigns;
            for (let [m, entry] of temp) {
                if (entry.number > lib) {
                    this.m_minerSigns.set(m, entry);
                }
            }

            if (this.m_libOnBest !== lib) {
                this.m_libOnBest = lib;
                // Yang Jun 2019-10-25, if it is the BP 
                await this.sendSign();
            }

            this.m_logger.info(`---------------------checkImpl end  bftLib=${(this.chain.chainTipState as DposBftChainTipState).bftIRB.number} `);
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
                this.maybeNewBftIRB();
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
            // Add by Yang Jun 2019-8-27
            this.m_chain!.node.txBuffer.beginTipSign();

            let address = libAddress.addressFromPublicKey(sign.pubkey)!;
            //this.m_logger.info(`===============tipSign from ${address} hash=${sign.hash} `);
            let entry: DposBftSignEntry = { number: -1, bInBestChain: false, sign };
            let hr = await this.chain.getHeader(sign.hash);
            if (!hr.err) {
                if (hr.header!.number <= (this.chain.chainTipState as DposBftChainTipState).bftIRB.number) {
                    return;
                }
                entry.number = hr.header!.number;
                hr = await this.chain.getHeader(hr.header!.number);
                if (!hr.err) {
                    entry.bInBestChain = true;
                }
            }
            this.m_minerSigns.set(address, entry);
            this.maybeNewBftIRB();

            this.m_chain!.node.txBuffer.endTipSign();
        });

        // Yang Jun 2019-10-25
        this.m_bftNode.on('tipSignPkg', async (inpkg: Package) => {
            // How to relay it?
            let reader = new BufferReader(inpkg.copyData());
            let pubkey: Buffer;
            let sign: Buffer;
            let hash: string;

            try {
                pubkey = reader.readBytes(33);
                sign = reader.readBytes(64);
                hash = reader.readHash().toString('hex');
            } catch (e) {
                this.m_logger.error(`dpos_bft decode tipSign failed `, e);
                return;
            }

            // Yang Jun 2019-10-25
            // let data = inpkg.data;
            let body: PackageTipSignBody = inpkg.body;

            //console.log('tipSignPkg, body.froms:', body.froms)

            // if body is empty, from older nodes
            if (!body.froms) {
                // emit tipSign
                //this.m_logger.info('Emit tipSign (from old version)');
                this.m_bftNode!.emit('tipSign', { hash, pubkey, sign });

                // then broadcast it out, 
                await this.handleOldTipSign(hash, pubkey, sign, inpkg);
                return;
            } else {
                //this.m_logger.info('New tipSign');
            }

            await this.handleNewTipSign(hash, pubkey, sign, inpkg);

        });

        return ErrorCode.RESULT_OK;
    }

    private async handleNewTipSign(hash: string, pubkey: Buffer, sign: Buffer, inpkg: Package) {
        let body: PackageTipSignBody = inpkg.body;

        let addresses: string[] = body.froms;
        let tipSignId = body.height + ':' + body.source;

        // this.m_logger.info(`=====tipSignPkg from ${addresses} height=${body.height}`);
        // console.log('tipSignCache:')
        // console.log(this.m_tipSignCache);
        // console.log('tip body:')
        // console.log(body)
        // console.log('tipSignId: ', tipSignId);


        // if body.depth === 0
        if (this.m_tipSignCache.has(tipSignId) || body.depth === 0) {
            //this.m_logger.info('<<< No need to relay tipSign:' + tipSignId)
            return;
        } else {
            this.m_tipSignCache.add(tipSignId);
        }

        if (body.source !== this.address) {
            //this.m_logger.info('Emit tipSign');
            this.m_bftNode!.emit('tipSign', { hash, pubkey, sign });
        }

        body.froms.push(this.address);
        body.depth = body.depth - 1;

        // prepare pkg to be sent
        let dataToSend = inpkg.copyData();
        let pkg = PackageStreamWriter.fromPackage(DPOS_BFT_SYNC_CMD_TYPE.tipSign, body, dataToSend.length).writeData(dataToSend);
        // console.log('new body:')
        // console.log(body)

        // Broadcast it 
        //console.log('RelayTipSign: ')

        let hret = await this.m_bftNode!.relayTipSign(pkg, addresses);
        // console.log(hret);

        this.cleanTipSignCache();
    }
    private createRandomAddress(): string {
        let ind = Math.floor(Math.random() * DposBftMiner.MAX_NODE_NUM);
        let num = Math.floor(Math.random() * DposBftMiner.RANDOM_ADDRESS.length)
        return DposBftMiner.RANDOM_ADDRESS[ind] + num;
    }
    private async handleOldTipSign(hash: string, pubkey: Buffer, sign: Buffer, inpkg: Package) {
        // Create new Body
        let fakeAddress = this.createRandomAddress();
        let recvHeight = 0;

        let hr = await this.chain.getHeader(hash);
        if (!hr.err) {
            recvHeight = hr.header!.number;
        } else {
            this.m_logger.error('Unrecognized hash: ' + hash)
            return;
        }

        let body: PackageTipSignBody = {
            froms: [],
            depth: MAX_PACKAGE_TIPSIGN_DEPTH,
            height: recvHeight,
            source: fakeAddress
        };

        body.froms.push(fakeAddress);
        let dataToSend = inpkg.copyData();
        let pkg = PackageStreamWriter.fromPackage(DPOS_BFT_SYNC_CMD_TYPE.tipSign, body, dataToSend.length).writeData(dataToSend);
        // console.log('new body:')
        // console.log(body)

        // Broadcast it 
        // console.log('RelayTipSign: ')

        let hret = await this.m_bftNode!.relayTipSign(pkg, []);
        console.log(hret);

        this.cleanTipSignCache();

    }

    protected async sendSign() {
        if (this.chain.tipBlockHeader!.hash === this.chain.chainTipState.IRB.hash) {
            return;
        }
        let hr = await this.chain.getHeader(this.chain.chainTipState.IRB.number + 1);
        if (hr.err) {
            return;
        }

        const sign = libAddress.sign(hr.header!.hash, this.m_secret!);
        this.m_bftNode!.broadcastTip(this.m_pubkey!, sign, hr.header! as DposBftBlockHeader);

        // Yang Jun 2019-10-25 update tipSignCache
        this.m_tipSignCache.add(hr.header!.number + ':' + this.address);

        let entry: DposBftSignEntry = { number: hr.header!.number, bInBestChain: true, sign: { hash: hr.header!.hash, pubkey: this.m_pubkey!, sign } };
        this.m_minerSigns.set(this.address, entry);

        this.maybeNewBftIRB();
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

    // Yang Jun 2019-10-25
    private cleanTipSignCache() {
        let irbNum = this.chain.chainTipState.IRB.number - 14;

        let arr: string[] = [];
        this.m_tipSignCache.forEach((str) => {
            let strLst = str.split(':');
            let num = parseInt(strLst[0]);
            if (num <= irbNum) {
                arr.push(str);
            }
        })
        for (let i = 0; i < arr.length; i++) {
            this.m_tipSignCache.delete(arr[i]);
        }

        // limit size of cache , during initialization 2019-11-6
        if (this.m_tipSignCache.size > 21 * 14) {
            this.m_tipSignCache.clear();
        }
    }
}