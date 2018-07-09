"use strict";
const EventEmitter = require('events');
const BDTStack = require('./stack');
const BDTAcceptor = require('./acceptor');
const BDTConnection = require('./connection');
const packageModule = require('./package');

class PeerFinder extends EventEmitter {
    constructor() {
        super();
        this.EVENT = PeerFinder.EVENT;
    }

    findSN(peerid, fromCache, onStep) {
        return Promise.reject('Function PeerFinder.findSN should be overrided.');
    }

    findPeer(peerid) {
        return Promise.reject('Function PeerFinder.findSN should be overrided.');
    }
}

PeerFinder.EVENT = {
    SNChanged: 'SNChanged'
}

class SimpleSNFinder extends PeerFinder {
    constructor(snPeers) {
        super();
        this.m_snPeers = snPeers;
    }

    findSN(peerid, fromCache, onStep) {
        if (this.m_snPeers && this.m_snPeers.length) {
            return Promise.resolve([packageModule.BDT_ERROR.success, this.m_snPeers]);
        } else {
            return Promise.Promise.resolve([packageModule.BDT_ERROR.invalidState]);
        }
    }
}

function newStack(peerid, eplist, mixSocket, peerFinder, options) {
    let stack = new BDTStack(peerid, eplist, mixSocket, peerFinder, options);
    stack.newAcceptor = (acceptorOptions)=>{
        return new BDTAcceptor(stack, acceptorOptions);
    };
    stack.newConnection = (connectionOptions)=>{
        return new BDTConnection(stack, connectionOptions);
    };
    stack.once(BDTStack.EVENT.close, () => {
        stack.newAcceptor = null;
        stack.newConnection = null;
    });
    return stack;
}


module.exports = {
    newStack: newStack,
    Stack: BDTStack,
    Connection: BDTConnection,
    Acceptor: BDTAcceptor,
    ERROR: packageModule.BDT_ERROR,
    Package: packageModule.BDTPackage,
    PeerFinder,
};