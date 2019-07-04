import { EventEmitter } from 'events';
import { ErrorCode } from '../../core';
import * as http from 'http';

const MAX_CONTENTY_LENGTH = 5 * 1024 * 1024;

export class RPCServer extends EventEmitter {
    private m_addr: string;
    private m_port: number;
    private m_server?: http.Server;
    constructor(listenaddr: string, port: number) {
        super();
        this.m_addr = listenaddr;
        this.m_port = port;
    }

    on(funcName: string, listener: (args: any, resp: http.ServerResponse) => void): this;
    on(event: string, listener: any): this {
        async function wrapper(args: any, resp: http.ServerResponse):Promise<any> {
            try {
                await listener(args, resp);
            } catch (err) {
                console.log('err is ', err);
                resp.end(JSON.stringify({err: ErrorCode.RESULT_INVALID_FORMAT}));
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
            )  {
                let jsonData = '';
                req.on('data', (chunk: any) => {
                    jsonData += chunk;
                    if (jsonData.length >= MAX_CONTENTY_LENGTH) {
                        resp.writeHead(404);
                        resp.end();
                    }
                });
                req.on('end', () => {

                    let reqObj: any;
                    // Added by Yang Jun 2019-4-26

                    try {
                        reqObj = JSON.parse(jsonData);
                    } catch (e) {
                        console.error('Wrong format of jsonData');
                        resp.writeHead(404);
                        resp.end();
                        return;
                    }

                    // console.info(`RPCServer emit request ${reqObj.funName}, params ${JSON.stringify(reqObj.args)}`);
                    if (!this.emit(reqObj.funName, reqObj.args, resp)) {
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

    stop() {
        if (this.m_server) {
            this.m_server.close();
            delete this.m_server;
        }
    }
}
