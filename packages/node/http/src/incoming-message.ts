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

  constructor() {
    super();
  }

  _read(_size: number): void {
    // Data is pushed externally via _pushBody or _pushStream
  }

  /** Finish the readable stream with the body data (used by server-side handler). */
  _pushBody(body: Uint8Array | null): void {
    if (body && body.length > 0) {
      this.push(Buffer.from(body));
    }
    this.push(null);
    this.complete = true;
  }

  setTimeout(msecs: number, callback?: () => void): this {
    if (callback) this.once('timeout', callback);
    return this;
  }

  destroy(error?: Error): this {
    this.aborted = true;
    return super.destroy(error) as this;
  }
}
