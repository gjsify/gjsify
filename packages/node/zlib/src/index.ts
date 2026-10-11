// Reference: Node.js lib/zlib.js
// Reimplemented for GJS using Web Compression API / Gio.ZlibCompressor

export {
    ZlibTransform,
    Gzip,
    Gunzip,
    Deflate,
    Inflate,
    DeflateRaw,
    InflateRaw,
    Unzip,
    BrotliCompress,
    BrotliDecompress,
    ZstdCompress,
    ZstdDecompress,
    createGzip,
    createGunzip,
    createDeflate,
    createInflate,
    createDeflateRaw,
    createInflateRaw,
    createUnzip,
    createBrotliCompress,
    createBrotliDecompress,
} from './transform-streams.js';

import type { ZlibOptions } from 'node:zlib';
import {
    assertLevel,
    compressWithGio,
    decompressStreamWithGio,
    DEFAULT_LEVEL,
    gunzipWithGio,
    hasGzipMagic,
    type GioFormat,
} from './gio-codec.js';
import { bufferTooLargeError, isBufferTooLargeError, resolveMaxOutputLength } from './max-output-length.js';

type ZlibCallback = (error: Error | null, result: Uint8Array) => void;

/**
 * Is a native Compression Streams implementation present?
 *
 * Asked PER CALL, not snapshotted at module load, and that is load-bearing for
 * testability rather than for correctness: a module-load snapshot makes the Web
 * branch unreachable from any test on GJS, where the global is absent — and that
 * unreachability is why the multi-member gzip defect below shipped. No gate ran this
 * branch. On GJS the global does not exist, and on Node the specs import `node:zlib`,
 * which IS Node's own zlib rather than this file (tests/AGENTS.md rule 3: the Node
 * leg proves the test, the GJS leg proves our implementation). The only host that
 * ever ran it was the node-gi reverse bridge, months later.
 *
 * With the check lazy, a spec can define the globals and exercise both branches
 * anywhere. The cost is one `typeof` per call.
 */
const hasWebCompression = (): boolean => typeof globalThis.CompressionStream !== 'undefined';

// The Gio codec primitives (shared with the streaming classes in
// transform-streams.ts, incl. the bounded-slice gzip member walk) live in
// gio-codec.ts — see the performance contract documented there.

function decompressWithGio(data: Uint8Array, format: GioFormat, maxOutputLength?: number): Uint8Array {
    if (format !== 'gzip') {
        return decompressStreamWithGio(data, format, maxOutputLength);
    }
    // Gzip: handle concatenated members (Node.js gunzip behavior).
    return gunzipWithGio(data, maxOutputLength);
}

/** Node's `Unzip`: gzip (all members) when the magic bytes say so, else zlib-wrapped deflate. */
function unzipFormat(data: Uint8Array): GioFormat {
    return hasGzipMagic(data) ? 'gzip' : 'deflate';
}

/**
 * Compression output is not decoded incrementally, so the limit is checked on the
 * result. That is still bounded: deflate output never exceeds its input by more
 * than a few bytes per block, unlike inflate, where the guard has to stop the loop.
 */
function assertWithinLimit(result: Uint8Array, maxOutputLength: number): Uint8Array {
    if (result.length > maxOutputLength) throw bufferTooLargeError(maxOutputLength);
    return result;
}

// Drive a (de)compression Transform by piping a single-chunk source through it
// and draining the result. Using `pipeThrough` (rather than a manual
// `getWriter()` + fire-and-forget `write()`/`close()`) keeps the stream
// internals in charge of the writable lifecycle, so no writer-level promise is
// left to reject unobserved. The old getWriter pattern intermittently leaked an
// "Unhandled promise rejection" on GJS when the readable side closed before the
// writer's close/closed promises settled, which is fatal under SpiderMonkey and
// flaked CI. A malformed/truncated input still rejects the reader's `read()`,
// so the returned promise rejects exactly as before.
async function runWebTransform(
    data: Uint8Array,
    transform: ReadableWritablePair<Uint8Array, Uint8Array>,
    maxOutputLength = Infinity,
): Promise<Uint8Array> {
    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength));
            controller.close();
        },
    });

    const chunks: Uint8Array[] = [];
    let produced = 0;
    const reader = source.pipeThrough(transform).getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        produced += value.length;
        if (produced > maxOutputLength) {
            // Cancelling stops the decoder pulling more input, so a bomb is not
            // inflated past the chunk that crossed the limit.
            await reader.cancel();
            throw bufferTooLargeError(maxOutputLength);
        }
        chunks.push(value);
    }

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

async function compressWithWeb(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
    return runWebTransform(data, new CompressionStream(format) as ReadableWritablePair<Uint8Array, Uint8Array>);
}

async function decompressWithWeb(
    data: Uint8Array,
    format: CompressionFormat,
    maxOutputLength: number,
): Promise<Uint8Array> {
    return runWebTransform(
        data,
        new DecompressionStream(format) as ReadableWritablePair<Uint8Array, Uint8Array>,
        maxOutputLength,
    );
}

/**
 * A `level` the caller actually chose, or `undefined` for "whatever zlib picks".
 *
 * `undefined` and `-1` are the same REQUEST and deliberately not the same ROUTE:
 * see {@link compress} for why only an explicit level leaves the Web fast path.
 */
function requestedLevel(options?: ZlibOptions): number | undefined {
    const level = options?.level;
    if (level === undefined || level === DEFAULT_LEVEL) return undefined;
    assertLevel(level);
    return level;
}

/**
 * Async one-shot encode.
 *
 * AN EXPLICIT LEVEL LEAVES THE WEB PATH, because `CompressionStream` has no way to
 * accept one: the Compression Streams spec takes a format and nothing else. Until
 * this argument existed the option was read off `ZlibOptions` and dropped on the
 * floor on both backends — the parameter was even spelled `_options` — so a caller
 * asking for 9 got 6, and the gzip header's XFL byte said 6 to everything that
 * reads it.
 *
 * Silently returning level-6 bytes to a caller who asked for 9 is the same class of
 * lie as stamping XFL without doing the work, which is why the fix is to route
 * rather than to ignore. With no level asked for, the Web path stays the default
 * for the reason in {@link decompress}: it is the platform's own C zlib.
 */
async function compress(
    data: Uint8Array,
    format: GioFormat,
    level: number | undefined,
    maxOutputLength: number,
): Promise<Uint8Array> {
    if (level === undefined && hasWebCompression()) {
        return assertWithinLimit(await compressWithWeb(data, format as CompressionFormat), maxOutputLength);
    }
    return assertWithinLimit(compressWithGio(data, format, level), maxOutputLength);
}

/**
 * Async one-shot decode, with the multi-member gzip case handled where the platform
 * cannot do it.
 *
 * A native `DecompressionStream('gzip')` decodes exactly ONE member and errors on
 * whatever follows — which is what the Compression Streams spec asks of it. Node's
 * `zlib.gunzip()` decodes every member, multi-member gzip being legal and produced
 * by `gzip -c a b`, bgzip and some HTTP servers. Preferring the Web API therefore
 * made this the only one of three siblings that could not read concatenated members:
 * `gunzipSync` walks them (`gunzipWithGio`) and `createGunzip` walks them (the
 * Transform in transform-streams.ts). Measured through the node-gi reverse bridge,
 * where the RUNTIME's own `DecompressionStream` wins over our polyfill:
 *
 *   ✔ gunzipSync should decompress concatenated gzip members
 *   ❌ gunzip async should decompress concatenated gzip members
 *        TypeError: failed to write whole buffer
 *          at Object.transform (ext:deno_web/14_compression.js)
 *   ✔ createGunzip (stream) should decompress concatenated gzip members
 *
 * The Web path STAYS the fast path, gzip included: it is the platform's own C zlib,
 * and on a host with no Gio it is the only path there is. The member walk runs only
 * after it has actually failed, so single-member gzip — the overwhelming majority —
 * pays nothing.
 *
 * Not conditioned on inspecting the bytes first: only inflating tells you where a
 * member ends, so "does this have a second one" is not answerable more cheaply than
 * walking them. A genuinely corrupt stream still rejects, because `gunzipWithGio`
 * re-decodes and surfaces GLib's error — what the truncated-input tests assert.
 */
async function decompress(data: Uint8Array, format: GioFormat, maxOutputLength: number): Promise<Uint8Array> {
    if (hasWebCompression()) {
        try {
            return await decompressWithWeb(data, format as CompressionFormat, maxOutputLength);
        } catch (err) {
            if (format !== 'gzip' || isBufferTooLargeError(err)) throw err;
            return decompressWithGio(data, format, maxOutputLength);
        }
    }
    return decompressWithGio(data, format, maxOutputLength);
}

function toUint8Array(data: string | Uint8Array | ArrayBuffer): Uint8Array {
    if (typeof data === 'string') {
        return new TextEncoder().encode(data);
    }
    if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
    }
    return data;
}

type ZlibInput = string | Uint8Array | ArrayBuffer;

/**
 * Shared body of the callback API. The options are validated BEFORE anything is
 * scheduled, so a bad `level` or `maxOutputLength` throws synchronously from the
 * call, as Node's does, instead of arriving through the callback.
 */
function runAsync(
    data: ZlibInput,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback: ZlibCallback | undefined,
    run: (input: Uint8Array, options: ZlibOptions | undefined, maxOutputLength: number) => Promise<Uint8Array>,
): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
    const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
    const maxOutputLength = resolveMaxOutputLength(options);
    run(toUint8Array(data), options, maxOutputLength).then(
        (result) => cb(null, result),
        (err) => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0)),
    );
}

function compressAsync(format: GioFormat) {
    return (input: Uint8Array, options: ZlibOptions | undefined, maxOutputLength: number) =>
        compress(input, format, requestedLevel(options), maxOutputLength);
}

function decompressAsync(format: GioFormat) {
    return (input: Uint8Array, _options: ZlibOptions | undefined, maxOutputLength: number) =>
        decompress(input, format, maxOutputLength);
}

export function gzip(data: ZlibInput, callback: ZlibCallback): void;
export function gzip(data: ZlibInput, options: ZlibOptions, callback: ZlibCallback): void;
export function gzip(data: ZlibInput, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
    runAsync(data, optionsOrCallback, callback, compressAsync('gzip'));
}

export function gunzip(data: ZlibInput, callback: ZlibCallback): void;
export function gunzip(data: ZlibInput, options: ZlibOptions, callback: ZlibCallback): void;
export function gunzip(data: ZlibInput, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
    runAsync(data, optionsOrCallback, callback, decompressAsync('gzip'));
}

export function deflate(data: ZlibInput, callback: ZlibCallback): void;
export function deflate(data: ZlibInput, options: ZlibOptions, callback: ZlibCallback): void;
export function deflate(data: ZlibInput, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
    runAsync(data, optionsOrCallback, callback, compressAsync('deflate'));
}

export function inflate(data: ZlibInput, callback: ZlibCallback): void;
export function inflate(data: ZlibInput, options: ZlibOptions, callback: ZlibCallback): void;
export function inflate(data: ZlibInput, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
    runAsync(data, optionsOrCallback, callback, decompressAsync('deflate'));
}

export function deflateRaw(data: ZlibInput, callback: ZlibCallback): void;
export function deflateRaw(data: ZlibInput, options: ZlibOptions, callback: ZlibCallback): void;
export function deflateRaw(
    data: ZlibInput,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback?: ZlibCallback,
): void {
    runAsync(data, optionsOrCallback, callback, compressAsync('deflate-raw'));
}

export function inflateRaw(data: ZlibInput, callback: ZlibCallback): void;
export function inflateRaw(data: ZlibInput, options: ZlibOptions, callback: ZlibCallback): void;
export function inflateRaw(
    data: ZlibInput,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback?: ZlibCallback,
): void {
    runAsync(data, optionsOrCallback, callback, decompressAsync('deflate-raw'));
}

export function unzip(data: ZlibInput, callback: ZlibCallback): void;
export function unzip(data: ZlibInput, options: ZlibOptions, callback: ZlibCallback): void;
export function unzip(data: ZlibInput, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
    runAsync(data, optionsOrCallback, callback, (input, _options, maxOutputLength) =>
        decompress(input, unzipFormat(input), maxOutputLength),
    );
}

function compressSync(data: ZlibInput, format: GioFormat, options?: ZlibOptions): Uint8Array {
    const maxOutputLength = resolveMaxOutputLength(options);
    return assertWithinLimit(
        compressWithGio(toUint8Array(data), format, options?.level ?? DEFAULT_LEVEL),
        maxOutputLength,
    );
}

export function gzipSync(data: ZlibInput, options?: ZlibOptions): Uint8Array {
    return compressSync(data, 'gzip', options);
}

export function gunzipSync(data: ZlibInput, options?: ZlibOptions): Uint8Array {
    return decompressWithGio(toUint8Array(data), 'gzip', resolveMaxOutputLength(options));
}

export function deflateSync(data: ZlibInput, options?: ZlibOptions): Uint8Array {
    return compressSync(data, 'deflate', options);
}

export function inflateSync(data: ZlibInput, options?: ZlibOptions): Uint8Array {
    return decompressWithGio(toUint8Array(data), 'deflate', resolveMaxOutputLength(options));
}

export function deflateRawSync(data: ZlibInput, options?: ZlibOptions): Uint8Array {
    return compressSync(data, 'deflate-raw', options);
}

export function inflateRawSync(data: ZlibInput, options?: ZlibOptions): Uint8Array {
    return decompressWithGio(toUint8Array(data), 'deflate-raw', resolveMaxOutputLength(options));
}

export function unzipSync(data: ZlibInput, options?: ZlibOptions): Uint8Array {
    const input = toUint8Array(data);
    return decompressWithGio(input, unzipFormat(input), resolveMaxOutputLength(options));
}

// Node's CompressCallback signature requires a `result: Uint8Array` even on
// the error path; convention is to pass an empty buffer when reporting an
// error. Hand back a zero-length view rather than casting `null` through.
const EMPTY_RESULT = new Uint8Array(0);

export function brotliCompress(
    data: string | Uint8Array | ArrayBuffer,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback?: ZlibCallback,
): void {
    const cb = (typeof optionsOrCallback === 'function' ? optionsOrCallback : callback) as ZlibCallback;
    cb(new Error('brotliCompress: Brotli is not supported in this environment'), EMPTY_RESULT);
}

export function brotliDecompress(
    data: string | Uint8Array | ArrayBuffer,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback?: ZlibCallback,
): void {
    const cb = (typeof optionsOrCallback === 'function' ? optionsOrCallback : callback) as ZlibCallback;
    cb(new Error('brotliDecompress: Brotli is not supported in this environment'), EMPTY_RESULT);
}

export function brotliCompressSync(_data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
    throw new Error('brotliCompressSync: Brotli is not supported in this environment');
}

export function brotliDecompressSync(_data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
    throw new Error('brotliDecompressSync: Brotli is not supported in this environment');
}

// ---- Zstd stubs (Node 23.8+ API, see https://github.com/nodejs/node/pull/56777) ----
//
// undici v7's runtime-feature detector reads `zlib.createZstdDecompress` at
// module-init time — even if no Zstd-encoded response ever arrives, the
// symbol MUST exist for undici to even load. These stubs make `import undici`
// work under GJS; they throw `ERR_UNSUPPORTED_OPERATION` only when the
// caller actually constructs the codec (rare — GTK ecosystem doesn't ship
// Content-Encoding: zstd today). A real implementation would land via
// `Gio.ZlibCompressor`'s zstd siblings in glib-networking 2.84+ or a
// libzstd-1.5 Vala prebuild — neither is on the immediate horizon.

export function zstdCompress(
    data: string | Uint8Array | ArrayBuffer,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback?: ZlibCallback,
): void {
    const cb = (typeof optionsOrCallback === 'function' ? optionsOrCallback : callback) as ZlibCallback;
    const err = new Error('zstdCompress: Zstd is not supported in this environment');
    (err as Error & { code: string }).code = 'ERR_UNSUPPORTED_OPERATION';
    cb(err, EMPTY_RESULT);
}

export function zstdDecompress(
    data: string | Uint8Array | ArrayBuffer,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback?: ZlibCallback,
): void {
    const cb = (typeof optionsOrCallback === 'function' ? optionsOrCallback : callback) as ZlibCallback;
    const err = new Error('zstdDecompress: Zstd is not supported in this environment');
    (err as Error & { code: string }).code = 'ERR_UNSUPPORTED_OPERATION';
    cb(err, EMPTY_RESULT);
}

export function zstdCompressSync(_data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
    const err = new Error('zstdCompressSync: Zstd is not supported in this environment');
    (err as Error & { code: string }).code = 'ERR_UNSUPPORTED_OPERATION';
    throw err;
}

export function zstdDecompressSync(_data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
    const err = new Error('zstdDecompressSync: Zstd is not supported in this environment');
    (err as Error & { code: string }).code = 'ERR_UNSUPPORTED_OPERATION';
    throw err;
}

export const constants = {
    Z_NO_FLUSH: 0,
    Z_PARTIAL_FLUSH: 1,
    Z_SYNC_FLUSH: 2,
    Z_FULL_FLUSH: 3,
    Z_FINISH: 4,
    Z_BLOCK: 5,
    Z_TREES: 6,
    Z_OK: 0,
    Z_STREAM_END: 1,
    Z_NEED_DICT: 2,
    Z_ERRNO: -1,
    Z_STREAM_ERROR: -2,
    Z_DATA_ERROR: -3,
    Z_MEM_ERROR: -4,
    Z_BUF_ERROR: -5,
    Z_VERSION_ERROR: -6,
    Z_NO_COMPRESSION: 0,
    Z_BEST_SPEED: 1,
    Z_BEST_COMPRESSION: 9,
    Z_DEFAULT_COMPRESSION: -1,
    Z_FILTERED: 1,
    Z_HUFFMAN_ONLY: 2,
    Z_RLE: 3,
    Z_FIXED: 4,
    Z_DEFAULT_STRATEGY: 0,
    Z_DEFLATED: 8,
};

import {
    Gzip,
    Gunzip,
    Deflate,
    Inflate,
    DeflateRaw,
    InflateRaw,
    Unzip,
    BrotliCompress,
    BrotliDecompress,
    ZstdCompress,
    ZstdDecompress,
    createGzip,
    createGunzip,
    createDeflate,
    createInflate,
    createDeflateRaw,
    createInflateRaw,
    createUnzip,
    createBrotliCompress,
    createBrotliDecompress,
    createZstdCompress,
    createZstdDecompress,
} from './transform-streams.js';

export { createZstdCompress, createZstdDecompress } from './transform-streams.js';

export default {
    gzip,
    gunzip,
    deflate,
    inflate,
    deflateRaw,
    inflateRaw,
    unzip,
    gzipSync,
    gunzipSync,
    deflateSync,
    inflateSync,
    deflateRawSync,
    inflateRawSync,
    unzipSync,
    brotliCompress,
    brotliDecompress,
    brotliCompressSync,
    brotliDecompressSync,
    zstdCompress,
    zstdDecompress,
    zstdCompressSync,
    zstdDecompressSync,
    Gzip,
    Gunzip,
    Deflate,
    Inflate,
    DeflateRaw,
    InflateRaw,
    Unzip,
    BrotliCompress,
    BrotliDecompress,
    ZstdCompress,
    ZstdDecompress,
    createGzip,
    createGunzip,
    createDeflate,
    createInflate,
    createDeflateRaw,
    createInflateRaw,
    createUnzip,
    createBrotliCompress,
    createBrotliDecompress,
    createZstdCompress,
    createZstdDecompress,
    constants,
};
