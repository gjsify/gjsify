// ClientRequest — Writable stream for outgoing HTTP requests via Soup.Session.
// Reference: Node.js lib/_http_client.js, lib/_http_outgoing.js

import GLib from '@girs/glib-2.0';
import Soup from '@girs/soup-3.0';
import Gio from '@girs/gio-2.0';
import { Writable } from 'stream';
import { Buffer } from 'buffer';
import { URL } from 'url';
import { IncomingMessage } from './incoming-message.js';

/** Read bytes from a Gio.InputStream asynchronously. */
function readBytesAsync(
  inputStream: Gio.InputStream,
  count = 4096,
  ioPriority = GLib.PRIORITY_DEFAULT,
  cancellable: Gio.Cancellable | null = null
): Promise<Uint8Array | null> {
  return new Promise<Uint8Array | null>((resolve, reject) => {
    inputStream.read_bytes_async(count, ioPriority, cancellable, (_self: any, asyncRes: Gio.AsyncResult) => {
      try {
        const bytes = inputStream.read_bytes_finish(asyncRes);
        if (bytes.get_size() === 0) {
          return resolve(null);
        }
        resolve(bytes.toArray());
      } catch (error) {
        reject(error);
      }
    });
  });
}

export interface ClientRequestOptions {
  protocol?: string;
  hostname?: string;
  host?: string;
  port?: number | string;
  path?: string;
  method?: string;
  headers?: Record<string, string | number | string[]>;
  timeout?: number;
  agent?: any;
  setHost?: boolean;
}

/**
 * ClientRequest — Writable stream representing an outgoing HTTP request.
 *
 * Usage:
 *   const req = http.request(options, (res) => { ... });
 *   req.write(body);
 *   req.end();
 */
export class ClientRequest extends Writable {
  method: string;
  path: string;
  protocol: string;
  host: string;
  hostname: string;
  port: number;
  aborted = false;
  finished = false;
  headersSent = false;
  socket: any = null;
  reusedSocket = false;
  maxHeadersCount = 2000;

  private _headers: Map<string, string | string[]> = new Map();
  private _chunks: Buffer[] = [];
  private _session: Soup.Session;
  private _message: Soup.Message;
  private _cancellable: Gio.Cancellable;
  private _timeout = 0;
  private _responseCallback?: (res: IncomingMessage) => void;

  constructor(url: string | URL | ClientRequestOptions, options?: ClientRequestOptions | ((res: IncomingMessage) => void), callback?: (res: IncomingMessage) => void) {
    super();

    // Parse arguments: request(url, options, cb) or request(options, cb)
    let opts: ClientRequestOptions;

    if (typeof url === 'string' || url instanceof URL) {
      const parsed = typeof url === 'string' ? new URL(url) : url;
      opts = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : undefined,
        path: parsed.pathname + parsed.search,
        ...(typeof options === 'object' ? options : {}),
      };
      if (typeof options === 'function') {
        callback = options;
      }
    } else {
      opts = url;
      if (typeof options === 'function') {
        callback = options;
      }
    }

    this.method = (opts.method || 'GET').toUpperCase();
    this.protocol = opts.protocol || 'http:';
    this.hostname = opts.hostname || opts.host?.split(':')[0] || 'localhost';
    this.port = Number(opts.port) || (this.protocol === 'https:' ? 443 : 80);
    this.path = opts.path || '/';
    this.host = opts.host || `${this.hostname}:${this.port}`;
    this._timeout = opts.timeout || 0;

    if (callback) {
      this._responseCallback = callback;
      this.once('response', callback);
    }

    // Set default headers
    if (opts.headers) {
      for (const [key, value] of Object.entries(opts.headers)) {
        this.setHeader(key, value);
      }
    }

    if (opts.setHost !== false && !this._headers.has('host')) {
      const defaultPort = this.protocol === 'https:' ? 443 : 80;
      const hostHeader = this.port === defaultPort ? this.hostname : `${this.hostname}:${this.port}`;
      this.setHeader('Host', hostHeader);
    }

    // Create Soup objects
    const uri = GLib.Uri.parse(this._buildUrl(), GLib.UriFlags.NONE);
    this._session = new Soup.Session();
    this._message = new Soup.Message({ method: this.method, uri });
    this._cancellable = new Gio.Cancellable();

    if (this._timeout > 0) {
      this._session.timeout = Math.ceil(this._timeout / 1000);
    }
  }

  private _buildUrl(): string {
    const proto = this.protocol.endsWith(':') ? this.protocol : this.protocol + ':';
    const defaultPort = proto === 'https:' ? 443 : 80;
    const portStr = this.port === defaultPort ? '' : `:${this.port}`;
    return `${proto}//${this.hostname}${portStr}${this.path}`;
  }

  /** Set a request header. */
  setHeader(name: string, value: string | number | string[]): this {
    this._headers.set(name.toLowerCase(), typeof value === 'number' ? String(value) : value);
    return this;
  }

  /** Get a request header. */
  getHeader(name: string): string | string[] | undefined {
    return this._headers.get(name.toLowerCase());
  }

  /** Remove a request header. */
  removeHeader(name: string): void {
    this._headers.delete(name.toLowerCase());
  }

  /** Check if a header has been set. */
  hasHeader(name: string): boolean {
    return this._headers.has(name.toLowerCase());
  }

  /** Get all header names. */
  getHeaderNames(): string[] {
    return Array.from(this._headers.keys());
  }

  /** Get raw header names and values as a flat array. */
  getRawHeaderNames(): string[] {
    return Array.from(this._headers.keys());
  }

  /** Flush headers — marks headers as sent. */
  flushHeaders(): void {
    if (!this.headersSent) {
      this._applyHeaders();
    }
  }

  /** Set timeout for the request. */
  setTimeout(msecs: number, callback?: () => void): this {
    this._timeout = msecs;
    if (callback) this.once('timeout', callback);
    if (msecs > 0) {
      this._session.timeout = Math.ceil(msecs / 1000);
    }
    return this;
  }

  /** Abort the request. */
  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    this._cancellable.cancel();
    this.emit('abort');
    this.destroy();
  }

  /** Writable stream _write implementation — collect body chunks. */
  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding as BufferEncoding);
    this._chunks.push(buf);
    callback();
  }

  /** Called when the writable stream ends — send the request. */
  _final(callback: (error?: Error | null) => void): void {
    this._sendRequest()
      .then(() => callback())
      .catch((err) => callback(err));
  }

  private _applyHeaders(): void {
    if (this.headersSent) return;
    this.headersSent = true;

    const requestHeaders = this._message.get_request_headers();
    for (const [key, value] of this._headers) {
      if (Array.isArray(value)) {
        for (const v of value) {
          requestHeaders.append(key, v);
        }
      } else {
        requestHeaders.replace(key, value as string);
      }
    }
  }

  private async _sendRequest(): Promise<void> {
    this._applyHeaders();

    // Set request body if we have data
    const body = Buffer.concat(this._chunks);
    if (body.length > 0) {
      const contentType = (this._headers.get('content-type') as string) || 'application/octet-stream';
      this._message.set_request_body_from_bytes(contentType, new GLib.Bytes(body));
    }

    try {
      // Send request asynchronously
      const inputStream = await new Promise<Gio.InputStream>((resolve, reject) => {
        this._session.send_async(this._message, GLib.PRIORITY_DEFAULT, this._cancellable, (_self: any, asyncRes: Gio.AsyncResult) => {
          try {
            const stream = this._session.send_finish(asyncRes);
            resolve(stream);
          } catch (error) {
            reject(error);
          }
        });
      });

      // Build IncomingMessage from the response
      const res = new IncomingMessage();
      res.statusCode = this._message.status_code;
      res.statusMessage = this._message.get_reason_phrase();
      res.httpVersion = '1.1';

      // Parse response headers
      const responseHeaders = this._message.get_response_headers();
      responseHeaders.foreach((name: string, value: string) => {
        const lower = name.toLowerCase();
        res.rawHeaders.push(name, value);
        if (lower in res.headers) {
          const existing = res.headers[lower];
          if (Array.isArray(existing)) {
            existing.push(value);
          } else {
            res.headers[lower] = [existing as string, value];
          }
        } else {
          res.headers[lower] = value;
        }
      });

      // Stream the response body from Gio.InputStream into IncomingMessage
      this._streamResponseBody(inputStream, res);

      this.finished = true;
      this.emit('response', res);
    } catch (error: any) {
      if (this.aborted) {
        this.emit('abort');
      } else {
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private async _streamResponseBody(inputStream: Gio.InputStream, res: IncomingMessage): Promise<void> {
    try {
      let chunk: Uint8Array | null;
      while ((chunk = await readBytesAsync(inputStream, 4096, GLib.PRIORITY_DEFAULT, this._cancellable)) !== null) {
        res.push(Buffer.from(chunk));
      }
      res.push(null);
      res.complete = true;
    } catch (error) {
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
