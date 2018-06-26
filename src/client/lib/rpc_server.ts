import { EventEmitter } from "events";
import { createServer, Http2Server, Http2ServerResponse } from "http2";


export class RPCServer extends EventEmitter {
    private m_addr: string;
    private m_port: number;
    private m_server: Http2Server|null;
    constructor(listenaddr: string, port: number) {
        super();
        this.m_addr = listenaddr;
        this.m_port = port;
        this.m_server = null;
    }

    on(funcName: string, listener: (args: any, resp: Http2ServerResponse) => void): this;
    on(event: string, listener: any): this  {
        return super.on(event, listener);
    }

    start() {
        if (this.m_server) {
            return;
        }
        this.m_server = createServer();
        this.m_server.on('request', (req, resp) => {
            if (req.url !== '/rpc' || req.method !== 'POST') {
                resp.writeHead(404);
                resp.end();
            } else {
                let jsonData = '';
                req.on('data', (chunk) => {
                    jsonData += chunk;
                });
                req.on('end', () => {
                    let reqObj = JSON.parse(jsonData);
                    if (!this.emit(reqObj.funName, reqObj.args, resp)) {
                        resp.writeHead(404);
                        resp.end();
                    }
                    
                });
            }
        });

        this.m_server.listen(this.m_port, this.m_addr);
    }

    stop() {
        if (this.m_server) {
            this.m_server.close();
            this.m_server = null;
        }
    }
}