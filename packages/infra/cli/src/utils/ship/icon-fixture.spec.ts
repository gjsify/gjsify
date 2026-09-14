// Test-only PNG material for the icon suites — a `.spec.ts` so `tsconfig`'s
// exclude keeps it out of `lib/`, with no suite of its own.
//
// A PNG ENCODER WITH NO COMPRESSOR: the image data goes into zlib STORED blocks
// (`BTYPE=00`), which every inflater accepts and which needs nothing but the
// two checksums. Written here rather than pulled from `node:zlib` because the
// suites run on GJS, Bun and Deno as well as Node, and a fixture that depends on
// one runtime's compressor is a fixture that only tests one runtime.
//
// The pixels are a solid colour that DIFFERS PER SIZE, so a writer that embeds
// the 32 px image under the 48 px header hands the reader bytes it can tell
// apart — the discriminator every "was the right image put in the right slot"
// assertion needs.

import { crc32 } from './zip.js';
import type { AppIconRasters } from './icons.js';

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    out.set(data, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return new Uint8Array(out);
}

function adler32(bytes: Uint8Array): number {
    let a = 1;
    let b = 0;
    for (const byte of bytes) {
        a = (a + byte) % 65521;
        b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
}

/** zlib framing around stored deflate blocks: `78 01`, blocks of at most 65535 bytes, adler32. */
function zlibStored(raw: Uint8Array): Uint8Array {
    const parts: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
    for (let at = 0; at < raw.length || at === 0; at += 65535) {
        const block = raw.subarray(at, Math.min(at + 65535, raw.length));
        const final = at + 65535 >= raw.length ? 1 : 0;
        const head = Buffer.alloc(5);
        head.writeUInt8(final, 0);
        head.writeUInt16LE(block.length, 1);
        head.writeUInt16LE(block.length ^ 0xffff, 3);
        parts.push(new Uint8Array(head), block);
        if (raw.length === 0) break;
    }
    const trailer = Buffer.alloc(4);
    trailer.writeUInt32BE(adler32(raw));
    parts.push(new Uint8Array(trailer));
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/**
 * A `width`×`height` RGBA PNG filled with one colour derived from the width.
 *
 * Filter byte 0 on every row, 8-bit RGBA, non-interlaced: the plainest PNG there
 * is, and one every reader in the chain (CPython's zlib, Pillow, cairo) decodes.
 */
export function tinyPng(width: number, height = width): Uint8Array {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.writeUInt8(8, 8); // bit depth
    ihdr.writeUInt8(6, 9); // colour type: RGBA
    // compression 0, filter 0, interlace 0 stay zero.
    const raw = new Uint8Array(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        const row = y * (1 + width * 4);
        for (let x = 0; x < width; x++) {
            raw[row + 1 + x * 4] = width & 0xff;
            raw[row + 2 + x * 4] = (width >> 8) & 0xff;
            raw[row + 3 + x * 4] = 0x40;
            raw[row + 4 + x * 4] = 0xff;
        }
    }
    const parts = [
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', new Uint8Array(ihdr)),
        chunk('IDAT', zlibStored(raw)),
        chunk('IEND', new Uint8Array(0)),
    ];
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/** A raster set holding one `tinyPng` per size. */
export function rasters(sizes: readonly number[], source = 'the test fixture'): AppIconRasters {
    return { source, png: new Map(sizes.map((size) => [size, tinyPng(size)])) };
}

/** Width and height out of a PNG's IHDR, by arithmetic — not through `readPngSize`. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
}
