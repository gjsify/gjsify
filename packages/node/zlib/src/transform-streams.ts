// Reference: Node.js lib/zlib.js — the streaming codec classes
// (`zlib.Gzip` / `Gunzip` / `Deflate` / `Inflate` / `DeflateRaw` /
// `InflateRaw` / `Unzip`) and their `createX()` factories.
//
// Reimplemented for GJS as real `node:stream` Transform subclasses backed by
// `Gio.ZlibCompressor` / `Gio.ZlibDecompressor`. Each class is a genuine
// constructor, so libraries that do `inherits(MyStream, zlib.Inflate)` at
// module-init time (sync-inflate / pngjs via qrcode) get a real function as
// `superCtor` instead of `undefined` → no `ERR_INVALID_ARG_TYPE` at import.
//
// Backing strategy: buffer the written chunks, then run the whole input
// through Gio's converter on `_flush`. zlib/deflate streams are
// self-delimiting, so a single-shot convert at end-of-stream is byte-correct;
// gzip decompression additionally walks concatenated members (Node's gunzip
// semantics). `Unzip` sniffs the gzip magic (0x1f 0x8b) on the first bytes and
// dispatches to the gzip or zlib decoder accordingly.

import { Transform } from 'node:stream';
import type { TransformOptions } from 'node:stream';
import type { ZlibOptions } from 'node:zlib';
// Gio codec primitives shared with the one-shot API in index.ts — see the
// performance contract documented in gio-codec.ts (bounded-slice member scan,
// 1 MiB stream reads).
import { compressWithGio, decompressStreamWithGio, gunzipWithGio, type GioFormat } from './gio-codec.js';

function toUint8Array(chunk: Uint8Array | string): Uint8Array {
    if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

function concat(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

// ---- Base Transform ----

type ZlibMode =
    | { kind: 'compress'; format: GioFormat }
    | { kind: 'decompress'; format: GioFormat }
    | { kind: 'gunzip' }
    | { kind: 'unzip' };

/**
 * Shared base for the zlib streaming classes. Buffers written chunks and runs
 * the codec once on flush. Concrete classes pick a {@link ZlibMode}; they are
 * thin `super(mode)` constructors so the public class identity (`Gzip`,
 * `Inflate`, …) is preserved for `instanceof` / `inherits()`.
 */
export class ZlibBase extends Transform {
    private _mode: ZlibMode;
    private _chunks: Uint8Array[] = [];

    constructor(mode: ZlibMode, options?: ZlibOptions) {
        super(options as unknown as TransformOptions);
        this._mode = mode;
    }

    _transform(chunk: unknown, _encoding: string, callback: (err?: Error) => void): void {
        this._chunks.push(toUint8Array(chunk as Uint8Array | string));
        callback();
    }

    _flush(callback: (err?: Error) => void): void {
        const input = concat(this._chunks);
        this._chunks = [];
        try {
            this.push(Buffer.from(this._run(input)));
            callback();
        } catch (err) {
            callback(err instanceof Error ? err : new Error(String(err)));
        }
    }

    private _run(input: Uint8Array): Uint8Array {
        const mode = this._mode;
        switch (mode.kind) {
            case 'compress':
                return compressWithGio(input, mode.format);
            case 'decompress':
                return decompressStreamWithGio(input, mode.format);
            case 'gunzip':
                return gunzipWithGio(input);
            case 'unzip':
                // Auto-detect: gzip magic (0x1f 0x8b) → gunzip, else zlib-wrapped
                // deflate. Node's Unzip sniffs the same two bytes.
                if (input.length >= 2 && input[0] === 0x1f && input[1] === 0x8b) {
                    return gunzipWithGio(input);
                }
                return decompressStreamWithGio(input, 'deflate');
        }
    }
}

// ---- Streaming classes (mirror Node's `zlib.Gzip`, `zlib.Inflate`, …) ----
//
// Each is a real constructor extending the polyfilled Transform, so
// `inherits(Sub, zlib.Inflate)` / `class Sub extends zlib.Gzip {}` both work.

/**
 * Backwards-compatible alias for the historical export name. New code should
 * use the concrete classes (`Gzip`, `Inflate`, …); this keeps the prior
 * generic base reachable for any external importer.
 */
export { ZlibBase as ZlibTransform };

export class Gzip extends ZlibBase {
    constructor(options?: ZlibOptions) {
        super({ kind: 'compress', format: 'gzip' }, options);
    }
}

export class Gunzip extends ZlibBase {
    constructor(options?: ZlibOptions) {
        super({ kind: 'gunzip' }, options);
    }
}

export class Deflate extends ZlibBase {
    constructor(options?: ZlibOptions) {
        super({ kind: 'compress', format: 'deflate' }, options);
    }
}

export class Inflate extends ZlibBase {
    constructor(options?: ZlibOptions) {
        super({ kind: 'decompress', format: 'deflate' }, options);
    }
}

export class DeflateRaw extends ZlibBase {
    constructor(options?: ZlibOptions) {
        super({ kind: 'compress', format: 'deflate-raw' }, options);
    }
}

export class InflateRaw extends ZlibBase {
    constructor(options?: ZlibOptions) {
        super({ kind: 'decompress', format: 'deflate-raw' }, options);
    }
}

export class Unzip extends ZlibBase {
    constructor(options?: ZlibOptions) {
        super({ kind: 'unzip' }, options);
    }
}

// Brotli has no Gio.ZlibCompressor backend — the constructors throw, mirroring
// the one-shot brotli stubs. Kept as real subclasses so `typeof
// zlib.BrotliCompress === 'function'` and `inherits(Sub, zlib.BrotliCompress)`
// hold for modules that reference the symbol at init time even if they never
// instantiate it.
export class BrotliCompress extends Transform {
    constructor() {
        super();
        throw new Error('BrotliCompress is not supported on GJS (no Brotli in GLib)');
    }
}

export class BrotliDecompress extends Transform {
    constructor() {
        super();
        throw new Error('BrotliDecompress is not supported on GJS (no Brotli in GLib)');
    }
}

// Zstd (Node 23.8+) likewise has no GLib backend. undici v7 reads
// `zlib.ZstdDecompress` / `createZstdDecompress` at module-init — the symbols
// must exist; construction throws ERR_UNSUPPORTED_OPERATION.
export class ZstdCompress extends Transform {
    constructor() {
        super();
        const err = new Error('ZstdCompress is not supported on GJS (no Zstd in GLib)');
        (err as Error & { code: string }).code = 'ERR_UNSUPPORTED_OPERATION';
        throw err;
    }
}

export class ZstdDecompress extends Transform {
    constructor() {
        super();
        const err = new Error('ZstdDecompress is not supported on GJS (no Zstd in GLib)');
        (err as Error & { code: string }).code = 'ERR_UNSUPPORTED_OPERATION';
        throw err;
    }
}

// ---- Factory functions (mirror Node.js API) ----

export function createGzip(options?: ZlibOptions): Gzip {
    return new Gzip(options);
}

export function createGunzip(options?: ZlibOptions): Gunzip {
    return new Gunzip(options);
}

export function createDeflate(options?: ZlibOptions): Deflate {
    return new Deflate(options);
}

export function createInflate(options?: ZlibOptions): Inflate {
    return new Inflate(options);
}

export function createDeflateRaw(options?: ZlibOptions): DeflateRaw {
    return new DeflateRaw(options);
}

export function createInflateRaw(options?: ZlibOptions): InflateRaw {
    return new InflateRaw(options);
}

export function createUnzip(options?: ZlibOptions): Unzip {
    return new Unzip(options);
}

// Brotli is not available in GLib — factories throw at runtime.
export function createBrotliCompress(_options?: ZlibOptions): never {
    throw new Error('createBrotliCompress is not supported on GJS (no Brotli in GLib)');
}

export function createBrotliDecompress(_options?: ZlibOptions): never {
    throw new Error('createBrotliDecompress is not supported on GJS (no Brotli in GLib)');
}

// Zstd (Node 23.8+, see https://github.com/nodejs/node/pull/56777) is not
// available in GLib. Stubs that throw at runtime — undici v7's module-init
// feature detector reads `zlib.createZstdDecompress` eagerly, so the
// export must exist; the stub never actually fires unless a real
// `Content-Encoding: zstd` response arrives (GTK ecosystem doesn't ship
// Zstd today). A real implementation would land via `Gio.ZlibCompressor`
// once glib-networking exposes the API, or via a libzstd-1.5 Vala prebuild.
export function createZstdCompress(_options?: ZlibOptions): never {
    const err = new Error('createZstdCompress is not supported on GJS (no Zstd in GLib)');
    (err as Error & { code: string }).code = 'ERR_UNSUPPORTED_OPERATION';
    throw err;
}

export function createZstdDecompress(_options?: ZlibOptions): never {
    const err = new Error('createZstdDecompress is not supported on GJS (no Zstd in GLib)');
    (err as Error & { code: string }).code = 'ERR_UNSUPPORTED_OPERATION';
    throw err;
}
