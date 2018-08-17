// Copyright (c) 2016-2018, BuckyCloud, Inc. and other BDT contributors.
// The BDT project is supported by the GeekChain Foundation.
// All rights reserved.

// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//     * Redistributions of source code must retain the above copyright
//       notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//     * Neither the name of the BDT nor the
//       names of its contributors may be used to endorse or promote products
//       derived from this software without specific prior written permission.

// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
// ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
// WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY
// DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
// (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
// LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
// ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
// SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

"use strict";

const Base = require('../base/base.js');
const BDTEcho = require('./echo');

async function main(config, server) {
    let bdtEcho = new BDTEcho(config);
    await bdtEcho.start();
    console.log(`client(${config.peerid}) is connecting to server(peerid:${server.peerid},vport:${server.vport}).`);
    bdtEcho.connect(server.peerid, server.vport);
}

Base.BX_SetLogLevel(Base.BLOG_LEVEL_OFF);


// 解释参数列表
let peerid = null;
let udpPort = null;
let tcpPort = null;
let server = {
    peerid: null,
    vport: null,
};
let sn = null;

function parseParams() {
    let params = process.argv.slice(2);
    let snParams = null;
    let serverParams = null;
    let index = 0;
    while (index < params.length) {
        switch (params[index]) {
            case '-peerid':
                peerid = params[index + 1];
                index += 2;
                break;
            case '-udp':
                udpPort = params[index + 1];
                index += 2;
                break;
            case '-tcp':
                tcpPort = params[index + 1];
                index += 2;
                break;
            case '-vport':
                vport = params[index + 1];
                index += 2;
                break;
            case '-sn':
                snParams = params[index + 1].split(',');
                index += 2;
                sn = {
                    peerid: null,
                    eplist: null,
                };
                break;
            case '-server':
                serverParams = params[index + 1].split(',');
                index += 2;
                break;
            default:
                index += 1;
                break;
        }
    }

    function parseSNParams() {
        let peerid = null;
        let ip = null;
        let udpPort = null;
        let tcpPort = null;
        snParams.forEach(param => {
            let [key, value] = param.split('=');
            switch (key) {
                case 'peerid':
                    peerid = value;
                    break;
                case 'ip':
                    ip = value;
                    break;
                case 'udp':
                    udpPort = value;
                    break;
                case 'tcp':
                    tcpPort = value;
                    break;
                default:
                    break;
            }
        });

        sn = {
            peerid: peerid,
            eplist: [`4@${ip}@${udpPort}@u`, `4@${ip}@${tcpPort}@t`],
        }
    }

    function parseServerParams() {
        serverParams.forEach(param => {
            let [key, value] = param.split('=');
            switch (key) {
                case 'peerid':
                    server.peerid = value;
                    break;
                case 'vport':
                    server.vport = value;
                    break;
                default:
                    break;
            }
        });
    }

    parseSNParams();
    parseServerParams();
}

parseParams();

const CONFIG = {
    peerid: peerid,
    seedPeers: [sn],
};

if (tcpPort !== null) {
    CONFIG.tcpPort = tcpPort;
}

if (udpPort !== null) {
    CONFIG.udpPort = udpPort;
}

main(CONFIG, server);