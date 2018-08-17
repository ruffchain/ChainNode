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

class TCPConnectionMgr {
    constructor() {
        this.m_socketInfoMap = new Map(); // <socket, {listener, Set(connections)}>
    }

    register(socket, connection) {
        let socketInfo = this.m_socketInfoMap.get(socket);
        if (!socketInfo) {
            socketInfo = {
                drainListener: null,
                closeListener: null,
                connections: new Set([connection]),
            };

            socketInfo.drainListener = () => {
                socketInfo.connections.forEach(_conn => {
                    _conn._onTCPDrain();
                });
            };

            socketInfo.closeListener = () => {
                socketInfo.connections.forEach(_conn => {
                    _conn._onTCPClose();
                });

                setImmediate(() => {
                    socket.removeListener('drain', socketInfo.drainListener);
                    socket.removeListener('close', socketInfo.closeListener);
                    socket.removeListener('end', socketInfo.closeListener);
                    this.m_socketInfoMap.delete(socket);
                });
            }

            socket.on('drain', socketInfo.drainListener);
            socket.once('close', socketInfo.closeListener);
            socket.once('end', socketInfo.closeListener);

            this.m_socketInfoMap.set(socket, socketInfo);
        } else {
            socketInfo.connections.add(connection);
        }
    }

    unregister(socket, connection) {
        let socketInfo = this.m_socketInfoMap.get(socket);
        if (!socketInfo) {
            return;
        }

        let removeConnection = () => {
            socketInfo.connections.delete(connection);
            if (socketInfo.connections.size === 0) {
                socket.removeListener('drain', socketInfo.drainListener);
                socket.removeListener('close', socketInfo.closeListener);
                socket.removeListener('end', socketInfo.closeListener);
                this.m_socketInfoMap.delete(socket);
            }
        }

        setImmediate(removeConnection);
    }
}

module.exports.TCPConnectionMgr = new TCPConnectionMgr();