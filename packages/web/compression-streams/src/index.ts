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
    throw new TypeError(`Unsupported compression format: '${format}'. Supported formats: 'gzip', 'deflate', 'deflate-raw'.`);
  }
  return format as CompressionFormat;
}

// Check for native support
const hasNative = typeof globalThis.CompressionStream === 'function'
  && typeof globalThis.DecompressionStream === 'function';

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
 *  with the standard `Buffer`-ish input/output shape. */
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
  const zlib = (await import('zlib')) as unknown as _ZlibSync;
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
    case 'gzip': return (c) => _gzipSync(c);
    case 'deflate': return (c) => _deflateSync(c);
    case 'deflate-raw': return (c) => _deflateRawSync(c);
  }
}

function getDecompressFn(format: CompressionFormat): (chunk: Uint8Array) => Uint8Array {
  switch (format) {
    case 'gzip': return (c) => _gunzipSync(c);
    case 'deflate': return (c) => _inflateSync(c);
    case 'deflate-raw': return (c) => _inflateRawSync(c);
  }
}

// ---- Exported classes ----

let CompressionStreamImpl: {
  new (format: CompressionFormat | string): { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
};

let DecompressionStreamImpl: {
  new (format: CompressionFormat | string): { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
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
      const ts = new TransformStream<Uint8Array, Uint8Array>({
        // Await the lazy zlib load inside the (async) transform rather than
        // requiring it at construction. `loadZlib()` is kicked off at module
        // init but resolves on a later microtask, so a CompressionStream built
        // synchronously right after import (e.g. `gjsify pack` → tar gzip)
        // would otherwise race it and throw. The GJS backend is itself sync.
        async transform(chunk, controller) {
          try {
            await zlibReady;
            controller.enqueue(getCompressFn(validFormat)(chunk));
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
      const ts = new TransformStream<Uint8Array, Uint8Array>({
        // See CompressionStream above: await the lazy zlib load in the async
        // transform to avoid the construct-before-loaded race.
        async transform(chunk, controller) {
          try {
            await zlibReady;
            controller.enqueue(getDecompressFn(validFormat)(chunk));
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
