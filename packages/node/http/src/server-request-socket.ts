// `req.socket` for our HTTP server.
//
// Reference: Node.js lib/net.js Socket interface
// Reimplemented for GJS — `@gjsify/http-soup-bridge` owns the underlying
// TCP connection, so a real `Gio.Socket` is not directly accessible from
// JS. This class satisfies the net.Socket duck-type expected by HTTP
// consumers (Hono, MCP SDK, engine.io, …) using values copied off the
// bridge `Request` instance at construction time.
//
// Extends Duplex (not EventEmitter) so that `instanceof stream.Duplex`
// checks and stream API calls (`pipe`, `pause`, `resume`) work. `_read`
// and `_write` are no-ops because the bridge owns the actual bytes.

import { Duplex } from 'node:stream';
import type { Response as BridgeResponse } from '@gjsify/http-soup-bridge';

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

  // Bridge response we forward pause/resume to (via super.pause/resume
  // for now; the bridge will grow explicit pause/unpause hooks later).
  private readonly _bridgeRes: BridgeResponse;
  private _bridgePaused = false;

  constructor(
    remoteAddress: string,
    remotePort: number,
    localAddress: string,
    localPort: number,
    bridgeRes: BridgeResponse,
    encrypted = false,
  ) {
    super({ allowHalfOpen: true });
    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
    this.localAddress = localAddress;
    this.localPort = localPort;
    this.encrypted = encrypted;
    this._bridgeRes = bridgeRes;
  }

  pause(): this {
    if (this._bridgePaused) return this;
    this._bridgePaused = true;
    return super.pause() as this;
  }

  resume(): this {
    if (!this._bridgePaused) return super.resume() as this;
    this._bridgePaused = false;
    return super.resume() as this;
  }

  // The bridge owns the TCP connection — no data flows through this Duplex.
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
