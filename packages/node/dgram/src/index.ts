// Node.js dgram module for GJS — UDP sockets via Gio.Socket
// Reference: Node.js lib/dgram.js

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { deferEmit, ensureMainLoop } from '@gjsify/utils';

export interface SocketOptions {
  type: 'udp4' | 'udp6';
  reuseAddr?: boolean;
  reusePort?: boolean;
  ipv6Only?: boolean;
  recvBufferSize?: number;
  sendBufferSize?: number;
  signal?: AbortSignal;
}

export interface AddressInfo {
  address: string;
  family: string;
  port: number;
}

/**
 * dgram.Socket — UDP socket wrapping Gio.Socket.
 */
interface RemoteAddressInfo {
  address: string;
  family: string;
  port: number;
}

// GC guard — GJS garbage-collects objects with no JS references.
// Keep strong references to bound UDP sockets to prevent their
// Gio.Socket from being collected while receiving data.
const _activeSockets = new Set<Socket>();

export class Socket extends EventEmitter {
  readonly type: 'udp4' | 'udp6';

  private _socket: Gio.Socket | null = null;
  private _bound = false;
  private _closed = false;
  private _receiving = false;
  private _address: AddressInfo = { address: '0.0.0.0', family: 'IPv4', port: 0 };
  private _cancellable: Gio.Cancellable = new Gio.Cancellable();
  // Strong JS ref to the GSocketSource so SM GC cannot finalize the
  // BoxedInstance while GLib's main context still holds it.
  private _readSource: GLib.Source | null = null;
  private _reuseAddr: boolean;
  private _connected = false;
  private _remoteAddress: RemoteAddressInfo | null = null;

  constructor(options: SocketOptions | string) {
    super();

    if (typeof options === 'string') {
      this.type = options as 'udp4' | 'udp6';
      this._reuseAddr = false;
    } else {
      this.type = options.type;
      this._reuseAddr = options.reuseAddr ?? false;
    }

    const family = this.type === 'udp6' ? Gio.SocketFamily.IPV6 : Gio.SocketFamily.IPV4;

    try {
      this._socket = Gio.Socket.new(family, Gio.SocketType.DATAGRAM, Gio.SocketProtocol.UDP);
      this._socket.set_blocking(false);
    } catch (err) {
      this._socket = null;
      // Defer error emission
      deferEmit(this, 'error', err);
    }
  }

  /**
   * Bind the socket to a port and optional address.
   */
  bind(port?: number | { port?: number; address?: string; exclusive?: boolean }, address?: string | (() => void), callback?: () => void): this {
    if (this._closed || !this._socket) return this;

    let bindPort = 0;
    let bindAddress = this.type === 'udp6' ? '::' : '0.0.0.0';

    if (typeof port === 'object') {
      const opts = port;
      bindPort = opts.port || 0;
      bindAddress = opts.address || bindAddress;
      if (typeof address === 'function') callback = address;
    } else if (typeof port === 'number') {
      bindPort = port;
      if (typeof address === 'string') bindAddress = address;
      else if (typeof address === 'function') callback = address;
    } else if (typeof port === 'function') {
      callback = port;
    }

    if (callback) this.once('listening', callback);

    try {
      const family = this.type === 'udp6' ? Gio.SocketFamily.IPV6 : Gio.SocketFamily.IPV4;
      const inetAddr = Gio.InetAddress.new_from_string(bindAddress) ||
                       (family === Gio.SocketFamily.IPV6 ? Gio.InetAddress.new_any(Gio.SocketFamily.IPV6) : Gio.InetAddress.new_any(Gio.SocketFamily.IPV4));
      const sockAddr = new Gio.InetSocketAddress({ address: inetAddr, port: bindPort });

      this._socket.bind(sockAddr, this._reuseAddr);
      this._bound = true;
      _activeSockets.add(this);
      ensureMainLoop();

      // Get actual bound address
      const localAddr = this._socket.get_local_address() as Gio.InetSocketAddress;
      if (localAddr) {
        this._address = {
          address: localAddr.get_address().to_string(),
          family: this.type === 'udp6' ? 'IPv6' : 'IPv4',
          port: localAddr.get_port(),
        };
      }

      setTimeout(() => {
        this.emit('listening');
        this._startReceiving();
      }, 0);
    } catch (err) {
      deferEmit(this, 'error', err);
    }

    return this;
  }

  /**
   * Send a message.
   */
  send(
    msg: Buffer | string | Uint8Array | (Buffer | string | Uint8Array)[],
    offset?: number | ((err: Error | null, bytes: number) => void),
    length?: number,
    port?: number,
    address?: string | ((err: Error | null, bytes: number) => void),
    callback?: (err: Error | null, bytes: number) => void,
  ): void {
    if (this._closed || !this._socket) return;

    // Handle overloaded signatures:
    // send(msg, port, address, callback)
    // send(msg, offset, length, port, address, callback)
    let buf: Buffer;
    let destPort: number;
    let destAddress: string;
    let cb: ((err: Error | null, bytes: number) => void) | undefined;

    if (typeof offset === 'function') {
      // send(msg, callback)
      cb = offset;
      buf = this._toBuffer(msg);
      destPort = this._address.port;
      destAddress = this._address.address;
    } else if (typeof offset === 'number' && typeof length === 'string') {
      // send(msg, port, address, callback) — offset=port, length=address, port=callback
      destPort = offset;
      destAddress = length;
      cb = port as unknown as ((err: Error | null, bytes: number) => void) | undefined;
      buf = this._toBuffer(msg);
    } else if (typeof offset === 'number' && typeof length === 'number' && typeof address === 'function') {
      // send(msg, offset, length, port, callback)
      cb = address;
      destPort = port!;
      destAddress = this.type === 'udp6' ? '::1' : '127.0.0.1';
      buf = this._toBufferSlice(msg, offset, length);
    } else if (typeof offset === 'number' && typeof length === 'number') {
      // send(msg, offset, length, port, address, callback)
      destPort = port!;
      destAddress = (address as string) || (this.type === 'udp6' ? '::1' : '127.0.0.1');
      cb = callback;
      buf = this._toBufferSlice(msg, offset, length);
    } else {
      // send(msg, port) or similar — best effort
      destPort = Number(offset) || 0;
      destAddress = this.type === 'udp6' ? '::1' : '127.0.0.1';
      buf = this._toBuffer(msg);
    }

    this._resolveAndSend(destAddress, destPort, buf, cb);
  }

  private _autoBind(): void {
    if (this._bound || !this._socket) return;
    const anyAddr = this.type === 'udp6'
      ? Gio.InetAddress.new_any(Gio.SocketFamily.IPV6)
      : Gio.InetAddress.new_any(Gio.SocketFamily.IPV4);
    const anySockAddr = new Gio.InetSocketAddress({ address: anyAddr, port: 0 });
    this._socket.bind(anySockAddr, false);
    this._bound = true;
    _activeSockets.add(this);
    ensureMainLoop();
  }

  private _resolveAndSend(destAddress: string, destPort: number, buf: Buffer, cb: ((err: Error | null, bytes: number) => void) | undefined): void {
    if (this._closed || !this._socket) {
      if (cb) cb(new Error('Socket is closed'), 0);
      return;
    }

    // Try numeric IP first (fast path, no DNS)
    let inetAddr = Gio.InetAddress.new_from_string(destAddress);

    const doSend = (addr: Gio.InetAddress) => {
      try {
        this._autoBind();
        const sockAddr = new Gio.InetSocketAddress({ address: addr, port: destPort });
        const bytesSent = this._socket!.send_to(sockAddr, buf, this._cancellable);
        if (cb) cb(null, bytesSent);
      } catch (err) {
        if (cb) cb(err instanceof Error ? err : new Error(String(err)), 0);
        else this.emit('error', err);
      }
    };

    if (inetAddr) {
      doSend(inetAddr);
      return;
    }

    // Hostname — resolve asynchronously via Gio.Resolver
    const resolver = Gio.Resolver.get_default();
    resolver.lookup_by_name_async(destAddress, this._cancellable, (_obj, res) => {
      try {
        const addresses = resolver.lookup_by_name_finish(res);
        if (!addresses || addresses.length === 0) {
          const err = new Error(`ENOTFOUND ${destAddress}`) as NodeJS.ErrnoException;
          err.code = 'ENOTFOUND';
          if (cb) cb(err, 0);
          else this.emit('error', err);
          return;
        }
        doSend(addresses[0]);
      } catch (err) {
        if (cb) cb(err instanceof Error ? err : new Error(String(err)), 0);
        else this.emit('error', err);
      }
    });
  }

  private _toBuffer(msg: Buffer | string | Uint8Array | (Buffer | string | Uint8Array)[]): Buffer {
    if (Array.isArray(msg)) {
      return Buffer.concat(msg.map(m => typeof m === 'string' ? Buffer.from(m) : Buffer.from(m)));
    }
    return typeof msg === 'string' ? Buffer.from(msg) : Buffer.from(msg);
  }

  private _toBufferSlice(msg: Buffer | string | Uint8Array | (Buffer | string | Uint8Array)[], offset: number, length: number): Buffer {
    const buf = this._toBuffer(msg);
    return Buffer.from(buf.buffer, buf.byteOffset + offset, length);
  }

  /**
   * Close the socket.
   */
  close(callback?: () => void): this {
    if (this._closed) {
      throw new Error('Not running');
    }
    this._closed = true;
    _activeSockets.delete(this);

    if (callback) this.once('close', callback);

    this._cancellable.cancel();

    if (this._readSource) {
      try { this._readSource.destroy(); } catch (_e) { /* ignore */ }
      this._readSource = null;
    }

    if (this._socket) {
      try {
        this._socket.close();
      } catch (_e) {
        // Ignore close errors
      }
      this._socket = null;
    }

    deferEmit(this, 'close');
    return this;
  }

  /**
   * Associate the socket with a remote address/port (connected UDP).
   * After connect(), send() can omit address and port.
   */
  connect(port: number, address?: string | (() => void), callback?: () => void): void {
    if (this._connected) {
      const err = new Error('Already connected') as NodeJS.ErrnoException;
      err.code = 'ERR_SOCKET_DGRAM_IS_CONNECTED';
      throw err;
    }
    if (!port || port <= 0 || port >= 65536) {
      const err = new RangeError(`Port should be > 0 and < 65536. Received ${port}.`) as NodeJS.ErrnoException;
      err.code = 'ERR_SOCKET_BAD_PORT';
      throw err;
    }
    let resolvedAddr: string;
    let cb: (() => void) | undefined;
    if (typeof address === 'function') {
      cb = address;
      resolvedAddr = this.type === 'udp6' ? '::1' : '127.0.0.1';
    } else {
      resolvedAddr = address || (this.type === 'udp6' ? '::1' : '127.0.0.1');
      cb = callback;
    }

    this._connected = true;
    this._remoteAddress = {
      address: resolvedAddr,
      family: this.type === 'udp6' ? 'IPv6' : 'IPv4',
      port,
    };

    if (cb) {
      // Emit connect asynchronously (matches Node.js behaviour)
      Promise.resolve().then(() => {
        this.emit('connect');
        cb!();
      });
    } else {
      Promise.resolve().then(() => this.emit('connect'));
    }
  }

  /**
   * Dissociate a connected socket from its remote address.
   */
  disconnect(): void {
    if (!this._connected) {
      const err = new Error('Not connected') as NodeJS.ErrnoException;
      err.code = 'ERR_SOCKET_DGRAM_NOT_CONNECTED';
      throw err;
    }
    this._connected = false;
    this._remoteAddress = null;
  }

  /**
   * Returns the remote address of a connected socket.
   * Throws ERR_SOCKET_DGRAM_NOT_CONNECTED if not connected.
   */
  remoteAddress(): RemoteAddressInfo {
    if (!this._connected || !this._remoteAddress) {
      const err = new Error('Not connected') as NodeJS.ErrnoException;
      err.code = 'ERR_SOCKET_DGRAM_NOT_CONNECTED';
      throw err;
    }
    return { ...this._remoteAddress };
  }

  /**
   * Get the bound address info.
   */
  address(): AddressInfo {
    return { ...this._address };
  }

  /**
   * Set the broadcast flag.
   */
  setBroadcast(flag: boolean): void {
    if (this._socket) {
      this._socket.set_broadcast(flag);
    }
  }

  /**
   * Set the TTL.
   */
  setTTL(ttl: number): number {
    if (this._socket) {
      this._socket.set_ttl(ttl);
    }
    return ttl;
  }

  /**
   * Set multicast TTL.
   */
  setMulticastTTL(ttl: number): number {
    if (this._socket) {
      this._socket.set_multicast_ttl(ttl);
    }
    return ttl;
  }

  /**
   * Set multicast loopback.
   */
  setMulticastLoopback(flag: boolean): boolean {
    if (this._socket) {
      this._socket.set_multicast_loopback(flag);
    }
    return flag;
  }

  /**
   * Add multicast group membership.
   */
  addMembership(multicastAddress: string, multicastInterface?: string): void {
    if (!this._socket) return;
    try {
      const mcastAddr = Gio.InetAddress.new_from_string(multicastAddress);
      this._socket.join_multicast_group(mcastAddr, false, multicastInterface || null);
    } catch (err) {
      this.emit('error', err);
    }
  }

  /**
   * Drop multicast group membership.
   */
  dropMembership(multicastAddress: string, multicastInterface?: string): void {
    if (!this._socket) return;
    try {
      const mcastAddr = Gio.InetAddress.new_from_string(multicastAddress);
      this._socket.leave_multicast_group(mcastAddr, false, multicastInterface || null);
    } catch (err) {
      this.emit('error', err);
    }
  }

  /**
   * Set multicast interface.
   */
  setMulticastInterface(_interfaceAddress: string): void {
    // GLib handles this via join_multicast_group interface parameter
  }

  /** Ref the socket (keep event loop alive). */
  ref(): this {
    return this;
  }

  /** Unref the socket (allow event loop to exit). */
  unref(): this {
    return this;
  }

  /** Get/Set receive buffer size. */
  getRecvBufferSize(): number {
    return 65536; // Default
  }

  setRecvBufferSize(_size: number): void {
    // Gio.Socket doesn't expose SO_RCVBUF directly
  }

  /** Get/Set send buffer size. */
  getSendBufferSize(): number {
    return 65536; // Default
  }

  setSendBufferSize(_size: number): void {
    // Gio.Socket doesn't expose SO_SNDBUF directly
  }

  /**
   * Start receiving messages in background.
   */
  private _startReceiving(): void {
    if (this._receiving || this._closed || !this._socket) return;
    this._receiving = true;
    this._receiveLoop();
  }

  private _receiveLoop(): void {
    if (this._closed || !this._socket || this._readSource) return;

    // Event-driven receive via GSocketSource: the source fires only when the
    // kernel reports data available (IOCondition.IN). Previously a
    // setTimeout(fn, 0) polling loop saturated the main loop with 0 ms timers
    // whenever any UDP traffic was in flight — WebTorrent DHT under load
    // starved GTK paint + other default-priority timers. receive_bytes_from is
    // GLib 2.80+ and non-blocking (timeout_us=0); receive_from() isn't
    // introspectable because its buffer arg is caller-allocated.
    const source = this._socket.create_source(GLib.IOCondition.IN, this._cancellable);
    this._readSource = source;
    source.set_callback(() => {
      if (this._closed || !this._socket) return GLib.SOURCE_REMOVE;
      try {
        const [bytes, srcAddr] = this._socket.receive_bytes_from(65536, 0, this._cancellable);
        if (bytes && srcAddr) {
          const data = Buffer.from(bytes.get_data()!);
          const inetSockAddr = srcAddr as Gio.InetSocketAddress;
          const rinfo: AddressInfo = {
            address: inetSockAddr.get_address().to_string(),
            family: this.type === 'udp6' ? 'IPv6' : 'IPv4',
            port: inetSockAddr.get_port(),
          };
          if (data.length > 0) this.emit('message', data, rinfo);
        }
      } catch (err) {
        const errObj = err as { code?: number };
        if (!this._closed && errObj.code !== Gio.IOErrorEnum.CANCELLED) {
          this.emit('error', err);
        }
      }
      return GLib.SOURCE_CONTINUE;
    });
    source.attach(null);
  }
}

/**
 * Create a UDP socket.
 */
export function createSocket(type: 'udp4' | 'udp6' | SocketOptions, callback?: (msg: Buffer, rinfo: AddressInfo) => void): Socket {
  const opts = typeof type === 'string' ? { type } : type;
  const socket = new Socket(opts);

  if (callback) {
    socket.on('message', callback);
  }

  return socket;
}

export default { Socket, createSocket };
