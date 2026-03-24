// W3C Compression Streams API for GJS
// Reference: refs/deno/ext/web/14_compression.js
// Uses native CompressionStream/DecompressionStream if available (Node.js 18+),
// otherwise provides a polyfill using zlib sync functions.

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

// Check for native TransformStream
const hasTransformStream = typeof globalThis.TransformStream === 'function';

/**
 * A simple stream pair that collects input on the writable side,
 * processes it (compress/decompress), and produces output on the readable side.
 * Uses TransformStream if available, otherwise builds a manual pair.
 */
function createStreamPair(
  processFn: (chunk: Uint8Array) => Uint8Array,
): { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } {
  if (hasTransformStream) {
    const ts = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        try {
          controller.enqueue(processFn(chunk));
        } catch (err) {
          controller.error(err);
        }
      },
    });
    return { readable: ts.readable, writable: ts.writable };
  }

  // Manual implementation without TransformStream (for GJS)
  const chunks: Uint8Array[] = [];
  let resolveReadable: ((value: ReadableStream<Uint8Array>) => void) | null = null;
  let streamClosed = false;

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      try {
        chunks.push(processFn(chunk));
      } catch (err) {
        throw err;
      }
    },
    close() {
      streamClosed = true;
    },
  });

  const readable = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Wait for writable to close
      while (!streamClosed) {
        await new Promise((r) => setTimeout(r, 1));
      }
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  return { readable, writable };
}

// ---- Polyfill implementations ----

// Import zlib synchronously — the bundler resolves this to @gjsify/zlib on GJS
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
  // Initialize zlib eagerly so sync functions are available
  const zlibReady = loadZlib();

  CompressionStreamImpl = class CompressionStream {
    readonly readable: ReadableStream<Uint8Array>;
    readonly writable: WritableStream<Uint8Array>;

    constructor(format: CompressionFormat | string) {
      const validFormat = validateFormat(format);
      if (!_zlibLoaded) {
        throw new Error('zlib not yet loaded. Ensure module initialization is complete.');
      }
      const pair = createStreamPair(getCompressFn(validFormat));
      this.readable = pair.readable;
      this.writable = pair.writable;
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
      const pair = createStreamPair(getDecompressFn(validFormat));
      this.readable = pair.readable;
      this.writable = pair.writable;
    }
  } as any;
}

export { CompressionStreamImpl as CompressionStream, DecompressionStreamImpl as DecompressionStream };

export default {
  CompressionStream: CompressionStreamImpl,
  DecompressionStream: DecompressionStreamImpl,
};
