import {ErrorCode} from '../error_code';
import { EventEmitter } from 'events';
import { LoggerInstance } from '../lib/logger_util';
import {SYNC_CMD_TYPE} from '../chain/chain_node';
import {NodeConnection, PackageStreamWriter, Package, CMD_TYPE} from '../net';
import {DposBftBlockHeaderSignature, DposBftBlockHeader} from './block';
import {DposBftNetwork} from './network';
import { BufferReader } from '../lib/reader';
import { BufferWriter } from '../lib/writer';
import * as libAddress from '../address';

export enum DPOS_BFT_SYNC_CMD_TYPE {
    tipSign = SYNC_CMD_TYPE.end + 1,
    end = SYNC_CMD_TYPE.end + 2,
}

export type DposBftNodeOptions = {
    network: DposBftNetwork,
    globalOptions: any,
    secret: Buffer
};

export class DposBftChainNode extends EventEmitter {
    private m_network: DposBftNetwork;
    private m_globalOptions: any;
    protected m_secret: Buffer;
    protected m_pubkey: Buffer;

    constructor(options: DposBftNodeOptions) {
        super();
        this.m_network = options.network;
        this.m_globalOptions = options.globalOptions;
        this.m_secret = options.secret;
        this.m_pubkey = libAddress.publicKeyFromSecretKey(this.m_secret)!;
        let initBound = (conns: NodeConnection[]) => {
            for (let conn of conns) {
                this._beginSyncWithNode(conn);
            }
        };
        let connOut = this.m_network.node.getOutbounds();
        initBound(connOut);
        let connIn = this.m_network.node.getInbounds();
        initBound(connIn);
        this.m_network.on('inbound', (conn: NodeConnection) => {
            this._beginSyncWithNode(conn);
        });
        this.m_network.on('outbound', (conn: NodeConnection) => {
            this._beginSyncWithNode(conn);
        });
    }
    on(event: 'tipSign', listener: (sign: DposBftBlockHeaderSignature) => any): this;
    on(event: string, listener: any): this {
        return super.on(event, listener);
    }

    once(event: 'tipSign', listener: (sign: DposBftBlockHeaderSignature) => any): this;
    once(event: string, listener: any): this {
        return super.once(event, listener);
    }   

    get logger(): LoggerInstance {
        return this.m_network.logger;
    }

    protected _beginSyncWithNode(conn: NodeConnection) {
        conn.on('pkg', async (pkg: Package) => {
            if (pkg.header.cmdType === DPOS_BFT_SYNC_CMD_TYPE.tipSign) {
                let reader = new BufferReader(pkg.copyData());
                try {
                    let pubkey = reader.readBytes(33);
                    let sign = reader.readBytes(64);
                    let hash = reader.readHash().toString('hex');
                    this.emit('tipSign', {hash, pubkey, sign});
                } catch (e) {
                    this.logger.error(`dpos_bft decode tipSign failed `, e);
                    return ;
                }
            }
        });
    }

    public broadcastTip(pubkey: Buffer, sign: Buffer, header: DposBftBlockHeader) {
        let writer = new BufferWriter();
        writer.writeBytes(this.m_pubkey);
        writer.writeBytes(sign);
        writer.writeHash(header.hash);

        let data = writer.render();
        let pkg = PackageStreamWriter.fromPackage(DPOS_BFT_SYNC_CMD_TYPE.tipSign, null, data.length).writeData(data);
        this.m_network.broadcastToValidators(pkg);
    }
}