import { run, describe, it, expect } from '@gjsify/unit';

async function compress(input: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
    const cs = new CompressionStream(format);
    const writer = cs.writable.getWriter();
    writer.write(input);
    writer.close();
    const buf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(buf);
}

async function decompress(input: Uint8Array, format: CompressionFormat): Promise<string> {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    writer.write(input);
    writer.close();
    return new Response(ds.readable).text();
}

run({
    async CompressionStreamsTest() {
        const text = 'Hello, compression world! '.repeat(10);
        const encoded = new TextEncoder().encode(text);

        for (const format of ['gzip', 'deflate', 'deflate-raw'] as CompressionFormat[]) {
            await describe(`CompressionStream (${format})`, async () => {
                await it('has readable and writable', async () => {
                    const cs = new CompressionStream(format);
                    expect(cs.readable).toBeDefined();
                    expect(cs.writable).toBeDefined();
                });

                await it('round-trips correctly', async () => {
                    const compressed = await compress(encoded, format);
                    expect(compressed.byteLength).toBeGreaterThan(0);
                    const result = await decompress(compressed, format);
                    expect(result).toBe(text);
                });
            });
        }

        await describe('DecompressionStream', async () => {
            await it('gzip magic bytes (0x1f 0x8b)', async () => {
                const compressed = await compress(encoded, 'gzip');
                expect(compressed[0]).toBe(0x1f);
                expect(compressed[1]).toBe(0x8b);
            });
        });
    },
});
