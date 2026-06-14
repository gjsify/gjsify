// W3C Compression Streams API for GJS
// Reference: refs/deno/ext/web/14_compression.js
// Uses native CompressionStream/DecompressionStream if available (Node.js 18+),
// otherwise provides a polyfill using zlib sync functions + @gjsify/web-streams.

// Pure named import of TransformStream — no longer relies on a side-effect
// register step to set globalThis.TransformStream. This keeps CompressionStream
// fully tree-shakeable when the user does not need compression.
import { TransformStream } from '@gjsify/web-streams';

type CompressionFormat = 'gzip' | 'deflate' | 'deflate-raw';

const VALID_FORMATS: Set<string> = new Set(['gzip', 'deflate', 'deflate-raw']);

function validateFormat(format: string): CompressionFormat {
    if (!VALID_FORMATS.has(format)) {
        throw new TypeError(
            `Unsupported compression format: '${format}'. Supported formats: 'gzip', 'deflate', 'deflate-raw'.`,
        );
    }
    return format as CompressionFormat;
}

// Check for native support
const hasNative =
    typeof globalThis.CompressionStream === 'function' && typeof globalThis.DecompressionStream === 'function';

// ---- zlib lazy loading ----

let _zlibLoaded = false;
let _gzipSync: (buf: Uint8Array) => Uint8Array;
let _gunzipSync: (buf: Uint8Array) => Uint8Array;
let _deflateSync: (buf: Uint8Array) => Uint8Array;
let _inflateSync: (buf: Uint8Array) => Uint8Array;
let _deflateRawSync: (buf: Uint8Array) => Uint8Array;
let _inflateRawSync: (buf: Uint8Array) => Uint8Array;

/** Subset of `node:zlib` that this module uses. Avoids depending on
 *  `@types/node` here — the surface we need is a handful of `*Sync` fns
 *  with the standard `Buffer`-ish input/output shape. The GJS backend's gunzip
 *  is member-aware (it decodes concatenated gzip members), which is why we run
 *  it once over the fully-buffered stream rather than per chunk. */
interface _ZlibSync {
    gzipSync: (buf: Uint8Array) => Uint8Array;
    gunzipSync: (buf: Uint8Array) => Uint8Array;
    deflateSync: (buf: Uint8Array) => Uint8Array;
    inflateSync: (buf: Uint8Array) => Uint8Array;
    deflateRawSync: (buf: Uint8Array) => Uint8Array;
    inflateRawSync: (buf: Uint8Array) => Uint8Array;
}

async function loadZlib(): Promise<void> {
    if (_zlibLoaded) return;
    const zlib = (await import('node:zlib')) as unknown as _ZlibSync;
    _gzipSync = zlib.gzipSync;
    _gunzipSync = zlib.gunzipSync;
    _deflateSync = zlib.deflateSync;
    _inflateSync = zlib.inflateSync;
    _deflateRawSync = zlib.deflateRawSync;
    _inflateRawSync = zlib.inflateRawSync;
    _zlibLoaded = true;
}

function getCompressFn(format: CompressionFormat): (chunk: Uint8Array) => Uint8Array {
    switch (format) {
        case 'gzip':
            return (c) => _gzipSync(c);
        case 'deflate':
            return (c) => _deflateSync(c);
        case 'deflate-raw':
            return (c) => _deflateRawSync(c);
    }
}

function getDecompressFn(format: CompressionFormat): (chunk: Uint8Array) => Uint8Array {
    switch (format) {
        case 'gzip':
            return (c) => _gunzipSync(c);
        case 'deflate':
            return (c) => _inflateSync(c);
        case 'deflate-raw':
            return (c) => _inflateRawSync(c);
    }
}

/** Concatenate the buffered stream chunks into one contiguous buffer. */
function concatChunks(chunks: Uint8Array[]): Uint8Array {
    if (chunks.length === 1) return chunks[0];
    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.length;
    }
    return out;
}

// ---- Exported classes ----

let CompressionStreamImpl: {
    new (format: CompressionFormat | string): {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
    };
};

let DecompressionStreamImpl: {
    new (format: CompressionFormat | string): {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
    };
};

if (hasNative) {
    // The native lib.dom `CompressionStream` / `DecompressionStream`
    // constructors return browser-typed `ReadableStream`/`WritableStream`
    // that we type as the local impl (same runtime shape). One structural
    // cast per assignment.
    CompressionStreamImpl = globalThis.CompressionStream as unknown as typeof CompressionStreamImpl;
    DecompressionStreamImpl = globalThis.DecompressionStream as unknown as typeof DecompressionStreamImpl;
} else {
    // Initialize zlib eagerly
    const zlibReady = loadZlib();

    CompressionStreamImpl = class CompressionStream {
        readonly readable: ReadableStream<Uint8Array>;
        readonly writable: WritableStream<Uint8Array>;

        constructor(format: CompressionFormat | string) {
            const validFormat = validateFormat(format);
            const collected: Uint8Array[] = [];
            const ts = new TransformStream<Uint8Array, Uint8Array>({
                // BUFFER every chunk and run the (de)compressor ONCE over the
                // concatenated stream in `flush`, instead of compressing each
                // chunk independently. The GJS zlib backend's `*Sync` functions
                // are one-shot — they encode/decode a complete member and emit a
                // self-contained gzip/deflate stream (with its own header +
                // trailer). Calling them per chunk produces concatenated members
                // on compress, and FAILS on decompress whenever a single
                // compressed stream is split across chunks (a 4 KB+ gzip body —
                // the norm for any non-trivial fetch response — arrives in
                // several `read_bytes` chunks; the first chunk alone is not a
                // complete gzip stream, so `Gio.ZlibDecompressor` raises
                // "Ungültige komprimierte Daten" / "Weitere Eingaben
                // erforderlich"). Native (Node/browser) DecompressionStream keeps
                // inflate state across chunks; concatenating before a single
                // decode is the equivalent for the one-shot GJS backend and
                // mirrors `@gjsify/zlib`'s own `ZlibTransform` (_flush decode).
                transform(chunk) {
                    collected.push(chunk);
                },
                async flush(controller) {
                    try {
                        await zlibReady;
                        const out = getCompressFn(validFormat)(concatChunks(collected));
                        if (out.length > 0) controller.enqueue(out);
                    } catch (err) {
                        controller.error(err);
                    }
                },
            });
            this.readable = ts.readable;
            this.writable = ts.writable;
        }
    };

    DecompressionStreamImpl = class DecompressionStream {
        readonly readable: ReadableStream<Uint8Array>;
        readonly writable: WritableStream<Uint8Array>;

        constructor(format: CompressionFormat | string) {
            const validFormat = validateFormat(format);
            const collected: Uint8Array[] = [];
            const ts = new TransformStream<Uint8Array, Uint8Array>({
                // See CompressionStream above: accumulate the whole compressed
                // body, then decode it in one pass at flush. This is what makes a
                // multi-chunk gzip/deflate response (the Norman fetch failure)
                // decode correctly on GJS.
                transform(chunk) {
                    collected.push(chunk);
                },
                async flush(controller) {
                    try {
                        await zlibReady;
                        const out = getDecompressFn(validFormat)(concatChunks(collected));
                        if (out.length > 0) controller.enqueue(out);
                    } catch (err) {
                        controller.error(err);
                    }
                },
            });
            this.readable = ts.readable;
            this.writable = ts.writable;
        }
    };
}

// Note: globals are no longer registered at import time. Use the `/register`
// subpath (`import '@gjsify/compression-streams/register'`) if you need
// globalThis.CompressionStream / DecompressionStream to be set on GJS.

export { CompressionStreamImpl as CompressionStream, DecompressionStreamImpl as DecompressionStream };

export default {
    CompressionStream: CompressionStreamImpl,
    DecompressionStream: DecompressionStreamImpl,
};
