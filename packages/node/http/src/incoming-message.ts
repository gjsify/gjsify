// IncomingMessage — Readable stream representing an HTTP request (server) or response (client).
// Reference: Node.js lib/_http_incoming.js

import { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';

/**
 * IncomingMessage — Readable stream for HTTP request (server-side) or response (client-side).
 */
export class IncomingMessage extends Readable {
  httpVersion = '1.1';
  httpVersionMajor = 1;
  httpVersionMinor = 1;
  headers: Record<string, string | string[]> = {};
  rawHeaders: string[] = [];
  method?: string;
  url?: string;
  statusCode?: number;
  statusMessage?: string;
  complete = false;
  socket: any = null;
  aborted = false;

  /** Node.js legacy alias for socket — needed by engine.io and other HTTP consumers. */
  get connection() { return this.socket; }

  private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
  }

  _read(_size: number): void {
    // Data is pushed externally via _pushBody or _pushStream
  }

  // HTTP IncomingMessage 'close' fires when the socket is destroyed (connection
  // lost), not when the request body stream ends. Suppress the Readable's
  // automatic emit-close-after-end so that engine.io and other HTTP libs don't
  // misinterpret body-stream completion as a premature connection close.
  protected _autoClose(): void {
    // no-op — 'close' is emitted via destroy() only
  }

  /** Finish the readable stream with the body data (used by server-side handler). */
  _pushBody(body: Uint8Array | null): void {
    if (body && body.length > 0) {
      this.push(Buffer.from(body));
    }
    this.push(null);
    this.complete = true;
    // Clear timeout when request body is complete
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
  }

  setTimeout(msecs: number, callback?: () => void): this {
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
    if (callback) this.once('timeout', callback);
    if (msecs > 0) {
      this._timeoutTimer = setTimeout(() => {
        this._timeoutTimer = null;
        this.emit('timeout');
      }, msecs);
    }
    return this;
  }

  destroy(error?: Error): this {
    if (this._timeoutTimer) {
      clearTimeout(this._timeoutTimer);
      this._timeoutTimer = null;
    }
    this.aborted = true;
    return super.destroy(error) as this;
  }
}
