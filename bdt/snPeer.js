const {
    BX_SetLogLevel,
    BLOG_LEVEL_WARN,
    BLOG_LEVEL_ERROR,
    BLOG_LEVEL_INFO,
    BLOG_LEVEL_ALL,
    BLOG_LEVEL_OFF,
} = require('./base/base');
const P2P = require('./p2p/p2p');



// 默认参数
const defaultParams = {
    out_host: '106.75.175.167',
    peerid: 'SN_PEER',
    tcpPort: 10000,
    udpPort: 10010,
    logger: false,
}

let params = process.argv.slice(2)
      .map(val => val.split('='))
      .filter( val => val.length == 2)
      .reduce((params, val) => {
          const [key, value] = val
          params[key] = value
          return params
      }, {})

params = Object.assign(defaultParams, params)
console.log(params)


if ( !params.logger ) {
    BX_SetLogLevel(BLOG_LEVEL_OFF);
}

async function start() {
    const OUT_HOST = params.out_host
    const { tcpPort, udpPort, peerid } = params

    // 端口配置
    const snDHTServerConfig = {
        // 使用username和本机的ip 拼接 peerid, 方便在不同的主机上启动测试
        peerid: peerid,
        tcp: {
            addrList: ['0.0.0.0'],
            initPort: tcpPort,
            maxPortOffset: 0,
        },
        udp: {
            addrList: ['0.0.0.0'],
            initPort: udpPort,
            maxPortOffset: 0,
        },
        listenerEPList: [`4@${OUT_HOST}@${tcpPort}@t`, `4@${OUT_HOST}@${udpPort}@u`]
    };

    let {result, p2p} = await P2P.create(snDHTServerConfig);
    await p2p.joinDHT([], true);
    await p2p.startupSNService(true, {minOnlineTime2JoinDHT: 0});

}
start()
