// Reference: Node.js lib/zlib.js
// Reimplemented for GJS using Web Compression API / Gio.ZlibCompressor

import type { ZlibOptions } from 'node:zlib';

type ZlibCallback = (error: Error | null, result: Uint8Array) => void;

const hasWebCompression = typeof globalThis.CompressionStream !== 'undefined';

// ---- Gio-based compression for GJS ----

type GioFormat = 'gzip' | 'deflate' | 'deflate-raw';

function compressWithGio(data: Uint8Array, format: GioFormat): Uint8Array {
  const Gio = (globalThis as any).imports?.gi?.Gio;
  if (!Gio) throw new Error('Gio not available');

  const formatMap: Record<GioFormat, number> = {
    'gzip': Gio.ZlibCompressorFormat.GZIP,
    'deflate': Gio.ZlibCompressorFormat.ZLIB,
    'deflate-raw': Gio.ZlibCompressorFormat.RAW,
  };

  const compressor = new Gio.ZlibCompressor({ format: formatMap[format] });
  const converter = new Gio.ConverterOutputStream({
    base_stream: Gio.MemoryOutputStream.new_resizable(),
    converter: compressor,
  });

  converter.write_bytes(new (globalThis as any).imports.gi.GLib.Bytes(data), null);
  converter.close(null);

  const memStream = converter.get_base_stream() as any;
  const bytes = memStream.steal_as_bytes();
  return new Uint8Array(bytes.get_data() ?? []);
}

function decompressWithGio(data: Uint8Array, format: GioFormat): Uint8Array {
  const Gio = (globalThis as any).imports?.gi?.Gio;
  if (!Gio) throw new Error('Gio not available');

  const formatMap: Record<GioFormat, number> = {
    'gzip': Gio.ZlibCompressorFormat.GZIP,
    'deflate': Gio.ZlibCompressorFormat.ZLIB,
    'deflate-raw': Gio.ZlibCompressorFormat.RAW,
  };

  const decompressor = new Gio.ZlibDecompressor({ format: formatMap[format] });
  const memInput = Gio.MemoryInputStream.new_from_bytes(
    new (globalThis as any).imports.gi.GLib.Bytes(data)
  );
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
export function gzip(data: string | Uint8Array | ArrayBuffer, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  compress(toUint8Array(data), 'gzip').then(
    result => cb(null, result),
    err => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0))
  );
}

export function gunzip(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function gunzip(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function gunzip(data: string | Uint8Array | ArrayBuffer, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  decompress(toUint8Array(data), 'gzip').then(
    result => cb(null, result),
    err => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0))
  );
}

export function deflate(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function deflate(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function deflate(data: string | Uint8Array | ArrayBuffer, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  compress(toUint8Array(data), 'deflate').then(
    result => cb(null, result),
    err => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0))
  );
}

export function inflate(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function inflate(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function inflate(data: string | Uint8Array | ArrayBuffer, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  decompress(toUint8Array(data), 'deflate').then(
    result => cb(null, result),
    err => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0))
  );
}

export function deflateRaw(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function deflateRaw(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function deflateRaw(data: string | Uint8Array | ArrayBuffer, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  compress(toUint8Array(data), 'deflate-raw').then(
    result => cb(null, result),
    err => cb(err instanceof Error ? err : new Error(String(err)), new Uint8Array(0))
  );
}

export function inflateRaw(data: string | Uint8Array | ArrayBuffer, callback: ZlibCallback): void;
export function inflateRaw(data: string | Uint8Array | ArrayBuffer, options: ZlibOptions, callback: ZlibCallback): void;
export function inflateRaw(data: string | Uint8Array | ArrayBuffer, optionsOrCallback: ZlibOptions | ZlibCallback, callback?: ZlibCallback): void {
  const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback!;
  decompress(toUint8Array(data), 'deflate-raw').then(
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
