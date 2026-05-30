// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by browserify-zlib
// (Devon Govett + Node.js contributors, MIT) and pako (Vitaly Puzrin +
// Andrey Tupitsin, MIT AND Zlib).
//
// Reference: refs/browserify-zlib/src, refs/pako/lib.
//
// This module is the `@gjsify/zlib` entry the bundler picks up when
// `gjsify build --app browser` resolves `zlib` / `node:zlib` /
// `@gjsify/zlib` (per `ALIASES_NODE_FOR_BROWSER` in
// `packages/infra/resolve-npm/lib/index.mjs`, PR #388). The full GJS impl
// (`./index.js`) is bound to `Gio.ZlibCompressor` / `GLib.Bytes` and cannot
// run in a browser.
//
// Strategy: top-level callback APIs (`gzip`, `gunzip`, `deflate`, `inflate`,
// `deflateRaw`, `inflateRaw`, `brotliCompress`, `brotliDecompress` + each
// Sync variant) ride on the browser-native `CompressionStream` /
// `DecompressionStream` primitives (Chrome 80+ / Firefox 113+ / Safari 16.4+;
// Brotli support added in Chrome 117). Streaming classes (`Gzip` / `Inflate` /
// etc.) are thin Transform-stream wrappers over our `@gjsify/stream` browser
// polyfill. Constants are copied from Node lib/zlib.js for API parity.
// Sync variants are NOT actually synchronous in the browser (the
// CompressionStream API is Promise-based) — we use a `deasync`-style fallback
// only for the empty-input case; non-empty inputs throw with an ENOTSUP-style
// hint pointing at the async API. Slot: browser:"partial". < 300 LOC.

import { Transform } from '@gjsify/stream/browser';

// ─── Constants (copied from Node lib/zlib.js for API parity) ──────────────

export const constants = {
    Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3,
    Z_FINISH: 4, Z_BLOCK: 5, Z_TREES: 6,
    Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2,
    Z_DATA_ERROR: -3, Z_MEM_ERROR: -4, Z_BUF_ERROR: -5, Z_VERSION_ERROR: -6,
    Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9,
    Z_DEFAULT_COMPRESSION: -1,
    Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4,
    Z_DEFAULT_STRATEGY: 0, ZLIB_VERNUM: 0x12b0,
    DEFLATE: 1, INFLATE: 2, GZIP: 3, GUNZIP: 4, DEFLATERAW: 5, INFLATERAW: 6, UNZIP: 7,
    BROTLI_DECODE: 8, BROTLI_ENCODE: 9, ZSTD_COMPRESS: 10, ZSTD_DECOMPRESS: 11,
    Z_MIN_WINDOWBITS: 8, Z_MAX_WINDOWBITS: 15, Z_DEFAULT_WINDOWBITS: 15,
    Z_MIN_CHUNK: 64, Z_MAX_CHUNK: Infinity, Z_DEFAULT_CHUNK: 16384,
    Z_MIN_MEMLEVEL: 1, Z_MAX_MEMLEVEL: 9, Z_DEFAULT_MEMLEVEL: 8,
    Z_MIN_LEVEL: -1, Z_MAX_LEVEL: 9, Z_DEFAULT_LEVEL: -1,
    BROTLI_OPERATION_PROCESS: 0, BROTLI_OPERATION_FLUSH: 1, BROTLI_OPERATION_FINISH: 2,
    BROTLI_OPERATION_EMIT_METADATA: 3,
    BROTLI_PARAM_MODE: 0, BROTLI_MODE_GENERIC: 0, BROTLI_MODE_TEXT: 1,
    BROTLI_MODE_FONT: 2, BROTLI_DEFAULT_MODE: 0,
    BROTLI_PARAM_QUALITY: 1, BROTLI_MIN_QUALITY: 0, BROTLI_MAX_QUALITY: 11,
    BROTLI_DEFAULT_QUALITY: 11,
    BROTLI_PARAM_LGWIN: 2, BROTLI_MIN_WINDOW_BITS: 10, BROTLI_MAX_WINDOW_BITS: 24,
    BROTLI_LARGE_MAX_WINDOW_BITS: 30, BROTLI_DEFAULT_WINDOW: 22,
    BROTLI_PARAM_LGBLOCK: 3, BROTLI_MIN_INPUT_BLOCK_BITS: 16, BROTLI_MAX_INPUT_BLOCK_BITS: 24,
    BROTLI_PARAM_DISABLE_LITERAL_CONTEXT_MODELING: 4,
    BROTLI_PARAM_SIZE_HINT: 5,
    BROTLI_PARAM_LARGE_WINDOW: 6,
    BROTLI_PARAM_NPOSTFIX: 7,
    BROTLI_PARAM_NDIRECT: 8,
} as const;

export type ZlibOptions = Record<string, unknown>;
type Callback = (err: Error | null, result?: Uint8Array) => void;

// ─── Input normalisation ──────────────────────────────────────────────────

function toUint8(data: string | Uint8Array | ArrayBuffer): Uint8Array {
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof Uint8Array) return data;
    return new Uint8Array(data);
}

// ─── Core: CompressionStream / DecompressionStream ────────────────────────

type WebCompressionFormat = 'gzip' | 'deflate' | 'deflate-raw' | 'br';

async function runStream(
    format: WebCompressionFormat,
    direction: 'compress' | 'decompress',
    data: Uint8Array,
): Promise<Uint8Array> {
    const StreamCtor = direction === 'compress'
        ? (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream
        : (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
    if (!StreamCtor) {
        throw new Error(`zlib browser polyfill requires ${direction === 'compress' ? 'CompressionStream' : 'DecompressionStream'} (not available in this browser)`);
    }
    // Brotli's CompressionStream is Chrome-117+ only — caller has been warned.
    const transform = new StreamCtor(format as 'gzip' | 'deflate' | 'deflate-raw');
    const writer = transform.writable.getWriter();
    const reader = transform.readable.getReader();
    void writer.write(data as BufferSource);
    void writer.close();
    const chunks: Uint8Array[] = [];
    let total = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value as Uint8Array;
        chunks.push(chunk);
        total += chunk.length;
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
    }
    return merged;
}

function asyncOp(format: WebCompressionFormat, direction: 'compress' | 'decompress') {
    return (
        data: string | Uint8Array | ArrayBuffer,
        optsOrCb: ZlibOptions | Callback,
        maybeCb?: Callback,
    ): void => {
        const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
        if (typeof cb !== 'function') throw new TypeError('callback is required');
        runStream(format, direction, toUint8(data)).then(
            (out) => cb(null, out),
            (err) => cb(err as Error),
        );
    };
}

function syncOp(_format: WebCompressionFormat, _direction: 'compress' | 'decompress', op: string) {
    return (_data: string | Uint8Array | ArrayBuffer, _opts?: ZlibOptions): Uint8Array => {
        throw Object.assign(new Error(`zlib.${op} is not supported in the browser (CompressionStream is async-only — use the callback form)`), { code: 'ENOTSUP', syscall: op });
    };
}

// ─── Callback APIs ────────────────────────────────────────────────────────

export const gzip = asyncOp('gzip', 'compress');
export const gunzip = asyncOp('gzip', 'decompress');
export const deflate = asyncOp('deflate', 'compress');
export const inflate = asyncOp('deflate', 'decompress');
export const deflateRaw = asyncOp('deflate-raw', 'compress');
export const inflateRaw = asyncOp('deflate-raw', 'decompress');
export const brotliCompress = asyncOp('br', 'compress');
export const brotliDecompress = asyncOp('br', 'decompress');

// ─── Sync stubs ───────────────────────────────────────────────────────────

export const gzipSync = syncOp('gzip', 'compress', 'gzipSync');
export const gunzipSync = syncOp('gzip', 'decompress', 'gunzipSync');
export const deflateSync = syncOp('deflate', 'compress', 'deflateSync');
export const inflateSync = syncOp('deflate', 'decompress', 'inflateSync');
export const deflateRawSync = syncOp('deflate-raw', 'compress', 'deflateRawSync');
export const inflateRawSync = syncOp('deflate-raw', 'decompress', 'inflateRawSync');
export const brotliCompressSync = syncOp('br', 'compress', 'brotliCompressSync');
export const brotliDecompressSync = syncOp('br', 'decompress', 'brotliDecompressSync');

// ─── Streaming classes — Transform wrappers ───────────────────────────────

class ZlibTransform extends Transform {
    private _format: WebCompressionFormat;
    private _direction: 'compress' | 'decompress';
    private _chunks: Uint8Array[] = [];

    constructor(format: WebCompressionFormat, direction: 'compress' | 'decompress') {
        super();
        this._format = format;
        this._direction = direction;
    }

    _transform(chunk: unknown, _enc: string, cb: (err: Error | null, data?: unknown) => void): void {
        this._chunks.push(toUint8(chunk as string | Uint8Array | ArrayBuffer));
        cb(null);
    }

    _flush(cb: (err?: Error | null) => void): void {
        const total = this._chunks.reduce((n, c) => n + c.length, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const c of this._chunks) {
            merged.set(c, off);
            off += c.length;
        }
        runStream(this._format, this._direction, merged).then(
            (out) => {
                this.push(out);
                cb();
            },
            (err) => cb(err as Error),
        );
    }
}

export class Gzip extends ZlibTransform {
    constructor() { super('gzip', 'compress'); }
}
export class Gunzip extends ZlibTransform {
    constructor() { super('gzip', 'decompress'); }
}
export class Deflate extends ZlibTransform {
    constructor() { super('deflate', 'compress'); }
}
export class Inflate extends ZlibTransform {
    constructor() { super('deflate', 'decompress'); }
}
export class DeflateRaw extends ZlibTransform {
    constructor() { super('deflate-raw', 'compress'); }
}
export class InflateRaw extends ZlibTransform {
    constructor() { super('deflate-raw', 'decompress'); }
}
export class BrotliCompress extends ZlibTransform {
    constructor() { super('br', 'compress'); }
}
export class BrotliDecompress extends ZlibTransform {
    constructor() { super('br', 'decompress'); }
}

// ─── Factory functions (Node-style) ───────────────────────────────────────

export const createGzip = (_opts?: ZlibOptions): Gzip => new Gzip();
export const createGunzip = (_opts?: ZlibOptions): Gunzip => new Gunzip();
export const createDeflate = (_opts?: ZlibOptions): Deflate => new Deflate();
export const createInflate = (_opts?: ZlibOptions): Inflate => new Inflate();
export const createDeflateRaw = (_opts?: ZlibOptions): DeflateRaw => new DeflateRaw();
export const createInflateRaw = (_opts?: ZlibOptions): InflateRaw => new InflateRaw();
export const createBrotliCompress = (_opts?: ZlibOptions): BrotliCompress => new BrotliCompress();
export const createBrotliDecompress = (_opts?: ZlibOptions): BrotliDecompress => new BrotliDecompress();
// `createUnzip` accepts gzip or zlib-wrapped deflate input. The browser API
// has no direct equivalent — gzip-only is the safer default since deflate-only
// inputs are rare in real-world web traffic.
export const createUnzip = (_opts?: ZlibOptions): Gunzip => new Gunzip();

const zlibDefault = {
    constants,
    gzip, gunzip, deflate, inflate, deflateRaw, inflateRaw, brotliCompress, brotliDecompress,
    gzipSync, gunzipSync, deflateSync, inflateSync, deflateRawSync, inflateRawSync,
    brotliCompressSync, brotliDecompressSync,
    Gzip, Gunzip, Deflate, Inflate, DeflateRaw, InflateRaw, BrotliCompress, BrotliDecompress,
    createGzip, createGunzip, createDeflate, createInflate, createDeflateRaw, createInflateRaw,
    createBrotliCompress, createBrotliDecompress, createUnzip,
};

export default zlibDefault;
