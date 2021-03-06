import { EventEmitter } from 'events';
import { ErrorCode } from '../../core';
import * as http from 'http';

import { getMonitor } from '../../../ruff/dposbft/chain/modules/monitor';
import { string, any } from '@hapi/joi';
import { TxBuffer } from '../../core/chain/tx_buffer';

// At first stage set max length to 300K
const MAX_CONTENTY_LENGTH = 300 * 1024;

export class RPCServer extends EventEmitter {
    private m_addr: string;
    private m_port: number;
    private m_server?: http.Server;
    private m_txBuffer: TxBuffer;

    constructor(listenaddr: string, port: number, txBuffer: TxBuffer) {
        super();
        this.m_addr = listenaddr;
        this.m_port = port;
        // Add for rpc flow control
        this.m_txBuffer = txBuffer;
        this.m_txBuffer.addRpcIf(this);
    }

    on(funcName: string, listener: (args: any, resp: http.ServerResponse) => void): this;
    on(event: string, listener: any): this {
        async function wrapper(args: any, resp: http.ServerResponse): Promise<any> {
            try {
                await listener(args, resp);
            } catch (err) {
                console.log('err is ', err);
                resp.end(JSON.stringify({ err: ErrorCode.RESULT_INVALID_FORMAT }));
            }
        }
        return super.on(event, wrapper);
    }

    once(funcName: string, listener: (args: any, resp: http.ServerResponse) => void): this;
    once(event: string, listener: any): this {
        return super.once(event, listener);
    }

    prependListener(funcName: string, listener: (args: any, resp: http.ServerResponse) => void): this;
    prependListener(event: string, listener: any): this {
        return super.prependListener(event, listener);
    }

    prependOnceListener(funcName: string, listener: (args: any, resp: http.ServerResponse) => void): this;
    prependOnceListener(event: string, listener: any): this {
        return super.prependOnceListener(event, listener);
    }

    start() {
        if (this.m_server) {
            return;
        }
        this.m_server = http.createServer();
        this.m_server.on('request', (req, resp) => {
            var contentType = req.headers['content-type'] || '';
            if (req.url === '/rpc' &&
                req.method === 'POST' &&
                contentType.indexOf('application/json') >= 0
            ) {
                let jsonData = '';
                let isValidReq = true;
                req.on('data', (chunk: any) => {
                    if (!isValidReq) {
                        return;
                    }
                    jsonData += chunk;
                    if (jsonData.length >= MAX_CONTENTY_LENGTH) {
                        isValidReq = false;
                        resp.writeHead(404);
                        resp.end();
                    }
                });
                req.on('end', () => {
                    let reqObj: any;
                    if (!isValidReq) {
                        return;
                    }
                    try {
                        reqObj = JSON.parse(jsonData);
                    } catch (e) {
                        console.error('Wrong format of jsonData');
                        resp.writeHead(404);
                        resp.end();
                        return;
                    }
                    // to count received rpc requests
                    getMonitor()!.updateRecvRpcs();

                    // Change by Yang Jun 2019-8-29
                    // if (!this.emit(reqObj.funName, reqObj.args, resp)) {
                    if (!this.m_txBuffer.addRpc(reqObj.funName, reqObj.args, resp)) {
                        resp.writeHead(404);
                        resp.end();
                    }
                });
            } else {
                resp.writeHead(404);
                resp.end();
            }
        });

        this.m_server.listen(this.m_port, this.m_addr);
    }

    public stop() {
        if (this.m_server) {
            this.m_server.close();
            delete this.m_server;
        }
    }
}
