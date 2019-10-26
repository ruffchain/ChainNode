import { ErrorCode } from '../error_code';
import { RandomOutNetwork } from '../block/random_outbound_network';
import { PackageStreamWriter, NodeConnection } from '../chain';
import { ValidatorsNetwork } from '../dbft_chain/validators_network';

export class DposBftNetwork extends RandomOutNetwork {
    protected m_validators: string[] = [];
    protected m_checkMinerOutboundTimer: any;

    setValidators(validators: string[]) {
        this.m_validators = [];
        this.m_validators.push(...validators);
    }

    getValidators(): string[] {
        const v = this.m_validators;
        return v;
    }

    public uninit(): Promise<any> {
        if (this.m_checkMinerOutboundTimer) {
            clearInterval(this.m_checkMinerOutboundTimer);
            delete this.m_checkMinerOutboundTimer;
        }

        return super.uninit();
    }

    public async initialOutbounds(): Promise<ErrorCode> {
        let err = await super.initialOutbounds();

        this._checkConnections();
        this.m_checkMinerOutboundTimer = setInterval(() => {
            this._checkConnections();
        }, 1000);

        return err;
    }

    protected _checkConnections() {
        let willConn = new Set<string>();
        for (let v of this.m_validators) {
            if (this._onWillConnectTo(v)) {
                willConn.add(v);
            }
        }
        this._connectTo(willConn);
    }

    // public broadcastToValidators(writer: PackageStreamWriter): Promise<{err: ErrorCode, count: number}> {
    //     let validators = new Set(this.m_validators);
    //     return this.m_node.broadcast(writer, {count: validators.size, filter: (conn: NodeConnection) => {
    //         return validators.has(conn.remote!);
    //     }});
    // }

    // Yang Jun 2019-10-23
    // Just broadcast it out, even nodes without connection can receive it
    public broadcastToValidators(writer: PackageStreamWriter): Promise<{ err: ErrorCode, count: number }> {
        return this.m_node.broadcast(writer);
    }

    // Yang Jun 2019-10-25
    public async relayTipSign(writer: PackageStreamWriter, addresses: string[]): Promise<{ err: ErrorCode, count: number }> {
        let validators = new Set(addresses);

        // return this.m_node.broadcast(writer, {
        //     count: validators.size, filter: (conn: NodeConnection) => {
        //         return !validators.has(conn.remote!);
        //     }
        // });


        return this.m_node.broadcast2(writer, addresses);
    }
}