import {ErrorCode} from '../error_code';
import {IConnection} from '../net';

const P2P = require('../../../bdt/p2p/p2p');

export class BdtConnection extends IConnection {
    private m_bdt_connection: any;
    private m_remote: string;
    protected m_nTimeDelta: number = 0;
    constructor(options: {bdt_connection: any, remote: string}) {
        super();
        this.m_bdt_connection = options.bdt_connection;

        this.m_bdt_connection.on(P2P.Connection.EVENT.drain, () => {
            this.emit('drain');
        });
        this.m_bdt_connection.on(P2P.Connection.EVENT.data, (data: Buffer[]) => {
            this.emit('data', data);
        });
        this.m_bdt_connection.on(P2P.Connection.EVENT.error, () => {
            this.emit('error', this, ErrorCode.RESULT_EXCEPTION);
        });
        this.m_bdt_connection.on(P2P.Connection.EVENT.close, () => {
            this.emit('close', this);
        });
        this.m_remote = options.remote;
    }

    send(data: Buffer): number {
        return this.m_bdt_connection.send(data);
    }
    
    close(): Promise<ErrorCode> {
        if (this.m_bdt_connection) {
            this.m_bdt_connection.close();
            delete this.m_bdt_connection;
        }
        return Promise.resolve(ErrorCode.RESULT_OK);
    }

    getRemote(): string {
        return this.m_remote;
    }

    setRemote(s: string) {
        this.m_remote = s;
    }

    getTimeDelta(): number {
        return this.m_nTimeDelta;
    }

    setTimeDelta(n: number) {
        this.m_nTimeDelta = n;
    }
}