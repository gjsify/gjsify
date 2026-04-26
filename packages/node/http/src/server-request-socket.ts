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

  // Reference kept so pause()/resume() can drive the underlying Soup message.
  private readonly _soupMsg: Soup.ServerMessage;
  // Track whether we previously paused Soup so we don't double-pause /
  // double-unpause (which would corrupt Soup's pause_count).
  private _soupPaused = false;

  constructor(
    soupMsg: Soup.ServerMessage,
    localAddress: string,
    localPort: number,
    encrypted = false,
  ) {
    super({ allowHalfOpen: true });
    this._soupMsg = soupMsg;
    this.remoteAddress = soupMsg.get_remote_host() ?? '127.0.0.1';
    const remoteAddr = soupMsg.get_remote_address();
    this.remotePort = (remoteAddr instanceof Gio.InetSocketAddress) ? remoteAddr.get_port() : 0;
    this.localAddress = localAddress;
    this.localPort = localPort;
    this.encrypted = encrypted;
  }

  // pause/resume: forward to the Soup message so backpressure-aware Node
  // consumers can throttle the response. Soup's pause is reference-counted
  // internally; we guard with _soupPaused to keep our own callers paired.
  pause(): this {
    if (this._soupPaused) return this;
    this._soupPaused = true;
    try { this._soupMsg.pause(); } catch { /* message already finished */ }
    return super.pause() as this;
  }

  resume(): this {
    if (!this._soupPaused) return super.resume() as this;
    this._soupPaused = false;
    try { this._soupMsg.unpause(); } catch { /* message already finished */ }
    return super.resume() as this;
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
