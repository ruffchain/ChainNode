let XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
export class RPCClient {
    private m_url: string;
    constructor(serveraddr: string, port: number) {
        this.m_url = 'http://' + serveraddr + ':' + port + '/rpc';
    }

    call(funName: string, funcArgs: any, onComplete: (resp: string | null, code: number) => void) {
        let sendObj = {
            'funName': funName,
            'args': funcArgs
        }
        const xmlhttp = new XMLHttpRequest();
        xmlhttp.onreadystatechange = function () {
            if (xmlhttp.readyState == 4) {

                if (xmlhttp.status == 200) {
                    let strResp = xmlhttp.responseText;
                    onComplete(strResp, xmlhttp.status);
                } else {
                    onComplete(null, xmlhttp.status);
                }
            }
        };

        xmlhttp.ontimeout = function (err: any) {
            onComplete(null, 504);
        };

        xmlhttp.open("POST", this.m_url, true);
        xmlhttp.setRequestHeader("Content-Type", "application/json");

        xmlhttp.send(JSON.stringify(sendObj));
    }

    async callAsync(funcName: string, funcArgs: any): Promise<{ resp: string | null, ret: number }> {
        return new Promise<{ resp: string | null, ret: number }>((reslove, reject) => {
            this.call(funcName, funcArgs, (resp, statusCode) => {
                reslove({ resp: resp, ret: statusCode });
            });
        });
    }
}