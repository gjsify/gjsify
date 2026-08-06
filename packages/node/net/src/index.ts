// Node.js net module for GJS
// Reference: Node.js lib/net.js

export { Socket, type SocketConnectOptions } from './socket.js';
export { Server, type ListenOptions } from './server.js';
import { Socket, type SocketConnectOptions } from './socket.js';
import { Server } from './server.js';

// `isIP` and friends are pure string classification and live in `is-ip.ts`,
// shared with the browser entry. They used to be answered here by
// `Gio.InetAddress.new_from_string()`, i.e. by the host's `inet_pton(3)` —
// which gives a DIFFERENT answer per libc (BSD accepts leading zeros in an
// IPv4 octet, glibc rejects them). The full measurement is in that module.
export { isIP, isIPv4, isIPv6 } from './is-ip.js';
import { isIP, isIPv4, isIPv6 } from './is-ip.js';

/** Create a new TCP connection. */
export function createConnection(
    options: SocketConnectOptions | number,
    host?: string | (() => void),
    connectionListener?: () => void,
): Socket {
    const socket = new Socket();
    return socket.connect(options, host, connectionListener);
}

/** Alias for createConnection. */
export const connect = createConnection;

/** Create a new TCP server. */
export function createServer(connectionListener?: (socket: Socket) => void): Server;
export function createServer(
    options?: { allowHalfOpen?: boolean },
    connectionListener?: (socket: Socket) => void,
): Server;
export function createServer(
    optionsOrListener?: { allowHalfOpen?: boolean } | ((socket: Socket) => void),
    connectionListener?: (socket: Socket) => void,
): Server {
    if (typeof optionsOrListener === 'function') {
        return new Server(optionsOrListener);
    }
    return new Server(optionsOrListener, connectionListener);
}

export default {
    Socket,
    Server,
    isIP,
    isIPv4,
    isIPv6,
    createConnection,
    connect,
    createServer,
};
