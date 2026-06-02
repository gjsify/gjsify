// Browser-target conformance spec for @gjsify/zlib.
//
// Imports the browser entry directly (`./browser.js`) — under `gjsify build
// --app browser` the bundler picks the same file via the `"browser"` export
// condition, so these assertions lock in the behaviour exercised in the
// Playwright/Firefox/SpiderMonkey suite.
//
// gzip / deflate / deflate-raw ride the browser-native WHATWG Compression
// Streams API (`CompressionStream` / `DecompressionStream`), which is
// Promise-based — so the roundtrip assertions are async (callback form).
// Brotli and zstd are NOT in that spec, so they surface a structured
// `ENOTSUP` error rather than a fake codec; the sync variants throw the same
// because the underlying API is async-only.

import { describe, it, expect } from '@gjsify/unit';
import zlib, {
    gzip,
    gunzip,
    deflate,
    inflate,
    deflateRaw,
    inflateRaw,
    brotliCompress,
    brotliDecompress,
    zstdCompress,
    zstdDecompress,
    gzipSync,
    deflateSync,
    BrotliCompress,
    BrotliDecompress,
    constants,
} from './browser.js';

type AsyncCodec = (
    data: string | Uint8Array | ArrayBuffer,
    cb: (err: Error | null, result?: Uint8Array) => void,
) => void;

/** Promisify a callback-style codec for async assertions. */
function call(fn: AsyncCodec, data: string | Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        fn(data, (err, result) => {
            if (err) reject(err);
            else resolve(result as Uint8Array);
        });
    });
}

const decode = (u8: Uint8Array): string => new TextDecoder().decode(u8);

export default async () => {
    await describe('zlib (browser)', async () => {
        // ==================== exports ====================
        await describe('exports', async () => {
            await it('should export the async codec surface as functions', async () => {
                expect(typeof gzip).toBe('function');
                expect(typeof gunzip).toBe('function');
                expect(typeof deflate).toBe('function');
                expect(typeof inflate).toBe('function');
                expect(typeof deflateRaw).toBe('function');
                expect(typeof inflateRaw).toBe('function');
            });

            await it('should expose constants on the default export', async () => {
                expect(typeof zlib.constants).toBe('object');
                expect(constants.Z_FINISH).toBe(4);
            });
        });

        // ==================== gzip roundtrip (Compression Streams, async) ====================
        await describe('gzip roundtrip', async () => {
            await it('should gzip then gunzip back to the original bytes', async () => {
                const input = 'hello gzip browser roundtrip';
                const compressed = await call(gzip as AsyncCodec, input);
                expect(compressed instanceof Uint8Array).toBe(true);
                expect(compressed.length > 0).toBe(true);
                const restored = await call(gunzip as AsyncCodec, compressed);
                expect(decode(restored)).toBe(input);
            });
        });

        // ==================== deflate roundtrip ====================
        await describe('deflate roundtrip', async () => {
            await it('should deflate then inflate back to the original bytes', async () => {
                const input = 'hello deflate browser roundtrip';
                const compressed = await call(deflate as AsyncCodec, input);
                expect(compressed instanceof Uint8Array).toBe(true);
                expect(compressed.length > 0).toBe(true);
                const restored = await call(inflate as AsyncCodec, compressed);
                expect(decode(restored)).toBe(input);
            });
        });

        // ==================== deflateRaw roundtrip ====================
        await describe('deflateRaw roundtrip', async () => {
            await it('should deflateRaw then inflateRaw back to the original bytes', async () => {
                const input = 'hello deflateRaw browser roundtrip';
                const compressed = await call(deflateRaw as AsyncCodec, input);
                expect(compressed instanceof Uint8Array).toBe(true);
                expect(compressed.length > 0).toBe(true);
                const restored = await call(inflateRaw as AsyncCodec, compressed);
                expect(decode(restored)).toBe(input);
            });
        });

        // ==================== ENOTSUP: brotli / zstd (no Web codec) ====================
        await describe('brotli / zstd are ENOTSUP (no fake codec)', async () => {
            await it('should surface structured ENOTSUP from brotliCompress', async () => {
                let code: string | undefined;
                try {
                    await call(brotliCompress as AsyncCodec, 'data');
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });

            await it('should surface structured ENOTSUP from brotliDecompress', async () => {
                let code: string | undefined;
                try {
                    await call(brotliDecompress as AsyncCodec, 'data');
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });

            await it('should surface structured ENOTSUP from zstdCompress', async () => {
                let code: string | undefined;
                try {
                    await call(zstdCompress as AsyncCodec, 'data');
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });

            await it('should surface structured ENOTSUP from zstdDecompress', async () => {
                let code: string | undefined;
                try {
                    await call(zstdDecompress as AsyncCodec, 'data');
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });

            await it('should throw structured ENOTSUP when constructing BrotliCompress', async () => {
                let code: string | undefined;
                try {
                    new BrotliCompress();
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });

            await it('should throw structured ENOTSUP when constructing BrotliDecompress', async () => {
                let code: string | undefined;
                try {
                    new BrotliDecompress();
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });
        });

        // ==================== ENOTSUP: sync variants (API is async-only) ====================
        await describe('sync variants are ENOTSUP (Compression Streams is async-only)', async () => {
            await it('should throw structured ENOTSUP from gzipSync', async () => {
                let code: string | undefined;
                try {
                    gzipSync('data');
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });

            await it('should throw structured ENOTSUP from deflateSync', async () => {
                let code: string | undefined;
                try {
                    deflateSync('data');
                } catch (e: unknown) {
                    code = (e as Error & { code?: string }).code;
                }
                expect(code).toBe('ENOTSUP');
            });
        });
    });
};
