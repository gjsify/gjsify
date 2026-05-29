// Write + chunked-output + end-semantics methods for Http2ServerResponse.
// Same `install*Methods(proto)` shape as the sibling `headers.ts` split —
// typed `*Methods` interface declaration-merged into
// `Http2ServerResponse` via `declare module '../response.js'` plus an
// `installStreamIoMethods(proto)` function that copies the
// implementations onto the prototype.
//
// Covers Node's `Writable._write` / `_final`, the streaming/batch send
// path that talks to the native dispatcher or Soup, and the public
// `end()` overload.
// Reference: refs/node/lib/internal/http2/compat.js (Http2ServerResponse
// _writev/_writeRaw/onStreamData).
// Original: see server/response.ts pre-split.

import Soup from '@girs/soup-3.0';
import { Buffer } from 'node:buffer';
import { Writable } from 'node:stream';
import type { Http2ServerResponse } from '../response.js';

/**
 * Internal streaming helpers (no Writable counterpart). Declaration-merged
 * onto `Http2ServerResponse` so sibling methods can call them as `this.*`
 * without type-checker complaints.
 *
 * We deliberately exclude the Writable lifecycle hooks (`_write` / `_final`)
 * and the public `end()` override from the merge — their signatures already
 * exist on the base class via `extends Writable`, and re-declaring them
 * would collide with the inherited `Writable._write(chunk: any, ...)`
 * overload. Those still get attached to the runtime prototype below;
 * `Object.assign` doesn't care about the type-level merge.
 */
export interface StreamIoMethods {
    _startStreaming(): void;
    _sendBatchResponse(): void;
}

declare module '../response.js' {
    interface Http2ServerResponse extends StreamIoMethods {}
}

type AllStreamIoMethods = StreamIoMethods & {
    _write(
        this: Http2ServerResponse,
        chunk: string | Buffer | Uint8Array,
        encoding: string,
        callback: (error?: Error | null) => void,
    ): void;
    _final(this: Http2ServerResponse, callback: (error?: Error | null) => void): void;
    end(
        this: Http2ServerResponse,
        chunk?: unknown,
        encoding?: BufferEncoding | (() => void),
        callback?: () => void,
    ): Http2ServerResponse;
};

const streamIoMethods: AllStreamIoMethods & ThisType<Http2ServerResponse> = {
    _startStreaming(this: Http2ServerResponse): void {
        if (this._streaming) return;
        this._streaming = true;
        this.headersSent = true;

        if (this._timeoutTimer) {
            clearTimeout(this._timeoutTimer);
            this._timeoutTimer = null;
        }

        if (this._nativeBackend) {
            // Native dispatcher: submit response headers; END_STREAM goes with the
            // first DATA frame in _write or _final.
            this._nativeBackend.submitResponse(this.statusCode, this.statusMessage, this._headers, false);
            return;
        }

        if (!this._soupMsg) return; // detached push response — no Soup wire

        this._soupMsg.set_status(this.statusCode, this.statusMessage || null);
        const responseHeaders = this._soupMsg.get_response_headers();

        if (this._headers.has('content-length')) {
            responseHeaders.set_encoding(Soup.Encoding.CONTENT_LENGTH);
        } else {
            responseHeaders.set_encoding(Soup.Encoding.CHUNKED);
        }

        for (const [key, value] of this._headers) {
            if (Array.isArray(value)) {
                for (const v of value) responseHeaders.append(key, v);
            } else {
                responseHeaders.replace(key, value as string);
            }
        }
    },

    _write(
        this: Http2ServerResponse,
        chunk: string | Buffer | Uint8Array,
        encoding: string,
        callback: (error?: Error | null) => void,
    ): void {
        const buf = Buffer.isBuffer(chunk)
            ? chunk
            : typeof chunk === 'string'
              ? Buffer.from(chunk, encoding as BufferEncoding)
              : Buffer.from(chunk);
        this._startStreaming();
        if (this._nativeBackend) {
            this._nativeBackend.submitData(buf, false);
        } else if (this._soupMsg) {
            const responseBody = this._soupMsg.get_response_body();
            responseBody.append(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
            this._soupMsg.unpause();
        } else if (this._detachedBody) {
            this._detachedBody.push(buf);
        }
        callback();
    },

    _final(this: Http2ServerResponse, callback: (error?: Error | null) => void): void {
        if (this._streaming) {
            if (this._nativeBackend) {
                this._nativeBackend.submitData(Buffer.alloc(0), true);
            } else if (this._soupMsg) {
                const responseBody = this._soupMsg.get_response_body();
                responseBody.complete();
                this._soupMsg.unpause();
            }
        } else {
            this._sendBatchResponse();
        }
        this.finished = true;
        callback();
    },

    _sendBatchResponse(this: Http2ServerResponse): void {
        if (this.headersSent) return;
        this.headersSent = true;

        if (this._timeoutTimer) {
            clearTimeout(this._timeoutTimer);
            this._timeoutTimer = null;
        }

        if (this._nativeBackend) {
            // No body — submit headers with END_STREAM.
            this._nativeBackend.submitResponse(this.statusCode, this.statusMessage, this._headers, true);
            return;
        }

        if (!this._soupMsg) return;

        this._soupMsg.set_status(this.statusCode, this.statusMessage || null);
        const responseHeaders = this._soupMsg.get_response_headers();

        for (const [key, value] of this._headers) {
            if (Array.isArray(value)) {
                for (const v of value) responseHeaders.append(key, v);
            } else {
                responseHeaders.replace(key, value as string);
            }
        }

        const contentType = (this._headers.get('content-type') as string) || 'text/plain';
        this._soupMsg.set_response(contentType, Soup.MemoryUse.COPY, new Uint8Array(0));
    },

    end(
        this: Http2ServerResponse,
        chunk?: unknown,
        encoding?: BufferEncoding | (() => void),
        callback?: () => void,
    ): Http2ServerResponse {
        if (typeof chunk === 'function') {
            callback = chunk as () => void;
            chunk = undefined;
        } else if (typeof encoding === 'function') {
            callback = encoding;
            encoding = undefined;
        }
        if (chunk != null) {
            this.write(chunk as string | Buffer, encoding as BufferEncoding);
        }
        // Equivalent to `super.end(callback)` from the original class body;
        // resolved against Writable.prototype since this method is now
        // installed onto Http2ServerResponse.prototype directly (no `super`).
        Writable.prototype.end.call(this, callback);
        return this;
    },
};

/** Install write + chunked-output + end-semantics methods on Http2ServerResponse.prototype. */
export function installStreamIoMethods(proto: object): void {
    Object.assign(proto, streamIoMethods);
}
