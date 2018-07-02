import {ErrorCode} from '../error_code';
import * as EventEmitter from 'events';
import {NodeConnection, INode} from '../net/node';
import {IConnection} from '../net/connection';
import {Connection} from './connection';

const P2P = require('../../../../bdt/p2p/p2p');
const DHTUtil = require('../../../../bdt/dht/util.js');
const {NetHelper} = require('../../../../bdt/base/util.js');

// 关闭 bdt 输出的logs
P2P.debug(false)

export class Node extends INode {
    private m_options: any;
    private m_bdtStack: any;
    private m_dht: any;
    private m_snPeerid: any;
    private m_host:any;
    private m_listen_port:any;
    // vport 只是提供给bdt connect的一个抽象，可以不用在调用时传入
    // 先定死， bdt connect 和 listen都先用这个
    private m_vport:number = 3000;

    // 初始化传入的 port 当作listen时的tcp port使用
    // udp 在这个基础上 + 10
    constructor(options: {host: string, port: number, peerid: string, snPeer: any}) {
        // const peerid = `${options.host}:${options.port}`;
        super({peerid: options.peerid});
        
        this.m_listen_port = options.port
        this.m_host = options.host;

        this.m_options = Object.create(null);
        Object.assign(this.m_options, options);
    }

    public async init() {
        // 初始化 bdt
        await this.createBDTStack();
    }

    protected async createBDTStack() {
        // let randomPort = DHTUtil.RandomGenerator.integer(65525, 2048);

        // bdt 里0.0.0.0 只能找到公网ip, 这样会导致单机多进程或单机单进程的节点找不到对方
        // 为了方便测试， 补充加入本机的内网192 IP
        let ips = NetHelper.getLocalIPV4().filter((ip:string) => ip.match(/^192.168.\d+.\d+/));
        let addrList = [this.m_host, ...ips];

        let {result, p2p, bdtStack} = await P2P.create4BDTStack({
            peerid: this.m_peerid,
            tcp: {
                addrList, 
                initPort: this.m_listen_port,
                maxPortOffset: 0,
            },
            udp: {
                addrList, 
                initPort: this.m_listen_port + 10,
                maxPortOffset: 0,
            },
            dhtEntry: [this.m_options.snPeer]
        });
        this.m_snPeerid = this.m_options.snPeer.peerid;

        this.m_dht = p2p.m_dht;
        this.m_bdtStack = bdtStack;
    }

    // 通过发现自身， 来找到一些peers, 然后尝试每个握手一下
    // 在测试阶段这种方法实现比较及时, 后面可能考虑用会dht中的randomPeers
    async randomPeers(count: number): Promise<{ err: ErrorCode, peers: string[] }> {
        let dhtPeerid  = this.m_snPeerid
        let res = await this.m_dht.findPeer(this.m_peerid)
        
        // 过滤掉自己和种子peer
        let peers:any = res.n_nodes.filter((val:any) => {
            return val.id!= this.m_peerid && val.id != dhtPeerid
        })

        // 试一下这些节点能不能握手
        const ops = peers.map((val:any, key:any) => {
            return new Promise(resolve => {
                // console.log('handshake', val.id)
                this.m_dht.handshake({
                    peerid: val.id,
                    eplist: val.eplist
                }, null, (result:number, peer:any) => {
                    if ( result != 0 ) {
                        delete peers[key]
                    }
                    resolve(result)
                })
            })
        })
        const result = await Promise.all(ops)
        // console.log(result, peers)
        
        // 过滤掉不能握手的节点
        let peerids = peers.filter((val:any) => val).map((val:any) => val.id)

        // 如果peer数量比传入的count多， 需要随机截取
        if ( peerids.length > count ) {
            var temp_peerids = [];
            for(var i = 0; i < count -1; i++) {
                var idx = Math.floor(Math.random() * peerids.length);
                temp_peerids.push(peerids[idx]);
                peerids.splice(idx, 1);
            }
            peerids = temp_peerids;
        }

        // console.log('randomPeers', peerids)
        let errCode = peerids.length ? ErrorCode.RESULT_OK : ErrorCode.RESULT_SKIPPED;
        return { err: errCode, peers: peerids };
    }

    protected _connectTo(peerid: string): Promise<{err: ErrorCode, conn?: NodeConnection}> {
        // console.log('_connectTo', peerid)
        let vport = this.m_vport
        let connection = this.m_bdtStack.newConnection();
        connection.bind(null)

        return new Promise((resolve, reject)=>{
            connection.connect({
                peerid,
                vport,
            })
            connection.on(P2P.Connection.EVENT.close, () => {
                resolve({err: ErrorCode.RESULT_EXCEPTION});
            });
            connection.on(P2P.Connection.EVENT.error, (error: number) => {
                console.log('Connection error',peerid , error)
                resolve({err: ErrorCode.RESULT_EXCEPTION});
            });
            connection.on(P2P.Connection.EVENT.connect, () => {
                let connNodeType = this._nodeConnectionType();
                let connNode: any = (new connNodeType(this, {bdt_connection: connection , remote: peerid}));
                resolve({err: ErrorCode.RESULT_OK, conn: connNode});
            });
        });
    }

    protected _connectionType(): new(...args: any[]) => IConnection {
        return Connection;
    }

    public listen(): Promise<ErrorCode> {
        return new Promise((resolve, reject)=>{
            const acceptor = this.m_bdtStack.newAcceptor({
                vport: this.m_vport,
            });
            acceptor.listen();
            acceptor.on(P2P.Acceptor.EVENT.close, () => {
                acceptor.close();
            });
            acceptor.on(P2P.Acceptor.EVENT.connection, (bdt_connection:any)=>{
                const remoteObject = bdt_connection.remote
                console.log(remoteObject)
                const remote = `${remoteObject.peerid}:${remoteObject.vport}`

                let connNodeType = this._nodeConnectionType();
                let connNode: any = (new connNodeType(this, {bdt_connection: bdt_connection , remote: remote}));

                // 调用_onInbound, 将成功的连接保存
                this._onInbound(connNode);
            });
            acceptor.on('error', ()=>{
                reject(ErrorCode.RESULT_EXCEPTION);
            });
            resolve(ErrorCode.RESULT_OK);
        });
    }
}