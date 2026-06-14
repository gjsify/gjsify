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

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import type { ZlibOptions } from 'node:zlib';

type ZlibCallback = (error: Error | null, result: Uint8Array) => void;

const hasWebCompression = typeof globalThis.CompressionStream !== 'undefined';

// ---- Gio-based compression for GJS ----

type GioFormat = 'gzip' | 'deflate' | 'deflate-raw';

function getGioFormat(format: GioFormat): Gio.ZlibCompressorFormat {
    switch (format) {
        case 'gzip':
            return Gio.ZlibCompressorFormat.GZIP;
        case 'deflate':
            return Gio.ZlibCompressorFormat.ZLIB;
        case 'deflate-raw':
            return Gio.ZlibCompressorFormat.RAW;
    }
}

function compressWithGio(data: Uint8Array, format: GioFormat): Uint8Array {
    const compressor = new Gio.ZlibCompressor({ format: getGioFormat(format) });
    const converter = new Gio.ConverterOutputStream({
        base_stream: Gio.MemoryOutputStream.new_resizable(),
        converter: compressor,
    });

    converter.write_bytes(new GLib.Bytes(data), null);
    converter.close(null);

    const memStream = converter.get_base_stream() as Gio.MemoryOutputStream;
    const bytes = memStream.steal_as_bytes();
    return new Uint8Array(bytes.get_data() ?? []);
}

function decompressStreamWithGio(data: Uint8Array, format: GioFormat): Uint8Array {
    const decompressor = new Gio.ZlibDecompressor({ format: getGioFormat(format) });
    const memInput = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(data));
    const converter = new Gio.ConverterInputStream({
        base_stream: memInput,
        converter: decompressor,
    });

    const chunks: Uint8Array[] = [];
    const bufSize = 4096;
    while (true) {
        const bytes = converter.read_bytes(bufSize, null);
        const size = bytes.get_size();
        if (size === 0) break;
        chunks.push(new Uint8Array(bytes.get_data()!));
    }
    converter.close(null);

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

function findGzipMemberEnd(data: Uint8Array): number {
    // Use the low-level convert() API to determine how many bytes a single
    // gzip member consumes. The outBuf data is not usable in GJS (not written
    // back to JS), but bytes_read is correct.
    const decompressor = new Gio.ZlibDecompressor({ format: Gio.ZlibCompressorFormat.GZIP });
    const outBuf = new Uint8Array(65536);
    let totalRead = 0;
    let finished = false;
    while (!finished) {
        const input = data.subarray(totalRead);
        try {
            const [result, bytesRead] = decompressor.convert(input, outBuf, Gio.ConverterFlags.NONE);
            totalRead += bytesRead;
            if (result === Gio.ConverterResult.FINISHED) finished = true;
        } catch {
            finished = true;
        }
    }
    return totalRead;
}

function decompressWithGio(data: Uint8Array, format: GioFormat): Uint8Array {
    if (format !== 'gzip') {
        return decompressStreamWithGio(data, format);
    }

    // Gzip: handle concatenated members (Node.js gunzip behavior)
    const allChunks: Uint8Array[] = [];
    let inputOffset = 0;

    while (inputOffset < data.length) {
        // Check for gzip magic bytes
        if (data.length - inputOffset < 2 || data[inputOffset] !== 0x1f || data[inputOffset + 1] !== 0x8b) {
            break;
        }

        const memberData = data.subarray(inputOffset);
        // Find where this member ends using the low-level API
        const consumed = findGzipMemberEnd(memberData);
        if (consumed <= 0) break; // No progress, avoid infinite loop

        // Decompress just this member using ConverterInputStream
        const decompressed = decompressStreamWithGio(memberData.subarray(0, consumed), 'gzip');
        allChunks.push(decompressed);
        inputOffset += consumed;
    }

    if (allChunks.length === 0) {
        // No valid gzip members found; try decompressing anyway to get proper error
        return decompressStreamWithGio(data, 'gzip');
    }

    const totalLength = allChunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of allChunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

// ---- Compression helpers using Web Compression API ----

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
): Promise<Uint8Array> {
    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength));
            controller.close();
        },
    });

    const chunks: Uint8Array[] = [];
    const reader = source.pipeThrough(transform).getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
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

async function decompressWithWeb(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
    return runWebTransform(data, new DecompressionStream(format) as ReadableWritablePair<Uint8Array, Uint8Array>);
}

// ---- Unified compress/decompress ----

async function compress(data: Uint8Array, format: GioFormat): Promise<Uint8Array> {
    if (hasWebCompression) {
        return compressWithWeb(data, format as CompressionFormat);
    }
    return compressWithGio(data, format);
}

async function decompress(data: Uint8Array, format: GioFormat): Promise<Uint8Array> {
    if (hasWebCompression) {
        return decompressWithWeb(data, format as CompressionFormat);
    }
    return decompressWithGio(data, format);
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

// ---- Callback-based API ----

export function gzip(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function gzip(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function gzip(
    data: string | Uint8Array | ArrayBuffer,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback?: ZlibCallback,
): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
    compress(toUint8Array(data), 'gzip').then(
        (result) => cb(null, result),
        (err) => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0)),
    );
}

export function gunzip(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function gunzip(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function gunzip(
    data: string | Uint8Array | ArrayBuffer,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback?: ZlibCallback,
): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
    decompress(toUint8Array(data), 'gzip').then(
        (result) => cb(null, result),
        (err) => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0)),
    );
}

export function deflate(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function deflate(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function deflate(
    data: string | Uint8Array | ArrayBuffer,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback?: ZlibCallback,
): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
    compress(toUint8Array(data), 'deflate').then(
        (result) => cb(null, result),
        (err) => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0)),
    );
}

export function inflate(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function inflate(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function inflate(
    data: string | Uint8Array | ArrayBuffer,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback?: ZlibCallback,
): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
    decompress(toUint8Array(data), 'deflate').then(
        (result) => cb(null, result),
        (err) => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0)),
    );
}

export function deflateRaw(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function deflateRaw(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function deflateRaw(
    data: string | Uint8Array | ArrayBuffer,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback?: ZlibCallback,
): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
    compress(toUint8Array(data), 'deflate-raw').then(
        (result) => cb(null, result),
        (err) => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0)),
    );
}

export function inflateRaw(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function inflateRaw(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function inflateRaw(
    data: string | Uint8Array | ArrayBuffer,
    optionsOrCallback: ZlibOptions | ZlibCallback,
    callback?: ZlibCallback,
): void {
    const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
    decompress(toUint8Array(data), 'deflate-raw').then(
        (result) => cb(null, result),
        (err) => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0)),
    );
}

// ---- Sync API (uses Gio.ZlibCompressor / Gio.ZlibDecompressor) ----

export function gzipSync(data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
    return compressWithGio(toUint8Array(data), 'gzip');
}

export function gunzipSync(data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
    return decompressWithGio(toUint8Array(data), 'gzip');
}

export function deflateSync(data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
    return compressWithGio(toUint8Array(data), 'deflate');
}

export function inflateSync(data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
    return decompressWithGio(toUint8Array(data), 'deflate');
}

export function deflateRawSync(data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
    return compressWithGio(toUint8Array(data), 'deflate-raw');
}

export function inflateRawSync(data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
    return decompressWithGio(toUint8Array(data), 'deflate-raw');
}

// ---- Brotli (not available in GJS — stubs throw at call time) ----

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

// ---- Constants ----

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

// ---- Default export ----

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
    gzipSync,
    gunzipSync,
    deflateSync,
    inflateSync,
    deflateRawSync,
    inflateRawSync,
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
