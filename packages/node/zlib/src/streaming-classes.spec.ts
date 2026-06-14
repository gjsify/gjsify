// Streaming-class surface of node:zlib.
//
// Regression coverage for the missing `zlib.Inflate` / `zlib.Gzip` / … named
// constructors. Libraries such as `sync-inflate` / `pngjs` (pulled in by
// `qrcode` to render a PNG) do `inherits(MyStream, zlib.Inflate)` at module
// init — when the class is `undefined`, `util.inherits` throws
// `ERR_INVALID_ARG_TYPE` ("superCtor … must be a function") at IMPORT time and
// kills the whole module. These tests assert the classes exist as genuine
// constructors, round-trip through `.write()` / `.end()` + `'data'` / `'end'`,
// and are valid `inherits()` super-constructors.

import { describe, it, expect } from '@gjsify/unit';
import zlib, {
    Gzip,
    Gunzip,
    Deflate,
    Inflate,
    DeflateRaw,
    InflateRaw,
    Unzip,
    createGzip,
} from 'node:zlib';
import { Transform } from 'node:stream';
import { inherits } from 'node:util';
import { Buffer } from 'node:buffer';

type StreamLike = {
    on(event: string, cb: (arg?: unknown) => void): unknown;
    write(chunk: unknown): unknown;
    end(chunk?: unknown): unknown;
};

/** Feed `input` through a streaming codec instance and collect the output. */
function runStreamingCodec(stream: StreamLike, input: Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (c) => chunks.push(c as Buffer));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (e) => reject(e as Error));
        stream.end(input);
    });
}

export default async () => {
    await describe('zlib streaming classes: exist as constructors', async () => {
        await it('exports the named streaming classes as functions', async () => {
            expect(typeof zlib.Gzip).toBe('function');
            expect(typeof zlib.Gunzip).toBe('function');
            expect(typeof zlib.Deflate).toBe('function');
            expect(typeof zlib.Inflate).toBe('function');
            expect(typeof zlib.DeflateRaw).toBe('function');
            expect(typeof zlib.InflateRaw).toBe('function');
            expect(typeof zlib.Unzip).toBe('function');
        });

        await it('named exports match the default-export classes', async () => {
            expect(typeof Gzip).toBe('function');
            expect(typeof Inflate).toBe('function');
            expect(Gzip).toBe(zlib.Gzip);
            expect(Inflate).toBe(zlib.Inflate);
        });

        await it('instances are Transform streams', async () => {
            const g = createGzip();
            expect(g instanceof Transform).toBe(true);
        });
    });

    await describe('zlib streaming classes: inherits() compatibility', async () => {
        // This is the exact pattern sync-inflate / pngjs run at module init.
        await it('inherits(fn, zlib.Inflate) does not throw', async () => {
            function MyInflate(this: unknown) {}
            expect(() => inherits(MyInflate as unknown as Function, zlib.Inflate as Function)).not.toThrow();
            expect((MyInflate as unknown as { super_: unknown }).super_).toBe(zlib.Inflate);
        });

        await it('inherits() works for every streaming class', async () => {
            for (const Cls of [Gzip, Gunzip, Deflate, Inflate, DeflateRaw, InflateRaw, Unzip]) {
                function Sub(this: unknown) {}
                expect(() => inherits(Sub as unknown as Function, Cls as Function)).not.toThrow();
            }
        });
    });

    await describe('zlib streaming classes: round-trips', async () => {
        await it('Deflate → Inflate round-trip via write()/end()', async () => {
            const input = Buffer.from('streaming class deflate round trip');
            const compressed = await runStreamingCodec(new Deflate() as unknown as StreamLike, input);
            expect(compressed.length > 0).toBe(true);
            const decompressed = await runStreamingCodec(new Inflate() as unknown as StreamLike, compressed);
            expect(decompressed.toString()).toBe('streaming class deflate round trip');
        });

        await it('Gzip → Gunzip round-trip via write()/end()', async () => {
            const input = Buffer.from('streaming class gzip round trip');
            const compressed = await runStreamingCodec(new Gzip() as unknown as StreamLike, input);
            // gzip magic bytes
            expect(compressed[0]).toBe(0x1f);
            expect(compressed[1]).toBe(0x8b);
            const decompressed = await runStreamingCodec(new Gunzip() as unknown as StreamLike, compressed);
            expect(decompressed.toString()).toBe('streaming class gzip round trip');
        });

        await it('DeflateRaw → InflateRaw round-trip', async () => {
            const input = Buffer.from('streaming class raw round trip');
            const compressed = await runStreamingCodec(new DeflateRaw() as unknown as StreamLike, input);
            const decompressed = await runStreamingCodec(new InflateRaw() as unknown as StreamLike, compressed);
            expect(decompressed.toString()).toBe('streaming class raw round trip');
        });

        await it('Unzip auto-detects gzip input', async () => {
            const input = Buffer.from('unzip auto-detect gzip');
            const compressed = await runStreamingCodec(new Gzip() as unknown as StreamLike, input);
            const decompressed = await runStreamingCodec(new Unzip() as unknown as StreamLike, compressed);
            expect(decompressed.toString()).toBe('unzip auto-detect gzip');
        });

        await it('Unzip auto-detects zlib (deflate) input', async () => {
            const input = Buffer.from('unzip auto-detect zlib');
            const compressed = await runStreamingCodec(new Deflate() as unknown as StreamLike, input);
            const decompressed = await runStreamingCodec(new Unzip() as unknown as StreamLike, compressed);
            expect(decompressed.toString()).toBe('unzip auto-detect zlib');
        });

        await it('multiple write() calls then end() are concatenated', async () => {
            const compressed = await new Promise<Buffer>((resolve, reject) => {
                const chunks: Buffer[] = [];
                const d = new Deflate() as unknown as StreamLike;
                d.on('data', (c) => chunks.push(c as Buffer));
                d.on('end', () => resolve(Buffer.concat(chunks)));
                d.on('error', (e) => reject(e as Error));
                d.write(Buffer.from('part one '));
                d.write(Buffer.from('part two'));
                d.end();
            });
            const decompressed = await runStreamingCodec(new Inflate() as unknown as StreamLike, compressed);
            expect(decompressed.toString()).toBe('part one part two');
        });
    });
};
