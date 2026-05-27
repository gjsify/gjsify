// Http2ServerRequest — Readable side of an HTTP/2 server message.
// Reference: Node.js lib/internal/http2/compat.js (Http2ServerRequest).

import { Readable } from 'node:stream';
import { Buffer } from 'node:buffer';
import type { ServerHttp2Stream } from './response.js';

export class Http2ServerRequest extends Readable {
    method = 'GET';
    url = '/';
    headers: Record<string, string | string[]> = {};
    rawHeaders: string[] = [];
    authority = '';
    scheme = 'https';
    httpVersion = '2.0';
    httpVersionMajor = 2;
    httpVersionMinor = 0;
    complete = false;
    socket: any = null;
    trailers: Record<string, string> = {};
    rawTrailers: string[] = [];

    private _stream: ServerHttp2Stream | null = null;
    private _timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    get stream(): ServerHttp2Stream | null {
        return this._stream;
    }

    // Called by Http2Server after stream is created
    _setStream(stream: ServerHttp2Stream): void {
        this._stream = stream;
    }

    constructor() {
        super();
    }

    _read(_size: number): void {}

    // 'close' means connection lost, not body-stream end
    protected _autoClose(): void {}

    _pushBody(body: Uint8Array | null): void {
        if (body && body.length > 0) {
            this.push(Buffer.from(body));
        }
        this.push(null);
        this.complete = true;
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
        return super.destroy(error) as this;
    }
}
