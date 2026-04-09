// XMLHttpRequest and URL.createObjectURL/revokeObjectURL for GJS
// Backed by @gjsify/fetch (Soup 3.0) for HTTP and GLib for file:// + temp files.
// Reference: https://xhr.spec.whatwg.org/

import GLib from 'gi://GLib?version=2.0';
import System from 'system';

let _blobCounter = 0;

// ---------------------------------------------------------------------------
// FakeBlob — carries raw bytes + temp file path for the createObjectURL cycle
// ---------------------------------------------------------------------------

export class FakeBlob {
    _tmpPath?: string;
    readonly type: string;
    readonly size: number;

    constructor(type: string, size: number) {
        this.type = type;
        this.size = size;
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
        if (this._tmpPath) {
            const [ok, contents] = GLib.file_get_contents(this._tmpPath);
            if (ok) return (contents as Uint8Array).buffer as ArrayBuffer;
        }
        return new ArrayBuffer(0);
    }

    async text(): Promise<string> {
        return new TextDecoder().decode(await this.arrayBuffer());
    }

    stream(): ReadableStream<Uint8Array> {
        const self = this;
        return new ReadableStream({
            async start(controller) {
                const buf = await self.arrayBuffer();
                controller.enqueue(new Uint8Array(buf));
                controller.close();
            },
        });
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function guessExt(url: string): string {
    const lower = url.toLowerCase();
    if (lower.endsWith('.png'))  return '.png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return '.jpg';
    if (lower.endsWith('.gif'))  return '.gif';
    if (lower.endsWith('.svg'))  return '.svg';
    if (lower.endsWith('.ttf'))  return '.ttf';
    if (lower.endsWith('.otf'))  return '.otf';
    if (lower.endsWith('.woff')) return '.woff';
    if (lower.endsWith('.woff2')) return '.woff2';
    if (lower.endsWith('.mp3'))  return '.mp3';
    if (lower.endsWith('.wav'))  return '.wav';
    if (lower.endsWith('.ogg'))  return '.ogg';
    if (lower.endsWith('.tmx') || lower.endsWith('.xml')) return '.xml';
    if (lower.endsWith('.json')) return '.json';
    return '.bin';
}

function guessMime(url: string): string {
    const lower = url.toLowerCase();
    if (lower.endsWith('.png'))  return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif'))  return 'image/gif';
    if (lower.endsWith('.svg'))  return 'image/svg+xml';
    if (lower.endsWith('.ttf'))  return 'font/truetype';
    if (lower.endsWith('.otf'))  return 'font/otf';
    if (lower.endsWith('.woff')) return 'font/woff';
    if (lower.endsWith('.woff2')) return 'font/woff2';
    if (lower.endsWith('.mp3'))  return 'audio/mpeg';
    if (lower.endsWith('.wav'))  return 'audio/wav';
    if (lower.endsWith('.ogg'))  return 'audio/ogg';
    if (lower.endsWith('.json')) return 'application/json';
    return 'application/octet-stream';
}

/** Read a file:// URL synchronously using GLib. */
async function readFileUrl(url: string): Promise<ArrayBuffer> {
    const path = GLib.filename_from_uri(url)[0];
    const [ok, contents] = GLib.file_get_contents(path);
    if (!ok) throw new Error(`XMLHttpRequest: cannot read file ${path}`);
    return (contents as Uint8Array).buffer as ArrayBuffer;
}

/** Write bytes to a temp file and return the path. */
function writeToTmp(bytes: Uint8Array, ext: string): string {
    const tmpPath = GLib.build_filenamev([
        GLib.get_tmp_dir(),
        `gjsify-blob-${_blobCounter++}${ext}`,
    ]);
    GLib.file_set_contents(tmpPath, bytes);
    return tmpPath;
}

// ---------------------------------------------------------------------------
// XMLHttpRequest
// ---------------------------------------------------------------------------

type XHREventType = 'loadstart' | 'progress' | 'load' | 'loadend' | 'error' | 'abort' | 'timeout';

export class XMLHttpRequest {
    // State
    readonly UNSENT = 0;
    readonly OPENED = 1;
    readonly HEADERS_RECEIVED = 2;
    readonly LOADING = 3;
    readonly DONE = 4;

    readyState = 0;
    status = 0;
    statusText = '';
    response: any = null;
    responseText = '';
    responseType = '';
    responseURL = '';
    timeout = 0;
    withCredentials = false;

    // Event handler properties
    onloadstart: ((e: any) => void) | null = null;
    onprogress: ((e: any) => void) | null = null;
    onload: ((e: any) => void) | null = null;
    onloadend: ((e: any) => void) | null = null;
    onerror: ((e: any) => void) | null = null;
    onabort: ((e: any) => void) | null = null;
    ontimeout: ((e: any) => void) | null = null;
    onreadystatechange: ((e: any) => void) | null = null;

    private _url = '';
    private _method = 'GET';
    private _aborted = false;
    private _listeners: Record<string, Array<(e: any) => void>> = {};

    open(method: string, url: string, _async = true): void {
        this._method = method.toUpperCase();
        this._url = url;
        this._aborted = false;
        this.readyState = this.OPENED;
    }

    setRequestHeader(_name: string, _value: string): void {
        // Not needed for the XHR→Blob→Image chain
    }

    overrideMimeType(_mime: string): void {}

    send(_body?: any): void {
        let url = this._url;
        const responseType = this.responseType;
        const DEBUG = (globalThis as any).__GJSIFY_DEBUG_XHR === true;

        // Root-relative URLs (start with '/', not '//') have no host to
        // resolve against in GJS. Rewrite to file:// relative to the program
        // directory — matches how an HTTP static server would resolve them.
        if (url.startsWith('/') && !url.startsWith('//')) {
            const prog = (System as any).programPath ?? System.programInvocationName ?? '';
            if (prog) {
                const programDir = GLib.path_get_dirname(prog);
                url = `file://${programDir}${this._url}`;
                if (DEBUG) console.log(`[xmlhttprequest] rewrite ${this._url} → ${url}`);
            }
        }

        if (DEBUG) console.log(`[xmlhttprequest] ${this._method} ${url} responseType=${responseType}`);

        const doFetch = (): Promise<ArrayBuffer> => {
            // Use GLib direct read for file:// URLs (avoids Soup for local files)
            if (url.startsWith('file://')) {
                return readFileUrl(url);
            }
            return (globalThis as any).fetch(url, { method: this._method })
                .then((r: any) => {
                    if (DEBUG) console.log(`[xmlhttprequest] fetch ok ${url} status=${r.status}`);
                    this.status = r.status === 0 ? 200 : r.status;
                    this.statusText = r.statusText || 'OK';
                    this.responseURL = r.url || url;
                    return r.arrayBuffer();
                });
        };

        this.readyState = this.LOADING;
        this._emit('loadstart', { loaded: 0, total: 0, lengthComputable: false });

        // Wrap doFetch() in Promise.resolve().then(...) so synchronous throws
        // (e.g. new URL('/path') when fetch parses the input) propagate into
        // the .catch chain instead of escaping send() as an uncaught exception.
        Promise.resolve().then(doFetch)
            .then((arrBuf: ArrayBuffer) => {
                if (this._aborted) return;

                if (this.status === 0) this.status = 200;
                if (!this.statusText) this.statusText = 'OK';
                this.readyState = this.DONE;

                const bytes = new Uint8Array(arrBuf);
                const len = bytes.byteLength;

                this._emit('progress', { loaded: len, total: len, lengthComputable: true });

                if (responseType === 'blob' || responseType === '') {
                    // Write to temp file so HTMLImageElement.src can load it via file://
                    const ext = guessExt(url);
                    const tmpPath = writeToTmp(bytes, ext);
                    const blob = new FakeBlob(guessMime(url), len);
                    blob._tmpPath = tmpPath;
                    this.response = blob;
                } else if (responseType === 'arraybuffer') {
                    this.response = arrBuf;
                } else if (responseType === 'json') {
                    this.response = JSON.parse(new TextDecoder().decode(bytes));
                } else {
                    // 'text' or ''
                    this.responseText = new TextDecoder().decode(bytes);
                    this.response = this.responseText;
                }

                this._emit('load', { target: this, loaded: len, total: len, lengthComputable: true });
                this._emit('loadend', { target: this, loaded: len, total: len, lengthComputable: true });
                if (this.onreadystatechange) this.onreadystatechange({});
            })
            .catch((err: any) => {
                if (this._aborted) return;
                console.warn(`[xmlhttprequest] ${this._method} ${url} — ${err?.message ?? err}`);
                this.readyState = this.DONE;
                this._emit('error', { error: err });
                this._emit('loadend', {});
            });
    }

    abort(): void {
        this._aborted = true;
        this.readyState = this.DONE;
        this._emit('abort', {});
        this._emit('loadend', {});
    }

    addEventListener(type: string, fn: (e: any) => void): void {
        (this._listeners[type] ??= []).push(fn);
    }

    removeEventListener(type: string, fn: (e: any) => void): void {
        this._listeners[type] = (this._listeners[type] ?? []).filter(f => f !== fn);
    }

    getResponseHeader(_name: string): string | null {
        return null;
    }

    getAllResponseHeaders(): string {
        return '';
    }

    private _emit(type: XHREventType, event: Record<string, any>): void {
        const handler = (this as any)['on' + type];
        if (typeof handler === 'function') handler.call(this, { type, ...event });
        for (const fn of this._listeners[type] ?? []) fn.call(this, { type, ...event });
    }
}

// ---------------------------------------------------------------------------
// URL.createObjectURL / revokeObjectURL
// These patch the existing URL global (provided by @gjsify/url / @gjsify/node-globals).
// HTMLImageElement.src natively handles file:// URLs via GLib.filename_from_uri + GdkPixbuf.
// ---------------------------------------------------------------------------

export function installObjectURLSupport(): void {
    // Only install if not already a real implementation
    if (typeof (URL as any).createObjectURL !== 'function' ||
        (URL as any).__gjsify_objecturl !== true) {

        const _objectURLPaths = new Map<string, string>();

        (URL as any).createObjectURL = function (blob: FakeBlob | Blob): string {
            if ((blob as FakeBlob)._tmpPath) {
                const url = `file://${(blob as FakeBlob)._tmpPath}`;
                _objectURLPaths.set(url, (blob as FakeBlob)._tmpPath!);
                return url;
            }
            // Fallback for real Blobs (shouldn't happen in GJS but handle gracefully)
            console.warn('[createObjectURL] received non-FakeBlob — cannot create file:// URL');
            return 'file:///dev/null';
        };

        (URL as any).revokeObjectURL = function (url: string): void {
            const path = _objectURLPaths.get(url);
            if (path) {
                try {
                    // Optionally clean up temp file
                    const file = GLib.build_filenamev([path]);
                    GLib.unlink(file);
                } catch {
                    // ignore cleanup errors
                }
                _objectURLPaths.delete(url);
            }
        };

        (URL as any).__gjsify_objecturl = true;
    }
}
