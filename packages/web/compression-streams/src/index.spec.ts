// Tests for W3C Compression Streams API
// Reference: refs/wpt/compression/

import { describe, it, expect } from '@gjsify/unit';
import { CompressionStream, DecompressionStream } from 'compression-streams';

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
                new CompressionStream('invalid-format-xyz' as unknown as CompressionFormat);
            } catch {
                threw = true;
            }
            expect(threw).toBe(true);
        });

        await it('should have readable and writable properties', async () => {
            const cs = new CompressionStream('gzip');
            expect(cs.readable).toBeDefined();
            expect(cs.writable).toBeDefined();
            expect(typeof cs.readable.getReader).toBe('function');
            expect(typeof cs.writable.getWriter).toBe('function');
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
                new DecompressionStream('invalid-format-xyz' as unknown as CompressionFormat);
            } catch {
                threw = true;
            }
            expect(threw).toBe(true);
        });

        await it('should have readable and writable properties', async () => {
            const ds = new DecompressionStream('gzip');
            expect(ds.readable).toBeDefined();
            expect(ds.writable).toBeDefined();
            expect(typeof ds.readable.getReader).toBe('function');
            expect(typeof ds.writable.getWriter).toBe('function');
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

    // ==================== Multi-chunk decompression input ====================
    //
    // Regression: the GJS backend used to decompress each WRITTEN chunk
    // independently (one `gunzipSync` per chunk). A single compressed stream
    // delivered to DecompressionStream across several writes — exactly what
    // @gjsify/fetch does when a >4 KB gzipped body arrives in multiple
    // `read_bytes` reads — then failed, because no individual chunk is a
    // complete gzip/deflate stream ("Ungültige komprimierte Daten" /
    // "Weitere Eingaben erforderlich"). The fix buffers all writes and decodes
    // the reassembled stream once. This was the @gjsify/fetch "Norman" failure.
    await describe('DecompressionStream multi-chunk input', async () => {
        // Build a compressed payload large enough that a real body reader would
        // split it, and feed it to DecompressionStream in several small writes.
        const buildCompressed = async (format: CompressionFormat, original: string): Promise<Uint8Array> => {
            const cs = new CompressionStream(format);
            const w = cs.writable.getWriter();
            const r = cs.readable.getReader();
            w.write(new TextEncoder().encode(original));
            w.close();
            const parts: Uint8Array[] = [];
            while (true) {
                const { done, value } = await r.read();
                if (done) break;
                parts.push(value);
            }
            let n = 0;
            for (const p of parts) n += p.length;
            const out = new Uint8Array(n);
            let o = 0;
            for (const p of parts) {
                out.set(p, o);
                o += p.length;
            }
            return out;
        };

        const decompressInChunks = async (
            format: CompressionFormat,
            data: Uint8Array,
            chunkSize: number,
        ): Promise<string> => {
            const ds = new DecompressionStream(format);
            const w = ds.writable.getWriter();
            const r = ds.readable.getReader();
            // Write the compressed stream split into `chunkSize` pieces.
            (async () => {
                for (let i = 0; i < data.length; i += chunkSize) {
                    await w.write(data.subarray(i, Math.min(i + chunkSize, data.length)));
                }
                await w.close();
            })();
            const parts: Uint8Array[] = [];
            while (true) {
                const { done, value } = await r.read();
                if (done) break;
                parts.push(value);
            }
            let n = 0;
            for (const p of parts) n += p.length;
            const out = new Uint8Array(n);
            let o = 0;
            for (const p of parts) {
                out.set(p, o);
                o += p.length;
            }
            return new TextDecoder().decode(out);
        };

        for (const format of ['gzip', 'deflate', 'deflate-raw'] as CompressionFormat[]) {
            await it(`reassembles a multi-write ${format} stream`, async () => {
                // Varied text so the compressed form stays comfortably > one chunk.
                const original = Array.from({ length: 300 }, (_, i) => `line ${i}: the quick brown fox ${i * 7}`).join(
                    '\n',
                );
                const compressed = await buildCompressed(format, original);
                expect(compressed.length > 256).toBe(true);
                // Split into small chunks to force cross-chunk reassembly.
                const decoded = await decompressInChunks(format, compressed, 256);
                expect(decoded).toBe(original);
            });
        }
    });
};
