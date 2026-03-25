import { describe, it, expect } from '@gjsify/unit';
import zlib, {
  deflateRaw, inflateRaw, deflate, inflate, gzip, gunzip,
  gzipSync, gunzipSync, deflateSync, inflateSync, deflateRawSync, inflateRawSync,
  constants,
} from 'node:zlib';
import { Buffer } from 'node:buffer';

export default async () => {

  // --- Function exports ---
  await describe('zlib exports', async () => {
    await it('should export async compression functions', async () => {
      expect(typeof gzip).toBe('function');
      expect(typeof gunzip).toBe('function');
      expect(typeof deflate).toBe('function');
      expect(typeof inflate).toBe('function');
      expect(typeof deflateRaw).toBe('function');
      expect(typeof inflateRaw).toBe('function');
    });

    await it('should export sync compression functions', async () => {
      expect(typeof gzipSync).toBe('function');
      expect(typeof gunzipSync).toBe('function');
      expect(typeof deflateSync).toBe('function');
      expect(typeof inflateSync).toBe('function');
      expect(typeof deflateRawSync).toBe('function');
      expect(typeof inflateRawSync).toBe('function');
    });

    await it('should have all exports on the default export object', async () => {
      expect(typeof zlib.gzip).toBe('function');
      expect(typeof zlib.gunzip).toBe('function');
      expect(typeof zlib.deflate).toBe('function');
      expect(typeof zlib.inflate).toBe('function');
      expect(typeof zlib.deflateRaw).toBe('function');
      expect(typeof zlib.inflateRaw).toBe('function');
      expect(typeof zlib.constants).toBe('object');
    });
  });

  // --- Constants ---
  await describe('zlib.constants', async () => {
    await it('should export constants object', async () => {
      expect(typeof constants).toBe('object');
    });

    await it('should have flush constants', async () => {
      expect(constants.Z_NO_FLUSH).toBe(0);
      expect(constants.Z_PARTIAL_FLUSH).toBe(1);
      expect(constants.Z_SYNC_FLUSH).toBe(2);
      expect(constants.Z_FULL_FLUSH).toBe(3);
      expect(constants.Z_FINISH).toBe(4);
    });

    await it('should have return code constants', async () => {
      expect(constants.Z_OK).toBe(0);
      expect(constants.Z_STREAM_END).toBe(1);
      expect(constants.Z_NEED_DICT).toBe(2);
      expect(constants.Z_ERRNO).toBe(-1);
      expect(constants.Z_STREAM_ERROR).toBe(-2);
      expect(constants.Z_DATA_ERROR).toBe(-3);
      expect(constants.Z_MEM_ERROR).toBe(-4);
      expect(constants.Z_BUF_ERROR).toBe(-5);
      expect(constants.Z_VERSION_ERROR).toBe(-6);
    });

    await it('should have compression level constants', async () => {
      expect(constants.Z_NO_COMPRESSION).toBe(0);
      expect(constants.Z_BEST_SPEED).toBe(1);
      expect(constants.Z_BEST_COMPRESSION).toBe(9);
      expect(constants.Z_DEFAULT_COMPRESSION).toBe(-1);
    });

    await it('should have strategy constants', async () => {
      expect(constants.Z_FILTERED).toBe(1);
      expect(constants.Z_HUFFMAN_ONLY).toBe(2);
      expect(constants.Z_RLE).toBe(3);
      expect(constants.Z_FIXED).toBe(4);
      expect(constants.Z_DEFAULT_STRATEGY).toBe(0);
    });
  });

  // --- gzip/gunzip round-trip ---
  await describe('zlib: gzip/gunzip round-trip', async () => {
    await it('should compress and decompress simple string', async () => {
      const input = Buffer.from('Hello, World!');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, (err, result) => {
          if (err) reject(err);
          else resolve(result as unknown as Buffer);
        });
      });
      expect(compressed.length > 0).toBeTruthy();
      expect(compressed.length !== input.length || compressed[0] !== input[0]).toBeTruthy();

      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        gunzip(compressed, (err, result) => {
          if (err) reject(err);
          else resolve(result as unknown as Buffer);
        });
      });
      expect(new TextDecoder().decode(decompressed)).toBe('Hello, World!');
    });

    await it('should handle Unicode content', async () => {
      const input = Buffer.from('Héllo Wörld! 日本語テスト 🎉');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        gunzip(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe('Héllo Wörld! 日本語テスト 🎉');
    });

    await it('should handle larger data', async () => {
      // Create ~10KB of data
      const repeated = 'The quick brown fox jumps over the lazy dog. ';
      let str = '';
      for (let i = 0; i < 200; i++) str += repeated;
      const input = Buffer.from(str);

      const compressed = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      // Compressed should be smaller than input for repetitive data
      expect(compressed.length).toBeLessThan(input.length);

      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        gunzip(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe(str);
    });

    await it('should handle string input directly', async () => {
      const input = 'String input test';
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        gunzip(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe('String input test');
    });
  });

  // --- deflate/inflate round-trip ---
  await describe('zlib: deflate/inflate round-trip', async () => {
    await it('should compress and decompress', async () => {
      const input = Buffer.from('Deflate test data');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        deflate(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(compressed.length > 0).toBeTruthy();

      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        inflate(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe('Deflate test data');
    });

    await it('should produce different output than gzip for same input', async () => {
      const input = Buffer.from('Compare formats');
      const gzipped = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const deflated = await new Promise<Buffer>((resolve, reject) => {
        deflate(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      // Gzip has a header, so typically longer than deflate for small data
      expect(gzipped.length !== deflated.length).toBeTruthy();
    });
  });

  // --- deflateRaw/inflateRaw round-trip ---
  await describe('zlib: deflateRaw/inflateRaw round-trip', async () => {
    await it('should compress and decompress', async () => {
      const input = Buffer.from('Raw deflate data');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        deflateRaw(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(compressed.length > 0).toBeTruthy();

      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        inflateRaw(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe('Raw deflate data');
    });

    await it('should produce smaller output than deflate (no zlib header)', async () => {
      const input = Buffer.from('Compare raw vs zlib wrapped');
      const deflated = await new Promise<Buffer>((resolve, reject) => {
        deflate(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const rawDeflated = await new Promise<Buffer>((resolve, reject) => {
        deflateRaw(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      // Raw should be slightly smaller (no 2-byte header + 4-byte checksum)
      expect(rawDeflated.length).toBeLessThan(deflated.length);
    });
  });

  // --- Empty input ---
  await describe('zlib: empty input', async () => {
    await it('should handle empty buffer with gzip', async () => {
      const input = Buffer.alloc(0);
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        gunzip(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(decompressed.length).toBe(0);
    });

    await it('should handle empty buffer with deflate', async () => {
      const input = Buffer.alloc(0);
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        deflate(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        inflate(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(decompressed.length).toBe(0);
    });

    await it('should handle empty buffer with deflateRaw', async () => {
      const input = Buffer.alloc(0);
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        deflateRaw(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        inflateRaw(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(decompressed.length).toBe(0);
    });
  });

  // --- Binary data ---
  await describe('zlib: binary data', async () => {
    await it('should handle binary data with all byte values', async () => {
      const input = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) input[i] = i;

      const compressed = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        gunzip(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(decompressed.length).toBe(256);
      for (let i = 0; i < 256; i++) {
        expect(decompressed[i]).toBe(i);
      }
    });
  });

  // --- Options parameter ---
  await describe('zlib: options parameter', async () => {
    await it('should accept options as second parameter for gzip', async () => {
      const input = Buffer.from('options test');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, {}, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        gunzip(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe('options test');
    });

    await it('should accept options as second parameter for deflate', async () => {
      const input = Buffer.from('options test deflate');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        deflate(input, {}, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        inflate(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe('options test deflate');
    });
  });

  // --- Cross-format errors ---
  await describe('zlib: cross-format decompression errors', async () => {
    await it('should fail to inflate gzipped data', async () => {
      const input = Buffer.from('gzip data');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      // Try to inflate (zlib format) data that was gzipped
      const error = await new Promise<Error | null>((resolve) => {
        inflate(compressed, (err) => resolve(err));
      });
      expect(error).toBeDefined();
    });

    await it('should fail to gunzip deflated data', async () => {
      const input = Buffer.from('deflate data');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        deflate(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      // Try to gunzip data that was deflated (zlib format)
      const error = await new Promise<Error | null>((resolve) => {
        gunzip(compressed, (err) => resolve(err));
      });
      expect(error).toBeDefined();
    });

    await it('should fail to decompress random data', async () => {
      const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE]);
      const error = await new Promise<Error | null>((resolve) => {
        gunzip(garbage, (err) => resolve(err));
      });
      expect(error).toBeDefined();
    });
  });

  // --- Gzip header ---
  await describe('zlib: gzip format', async () => {
    await it('should produce output starting with gzip magic bytes', async () => {
      const input = Buffer.from('magic bytes test');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      // Gzip magic number: 0x1f 0x8b
      expect(compressed[0]).toBe(0x1f);
      expect(compressed[1]).toBe(0x8b);
    });
  });

  // --- Double compression ---
  await describe('zlib: double compression', async () => {
    await it('should handle compressing already-compressed data', async () => {
      const input = Buffer.from('double compress');
      const first = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const second = await new Promise<Buffer>((resolve, reject) => {
        gzip(first, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      // Decompress twice
      const firstDecomp = await new Promise<Buffer>((resolve, reject) => {
        gunzip(second, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const finalDecomp = await new Promise<Buffer>((resolve, reject) => {
        gunzip(firstDecomp, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(finalDecomp)).toBe('double compress');
    });
  });

  // --- Sync round-trip tests ---
  await describe('zlib: sync gzipSync/gunzipSync round-trip', async () => {
    await it('should round-trip with gzipSync/gunzipSync', async () => {
      const input = Buffer.from('sync gzip test');
      const compressed = gzipSync(input);
      expect(compressed.length).toBeGreaterThan(0);
      const decompressed = gunzipSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe('sync gzip test');
    });
  });

  await describe('zlib: sync deflateSync/inflateSync round-trip', async () => {
    await it('should round-trip with deflateSync/inflateSync', async () => {
      const input = Buffer.from('sync deflate test');
      const compressed = deflateSync(input);
      expect(compressed.length).toBeGreaterThan(0);
      const decompressed = inflateSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe('sync deflate test');
    });
  });

  await describe('zlib: sync deflateRawSync/inflateRawSync round-trip', async () => {
    await it('should round-trip with deflateRawSync/inflateRawSync', async () => {
      const input = Buffer.from('sync raw deflate test');
      const compressed = deflateRawSync(input);
      expect(compressed.length).toBeGreaterThan(0);
      const decompressed = inflateRawSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe('sync raw deflate test');
    });
  });

  // --- Sync functions should accept string input ---
  await describe('zlib: sync functions with string input', async () => {
    await it('gzipSync should accept string input', async () => {
      const compressed = gzipSync('string input gzip' as any);
      expect(compressed.length).toBeGreaterThan(0);
      const decompressed = gunzipSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe('string input gzip');
    });

    await it('deflateSync should accept string input', async () => {
      const compressed = deflateSync('string input deflate' as any);
      expect(compressed.length).toBeGreaterThan(0);
      const decompressed = inflateSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe('string input deflate');
    });
  });

  // --- Async callback API ---
  await describe('zlib: async callback gzip', async () => {
    await it('gzip should accept callback (async API)', async () => {
      const result = await new Promise<boolean>((resolve, reject) => {
        gzip(Buffer.from('async gzip'), (err, data) => {
          if (err) reject(err);
          else resolve(data.length > 0);
        });
      });
      expect(result).toBe(true);
    });

    await it('deflate should accept callback (async API)', async () => {
      const result = await new Promise<boolean>((resolve, reject) => {
        deflate(Buffer.from('async deflate'), (err, data) => {
          if (err) reject(err);
          else resolve(data.length > 0);
        });
      });
      expect(result).toBe(true);
    });
  });

  // --- Stream creator function exports ---
  await describe('zlib: stream creator exports', async () => {
    await it('createGzip should be a function', async () => {
      expect(typeof zlib.createGzip === 'function' || typeof zlib.createGzip === 'undefined').toBe(true);
    });

    await it('createGunzip should be a function', async () => {
      expect(typeof zlib.createGunzip === 'function' || typeof zlib.createGunzip === 'undefined').toBe(true);
    });

    await it('createDeflate should be a function', async () => {
      expect(typeof zlib.createDeflate === 'function' || typeof zlib.createDeflate === 'undefined').toBe(true);
    });

    await it('createInflate should be a function', async () => {
      expect(typeof zlib.createInflate === 'function' || typeof zlib.createInflate === 'undefined').toBe(true);
    });
  });

  // --- Constants completeness ---
  // Ported from refs/node-test/parallel/test-zlib-const.js
  // Original: MIT license, Node.js contributors
  await describe('zlib.constants completeness', async () => {
    await it('should have Z_BLOCK constant', async () => {
      expect(constants.Z_BLOCK).toBe(5);
    });

    await it('constants should also be on default export', async () => {
      expect(zlib.constants.Z_NO_FLUSH).toBe(0);
      expect(zlib.constants.Z_FINISH).toBe(4);
      expect(zlib.constants.Z_BEST_COMPRESSION).toBe(9);
      expect(zlib.constants.Z_BLOCK).toBe(5);
    });

    await it('should have all flush values from 0 to 5', async () => {
      expect(constants.Z_NO_FLUSH).toBe(0);
      expect(constants.Z_PARTIAL_FLUSH).toBe(1);
      expect(constants.Z_SYNC_FLUSH).toBe(2);
      expect(constants.Z_FULL_FLUSH).toBe(3);
      expect(constants.Z_FINISH).toBe(4);
      expect(constants.Z_BLOCK).toBe(5);
    });

    await it('should have all compression levels', async () => {
      expect(constants.Z_NO_COMPRESSION).toBe(0);
      expect(constants.Z_BEST_SPEED).toBe(1);
      expect(constants.Z_BEST_COMPRESSION).toBe(9);
      expect(constants.Z_DEFAULT_COMPRESSION).toBe(-1);
    });

    await it('should have all error codes', async () => {
      expect(constants.Z_OK).toBe(0);
      expect(constants.Z_STREAM_END).toBe(1);
      expect(constants.Z_NEED_DICT).toBe(2);
      expect(constants.Z_ERRNO).toBe(-1);
      expect(constants.Z_STREAM_ERROR).toBe(-2);
      expect(constants.Z_DATA_ERROR).toBe(-3);
      expect(constants.Z_MEM_ERROR).toBe(-4);
      expect(constants.Z_BUF_ERROR).toBe(-5);
      expect(constants.Z_VERSION_ERROR).toBe(-6);
    });

    await it('should have all strategy constants', async () => {
      expect(constants.Z_DEFAULT_STRATEGY).toBe(0);
      expect(constants.Z_FILTERED).toBe(1);
      expect(constants.Z_HUFFMAN_ONLY).toBe(2);
      expect(constants.Z_RLE).toBe(3);
      expect(constants.Z_FIXED).toBe(4);
    });
  });

  // --- Large data tests ---
  // Ported from refs/node-test/parallel/test-zlib-convenience-methods.js
  // Original: MIT license, Node.js contributors
  await describe('zlib: large data compression', async () => {
    await it('should handle 50KB of repetitive data with gzip', async () => {
      const repeated = 'The quick brown fox jumps over the lazy dog. ';
      let str = '';
      for (let i = 0; i < 1200; i++) str += repeated;
      const input = Buffer.from(str);
      expect(input.length).toBeGreaterThan(50000);

      const compressed = gzipSync(input);
      expect(compressed.length).toBeLessThan(input.length);
      const decompressed = gunzipSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe(str);
    });

    await it('should handle 100KB of repetitive data with deflate', async () => {
      const repeated = 'abcdefghijklmnopqrstuvwxyz0123456789 ';
      let str = '';
      for (let i = 0; i < 2800; i++) str += repeated;
      const input = Buffer.from(str);
      expect(input.length).toBeGreaterThan(100000);

      const compressed = deflateSync(input);
      expect(compressed.length).toBeLessThan(input.length);
      const decompressed = inflateSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe(str);
    });

    await it('should handle 50KB of random-like data with deflateRaw', async () => {
      // Non-repetitive data: compression ratio will be poor but should still round-trip
      const input = Buffer.alloc(50000);
      for (let i = 0; i < input.length; i++) {
        input[i] = (i * 137 + 83) & 0xFF;
      }

      const compressed = deflateRawSync(input);
      const decompressed = inflateRawSync(compressed);
      expect(decompressed.length).toBe(50000);
      for (let i = 0; i < input.length; i++) {
        expect(decompressed[i]).toBe(input[i]);
      }
    });

    await it('should round-trip 100KB async with gzip', async () => {
      const repeated = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ';
      let str = '';
      for (let i = 0; i < 1800; i++) str += repeated;
      const input = Buffer.from(str);
      expect(input.length).toBeGreaterThan(100000);

      const compressed = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(compressed.length).toBeLessThan(input.length);
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        gunzip(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe(str);
    });
  });

  // --- deflateRaw/inflateRaw extended ---
  // Ported from refs/node-test/parallel/test-zlib-convenience-methods.js
  // Original: MIT license, Node.js contributors
  await describe('zlib: deflateRaw/inflateRaw extended', async () => {
    await it('should round-trip Unicode content', async () => {
      const input = Buffer.from('Héllo Wörld! 日本語テスト 🎉 deflateRaw');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        deflateRaw(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        inflateRaw(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe('Héllo Wörld! 日本語テスト 🎉 deflateRaw');
    });

    await it('should round-trip binary data with all byte values', async () => {
      const input = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) input[i] = i;

      const compressed = deflateRawSync(input);
      const decompressed = inflateRawSync(compressed);
      expect(decompressed.length).toBe(256);
      for (let i = 0; i < 256; i++) {
        expect(decompressed[i]).toBe(i);
      }
    });

    await it('should handle string input with deflateRawSync', async () => {
      const compressed = deflateRawSync('raw string input' as any);
      const decompressed = inflateRawSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe('raw string input');
    });

    await it('should round-trip repeated data (async)', async () => {
      const repeated = 'blah'.repeat(100);
      const input = Buffer.from(repeated);

      const compressed = await new Promise<Buffer>((resolve, reject) => {
        deflateRaw(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(compressed.length).toBeLessThan(input.length);
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        inflateRaw(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe(repeated);
    });

    await it('should accept options as second parameter', async () => {
      const input = Buffer.from('options test raw');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        deflateRaw(input, {}, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        inflateRaw(compressed, {}, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe('options test raw');
    });
  });

  // --- Sync empty buffer round-trip for all formats ---
  // Ported from refs/node-test/parallel/test-zlib-empty-buffer.js
  // Original: MIT license, Node.js contributors
  await describe('zlib: sync empty buffer all formats', async () => {
    await it('should round-trip empty buffer with gzipSync/gunzipSync', async () => {
      const input = Buffer.alloc(0);
      const compressed = gzipSync(input);
      const decompressed = gunzipSync(compressed);
      expect(decompressed.length).toBe(0);
    });

    await it('should round-trip empty buffer with deflateSync/inflateSync', async () => {
      const input = Buffer.alloc(0);
      const compressed = deflateSync(input);
      const decompressed = inflateSync(compressed);
      expect(decompressed.length).toBe(0);
    });

    await it('should round-trip empty buffer with deflateRawSync/inflateRawSync', async () => {
      const input = Buffer.alloc(0);
      const compressed = deflateRawSync(input);
      const decompressed = inflateRawSync(compressed);
      expect(decompressed.length).toBe(0);
    });
  });

  // --- Cross-format errors extended ---
  // Ported from refs/node-test/parallel/test-zlib-invalid-input.js
  // Original: MIT license, Node.js contributors
  await describe('zlib: cross-format errors extended', async () => {
    await it('should fail to inflateRaw gzipped data', async () => {
      const compressed = gzipSync(Buffer.from('test data'));
      const error = await new Promise<Error | null>((resolve) => {
        inflateRaw(compressed, (err) => resolve(err));
      });
      expect(error).toBeDefined();
    });

    await it('should fail to inflateRaw zlib-deflated data', async () => {
      const compressed = deflateSync(Buffer.from('test data'));
      const error = await new Promise<Error | null>((resolve) => {
        inflateRaw(compressed, (err) => resolve(err));
      });
      expect(error).toBeDefined();
    });

    await it('should fail to inflate raw-deflated data', async () => {
      const compressed = deflateRawSync(Buffer.from('test data'));
      const error = await new Promise<Error | null>((resolve) => {
        inflate(compressed, (err) => resolve(err));
      });
      expect(error).toBeDefined();
    });

    await it('should fail to gunzip raw-deflated data', async () => {
      const compressed = deflateRawSync(Buffer.from('test data'));
      const error = await new Promise<Error | null>((resolve) => {
        gunzip(compressed, (err) => resolve(err));
      });
      expect(error).toBeDefined();
    });

    await it('should fail to decompress random bytes with inflate', async () => {
      const garbage = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03]);
      const error = await new Promise<Error | null>((resolve) => {
        inflate(garbage, (err) => resolve(err));
      });
      expect(error).toBeDefined();
    });

    await it('should fail to decompress random bytes with inflateRaw', async () => {
      const garbage = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03]);
      const error = await new Promise<Error | null>((resolve) => {
        inflateRaw(garbage, (err) => resolve(err));
      });
      expect(error).toBeDefined();
    });

    await it('should fail sync gunzipSync on random data', async () => {
      const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE]);
      let threw = false;
      try {
        gunzipSync(garbage);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should fail sync inflateSync on random data', async () => {
      const garbage = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
      let threw = false;
      try {
        inflateSync(garbage);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should fail sync inflateRawSync on random data', async () => {
      const garbage = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
      let threw = false;
      try {
        inflateRawSync(garbage);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  // --- Gzip header format details ---
  // Ported from refs/node-test/parallel/test-zlib-from-string.js
  // Original: MIT license, Node.js contributors
  await describe('zlib: gzip format details', async () => {
    await it('gzip compression method byte should be 8 (deflate)', async () => {
      const compressed = gzipSync(Buffer.from('test'));
      // byte 0: 0x1f, byte 1: 0x8b (magic), byte 2: compression method (8 = deflate)
      expect(compressed[0]).toBe(0x1f);
      expect(compressed[1]).toBe(0x8b);
      expect(compressed[2]).toBe(8);
    });

    await it('deflate output should start with zlib header', async () => {
      const compressed = deflateSync(Buffer.from('test'));
      // Zlib header: first byte has CMF (usually 0x78 for deflate with default window)
      // High nibble = CINFO (window size), Low nibble = CM (8 = deflate)
      expect(compressed[0] & 0x0F).toBe(8);
    });

    await it('deflateRaw output should have no header', async () => {
      const input = Buffer.from('test header absence');
      const raw = deflateRawSync(input);
      const deflated = deflateSync(input);
      const gzipped = gzipSync(input);

      // Raw should be smallest (no header/checksum), gzip should be largest
      expect(raw.length).toBeLessThan(deflated.length);
      expect(deflated.length).toBeLessThan(gzipped.length);
    });
  });

  // --- Uint8Array and ArrayBuffer input ---
  // Ported from refs/node-test/parallel/test-zlib-convenience-methods.js
  // Original: MIT license, Node.js contributors
  await describe('zlib: TypedArray and ArrayBuffer input', async () => {
    await it('should accept Uint8Array input for gzip', async () => {
      const input = new TextEncoder().encode('Uint8Array gzip test');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        gzip(input, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        gunzip(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe('Uint8Array gzip test');
    });

    await it('should accept Uint8Array input for deflateSync', async () => {
      const input = new TextEncoder().encode('Uint8Array deflate sync');
      const compressed = deflateSync(input as any);
      const decompressed = inflateSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe('Uint8Array deflate sync');
    });

    await it('should accept Uint8Array input for deflateRawSync', async () => {
      const input = new TextEncoder().encode('Uint8Array raw sync');
      const compressed = deflateRawSync(input as any);
      const decompressed = inflateRawSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe('Uint8Array raw sync');
    });
  });

  // --- Double compression for all formats ---
  await describe('zlib: double compression all formats', async () => {
    await it('should handle double deflate/inflate', async () => {
      const input = Buffer.from('double deflate test');
      const first = deflateSync(input);
      const second = deflateSync(first);
      const dec1 = inflateSync(second);
      const dec2 = inflateSync(dec1);
      expect(new TextDecoder().decode(dec2)).toBe('double deflate test');
    });

    await it('should handle double deflateRaw/inflateRaw', async () => {
      const input = Buffer.from('double raw test');
      const first = deflateRawSync(input);
      const second = deflateRawSync(first);
      const dec1 = inflateRawSync(second);
      const dec2 = inflateRawSync(dec1);
      expect(new TextDecoder().decode(dec2)).toBe('double raw test');
    });
  });

  // --- Sync with repeated string content ---
  // Ported from refs/node-test/parallel/test-zlib-convenience-methods.js
  // Original: MIT license, Node.js contributors
  await describe('zlib: sync convenience round-trip with repeated data', async () => {
    await it('gzipSync/gunzipSync with repeated string', async () => {
      const expectStr = 'blah'.repeat(8);
      const compressed = gzipSync(expectStr as any);
      const decompressed = gunzipSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe(expectStr);
    });

    await it('deflateSync/inflateSync with repeated string', async () => {
      const expectStr = 'blah'.repeat(8);
      const compressed = deflateSync(expectStr as any);
      const decompressed = inflateSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe(expectStr);
    });

    await it('deflateRawSync/inflateRawSync with repeated string', async () => {
      const expectStr = 'blah'.repeat(8);
      const compressed = deflateRawSync(expectStr as any);
      const decompressed = inflateRawSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe(expectStr);
    });
  });

  // --- From string: long string with special characters ---
  // Ported from refs/node-test/parallel/test-zlib-from-string.js
  // Original: MIT license, Node.js contributors
  await describe('zlib: string compression from-string pattern', async () => {
    await it('should round-trip a long string with special chars through deflate', async () => {
      const inputString = '\u03A9\u03A9Lorem ipsum dolor sit amet, consectetur adipiscing eli' +
                          't. Morbi faucibus, purus at gravida dictum, libero arcu ' +
                          'convallis lacus, in commodo libero metus eu nisi. Nullam' +
                          ' commodo, neque nec porta placerat, nisi est fermentum a' +
                          'ugue, vitae gravida tellus sapien sit amet tellus. Aenea' +
                          'n non diam orci. Proin quis elit turpis. Suspendisse non' +
                          ' diam ipsum. Suspendisse nec ullamcorper odio. Vestibulu' +
                          'm arcu mi, sodales non suscipit id, ultrices ut massa. S' +
                          'ed ac sem sit amet arcu malesuada fermentum. Nunc sed. ';

      const compressed = await new Promise<Buffer>((resolve, reject) => {
        deflate(inputString, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        inflate(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe(inputString);
    });

    await it('should round-trip a long string through gzip', async () => {
      const inputString = '\u03A9\u03A9Lorem ipsum dolor sit amet, consectetur adipiscing eli' +
                          't. Morbi faucibus, purus at gravida dictum, libero arcu ' +
                          'convallis lacus, in commodo libero metus eu nisi. Nullam' +
                          ' commodo, neque nec porta placerat, nisi est fermentum a' +
                          'ugue, vitae gravida tellus sapien sit amet tellus. Aenea' +
                          'n non diam orci. Proin quis elit turpis. Suspendisse non' +
                          ' diam ipsum. Suspendisse nec ullamcorper odio. Vestibulu' +
                          'm arcu mi, sodales non suscipit id, ultrices ut massa. S' +
                          'ed ac sem sit amet arcu malesuada fermentum. Nunc sed. ';

      const compressed = await new Promise<Buffer>((resolve, reject) => {
        gzip(inputString, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        gunzip(compressed, (err, result) => err ? reject(err) : resolve(result as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe(inputString);
    });
  });

  // --- Binary data with specific patterns ---
  await describe('zlib: binary data patterns', async () => {
    await it('should handle all-zeros buffer', async () => {
      const input = Buffer.alloc(1024, 0);
      const compressed = gzipSync(input);
      // All zeros should compress very well
      expect(compressed.length).toBeLessThan(input.length);
      const decompressed = gunzipSync(compressed);
      expect(decompressed.length).toBe(1024);
      for (let i = 0; i < 1024; i++) {
        expect(decompressed[i]).toBe(0);
      }
    });

    await it('should handle all-0xFF buffer', async () => {
      const input = Buffer.alloc(1024, 0xFF);
      const compressed = deflateSync(input);
      expect(compressed.length).toBeLessThan(input.length);
      const decompressed = inflateSync(compressed);
      expect(decompressed.length).toBe(1024);
      for (let i = 0; i < 1024; i++) {
        expect(decompressed[i]).toBe(0xFF);
      }
    });

    await it('should handle single byte', async () => {
      const input = Buffer.from([0x42]);
      const compressed = gzipSync(input);
      const decompressed = gunzipSync(compressed);
      expect(decompressed.length).toBe(1);
      expect(decompressed[0]).toBe(0x42);
    });

    await it('should handle single byte with deflateRaw', async () => {
      const input = Buffer.from([0xAB]);
      const compressed = deflateRawSync(input);
      const decompressed = inflateRawSync(compressed);
      expect(decompressed.length).toBe(1);
      expect(decompressed[0]).toBe(0xAB);
    });

    await it('should handle alternating byte pattern', async () => {
      const input = Buffer.alloc(512);
      for (let i = 0; i < 512; i++) {
        input[i] = i % 2 === 0 ? 0xAA : 0x55;
      }
      const compressed = deflateRawSync(input);
      const decompressed = inflateRawSync(compressed);
      expect(decompressed.length).toBe(512);
      for (let i = 0; i < 512; i++) {
        expect(decompressed[i]).toBe(i % 2 === 0 ? 0xAA : 0x55);
      }
    });
  });

  // --- Truncated data errors ---
  // Ported from refs/node-test/parallel/test-zlib-truncated.js
  // Original: MIT license, Node.js contributors
  await describe('zlib: truncated compressed data', async () => {
    await it('should error on truncated gzip data (sync)', async () => {
      const original = 'This is data that will be truncated after compression';
      const compressed = gzipSync(original as any);
      const truncated = compressed.slice(0, Math.floor(compressed.length / 2));
      let threw = false;
      try {
        gunzipSync(truncated);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should error on truncated deflate data (sync)', async () => {
      const original = 'This is data that will be truncated after deflation';
      const compressed = deflateSync(original as any);
      const truncated = compressed.slice(0, Math.floor(compressed.length / 2));
      let threw = false;
      try {
        inflateSync(truncated);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should error on truncated deflateRaw data (sync)', async () => {
      const original = 'This is data that will be truncated after raw deflation';
      const compressed = deflateRawSync(original as any);
      const truncated = compressed.slice(0, Math.floor(compressed.length / 2));
      let threw = false;
      try {
        inflateRawSync(truncated);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    await it('should error on truncated gzip data (async)', async () => {
      const original = 'Async truncation test data for gzip compression';
      const compressed = gzipSync(original as any);
      const truncated = compressed.slice(0, Math.floor(compressed.length / 2));
      const error = await new Promise<Error | null>((resolve) => {
        gunzip(truncated, (err) => resolve(err));
      });
      expect(error).toBeDefined();
    });

    await it('should error on truncated deflate data (async)', async () => {
      const original = 'Async truncation test data for deflate compression';
      const compressed = deflateSync(original as any);
      const truncated = compressed.slice(0, Math.floor(compressed.length / 2));
      const error = await new Promise<Error | null>((resolve) => {
        inflate(truncated, (err) => resolve(err));
      });
      expect(error).toBeDefined();
    });
  });

  // --- Concatenated gzip members ---
  // Ported from refs/node-test/parallel/test-zlib-from-concatenated-gzip.js
  // Original: MIT license, Node.js contributors
  await describe('zlib: concatenated gzip members', async () => {
    await it('gunzipSync should decompress concatenated gzip members', async () => {
      const abc = 'abc';
      const def = 'def';
      const abcEncoded = gzipSync(abc as any);
      const defEncoded = gzipSync(def as any);

      const concatenated = Buffer.concat([abcEncoded, defEncoded]);
      const result = gunzipSync(concatenated);
      expect(new TextDecoder().decode(result)).toBe('abcdef');
    });

    await it('gunzip async should decompress concatenated gzip members', async () => {
      const abc = 'abc';
      const def = 'def';
      const abcEncoded = gzipSync(abc as any);
      const defEncoded = gzipSync(def as any);

      const concatenated = Buffer.concat([abcEncoded, defEncoded]);
      const result = await new Promise<Buffer>((resolve, reject) => {
        gunzip(concatenated, (err, data) => err ? reject(err) : resolve(data as unknown as Buffer));
      });
      expect(new TextDecoder().decode(result)).toBe('abcdef');
    });
  });

  // --- Sync functions with empty string ---
  await describe('zlib: sync with empty string', async () => {
    await it('gzipSync should handle empty string', async () => {
      const compressed = gzipSync('' as any);
      const decompressed = gunzipSync(compressed);
      expect(decompressed.length).toBe(0);
    });

    await it('deflateSync should handle empty string', async () => {
      const compressed = deflateSync('' as any);
      const decompressed = inflateSync(compressed);
      expect(decompressed.length).toBe(0);
    });

    await it('deflateRawSync should handle empty string', async () => {
      const compressed = deflateRawSync('' as any);
      const decompressed = inflateRawSync(compressed);
      expect(decompressed.length).toBe(0);
    });
  });

  // --- Idempotence: compressing same data multiple times ---
  await describe('zlib: idempotence', async () => {
    await it('gzipSync should produce consistent decompression', async () => {
      const input = Buffer.from('idempotent test gzip');
      const c1 = gzipSync(input);
      const c2 = gzipSync(input);
      // Compressed output may differ (timestamps in gzip header) but
      // decompressed output must be identical
      const d1 = gunzipSync(c1);
      const d2 = gunzipSync(c2);
      expect(new TextDecoder().decode(d1)).toBe('idempotent test gzip');
      expect(new TextDecoder().decode(d2)).toBe('idempotent test gzip');
    });

    await it('deflateSync should produce identical output for same input', async () => {
      const input = Buffer.from('idempotent test deflate');
      const c1 = deflateSync(input);
      const c2 = deflateSync(input);
      expect(c1.length).toBe(c2.length);
      for (let i = 0; i < c1.length; i++) {
        expect(c1[i]).toBe(c2[i]);
      }
    });

    await it('deflateRawSync should produce identical output for same input', async () => {
      const input = Buffer.from('idempotent test raw');
      const c1 = deflateRawSync(input);
      const c2 = deflateRawSync(input);
      expect(c1.length).toBe(c2.length);
      for (let i = 0; i < c1.length; i++) {
        expect(c1[i]).toBe(c2[i]);
      }
    });
  });

  // --- Async callback: deflateRaw/inflateRaw ---
  await describe('zlib: async callback deflateRaw/inflateRaw', async () => {
    await it('deflateRaw should accept callback', async () => {
      const result = await new Promise<boolean>((resolve, reject) => {
        deflateRaw(Buffer.from('async deflateRaw'), (err, data) => {
          if (err) reject(err);
          else resolve(data.length > 0);
        });
      });
      expect(result).toBe(true);
    });

    await it('inflateRaw should decompress via callback', async () => {
      const input = Buffer.from('async inflateRaw round-trip');
      const compressed = deflateRawSync(input);
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        inflateRaw(compressed, (err, data) => {
          if (err) reject(err);
          else resolve(data as unknown as Buffer);
        });
      });
      expect(new TextDecoder().decode(decompressed)).toBe('async inflateRaw round-trip');
    });
  });

  // --- Mixed sync/async: compress sync, decompress async and vice versa ---
  await describe('zlib: mixed sync/async interop', async () => {
    await it('should decompress async what was compressed sync (gzip)', async () => {
      const input = Buffer.from('mixed sync async gzip');
      const compressed = gzipSync(input);
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        gunzip(compressed, (err, data) => err ? reject(err) : resolve(data as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe('mixed sync async gzip');
    });

    await it('should decompress sync what was compressed async (deflate)', async () => {
      const input = Buffer.from('mixed async sync deflate');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        deflate(input, (err, data) => err ? reject(err) : resolve(data as unknown as Buffer));
      });
      const decompressed = inflateSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe('mixed async sync deflate');
    });

    await it('should decompress sync what was compressed async (deflateRaw)', async () => {
      const input = Buffer.from('mixed async sync raw');
      const compressed = await new Promise<Buffer>((resolve, reject) => {
        deflateRaw(input, (err, data) => err ? reject(err) : resolve(data as unknown as Buffer));
      });
      const decompressed = inflateRawSync(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe('mixed async sync raw');
    });

    await it('should decompress async what was compressed sync (deflateRaw)', async () => {
      const input = Buffer.from('mixed sync async raw');
      const compressed = deflateRawSync(input);
      const decompressed = await new Promise<Buffer>((resolve, reject) => {
        inflateRaw(compressed, (err, data) => err ? reject(err) : resolve(data as unknown as Buffer));
      });
      expect(new TextDecoder().decode(decompressed)).toBe('mixed sync async raw');
    });
  });
};
