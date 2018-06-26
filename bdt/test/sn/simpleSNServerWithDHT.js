'use strict'

const dgram = require('dgram');
const SN = require('../../sn/sn.js');
const P2P = require('../../p2p/p2p');
const DHT = require('../../dht/dht.js');
const DHTUtil = require('../../dht/util.js');
const PackageModule = require('../../bdt/package.js');
const BDTPackage = PackageModule.BDTPackage;

const Base = require('../../base/base.js');
const LOG_INFO = Base.BX_INFO;
const LOG_WARN = Base.BX_WARN;
const LOG_DEBUG = Base.BX_DEBUG;
const LOG_CHECK = Base.BX_CHECK;
const LOG_ASSERT = Base.BX_ASSERT;
const LOG_ERROR = Base.BX_ERROR;

process.on('uncaughtException', function (err) {
    LOG_ERROR('An uncaught error occurred!' + err.message);
    LOG_ERROR(err.stack);
});

async function startSNServer(serverConfigList) {
    let dhtEntry = [];
    serverConfigList.forEach(snInfo => dhtEntry.push({peerid: snInfo.peerid, eplist: snInfo.eplist}));

    for (let config of serverConfigList) {
        let {result, p2p} = await P2P.create({
                peerid: config.peerid,
                tcp: {
                    addrList:[config.address],
                    initPort: config.port,
                    maxPortOffset: 0,
                },
                dhtEntry,
            });

        if (result !== 0) {
            LOG_WARN(`SN service listening failed.`);
            continue;
        }

        if (p2p.startupSNService(true) != 0) {
            LOG_WARN(`SN service listening failed.`);
            continue;
        }

        console.log(`server<${config.peerid}> start.`);
    }
}


if (require.main === module) {
    startSNServer([/*{
            peerid: 'SIMPLE-SN-1',
            address: '127.0.0.1',
            port: 3034,
            eplist: ['4@127.0.0.1@3034', '4@192.168.100.175@3034'],
        },*/
        {
            peerid: 'SIMPLE-SN-2',
            address: '0.0.0.0',
            port: 3035,
            eplist: ['4@127.0.0.1@3035', '4@192.168.100.175@3035'],
        },
        /*{
            peerid: 'SIMPLE-SN-3',
            address: '0.0.0.0',
            port: 3036,
            eplist: ['4@127.0.0.1@3036', '4@192.168.100.175@3036'],
        },*/]);
}

module.exports.start = startSNServer;