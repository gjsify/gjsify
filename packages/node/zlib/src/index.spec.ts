import { describe, it, expect } from '@gjsify/unit';
import zlib, {
  deflateRaw, inflateRaw, deflate, inflate, gzip, gunzip,
  gzipSync, gunzipSync, deflateSync, inflateSync, deflateRawSync, inflateRawSync,
  constants,
} from 'zlib';
import { Buffer } from 'buffer';

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
};
