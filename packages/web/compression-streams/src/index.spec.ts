// Tests for W3C Compression Streams API
// Reference: refs/wpt/compression/

import { describe, it, expect } from '@gjsify/unit';
import { CompressionStream, DecompressionStream } from './index.js';

export default async () => {

  // ==================== CompressionStream ====================

  await describe('CompressionStream', async () => {
    await it('should be a constructor', async () => {
      expect(typeof CompressionStream).toBe('function');
    });

    await it('should accept gzip format', async () => {
      const cs = new CompressionStream('gzip');
      expect(cs).toBeDefined();
      expect(cs.readable).toBeDefined();
      expect(cs.writable).toBeDefined();
    });

    await it('should accept deflate format', async () => {
      const cs = new CompressionStream('deflate');
      expect(cs).toBeDefined();
    });

    await it('should accept deflate-raw format', async () => {
      const cs = new CompressionStream('deflate-raw');
      expect(cs).toBeDefined();
    });

    await it('should reject unsupported format', async () => {
      // Native implementations may throw TypeError or other errors
      let threw = false;
      try {
        new CompressionStream('invalid-format-xyz' as any);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should have readable and writable properties', async () => {
      const cs = new CompressionStream('gzip');
      expect(cs.readable instanceof ReadableStream).toBe(true);
      expect(cs.writable instanceof WritableStream).toBe(true);
    });

    await it('should compress data with gzip', async () => {
      const cs = new CompressionStream('gzip');
      const input = new TextEncoder().encode('Hello, World!');

      const writer = cs.writable.getWriter();
      const reader = cs.readable.getReader();

      writer.write(input);
      writer.close();

      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Compressed output should exist and be non-empty
      expect(chunks.length > 0).toBe(true);
      const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
      expect(totalSize > 0).toBe(true);

      // Gzip magic bytes: 0x1f 0x8b
      expect(chunks[0][0]).toBe(0x1f);
      expect(chunks[0][1]).toBe(0x8b);
    });
  });

  // ==================== DecompressionStream ====================

  await describe('DecompressionStream', async () => {
    await it('should be a constructor', async () => {
      expect(typeof DecompressionStream).toBe('function');
    });

    await it('should accept gzip format', async () => {
      const ds = new DecompressionStream('gzip');
      expect(ds).toBeDefined();
      expect(ds.readable).toBeDefined();
      expect(ds.writable).toBeDefined();
    });

    await it('should accept deflate format', async () => {
      const ds = new DecompressionStream('deflate');
      expect(ds).toBeDefined();
    });

    await it('should accept deflate-raw format', async () => {
      const ds = new DecompressionStream('deflate-raw');
      expect(ds).toBeDefined();
    });

    await it('should reject unsupported format', async () => {
      let threw = false;
      try {
        new DecompressionStream('invalid-format-xyz' as any);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should have readable and writable properties', async () => {
      const ds = new DecompressionStream('gzip');
      expect(ds.readable instanceof ReadableStream).toBe(true);
      expect(ds.writable instanceof WritableStream).toBe(true);
    });
  });

  // ==================== Round-trip ====================

  await describe('Compression round-trip', async () => {
    await it('should compress and decompress gzip', async () => {
      const original = 'The quick brown fox jumps over the lazy dog';
      const input = new TextEncoder().encode(original);

      // Compress
      const cs = new CompressionStream('gzip');
      const csWriter = cs.writable.getWriter();
      const csReader = cs.readable.getReader();

      csWriter.write(input);
      csWriter.close();

      const compressed: Uint8Array[] = [];
      while (true) {
        const { done, value } = await csReader.read();
        if (done) break;
        compressed.push(value);
      }

      // Combine compressed chunks
      let totalLen = 0;
      for (const c of compressed) totalLen += c.length;
      const compressedData = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of compressed) {
        compressedData.set(c, offset);
        offset += c.length;
      }

      // Decompress
      const ds = new DecompressionStream('gzip');
      const dsWriter = ds.writable.getWriter();
      const dsReader = ds.readable.getReader();

      dsWriter.write(compressedData);
      dsWriter.close();

      const decompressed: Uint8Array[] = [];
      while (true) {
        const { done, value } = await dsReader.read();
        if (done) break;
        decompressed.push(value);
      }

      let decompressedLen = 0;
      for (const c of decompressed) decompressedLen += c.length;
      const result = new Uint8Array(decompressedLen);
      let off = 0;
      for (const c of decompressed) {
        result.set(c, off);
        off += c.length;
      }

      const decoded = new TextDecoder().decode(result);
      expect(decoded).toBe(original);
    });

    await it('should compress and decompress deflate', async () => {
      const original = 'Hello, deflate compression!';
      const input = new TextEncoder().encode(original);

      // Compress
      const cs = new CompressionStream('deflate');
      const csWriter = cs.writable.getWriter();
      const csReader = cs.readable.getReader();
      csWriter.write(input);
      csWriter.close();

      const compressed: Uint8Array[] = [];
      while (true) {
        const { done, value } = await csReader.read();
        if (done) break;
        compressed.push(value);
      }

      let totalLen = 0;
      for (const c of compressed) totalLen += c.length;
      const compressedData = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of compressed) {
        compressedData.set(c, offset);
        offset += c.length;
      }

      // Decompress
      const ds = new DecompressionStream('deflate');
      const dsWriter = ds.writable.getWriter();
      const dsReader = ds.readable.getReader();
      dsWriter.write(compressedData);
      dsWriter.close();

      const decompressed: Uint8Array[] = [];
      while (true) {
        const { done, value } = await dsReader.read();
        if (done) break;
        decompressed.push(value);
      }

      let decompressedLen = 0;
      for (const c of decompressed) decompressedLen += c.length;
      const result = new Uint8Array(decompressedLen);
      let off = 0;
      for (const c of decompressed) {
        result.set(c, off);
        off += c.length;
      }

      const decoded = new TextDecoder().decode(result);
      expect(decoded).toBe(original);
    });

    await it('should compress and decompress deflate-raw', async () => {
      const original = 'Raw deflate test data';
      const input = new TextEncoder().encode(original);

      const cs = new CompressionStream('deflate-raw');
      const csWriter = cs.writable.getWriter();
      const csReader = cs.readable.getReader();
      csWriter.write(input);
      csWriter.close();

      const compressed: Uint8Array[] = [];
      while (true) {
        const { done, value } = await csReader.read();
        if (done) break;
        compressed.push(value);
      }

      let totalLen = 0;
      for (const c of compressed) totalLen += c.length;
      const compressedData = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of compressed) {
        compressedData.set(c, offset);
        offset += c.length;
      }

      const ds = new DecompressionStream('deflate-raw');
      const dsWriter = ds.writable.getWriter();
      const dsReader = ds.readable.getReader();
      dsWriter.write(compressedData);
      dsWriter.close();

      const decompressed: Uint8Array[] = [];
      while (true) {
        const { done, value } = await dsReader.read();
        if (done) break;
        decompressed.push(value);
      }

      let decompressedLen = 0;
      for (const c of decompressed) decompressedLen += c.length;
      const result = new Uint8Array(decompressedLen);
      let off = 0;
      for (const c of decompressed) {
        result.set(c, off);
        off += c.length;
      }

      const decoded = new TextDecoder().decode(result);
      expect(decoded).toBe(original);
    });
  });
};
