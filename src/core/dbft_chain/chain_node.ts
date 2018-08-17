import * as BaseChainNode from '../chain/chain_node';
import * as BaseChain from '../chain/chain';
import {INode, NodeConnection, PackageStreamWriter, Package, CMD_TYPE} from '../net';
import { ErrorCode } from '../error_code';
import {Transaction} from '../value_chain';
import {DbftBlockHeader} from './block';

export enum SYNC_CMD_TYPE {
    prepareRequest = BaseChainNode.SYNC_CMD_TYPE.end + 1,
    prepareResponse = BaseChainNode.SYNC_CMD_TYPE.end + 2,
    changeview = BaseChainNode.SYNC_CMD_TYPE.end + 3,
}

export class DbftChainNode extends BaseChainNode.ChainNode {
    constructor(options: BaseChainNode.ChainNodeOptions & BaseChainNode.ChainNodeOptionsEx) {
        super(options);
    }

    on(event: 'blocks', listener: (params: BaseChainNode.BlocksEventParams) => any): this;
    on(event: 'headers', listener: (params: BaseChainNode.HeadersEventParams) => any): this;
    on(event: 'transactions', listener: (conn: NodeConnection, tx: Transaction[]) => any): this;
    on(event: 'ban', listener: (remote: string) => any): this;
    on(event: 'outbound', listener: (conn: NodeConnection) => any): this;
    on(event: 'prepareRequest', listener: any): this;
    on(event: 'prepareResponse', listener: any): this;
    on(event: 'changeview', listener: any): this;
    on(event: string, listener: any): this {
        super.on(event as 'outbound', listener);
        return this;
    }

    protected _beginSyncWithNode(conn: NodeConnection) {
        super._beginSyncWithNode(conn);

        conn.on('pkg', async (pkg: Package) => {
            if (pkg.header.cmdType === SYNC_CMD_TYPE.prepareRequest) {
                this.emit('prepareRequest', pkg.body);
            } else if (pkg.header.cmdType === SYNC_CMD_TYPE.prepareResponse) {
                this.emit('prepareResponse', pkg.body);
            } else if (pkg.header.cmdType === SYNC_CMD_TYPE.changeview) {
                this.emit('changeview', pkg.body);
            }
        });
    }

    public async sendConsensusMsg(cmd: SYNC_CMD_TYPE, msg: {}, ids: string[]): Promise<{err: ErrorCode, count: number}> {
        let writer: PackageStreamWriter = PackageStreamWriter.fromPackage(cmd, msg, 0);
        let inArray: (s: string[], p: string) => boolean = (s: string[], p: string): boolean => {
            for (let p1 of s) {
                if (p1 === p) {
                    return true;
                }
            }
            return false;
        };

        let filter: (conn: NodeConnection) => boolean = (conn: NodeConnection): boolean => {
            if (inArray(ids, conn.getRemote())) {
                return true;
            }
            return false;
        };

        return  await this.node.broadcast(writer, {filter});
    }
}