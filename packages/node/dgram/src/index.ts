// Node.js dgram module for GJS — UDP sockets via Gio.Socket
// Reference: Node.js lib/dgram.js

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'events';
import { Buffer } from 'buffer';
import { deferEmit } from '@gjsify/utils';

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
export class Socket extends EventEmitter {
  readonly type: 'udp4' | 'udp6';

  private _socket: Gio.Socket | null = null;
  private _bound = false;
  private _closed = false;
  private _receiving = false;
  private _address: AddressInfo = { address: '0.0.0.0', family: 'IPv4', port: 0 };
  private _cancellable: Gio.Cancellable = new Gio.Cancellable();
  private _reuseAddr: boolean;

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

    try {
      const inetAddr = Gio.InetAddress.new_from_string(destAddress);
      const sockAddr = new Gio.InetSocketAddress({ address: inetAddr, port: destPort });

      // Auto-bind if not yet bound
      if (!this._bound) {
        const anyAddr = this.type === 'udp6'
          ? Gio.InetAddress.new_any(Gio.SocketFamily.IPV6)
          : Gio.InetAddress.new_any(Gio.SocketFamily.IPV4);
        const anySockAddr = new Gio.InetSocketAddress({ address: anyAddr, port: 0 });
        this._socket.bind(anySockAddr, false);
        this._bound = true;
      }

      const bytesSent = this._socket.send_to(sockAddr, buf, this._cancellable);
      if (cb) cb(null, bytesSent);
    } catch (err) {
      if (cb) cb(err instanceof Error ? err : new Error(String(err)), 0);
      else this.emit('error', err);
    }
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
    if (this._closed) return this;
    this._closed = true;

    if (callback) this.once('close', callback);

    this._cancellable.cancel();

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
    if (this._closed || !this._socket) return;

    // Use condition_timed_wait with a short timeout to poll for data
    // Then read with receive_from
    try {
      if (!this._socket.condition_check(GLib.IOCondition.IN)) {
        // No data yet, schedule retry
        setTimeout(() => this._receiveLoop(), 50);
        return;
      }

      const buf = new Uint8Array(65536);
      const result = (this._socket as unknown as { receive_from(buf: Uint8Array, cancellable: Gio.Cancellable): [number, Gio.SocketAddress | null] }).receive_from(buf, this._cancellable);
      const bytesRead = Array.isArray(result) ? result[0] : result;
      const srcAddr = Array.isArray(result) ? result[1] : null;

      if (bytesRead > 0 && srcAddr) {
        const data = Buffer.from(buf.subarray(0, bytesRead as number));
        const inetSockAddr = srcAddr as Gio.InetSocketAddress;
        const rinfo: AddressInfo = {
          address: inetSockAddr.get_address().to_string(),
          family: this.type === 'udp6' ? 'IPv6' : 'IPv4',
          port: inetSockAddr.get_port(),
        };

        this.emit('message', data, rinfo);
      }

      // Continue receiving
      if (!this._closed) {
        setTimeout(() => this._receiveLoop(), 0);
      }
    } catch (err: unknown) {
      if (!this._closed) {
        // IOErrorEnum CANCELLED is expected when socket is closed
        const errObj = err as { code?: number };
        if (errObj.code !== Gio.IOErrorEnum.CANCELLED) {
          this.emit('error', err);
        }
      }
    }
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
