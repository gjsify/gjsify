// Reference: Node.js lib/zlib.js (createGzip, createDeflate, etc.)
// Reimplemented for GJS using Gio.ZlibCompressor wrapped in a Node Transform stream.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Transform } from 'node:stream';
import type { TransformOptions } from 'node:stream';
import type { ZlibOptions } from 'node:zlib';

type GioFormat = 'gzip' | 'deflate' | 'deflate-raw';

function getGioCompressorFormat(format: GioFormat): Gio.ZlibCompressorFormat {
  switch (format) {
    case 'gzip': return Gio.ZlibCompressorFormat.GZIP;
    case 'deflate': return Gio.ZlibCompressorFormat.ZLIB;
    case 'deflate-raw': return Gio.ZlibCompressorFormat.RAW;
  }
}

function getGioDecompressorFormat(format: GioFormat): Gio.ZlibCompressorFormat {
  return getGioCompressorFormat(format);
}

function toUint8Array(chunk: Uint8Array | string): Uint8Array {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
}

export class ZlibTransform extends Transform {
  private _format: GioFormat;
  private _mode: 'compress' | 'decompress';
  private _chunks: Uint8Array[] = [];

  constructor(format: GioFormat, mode: 'compress' | 'decompress', options?: ZlibOptions) {
    super(options as unknown as TransformOptions);
    this._format = format;
    this._mode = mode;
  }

  _transform(chunk: unknown, _encoding: string, callback: (err?: Error) => void): void {
    this._chunks.push(toUint8Array(chunk as Uint8Array | string));
    callback();
  }

  _flush(callback: (err?: Error) => void): void {
    const totalLength = this._chunks.reduce((acc, c) => acc + c.length, 0);
    const input = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of this._chunks) { input.set(c, offset); offset += c.length; }
    this._chunks = [];

    try {
      const result = this._mode === 'compress'
        ? this._compress(input)
        : this._decompress(input);
      this.push(Buffer.from(result));
      callback();
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private _compress(data: Uint8Array): Uint8Array {
    const compressor = new Gio.ZlibCompressor({ format: getGioCompressorFormat(this._format) });
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

  private _decompress(data: Uint8Array): Uint8Array {
    const decompressor = new Gio.ZlibDecompressor({ format: getGioDecompressorFormat(this._format) });
    const memInput = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(data));
    const converter = new Gio.ConverterInputStream({
      base_stream: memInput,
      converter: decompressor,
    });

    const chunks: Uint8Array[] = [];
    const bufSize = 4096;
    while (true) {
      const bytes = converter.read_bytes(bufSize, null);
      if (bytes.get_size() === 0) break;
      chunks.push(new Uint8Array(bytes.get_data()!));
    }
    converter.close(null);

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLength);
    let off = 0;
    for (const c of chunks) { result.set(c, off); off += c.length; }
    return result;
  }
}

// ---- Factory functions (mirror Node.js API) ----

export function createGzip(options?: ZlibOptions): ZlibTransform {
  return new ZlibTransform('gzip', 'compress', options);
}

export function createGunzip(options?: ZlibOptions): ZlibTransform {
  return new ZlibTransform('gzip', 'decompress', options);
}

export function createDeflate(options?: ZlibOptions): ZlibTransform {
  return new ZlibTransform('deflate', 'compress', options);
}

export function createInflate(options?: ZlibOptions): ZlibTransform {
  return new ZlibTransform('deflate', 'decompress', options);
}

export function createDeflateRaw(options?: ZlibOptions): ZlibTransform {
  return new ZlibTransform('deflate-raw', 'compress', options);
}

export function createInflateRaw(options?: ZlibOptions): ZlibTransform {
  return new ZlibTransform('deflate-raw', 'decompress', options);
}

export function createUnzip(options?: ZlibOptions): ZlibTransform {
  // Unzip auto-detects gzip vs deflate — default to gzip for GJS
  return new ZlibTransform('gzip', 'decompress', options);
}

// Brotli is not available in GLib — stubs that throw at runtime
export function createBrotliCompress(_options?: ZlibOptions): never {
  throw new Error('createBrotliCompress is not supported on GJS (no Brotli in GLib)');
}

export function createBrotliDecompress(_options?: ZlibOptions): never {
  throw new Error('createBrotliDecompress is not supported on GJS (no Brotli in GLib)');
}
