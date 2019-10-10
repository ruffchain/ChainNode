import { ErrorCode } from '../error_code';
import { Server, Socket } from 'net';
import { IConnection, NodeConnection, INode } from '../net';
import { TcpConnection } from './connection';
import { LoggerOptions } from '../lib/logger_util';

// Yang Jun 2019-9-17
export interface IfHostPort {
    host: string;
    port: number;
}

export class TcpNode extends INode {
    private m_options: any;
    private m_server: Server;

    // Yang Jun 2019-10-10
    protected m_inStaticIps: string[];

    constructor(inpeers: string, options: { network: string, peerid: string, host: string, port: number } & LoggerOptions) {
        console.log(arguments);

        super({ network: options.network, peerid: options.peerid, logger: options.logger, loggerOptions: options.loggerOptions });
        this.m_options = Object.create(null);
        Object.assign(this.m_options, options);
        this.m_server = new Server();

        // Yang Jun 2019-10-10
        this.m_inStaticIps = [];

        for (let inpeer of inpeers) {
            let arr = inpeer.split(':');
            let ip = arr[0];
            if (this.m_inStaticIps.indexOf(ip) === -1) {
                this.m_inStaticIps.push(ip);
            }
        }
        console.log('inpeers ips:');
        console.log(this.m_inStaticIps);
    }


    // ip in inPeers
    protected _bInPeers(strIp: string): boolean {

        if (this.m_inStaticIps.indexOf(strIp) !== -1) {
            return true;
        }

        return false;
    }

    // Yang Jun 2019-9-17, This should be modified to support peerid to addres mapping
    protected async _peeridToIpAddress(peerid: string): Promise<{ err: ErrorCode, ip?: { host: string, port: number } }> {
        return { err: ErrorCode.RESULT_NOT_SUPPORT };
    }

    protected async _connectTo(peerid: string): Promise<{ err: ErrorCode, conn?: NodeConnection }> {
        let par = await this._peeridToIpAddress(peerid);
        if (par.err) {
            return { err: par.err };
        }
        let tcp = new Socket();

        return new Promise<{ err: ErrorCode, conn?: NodeConnection }>((resolve, reject) => {
            tcp.connect(par.ip!);

            tcp.once('error', (e) => {
                tcp.removeAllListeners('connect');
                resolve({ err: ErrorCode.RESULT_EXCEPTION });
            });


            tcp.once('connect', () => {
                let connNodeType = this._nodeConnectionType();

                let connNode: any = (new connNodeType(this, { socket: tcp, remote: peerid }));

                tcp.removeAllListeners('error');

                tcp.on('error', (e) => {
                    this.emit('error', connNode, ErrorCode.RESULT_EXCEPTION);
                });

                // Yang Jun 2019-9-18

                resolve({ err: ErrorCode.RESULT_OK, conn: connNode });
            });
        });
    }

    protected _connectionType(): new (...args: any[]) => IConnection {
        return TcpConnection;
    }

    public uninit() {
        let closeServerOp;

        if (this.m_server) {
            closeServerOp = new Promise((resolve) => {
                this.m_server.close(resolve);
            });
        }
        if (closeServerOp) {
            return Promise.all([closeServerOp, super.uninit()]);
        } else {
            return super.uninit();
        }
    }

    public listen(): Promise<ErrorCode> {
        return new Promise((resolve, reject) => {

            let start = () => {
                this.m_server.listen(this.m_options.port, this.m_options.host);

                this.m_server.once('listening', () => {
                    this.m_server.removeAllListeners('error');

                    this.m_server.on('connection', (tcp: Socket) => {
                        // 

                        // if ip not in inpeers return
                        // Yang Jun 2019-9-18
                        let ip = tcp.remoteAddress;
                        if (ip === undefined || this._bInPeers(ip) === false) {

                            console.log('Connection not allowed: ', ip)
                            tcp.on('error', (e) => { });

                            tcp.on('close', (e) => { });

                            tcp.on('data', (dat) => { });

                            tcp.on('end', (data: any) => { });

                            tcp.end();
                            return;
                        }


                        let connNodeType = this._nodeConnectionType();
                        let connNode: any = (new connNodeType(this, { socket: tcp, remote: `${tcp.remoteAddress}:${tcp.remotePort}` }));

                        tcp.on('error', (e) => {
                            this.emit('error', connNode, ErrorCode.RESULT_EXCEPTION);
                        });

                        // Yang Jun 2019-9-18
                        tcp.on('close', (e) => {
                            this.emit('error', connNode, ErrorCode.RESULT_EXCEPTION);
                        });

                        this._onInbound(connNode);
                    });
                });

                this.m_server.once('error', (e) => {
                    this.m_server.removeAllListeners('listening');
                    this.m_logger.error(`tcp listen on ${this.m_options.host}:${this.m_options.port} error `, e);
                    this.m_server.close();

                    setTimeout(() => {
                        start();
                        this.m_logger.error('Restart tcp server after 5 seconds');
                    }, 5000)
                });
            }

            start();
            resolve(ErrorCode.RESULT_OK);
        });
    }
}