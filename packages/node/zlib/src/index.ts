// Native zlib module for GJS — no Deno dependency
// Uses Web Compression API (CompressionStream/DecompressionStream) where available,
// falls back to Gio.ZlibCompressor/Decompressor on GJS.

type ZlibCallback = (error: Error | null, result: Uint8Array) => void;

interface ZlibOptions {
  flush?: number;
  finishFlush?: number;
  chunkSize?: number;
  windowBits?: number;
  level?: number;
  memLevel?: number;
  strategy?: number;
  dictionary?: Uint8Array | ArrayBuffer;
  info?: boolean;
  maxOutputLength?: number;
}

// ---- Compression helpers using Web Compression API ----

async function compressWithWeb(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const cs = new CompressionStream(format);
  const writer = cs.writable.getWriter();
  writer.write(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength));
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
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

async function decompressWithWeb(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength));
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
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
export function gzip(data: string | Uint8Array | ArrayBuffer, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  const buf = toUint8Array(data);
  compressWithWeb(buf, 'gzip').then(
    result => cb(null, result),
    err => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0))
  );
}

export function gunzip(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function gunzip(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function gunzip(data: string | Uint8Array | ArrayBuffer, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  const buf = toUint8Array(data);
  decompressWithWeb(buf, 'gzip').then(
    result => cb(null, result),
    err => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0))
  );
}

export function deflate(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function deflate(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function deflate(data: string | Uint8Array | ArrayBuffer, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  const buf = toUint8Array(data);
  compressWithWeb(buf, 'deflate').then(
    result => cb(null, result),
    err => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0))
  );
}

export function inflate(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function inflate(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function inflate(data: string | Uint8Array | ArrayBuffer, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  const buf = toUint8Array(data);
  decompressWithWeb(buf, 'deflate').then(
    result => cb(null, result),
    err => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0))
  );
}

export function deflateRaw(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function deflateRaw(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function deflateRaw(data: string | Uint8Array | ArrayBuffer, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  const buf = toUint8Array(data);
  compressWithWeb(buf, 'deflate-raw').then(
    result => cb(null, result),
    err => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0))
  );
}

export function inflateRaw(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function inflateRaw(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function inflateRaw(data: string | Uint8Array | ArrayBuffer, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  const buf = toUint8Array(data);
  decompressWithWeb(buf, 'deflate-raw').then(
    result => cb(null, result),
    err => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0))
  );
}

// ---- Sync API ----
// Note: True sync compression is not possible with Web Compression API.
// These stubs throw to indicate sync is not supported yet.

export function gzipSync(_data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
  throw new Error('zlib sync methods are not yet supported in GJS. Use the async API.');
}

export function gunzipSync(_data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
  throw new Error('zlib sync methods are not yet supported in GJS. Use the async API.');
}

export function deflateSync(_data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
  throw new Error('zlib sync methods are not yet supported in GJS. Use the async API.');
}

export function inflateSync(_data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
  throw new Error('zlib sync methods are not yet supported in GJS. Use the async API.');
}

export function deflateRawSync(_data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
  throw new Error('zlib sync methods are not yet supported in GJS. Use the async API.');
}

export function inflateRawSync(_data: string | Uint8Array | ArrayBuffer, _options?: ZlibOptions): Uint8Array {
  throw new Error('zlib sync methods are not yet supported in GJS. Use the async API.');
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

export default {
  gzip, gunzip, deflate, inflate, deflateRaw, inflateRaw,
  gzipSync, gunzipSync, deflateSync, inflateSync, deflateRawSync, inflateRawSync,
  constants,
};
