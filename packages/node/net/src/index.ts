// Node.js net module for GJS
// Reference: Node.js lib/net.js

import Gio from '@girs/gio-2.0';

export { Socket, SocketConnectOptions } from './socket.js';
export { Server, ListenOptions } from './server.js';
import { Socket, SocketConnectOptions } from './socket.js';
import { Server, ListenOptions } from './server.js';

/** Check if input is a valid IP address. Returns 0, 4, or 6. */
export function isIP(input: string): 0 | 4 | 6 {
  const addr = Gio.InetAddress.new_from_string(input);
  if (!addr) return 0;
  const family = addr.get_family();
  switch (family) {
    case Gio.SocketFamily.INVALID: return 0;
    case Gio.SocketFamily.IPV4: return 4;
    case Gio.SocketFamily.IPV6: return 6;
  }
}

/** Check if input is a valid IPv4 address. */
export function isIPv4(input: string): boolean {
  return isIP(input) === 4;
}

/** Check if input is a valid IPv6 address. */
export function isIPv6(input: string): boolean {
  return isIP(input) === 6;
}

/** Create a new TCP connection. */
export function createConnection(options: SocketConnectOptions | number, host?: string | (() => void), connectionListener?: () => void): Socket {
  const socket = new Socket();
  return socket.connect(options as any, host as any, connectionListener);
}

/** Alias for createConnection. */
export const connect = createConnection;

/** Create a new TCP server. */
export function createServer(connectionListener?: (socket: Socket) => void): Server;
export function createServer(options?: { allowHalfOpen?: boolean }, connectionListener?: (socket: Socket) => void): Server;
export function createServer(optionsOrListener?: any, connectionListener?: (socket: Socket) => void): Server {
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
