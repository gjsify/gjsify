// W3C Compression Streams API for GJS
// Reference: refs/deno/ext/web/14_compression.js
// Uses native CompressionStream/DecompressionStream if available (Node.js 18+),
// otherwise provides a polyfill using zlib sync functions + @gjsify/web-streams.

// Import Web Streams polyfill to ensure TransformStream is available on GJS
import '@gjsify/web-streams';

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

async function loadZlib(): Promise<void> {
  if (_zlibLoaded) return;
  const zlib = await import('zlib') as any;
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
  CompressionStreamImpl = globalThis.CompressionStream as any;
  DecompressionStreamImpl = globalThis.DecompressionStream as any;
} else {
  // Initialize zlib eagerly
  const zlibReady = loadZlib();

  CompressionStreamImpl = class CompressionStream {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;

    constructor(format: CompressionFormat | string) {
      const validFormat = validateFormat(format);
      if (!_zlibLoaded) {
        throw new Error('zlib not yet loaded. Ensure module initialization is complete.');
      }
      const processFn = getCompressFn(validFormat);
      const ts = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          try {
            controller.enqueue(processFn(chunk));
          } catch (err) {
            controller.error(err);
          }
        },
      });
      this.readable = ts.readable;
      this.writable = ts.writable;
    }
  } as any;

  DecompressionStreamImpl = class DecompressionStream {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;

    constructor(format: CompressionFormat | string) {
      const validFormat = validateFormat(format);
      if (!_zlibLoaded) {
        throw new Error('zlib not yet loaded. Ensure module initialization is complete.');
      }
      const processFn = getDecompressFn(validFormat);
      const ts = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          try {
            controller.enqueue(processFn(chunk));
          } catch (err) {
            controller.error(err);
          }
        },
      });
      this.readable = ts.readable;
      this.writable = ts.writable;
    }
  } as any;
}

export { CompressionStreamImpl as CompressionStream, DecompressionStreamImpl as DecompressionStream };

export default {
  CompressionStream: CompressionStreamImpl,
  DecompressionStream: DecompressionStreamImpl,
};
