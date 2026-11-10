// Pure-TypeScript PNG round-trip: encode then decode, filters, rejection of
// unsupported formats. No canvas, no GPU.

import { describe, expect, it } from '@gjsify/unit';

import { decode } from './decode.js';
import { encodePng, encodePngRgba } from './encode.js';

function makeCrcTable(): Uint32Array {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(data: Uint8Array): number {
    let c = ~0;
    for (let i = 0; i < data.length; i++) {
        c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
    }
    return ~c;
}

function writeUint32(value: number, data: Uint8Array, offset: number): void {
    data[offset] = (value >>> 24) & 0xff;
    data[offset + 1] = (value >>> 16) & 0xff;
    data[offset + 2] = (value >>> 8) & 0xff;
    data[offset + 3] = value & 0xff;
}

function fillRgb(width: number, height: number, r: number, g: number, b: number): Uint8Array {
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < rgb.length; i += 3) {
        rgb[i] = r;
        rgb[i + 1] = g;
        rgb[i + 2] = b;
    }
    return rgb;
}

function fillRgba(width: number, height: number, r: number, g: number, b: number, a: number): Uint8Array {
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = a;
    }
    return rgba;
}

export default async () => {
    await describe('PNG', async () => {
        await it('round-trips an RGB image', async () => {
            const rgb = fillRgb(3, 2, 17, 34, 51);
            const blob = encodePng({ width: 3, height: 2, rgb });
            const decoded = await decode(blob);
            expect(decoded.width).toBe(3);
            expect(decoded.height).toBe(2);
            expect(decoded.data.length).toBe(3 * 2 * 4);
            for (let i = 0; i < decoded.data.length; i += 4) {
                expect(decoded.data[i]).toBe(17);
                expect(decoded.data[i + 1]).toBe(34);
                expect(decoded.data[i + 2]).toBe(51);
                expect(decoded.data[i + 3]).toBe(0xff);
            }
        });

        await it('round-trips an RGBA image', async () => {
            const rgba = fillRgba(4, 3, 255, 0, 128, 200);
            const blob = encodePngRgba({ width: 4, height: 3, rgba });
            const decoded = await decode(blob);
            expect(decoded.width).toBe(4);
            expect(decoded.height).toBe(3);
            expect(decoded.data.length).toBe(4 * 3 * 4);
            for (let i = 0; i < decoded.data.length; i += 4) {
                expect(decoded.data[i]).toBe(255);
                expect(decoded.data[i + 1]).toBe(0);
                expect(decoded.data[i + 2]).toBe(128);
                expect(decoded.data[i + 3]).toBe(200);
            }
        });

        await it('sets the PNG type on the blob', async () => {
            const blob = encodePng({ width: 1, height: 1, rgb: new Uint8Array(3).fill(0xff) });
            expect(blob.type).toBe('image/png');
        });

        await it('rejects a malformed file', async () => {
            await expect(decode(new Blob([new Uint8Array([0x00, 0x01, 0x02])]))).rejects.toThrow(/not a PNG/);
        });

        await it('rejects unsupported color types', async () => {
            // Patch a valid RGB PNG to grayscale (color type 0) and fix the IHDR CRC.
            const original = await encodePng({ width: 1, height: 1, rgb: new Uint8Array(3).fill(0x80) }).arrayBuffer();
            const png = new Uint8Array(original);
            const ihdrTypeAndDataStart = 8 + 4; // after signature and IHDR length (start of IHDR type)
            const colorTypeOffset = ihdrTypeAndDataStart + 4 + 9;
            png[colorTypeOffset] = 0; // grayscale
            const ihdrCrcStart = ihdrTypeAndDataStart + 4 + 13;
            const crc = crc32(png.subarray(ihdrTypeAndDataStart, ihdrCrcStart));
            writeUint32(crc, png, ihdrCrcStart);
            await expect(decode(new Blob([png]))).rejects.toThrow(/color type/);
        });
    });
};
