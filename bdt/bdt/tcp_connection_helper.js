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