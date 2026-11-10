// Pure-TypeScript PNG encoder: filter + `node:zlib` deflate, 8-bit RGB/RGBA,
// non-interlaced. Keeps the engine's result as a web `Blob` without a canvas
// or GdkPixbuf dependency.

import { deflateSync } from 'node:zlib';

import { Blob } from '@gjsify/buffer';

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
        c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    }
    return ~c;
}

function writeUint32(value: number): Uint8Array {
    return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function typeBytes(type: string): Uint8Array {
    return new TextEncoder().encode(type);
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
    const typeData = typeBytes(type);
    const combined = new Uint8Array(typeData.length + data.length);
    combined.set(typeData);
    combined.set(data, typeData.length);
    const chunk = new Uint8Array(4 + combined.length + 4);
    chunk.set(writeUint32(data.length));
    chunk.set(combined, 4);
    chunk.set(writeUint32(crc32(combined)), 4 + combined.length);
    return chunk;
}

export interface RgbImage {
    readonly width: number;
    readonly height: number;
    /** Tightly packed RGB, `width * height * 3` bytes. */
    readonly rgb: Uint8Array;
}

export interface RgbaImage {
    readonly width: number;
    readonly height: number;
    /** Tightly packed RGBA, `width * height * 4` bytes. */
    readonly rgba: Uint8Array;
}

function encodeRaw(pixels: Uint8Array, width: number, height: number, channels: number): Uint8Array {
    if (pixels.length !== width * height * channels) {
        throw new Error(`Pixel buffer is ${pixels.length} bytes, expected ${width * height * channels}.`);
    }
    const stride = width * channels;
    const raw = new Uint8Array(height * (stride + 1));
    for (let y = 0; y < height; y++) {
        raw[y * (stride + 1)] = 0; // filter byte: None
        raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    return deflateSync(raw);
}

/** Encode an RGB image as a PNG `Blob`. */
export function encodePng(image: RgbImage): Blob {
    const { width, height, rgb } = image;
    const ihdr = new Uint8Array([
        (width >>> 24) & 0xff,
        (width >>> 16) & 0xff,
        (width >>> 8) & 0xff,
        width & 0xff,
        (height >>> 24) & 0xff,
        (height >>> 16) & 0xff,
        (height >>> 8) & 0xff,
        height & 0xff,
        8, // bit depth
        2, // color type: RGB
        0, // compression
        0, // filter
        0, // interlace
    ]);
    const idat = encodeRaw(rgb, width, height, 3);
    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunks: Uint8Array[] = [
        signature,
        makeChunk('IHDR', ihdr),
        makeChunk('IDAT', idat),
        makeChunk('IEND', new Uint8Array(0)),
    ];
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(length);
    let pos = 0;
    for (const chunk of chunks) {
        out.set(chunk, pos);
        pos += chunk.length;
    }
    return new Blob([out], { type: 'image/png' });
}

/** Encode an RGBA image as a PNG `Blob`. */
export function encodePngRgba(image: RgbaImage): Blob {
    const { width, height, rgba } = image;
    const ihdr = new Uint8Array([
        (width >>> 24) & 0xff,
        (width >>> 16) & 0xff,
        (width >>> 8) & 0xff,
        width & 0xff,
        (height >>> 24) & 0xff,
        (height >>> 16) & 0xff,
        (height >>> 8) & 0xff,
        height & 0xff,
        8, // bit depth
        6, // color type: RGBA
        0, // compression
        0, // filter
        0, // interlace
    ]);
    const idat = encodeRaw(rgba, width, height, 4);
    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunks: Uint8Array[] = [
        signature,
        makeChunk('IHDR', ihdr),
        makeChunk('IDAT', idat),
        makeChunk('IEND', new Uint8Array(0)),
    ];
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(length);
    let pos = 0;
    for (const chunk of chunks) {
        out.set(chunk, pos);
        pos += chunk.length;
    }
    return new Blob([out], { type: 'image/png' });
}
