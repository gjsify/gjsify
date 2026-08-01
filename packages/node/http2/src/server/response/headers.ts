// Header-management methods for Http2ServerResponse. Same
// `install*Methods(proto)` shape as the webgl2-rendering-context split —
// typed `*Methods` interface declaration-merged into
// `Http2ServerResponse` via `declare module '../response.js'` plus an
// `installHeaderMethods(proto)` function that copies the
// implementations onto the prototype.
//
// Covers the OutgoingMessage-style header API plus the http2 session
// `respond()` alias and the early-hints / continue / timeout knobs.
// Reference: refs/node/lib/internal/http2/compat.js (Http2ServerResponse).
// Original: see server/response.ts pre-split.

import type { Http2ServerResponse } from '../response.js';

export interface HeaderMethods {
    setHeader(name: string, value: string | number | string[]): Http2ServerResponse;
    getHeader(name: string): string | string[] | undefined;
    removeHeader(name: string): void;
    hasHeader(name: string): boolean;
    getHeaderNames(): string[];
    getHeaders(): Record<string, string | string[]>;
    appendHeader(name: string, value: string | string[]): Http2ServerResponse;
    flushHeaders(): void;
    writeHead(
        statusCode: number,
        statusMessage?: string | Record<string, string | string[]>,
        headers?: Record<string, string | string[]>,
    ): Http2ServerResponse;
    respond(headers: Record<string, string | string[] | number>, options?: { endStream?: boolean }): void;
    writeContinue(callback?: () => void): void;
    writeEarlyHints(hints: Record<string, string | string[]>, callback?: () => void): void;
    addTrailers(headers: Record<string, string>): void;
    setTimeout(msecs: number, callback?: () => void): Http2ServerResponse;
}

declare module '../response.js' {
    interface Http2ServerResponse extends HeaderMethods {}
}

const headerMethods: HeaderMethods & ThisType<Http2ServerResponse> = {
    setHeader(this: Http2ServerResponse, name: string, value: string | number | string[]): Http2ServerResponse {
        this._headers.set(name.toLowerCase(), typeof value === 'number' ? String(value) : value);
        return this;
    },

    getHeader(this: Http2ServerResponse, name: string): string | string[] | undefined {
        return this._headers.get(name.toLowerCase());
    },

    removeHeader(this: Http2ServerResponse, name: string): void {
        this._headers.delete(name.toLowerCase());
    },

    hasHeader(this: Http2ServerResponse, name: string): boolean {
        return this._headers.has(name.toLowerCase());
    },

    getHeaderNames(this: Http2ServerResponse): string[] {
        return Array.from(this._headers.keys());
    },

    getHeaders(this: Http2ServerResponse): Record<string, string | string[]> {
        const result: Record<string, string | string[]> = {};
        for (const [key, value] of this._headers) {
            result[key] = value;
        }
        return result;
    },

    appendHeader(this: Http2ServerResponse, name: string, value: string | string[]): Http2ServerResponse {
        const lower = name.toLowerCase();
        const existing = this._headers.get(lower);
        if (existing === undefined) {
            this._headers.set(lower, value);
        } else if (Array.isArray(existing)) {
            if (Array.isArray(value)) existing.push(...value);
            else existing.push(value);
        } else {
            this._headers.set(
                lower,
                Array.isArray(value) ? [existing as string, ...value] : [existing as string, value],
            );
        }
        return this;
    },

    flushHeaders(this: Http2ServerResponse): void {
        if (!this.headersSent) this.headersSent = true;
    },

    writeHead(
        this: Http2ServerResponse,
        statusCode: number,
        statusMessage?: string | Record<string, string | string[]>,
        headers?: Record<string, string | string[]>,
    ): Http2ServerResponse {
        this.statusCode = statusCode;
        if (typeof statusMessage === 'object') {
            headers = statusMessage;
            statusMessage = undefined;
        }
        if (typeof statusMessage === 'string') this.statusMessage = statusMessage;
        if (headers) {
            for (const [key, value] of Object.entries(headers)) {
                this.setHeader(key, value);
            }
        }
        return this;
    },

    // http2 session-API alias — extracts :status from headers map
    respond(
        this: Http2ServerResponse,
        headers: Record<string, string | string[] | number>,
        options?: { endStream?: boolean },
    ): void {
        const status = Number(headers[':status'] ?? 200);
        const rest: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(headers)) {
            if (k === ':status') continue;
            rest[k] = typeof v === 'number' ? String(v) : v;
        }
        this.writeHead(status, rest);
        if (options?.endStream) this.end();
    },

    writeContinue(this: Http2ServerResponse, callback?: () => void): void {
        if (callback) Promise.resolve().then(callback);
    },

    writeEarlyHints(this: Http2ServerResponse, _hints: Record<string, string | string[]>, callback?: () => void): void {
        if (callback) Promise.resolve().then(callback);
    },

    addTrailers(this: Http2ServerResponse, _headers: Record<string, string>): void {},

    setTimeout(this: Http2ServerResponse, msecs: number, callback?: () => void): Http2ServerResponse {
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
    },
};

/** Install header-management methods on Http2ServerResponse.prototype. */
export function installHeaderMethods(proto: object): void {
    Object.assign(proto, headerMethods);
}
