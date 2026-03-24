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

// Check for Web Streams availability
const hasTransformStream = typeof globalThis.TransformStream === 'function';
const hasWebStreams = typeof globalThis.ReadableStream === 'function'
  && typeof globalThis.WritableStream === 'function';

/**
 * Minimal ReadableStream shim for environments without Web Streams (GJS).
 * Only supports getReader() → read()/cancel() for consuming compressed output.
 */
class SimpleReadable {
  private _chunks: Uint8Array[] = [];
  private _closed = false;
  private _waiters: Array<() => void> = [];

  /** @internal */
  _enqueue(chunk: Uint8Array): void {
    this._chunks.push(chunk);
    for (const w of this._waiters.splice(0)) w();
  }

  /** @internal */
  _close(): void {
    this._closed = true;
    for (const w of this._waiters.splice(0)) w();
  }

  getReader() {
    const self = this;
    return {
      async read(): Promise<{ done: boolean; value?: Uint8Array }> {
        while (self._chunks.length === 0 && !self._closed) {
          await new Promise<void>((r) => self._waiters.push(r));
        }
        if (self._chunks.length > 0) {
          return { done: false, value: self._chunks.shift()! };
        }
        return { done: true, value: undefined };
      },
      releaseLock() {},
      cancel() { self._closed = true; },
    };
  }
}

/**
 * Minimal WritableStream shim for environments without Web Streams (GJS).
 * Only supports getWriter() → write()/close() for feeding data.
 */
class SimpleWritable {
  private _writeFn: (chunk: Uint8Array) => void;
  private _closeFn: () => void;

  constructor(writeFn: (chunk: Uint8Array) => void, closeFn: () => void) {
    this._writeFn = writeFn;
    this._closeFn = closeFn;
  }

  getWriter() {
    const self = this;
    return {
      write(chunk: Uint8Array) { self._writeFn(chunk); return Promise.resolve(); },
      close() { self._closeFn(); return Promise.resolve(); },
      releaseLock() {},
      get ready() { return Promise.resolve(); },
    };
  }
}

/**
 * Create a stream pair that processes chunks through processFn.
 * Uses native Web Streams when available, otherwise minimal shims.
 */
function createStreamPair(
  processFn: (chunk: Uint8Array) => Uint8Array,
): { readable: any; writable: any } {
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

  if (hasWebStreams) {
    const chunks: Uint8Array[] = [];
    let closed = false;
    const waiters: Array<() => void> = [];

    const writable = new WritableStream<Uint8Array>({
      write(chunk) { chunks.push(processFn(chunk)); },
      close() { closed = true; for (const w of waiters.splice(0)) w(); },
    });

    const readable = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (chunks.length === 0 && !closed) {
          await new Promise<void>((r) => waiters.push(r));
        }
        for (const c of chunks.splice(0)) controller.enqueue(c);
        if (closed) controller.close();
      },
    });

    return { readable, writable };
  }

  // GJS fallback: no Web Streams available — use minimal shims
  const readable = new SimpleReadable();
  const writable = new SimpleWritable(
    (chunk) => readable._enqueue(processFn(chunk)),
    () => readable._close(),
  );
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
