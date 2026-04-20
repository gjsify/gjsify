// Reference: Node.js lib/net.js, refs/deno/ext/node/polyfills/net.ts
// Reimplemented for GJS using Gio.SocketClient / Gio.SocketConnection

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Duplex } from 'node:stream';
import { Buffer } from 'node:buffer';
import { createNodeError, gbytesToUint8Array } from '@gjsify/utils';
import type { DuplexOptions } from 'node:stream';

export interface SocketConnectOptions {
  port: number;
  host?: string;
  localAddress?: string;
  localPort?: number;
  family?: 4 | 6 | 0;
  keepAlive?: boolean;
  keepAliveInitialDelay?: number;
  noDelay?: boolean;
  timeout?: number;
}

export interface SocketOptions extends DuplexOptions {
  allowHalfOpen?: boolean;
}

export class Socket extends Duplex {
  // Public properties matching Node.js net.Socket
  remoteAddress?: string;
  remotePort?: number;
  remoteFamily?: string;
  localAddress?: string;
  localPort?: number;
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  destroyed = false;
  pending = true;
  readyState: 'opening' | 'open' | 'readOnly' | 'writeOnly' | 'closed' = 'closed';
  declare allowHalfOpen: boolean;

  private _connection: Gio.SocketConnection | null = null;
  private _ioStream: Gio.IOStream | null = null;
  private _inputStream: Gio.InputStream | null = null;
  private _outputStream: Gio.OutputStream | null = null;
  private _cancellable: Gio.Cancellable = new Gio.Cancellable();
  private _reading = false;
  private _timeout = 0;
  private _timeoutId: ReturnType<typeof setTimeout> | null = null;

  constructor(options?: SocketOptions) {
    super(options);
    this.allowHalfOpen = options?.allowHalfOpen ?? false;
  }

  /** @internal Set the connection from an accepted server socket. */
  _setConnection(connection: Gio.SocketConnection): void {
    this._connection = connection;
  }

  /**
   * @internal Set up this socket from a raw Gio.IOStream (e.g., stolen from Soup.Server
   * during an HTTP upgrade). Extracts I/O streams, attempts to read address info
   * if the underlying stream is a SocketConnection, and starts reading.
   */
  _setupFromIOStream(ioStream: Gio.IOStream): void {
    this._ioStream = ioStream;

    // If the IOStream is actually a SocketConnection, use it for full features
    try {
      const sockConn = ioStream as unknown as Gio.SocketConnection;
      if (typeof sockConn.get_socket === 'function') {
        this._connection = sockConn;
        const remoteAddr = sockConn.get_remote_address() as Gio.InetSocketAddress;
        this.remoteAddress = remoteAddr.get_address().to_string();
        this.remotePort = remoteAddr.get_port();
        this.remoteFamily = remoteAddr.get_address().get_family() === Gio.SocketFamily.IPV6 ? 'IPv6' : 'IPv4';
        const localAddr = sockConn.get_local_address() as Gio.InetSocketAddress;
        this.localAddress = localAddr.get_address().to_string();
        this.localPort = localAddr.get_port();
      }
    } catch { /* not a SocketConnection — use IOStream only */ }

    this._inputStream = ioStream.get_input_stream();
    this._outputStream = ioStream.get_output_stream();

    this.connecting = false;
    this.pending = false;
    this.readyState = 'open';

    this.emit('connect');
    this.emit('ready');

    this._startReading();
  }

  /**
   * Initiate a TCP connection.
   */
  connect(options: SocketConnectOptions | number, host?: string | (() => void), connectionListener?: () => void): this;
  connect(options: SocketConnectOptions | number, host?: string | (() => void), connectionListener?: () => void): this {
    // Normalize arguments
    let opts: SocketConnectOptions;
    if (typeof options === 'number') {
      opts = { port: options, host: typeof host === 'string' ? host : 'localhost' };
      if (typeof host === 'function') connectionListener = host;
    } else {
      opts = options;
      if (typeof host === 'function') connectionListener = host;
    }

    if (connectionListener) {
      this.once('connect', connectionListener);
    }

    this.connecting = true;
    this.readyState = 'opening';
    this.pending = true;

    const targetHost = opts.host || 'localhost';
    const targetPort = opts.port;

    const client = new Gio.SocketClient();

    if (opts.timeout) {
      client.set_timeout(Math.ceil(opts.timeout / 1000));
    }

    // Async connect
    client.connect_to_host_async(
      targetHost,
      targetPort,
      this._cancellable,
      (_source: Gio.SocketClient | null, asyncResult: Gio.AsyncResult) => {
        try {
          this._connection = client.connect_to_host_finish(asyncResult);
          this._setupConnection(opts);
        } catch (err: unknown) {
          this.connecting = false;
          this.readyState = 'closed';
          const nodeErr = createNodeError(err, 'connect', {
            address: targetHost,
            port: targetPort,
          });
          this.destroy(nodeErr);
        }
      },
    );

    return this;
  }

  /** @internal Set up streams and emit connect after connection is established. */
  _setupConnection(opts: SocketConnectOptions | Record<string, never>): void {
    if (!this._connection) return;

    const sock = this._connection.get_socket();
    this._inputStream = this._connection.get_input_stream();
    this._outputStream = this._connection.get_output_stream();

    // Set socket options
    if ('keepAlive' in opts && opts.keepAlive) {
      sock.set_keepalive(true);
    }
    if (!('noDelay' in opts) || opts.noDelay !== false) {
      // TCP_NODELAY: level=6 (IPPROTO_TCP), optname=1 (TCP_NODELAY)
      try { sock.set_option(6, 1, 1); } catch { /* may not be supported */ }
    }

    // Extract address info
    try {
      const remoteAddr = this._connection.get_remote_address() as Gio.InetSocketAddress;
      this.remoteAddress = remoteAddr.get_address().to_string();
      this.remotePort = remoteAddr.get_port();
      this.remoteFamily = remoteAddr.get_address().get_family() === Gio.SocketFamily.IPV6 ? 'IPv6' : 'IPv4';
    } catch { /* ignore */ }

    try {
      const localAddr = this._connection.get_local_address() as Gio.InetSocketAddress;
      this.localAddress = localAddr.get_address().to_string();
      this.localPort = localAddr.get_port();
    } catch { /* ignore */ }

    this.connecting = false;
    this.pending = false;
    this.readyState = 'open';

    this.emit('connect');
    this.emit('ready');

    // Start reading
    this._startReading();
  }

  private _startReading(): void {
    if (this._reading || !this._inputStream) return;
    this._reading = true;
    this._readLoop();
  }

  private async _readLoop(): Promise<void> {
    const inputStream = this._inputStream;
    if (!inputStream) return;

    const CHUNK_SIZE = 16384;

    try {
      while (this._reading && inputStream) {
        const bytes = await new Promise<GLib.Bytes | null>((resolve, reject) => {
          inputStream.read_bytes_async(
            CHUNK_SIZE,
            GLib.PRIORITY_DEFAULT,
            this._cancellable,
            (_source: Gio.InputStream | null, asyncResult: Gio.AsyncResult) => {
              try {
                resolve(inputStream.read_bytes_finish(asyncResult));
              } catch (err) {
                reject(err);
              }
            },
          );
        });
        if (!bytes || bytes.get_size() === 0) {
          // EOF — remote peer closed their write side
          this._reading = false;
          if (!this.allowHalfOpen) {
            // Default: close our write side after 'end' listeners have run,
            // so they can still write before the socket shuts down.
            this.once('end', () => {
              this.end();
              this.readyState = 'closed';
            });
          } else {
            this.readyState = this.writable ? 'writeOnly' : 'closed';
          }
          this.push(null);
          break;
        }

        const data = gbytesToUint8Array(bytes);
        this.bytesRead += data.length;
        this._resetTimeout();

        if (!this.push(Buffer.from(data))) {
          // Backpressure — pause reading until _read is called
          this._reading = false;
          break;
        }

        // Yield to the GLib main loop at idle priority so GTK input events
        // (mouse, keyboard, window management) can be processed between reads.
        // Without this, rapid I/O completion callbacks form a microtask chain
        // that drains before GTK macrotasks, starving window event processing.
        await new Promise<void>(resolve => {
          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
          });
        });
      }
    } catch (err: unknown) {
      if (!this._cancellable.is_cancelled()) {
        this.destroy(createNodeError(err, 'read', { address: this.remoteAddress }));
      }
    }
  }

  // Duplex stream interface
  _read(_size: number): void {
    if (!this._reading && this._inputStream) {
      this._startReading();
    }
  }

  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    if (!this._outputStream) {
      callback(new Error('Socket is not connected'));
      return;
    }

    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding);

    this._outputStream.write_bytes_async(
      new GLib.Bytes(data),
      GLib.PRIORITY_DEFAULT,
      this._cancellable,
      (_source: Gio.OutputStream | null, asyncResult: Gio.AsyncResult) => {
        try {
          const written = this._outputStream!.write_bytes_finish(asyncResult);
          this.bytesWritten += written;
          this._resetTimeout();
          callback(null);
        } catch (err: unknown) {
          callback(createNodeError(err, 'write', { address: this.remoteAddress }));
        }
      },
    );
  }

  _final(callback: (error?: Error | null) => void): void {
    // Half-close: shutdown write side
    if (this._connection) {
      try {
        this._connection.get_socket().shutdown(false, true);
        this.readyState = this.readable ? 'readOnly' : 'closed';
      } catch { /* ignore */ }
    } else if (this._ioStream) {
      // Fallback for IOStream-based sockets (e.g., stolen from Soup.Server).
      // SoupIOStream doesn't support half-close via output stream close,
      // so close the entire IOStream to send TCP FIN to the peer.
      try {
        this._ioStream.close(null);
        this.readyState = 'closed';
      } catch { /* ignore */ }
      this._ioStream = null;
      this._inputStream = null;
      this._outputStream = null;
    }
    callback();
  }

  _destroy(err: Error | null, callback: (error?: Error | null) => void): void {
    this._reading = false;
    this._clearTimeout();
    this._cancellable.cancel();

    if (this._connection) {
      try {
        this._connection.close(null);
      } catch { /* ignore */ }
      this._connection = null;
    } else if (this._ioStream) {
      try {
        this._ioStream.close(null);
      } catch { /* ignore */ }
    }

    this._ioStream = null;
    this._inputStream = null;
    this._outputStream = null;
    this.readyState = 'closed';
    this.destroyed = true;

    callback(err);
  }

  /** Set the socket timeout in milliseconds. 0 disables. */
  setTimeout(timeout: number, callback?: () => void): this {
    this._timeout = timeout;
    this._clearTimeout();

    if (callback) {
      this.once('timeout', callback);
    }

    if (timeout > 0) {
      this._resetTimeout();
    }

    return this;
  }

  private _resetTimeout(): void {
    this._clearTimeout();
    if (this._timeout > 0) {
      this._timeoutId = setTimeout(() => {
        this.emit('timeout');
      }, this._timeout);
    }
  }

  private _clearTimeout(): void {
    if (this._timeoutId !== null) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
  }

  /** Enable/disable TCP keep-alive. */
  setKeepAlive(enable?: boolean, _initialDelay?: number): this {
    if (this._connection) {
      try {
        this._connection.get_socket().set_keepalive(enable ?? false);
      } catch { /* ignore */ }
    }
    return this;
  }

  /** Enable/disable TCP_NODELAY (disable Nagle algorithm). */
  setNoDelay(noDelay?: boolean): this {
    if (this._connection) {
      try {
        this._connection.get_socket().set_option(6, 1, noDelay !== false ? 1 : 0);
      } catch { /* ignore */ }
    }
    return this;
  }

  /** Get the underlying socket address info. */
  address(): { port: number; family: string; address: string } | {} {
    if (this.localAddress && this.localPort) {
      return {
        port: this.localPort,
        family: this.remoteFamily || 'IPv4',
        address: this.localAddress,
      };
    }
    return {};
  }

  /** Reference this socket (keep event loop alive). No-op in GJS. */
  ref(): this { return this; }
  /** Unreference this socket. No-op in GJS. */
  unref(): this { return this; }
}
