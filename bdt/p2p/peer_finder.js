'use strict';

const EventEmitter = require('events');
const DHT = require('../dht/dht.js');
const SNDHT = require('../sn/sn_dht.js');
const BDT = require('../bdt/bdt.js');

class PeerFinder extends BDT.PeerFinder {
    constructor(snPeer, dht) {
        super();

        this.m_snDHT = null;
        this.snPeer = snPeer;
        this.dht = dht;
    }

    get snPeer() {
        return this.m_snPeer;
    }

    set snPeer(snPeer) {
        this.m_snPeer = snPeer;
        this.emit(this.EVENT.SNChanged);
    }

    get dht() {
        return this.m_dht;
    }

    set dht(_dht) {
        this._destroyDHT();

        this.m_dht = _dht;

        if (this.m_dht) {
            this.m_snDHT = new SNDHT(this.m_dht);
            this.m_snDHT.signinVistor();
            this.m_dht.once(DHT.EVENT.stop, () => this._destroyDHT());

            this.m_nearSNChangedListener = () => this.emit(this.EVENT.SNChanged);
            this.m_snDHT.attachEvent(SNDHT.Event.NearSNChanged, this.m_nearSNChangedListener);
        }
    }

    destory() {
        this._destroyDHT();
    }

    findSN(peerid) {
        if (this.m_snPeer) {
            return Promise.resolve([BDT.ERROR.success, [this.m_snPeer]]);
        } else if (this.m_snDHT) {
            return new Promise(resolve => {
                this.m_snDHT.findSN(peerid, ({result, snList})=>{
                    if (result) {
                        resolve([result]);
                    } else {
                        resolve([BDT.ERROR.success, snList]);
                    }
                });
            });
        } else {
            return Promise.resolve([BDT.ERROR.invalidState]);
        }
    }

    supportFindPeerImmediate() {
        return !!this.m_dht;
    }

    findPeer(peerid) {
        if (this.m_dht) {
            return new Promise(resolve => {
                this.m_dht.findPeer(peerid, ({result, peerlist}) => {
                    let peer = null;
                    if (peerlist && peerlist.length > 0 && peerlist[0].peerid === peerid) {
                        peer = peerlist[0];
                    }
                    resolve(peer);
                });
            });
        } else {
            return Promise.resolve(null);
        }
    }

    _destroyDHT() {
        if (this.m_dht) {
            this.m_snDHT.signoutVistor();
            this.m_snDHT.detachEvent(SNDHT.Event.NearSNChanged, this.m_nearSNChangedListener);
            this.m_snDHT = null;
            this.findPeer = null;
            this.m_dht = null;
        }
    }
}

PeerFinder.EVENT = {
    SNChanged: 'SNChanged'
}

module.exports = PeerFinder;