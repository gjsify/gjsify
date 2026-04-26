// Reference: Node.js lib/net.js Socket interface
// Reimplemented for GJS — Soup.Server manages connections internally; a real
// Gio.Socket is inaccessible for non-upgrade requests without stealing the
// connection (which prevents sending a response).  This class satisfies the
// net.Socket duck-type expected by HTTP consumers (engine.io, hono, etc.)
// while keeping address metadata accurate via Soup.ServerMessage.
//
// Extends Duplex (not EventEmitter) so that `instanceof stream.Duplex` checks
// and stream API calls (pipe, pause, resume) work.  _read/_write are no-ops
// because Soup owns the underlying TCP connection for non-upgrade requests.

import Soup from '@girs/soup-3.0';
import Gio from '@girs/gio-2.0';
import { Duplex } from 'node:stream';

export class ServerRequestSocket extends Duplex {
  readonly remoteAddress: string;
  readonly remotePort: number;
  readonly localAddress: string;
  readonly localPort: number;
  readonly remoteFamily = 'IPv4';
  readonly encrypted: boolean;
  readonly connecting = false;
  readonly pending = false;
  bytesRead = 0;
  bytesWritten = 0;

  constructor(
    soupMsg: Soup.ServerMessage,
    localAddress: string,
    localPort: number,
    encrypted = false,
  ) {
    super({ allowHalfOpen: true });
    this.remoteAddress = soupMsg.get_remote_host() ?? '127.0.0.1';
    const remoteAddr = soupMsg.get_remote_address();
    this.remotePort = (remoteAddr instanceof Gio.InetSocketAddress) ? remoteAddr.get_port() : 0;
    this.localAddress = localAddress;
    this.localPort = localPort;
    this.encrypted = encrypted;
  }

  // Soup owns the TCP connection — no data flows through this Duplex.
  _read(_size: number): void {}
  _write(_chunk: unknown, _encoding: BufferEncoding, cb: (err?: Error | null) => void): void { cb(); }

  destroySoon(): void {
    if (!this.writableEnded) this.end();
    if (this.writableFinished)
      this.destroy();
    else
      this.once('finish', () => this.destroy());
  }

  setTimeout(_timeout: number, cb?: () => void): this {
    if (cb) this.once('timeout', cb);
    return this;
  }

  setNoDelay(_noDelay?: boolean): this { return this; }
  setKeepAlive(_enable?: boolean, _delay?: number): this { return this; }
  ref(): this { return this; }
  unref(): this { return this; }

  address(): { address: string; family: string; port: number } {
    return { address: this.localAddress, family: 'IPv4', port: this.localPort };
  }
}
