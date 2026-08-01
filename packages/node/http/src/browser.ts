// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by stream-http
// (John Hiesey, MIT).
//
// Reference: refs/stream-http/index.js, refs/stream-http/lib/request.js,
//            refs/stream-http/lib/response.js.
//
// This module is the `@gjsify/http` entry the bundler picks up when
// `gjsify build --app browser` resolves `http` / `node:http` /
// `@gjsify/http` (per `ALIASES_NODE_FOR_BROWSER` in
// `packages/infra/resolve-npm/lib/index.mjs`, PR #388). The full GJS impl
// (`./index.js`) drives libsoup and cannot run in a browser.
//
// Strategy: client paths (`request`, `get`) ride on top of the native browser
// `fetch()`. The request body is buffered into a `Blob` and posted; the response
// body is streamed through a Readable-shaped `IncomingMessage` that supports the
// surface Node consumers expect — flowing `'data'`/`'end'`, paused `read()` +
// `'readable'`, `pause()`/`resume()` backpressure, `setEncoding()` decoding,
// `pipe()`, and async iteration. Server paths (`createServer`, `Server`,
// `ServerResponse`) throw a structured ENOTSUP — a browser cannot listen on a
// socket and faking it would be dishonest. Slot: browser:"partial".

import { EventEmitter } from '@gjsify/events';

// ─── Constants ─────────────────────────────────────────────────────────────

export const METHODS = [
    'ACL',
    'BIND',
    'CHECKOUT',
    'CONNECT',
    'COPY',
    'DELETE',
    'GET',
    'HEAD',
    'LINK',
    'LOCK',
    'M-SEARCH',
    'MERGE',
    'MKACTIVITY',
    'MKCALENDAR',
    'MKCOL',
    'MOVE',
    'NOTIFY',
    'OPTIONS',
    'PATCH',
    'POST',
    'PROPFIND',
    'PROPPATCH',
    'PURGE',
    'PUT',
    'REBIND',
    'REPORT',
    'SEARCH',
    'SOURCE',
    'SUBSCRIBE',
    'TRACE',
    'UNBIND',
    'UNLINK',
    'UNLOCK',
    'UNSUBSCRIBE',
];

export const STATUS_CODES: Record<number, string> = {
    100: 'Continue',
    101: 'Switching Protocols',
    102: 'Processing',
    103: 'Early Hints',
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    203: 'Non-Authoritative Information',
    204: 'No Content',
    205: 'Reset Content',
    206: 'Partial Content',
    207: 'Multi-Status',
    208: 'Already Reported',
    226: 'IM Used',
    300: 'Multiple Choices',
    301: 'Moved Permanently',
    302: 'Found',
    303: 'See Other',
    304: 'Not Modified',
    305: 'Use Proxy',
    307: 'Temporary Redirect',
    308: 'Permanent Redirect',
    400: 'Bad Request',
    401: 'Unauthorized',
    402: 'Payment Required',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    407: 'Proxy Authentication Required',
    408: 'Request Timeout',
    409: 'Conflict',
    410: 'Gone',
    411: 'Length Required',
    412: 'Precondition Failed',
    413: 'Payload Too Large',
    414: 'URI Too Long',
    415: 'Unsupported Media Type',
    416: 'Range Not Satisfiable',
    417: 'Expectation Failed',
    418: "I'm a Teapot",
    421: 'Misdirected Request',
    422: 'Unprocessable Entity',
    423: 'Locked',
    424: 'Failed Dependency',
    425: 'Too Early',
    426: 'Upgrade Required',
    428: 'Precondition Required',
    429: 'Too Many Requests',
    431: 'Request Header Fields Too Large',
    451: 'Unavailable For Legal Reasons',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
    505: 'HTTP Version Not Supported',
    506: 'Variant Also Negotiates',
    507: 'Insufficient Storage',
    508: 'Loop Detected',
    509: 'Bandwidth Limit Exceeded',
    510: 'Not Extended',
    511: 'Network Authentication Required',
};

export const maxHeaderSize = 16384;

// ─── Agent stub ────────────────────────────────────────────────────────────

export class Agent extends EventEmitter {
    maxSockets = Infinity;
    maxFreeSockets = 256;
    maxTotalSockets = Infinity;
    sockets: Record<string, unknown[]> = {};
    freeSockets: Record<string, unknown[]> = {};
    requests: Record<string, unknown[]> = {};
    destroy(): void {}
}

export const globalAgent = new Agent();

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RequestOptions {
    protocol?: string;
    host?: string;
    hostname?: string;
    family?: number;
    port?: number | string;
    defaultPort?: number | string;
    localAddress?: string;
    socketPath?: string;
    method?: string;
    path?: string;
    headers?: Record<string, string | string[]>;
    auth?: string;
    agent?: Agent | boolean;
    timeout?: number;
    signal?: AbortSignal;
    setHost?: boolean;
}

function urlToOptions(url: URL): RequestOptions {
    return {
        protocol: url.protocol,
        hostname: url.hostname,
        host: url.host,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        auth: url.username || url.password ? `${url.username}:${url.password}` : undefined,
    };
}

function buildUrl(opts: RequestOptions): string {
    const protocol = opts.protocol || 'http:';
    const host = opts.hostname || opts.host || 'localhost';
    const port = opts.port ? `:${opts.port}` : '';
    const path = opts.path || '/';
    return `${protocol}//${host}${port}${path}`;
}

// ─── IncomingMessage (browser response wrapper) ───────────────────────────

// A minimal Readable-stream shape over the fetch Response body. Self-contained
// (no `@gjsify/stream` dependency) so it stays bundle-light, but implements the
// surface Node consumers rely on: flowing-mode `'data'`/`'end'` events,
// paused-mode `read()` + `'readable'`, backpressure via `pause()`/`resume()`,
// `setEncoding()` decoding, `pipe()`, and async iteration. The `ClientRequest`
// flush loop drives it through `_push()` / `_push(null)`.
export class IncomingMessage extends EventEmitter {
    statusCode: number;
    statusMessage: string;
    httpVersion = '1.1';
    httpVersionMajor = 1;
    httpVersionMinor = 1;
    headers: Record<string, string> = {};
    rawHeaders: string[] = [];
    trailers: Record<string, string> = {};
    rawTrailers: string[] = [];
    url = '';
    method?: string;
    readable = true;
    destroyed = false;
    complete = false;
    aborted = false;

    private _buffer: (Uint8Array | string)[] = [];
    private _flowing: boolean | null = null;
    private _paused = false;
    private _ended = false;
    private _decoder: TextDecoder | null = null;

    constructor(response: Response) {
        super();
        this.statusCode = response.status;
        this.statusMessage = response.statusText;
        response.headers.forEach((v, k) => {
            this.headers[k.toLowerCase()] = v;
            this.rawHeaders.push(k, v);
        });
    }

    // ── stream ingestion (driven by ClientRequest._flush) ──
    /** Feed one body chunk, or `null` to signal end-of-stream. */
    _push(chunk: Uint8Array | null): void {
        if (chunk === null) {
            // Flush any partial multibyte char held by the streaming decoder.
            if (this._decoder) {
                const tail = this._decoder.decode();
                if (tail) this._emitChunk(tail);
            }
            this._ended = true;
            this._maybeEnd();
            return;
        }
        this._emitChunk(this._decoder ? this._decoder.decode(chunk, { stream: true }) : chunk);
    }

    private _emitChunk(out: Uint8Array | string): void {
        if (this._flowing) {
            this.emit('data', out);
        } else {
            this._buffer.push(out);
            this.emit('readable');
        }
    }

    private _maybeEnd(): void {
        if (this._ended && this._buffer.length === 0 && !this.complete) {
            this.complete = true;
            this.readable = false;
            this.emit('end');
        }
    }

    private _drain(): void {
        while (this._flowing && !this._paused && this._buffer.length > 0) {
            this.emit('data', this._buffer.shift());
        }
        this._maybeEnd();
    }

    // ── public Readable surface ──
    setEncoding(enc: string): this {
        this._decoder = new TextDecoder(enc === 'binary' ? 'latin1' : enc);
        return this;
    }

    read(): Uint8Array | string | null {
        if (this._buffer.length === 0) return null;
        const chunk = this._buffer.shift() as Uint8Array | string;
        // A paused reader that drains LATER (the usual shape: `'readable'` →
        // read on a later turn) must still get `'end'`. `_push(null)` can only
        // emit it while the buffer is already empty, so re-check here once this
        // read empties it. Deferred to a microtask so `'end'` never fires
        // synchronously from inside the consumer's own `read()` call.
        if (this._buffer.length === 0) queueMicrotask(() => this._maybeEnd());
        return chunk;
    }

    pause(): this {
        this._paused = true;
        this._flowing = false;
        this.emit('pause');
        return this;
    }

    resume(): this {
        this._paused = false;
        this._flowing = true;
        queueMicrotask(() => this._drain());
        this.emit('resume');
        return this;
    }

    pipe<T extends { write(c: unknown): unknown; end(): unknown }>(dest: T): T {
        this.on('data', (chunk: unknown) => dest.write(chunk));
        this.on('end', () => dest.end());
        this.resume();
        return dest;
    }

    override on(event: string, listener: (...args: unknown[]) => void): this {
        super.on(event, listener);
        if (event === 'data' && this._flowing === null) {
            this._flowing = true;
            queueMicrotask(() => this._drain());
        }
        return this;
    }

    destroy(err?: Error): this {
        if (this.destroyed) return this;
        this.destroyed = true;
        this.readable = false;
        this.aborted = true;
        queueMicrotask(() => {
            if (err) this.emit('error', err);
            this.emit('close');
        });
        return this;
    }

    async *[Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array | string> {
        const queue: (Uint8Array | string)[] = [];
        let done = false;
        let err: Error | null = null;
        let wake: (() => void) | null = null;
        const onData = (c: Uint8Array | string): void => {
            queue.push(c);
            wake?.();
        };
        const onEnd = (): void => {
            done = true;
            wake?.();
        };
        const onError = (e: Error): void => {
            err = e;
            wake?.();
        };
        this.on('data', onData as (...a: unknown[]) => void);
        this.once('end', onEnd);
        this.once('error', onError as (...a: unknown[]) => void);
        try {
            while (true) {
                if (err) throw err;
                if (queue.length > 0) {
                    yield queue.shift() as Uint8Array | string;
                    continue;
                }
                if (done) return;
                await new Promise<void>((res) => {
                    wake = res;
                });
            }
        } finally {
            this.removeListener('data', onData as (...a: unknown[]) => void);
            this.removeListener('end', onEnd);
            this.removeListener('error', onError as (...a: unknown[]) => void);
        }
    }
}

// ─── ClientRequest ────────────────────────────────────────────────────────

export class ClientRequest extends EventEmitter {
    method: string;
    path: string;
    private _url: string;
    private _headers: Record<string, string | string[]>;
    private _bodyChunks: Uint8Array[] = [];
    private _started = false;
    private _ended = false;
    private _aborted = false;
    private _signal?: AbortSignal;
    private _abortCtrl = new AbortController();
    private _responseCb?: (res: IncomingMessage) => void;
    socket = null;
    connection = null;
    writable = true;
    destroyed = false;
    aborted = false;

    constructor(options: RequestOptions, callback?: (res: IncomingMessage) => void) {
        super();
        this.method = (options.method || 'GET').toUpperCase();
        this.path = options.path || '/';
        this._url = buildUrl(options);
        this._headers = options.headers ? { ...options.headers } : {};
        this._signal = options.signal;
        if (callback) {
            this._responseCb = callback;
            this.once('response', callback);
        }
        if (this._signal) {
            const onAbort = (): void => this.abort();
            if (this._signal.aborted) queueMicrotask(onAbort);
            else this._signal.addEventListener('abort', onAbort, { once: true });
        }
    }

    setHeader(name: string, value: string | string[]): this {
        this._headers[name] = value;
        return this;
    }
    getHeader(name: string): string | string[] | undefined {
        return this._headers[name];
    }
    removeHeader(name: string): void {
        delete this._headers[name];
    }

    write(chunk: string | Uint8Array, encOrCb?: string | (() => void), cb?: () => void): boolean {
        if (this._ended) return false;
        const callback = typeof encOrCb === 'function' ? encOrCb : cb;
        const data = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
        this._bodyChunks.push(data);
        if (callback) queueMicrotask(callback);
        return true;
    }

    end(chunk?: string | Uint8Array, encOrCb?: string | (() => void), cb?: () => void): this {
        if (this._ended) return this;
        if (chunk) this.write(chunk, typeof encOrCb === 'string' ? encOrCb : undefined);
        const callback = typeof encOrCb === 'function' ? encOrCb : cb;
        this._ended = true;
        queueMicrotask(() => this._flush(callback));
        return this;
    }

    abort(): void {
        if (this._aborted) return;
        this._aborted = true;
        this.aborted = true;
        this.writable = false;
        this._abortCtrl.abort();
        queueMicrotask(() => {
            this.emit('abort');
            this.emit('close');
        });
    }

    destroy(err?: Error): this {
        if (this.destroyed) return this;
        this.destroyed = true;
        this._abortCtrl.abort();
        if (err) queueMicrotask(() => this.emit('error', err));
        return this;
    }

    setTimeout(msec: number, cb?: () => void): this {
        if (cb) this.once('timeout', cb);
        setTimeout(() => this.emit('timeout'), msec);
        return this;
    }
    setNoDelay(_noDelay?: boolean): void {}
    setSocketKeepAlive(_enable?: boolean, _delay?: number): void {}
    flushHeaders(): void {}

    private async _flush(cb?: () => void): Promise<void> {
        if (this._started) return;
        this._started = true;
        const hasBody = this._bodyChunks.length > 0;
        const body = hasBody ? new Blob(this._bodyChunks as BlobPart[]) : undefined;
        try {
            const response = await fetch(this._url, {
                method: this.method,
                headers: this._normalizeHeaders(),
                body: body as BodyInit | undefined,
                signal: this._abortCtrl.signal,
                credentials: 'same-origin',
            });
            const incoming = new IncomingMessage(response);
            incoming.method = this.method;
            incoming.url = this.path;
            this.emit('response', incoming);
            if (cb) queueMicrotask(cb);
            const reader = response.body?.getReader();
            if (!reader) {
                queueMicrotask(() => incoming._push(null));
                return;
            }
            const pump = async (): Promise<void> => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        incoming._push(value);
                    }
                    incoming._push(null);
                } catch (err) {
                    incoming.emit('error', err);
                }
            };
            pump();
        } catch (err) {
            if (this._aborted) return;
            queueMicrotask(() => this.emit('error', err));
        }
    }

    private _normalizeHeaders(): Record<string, string> {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(this._headers)) {
            out[k] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        return out;
    }
}

// ─── Public client helpers ────────────────────────────────────────────────

export function request(
    urlOrOptions: string | URL | RequestOptions,
    optsOrCb?: RequestOptions | ((res: IncomingMessage) => void),
    maybeCb?: (res: IncomingMessage) => void,
): ClientRequest {
    let opts: RequestOptions;
    let cb: ((res: IncomingMessage) => void) | undefined;
    if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
        const url = typeof urlOrOptions === 'string' ? new URL(urlOrOptions) : urlOrOptions;
        opts = { ...urlToOptions(url), ...(typeof optsOrCb === 'object' ? optsOrCb : {}) };
        cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
    } else {
        opts = urlOrOptions;
        cb = typeof optsOrCb === 'function' ? optsOrCb : undefined;
    }
    return new ClientRequest(opts, cb);
}

export function get(
    urlOrOptions: string | URL | RequestOptions,
    optsOrCb?: RequestOptions | ((res: IncomingMessage) => void),
    maybeCb?: (res: IncomingMessage) => void,
): ClientRequest {
    const req = request(urlOrOptions, optsOrCb, maybeCb);
    req.end();
    return req;
}

// ─── Server paths — ENOTSUP in the browser ────────────────────────────────
//
// A browser cannot bind a TCP listening socket, so there is no honest way to
// implement an HTTP server. These throw a structured `ENOTSUP` rather than
// pretending to work — faking it would hide the real platform limit.

function notSupported(syscall: string): never {
    const err = new Error(`http.${syscall} is not supported in the browser`) as Error & {
        code: string;
        errno: number;
        syscall: string;
    };
    err.code = 'ENOTSUP';
    err.errno = -45;
    err.syscall = syscall;
    throw err;
}

export class Server extends EventEmitter {
    constructor() {
        super();
        notSupported('Server');
    }
}

export class ServerResponse extends EventEmitter {
    constructor() {
        super();
        notSupported('ServerResponse');
    }
}

export class OutgoingMessage extends EventEmitter {
    constructor() {
        super();
        notSupported('OutgoingMessage');
    }
}

/** Throws structured `ENOTSUP` — a browser cannot listen on a TCP socket. */
export function createServer(..._args: unknown[]): Server {
    return notSupported('createServer');
}

// Real validation, not no-ops. `validators.ts` is deliberately bridge-free
// (pure regex over strings, no platform imports — see its header), so the
// browser entry can and should use the SAME implementation as the root entry.
// Empty bodies here meant a browser build silently accepted header names and
// values that Node rejects with `ERR_INVALID_HTTP_TOKEN` /
// `ERR_HTTP_INVALID_HEADER_VALUE` — a divergence that surfaces as a wire-level
// bug on the server side, far from its cause.
// Imported (not just re-exported) so the `httpDefault` object below can
// reference them — a bare `export … from` never binds names locally.
import { validateHeaderName, validateHeaderValue } from './validators.js';

export { validateHeaderName, validateHeaderValue };

export function setMaxIdleHTTPParsers(_max: number): void {}

const httpDefault = {
    METHODS,
    STATUS_CODES,
    maxHeaderSize,
    Agent,
    globalAgent,
    IncomingMessage,
    ClientRequest,
    Server,
    ServerResponse,
    OutgoingMessage,
    createServer,
    request,
    get,
    validateHeaderName,
    validateHeaderValue,
    setMaxIdleHTTPParsers,
};

export default httpDefault;
