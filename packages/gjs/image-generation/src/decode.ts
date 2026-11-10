// Pure-TypeScript PNG decoder: `node:zlib` inflate + unfilter, 8-bit RGB/RGBA,
// non-interlaced. Returns the structural shape of `ImageData` so surfaces that
// paint do not need a heavy dependency.

import { inflateSync } from 'node:zlib';

import type { DecodedImage } from './engine.js';

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

function readUint32(data: Uint8Array, offset: number): number {
    return (data[offset]! << 24) | (data[offset + 1]! << 16) | (data[offset + 2]! << 8) | data[offset + 3]!;
}

function typeOf(data: Uint8Array, offset: number): string {
    return String.fromCharCode(data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!);
}

function assertPngSignature(data: Uint8Array): void {
    if (data.length < PNG_SIGNATURE.length) throw new Error('PNG decoder: not a PNG file');
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
        if (data[i] !== PNG_SIGNATURE[i]) throw new Error('PNG decoder: not a PNG file');
    }
}

function paeth(left: number, above: number, aboveLeft: number): number {
    const p = left + above - aboveLeft;
    const pa = Math.abs(p - left);
    const pb = Math.abs(p - above);
    const pc = Math.abs(p - aboveLeft);
    if (pa <= pb && pa <= pc) return left;
    if (pb <= pc) return above;
    return aboveLeft;
}

export interface PngHeader {
    readonly width: number;
    readonly height: number;
    readonly bitDepth: number;
    readonly colorType: number;
    readonly channels: number;
}

function parseIhdr(data: Uint8Array): PngHeader {
    const width = readUint32(data, 0);
    const height = readUint32(data, 4);
    const bitDepth = data[8]!;
    const colorType = data[9]!;
    const compression = data[10]!;
    const filter = data[11]!;
    const interlace = data[12]!;

    if (compression !== 0) throw new Error('PNG decoder: unsupported compression method');
    if (filter !== 0) throw new Error('PNG decoder: unsupported filter method');
    if (interlace !== 0) throw new Error('PNG decoder: interlaced PNGs are not supported');
    if (bitDepth !== 8) throw new Error(`PNG decoder: unsupported bit depth ${bitDepth}`);

    const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 0;
    if (channels === 0) {
        throw new Error(`PNG decoder: unsupported color type ${colorType} (only 8-bit RGB/RGBA)`);
    }
    return { width, height, bitDepth, colorType, channels };
}

function unfilter(raw: Uint8Array, width: number, height: number, channels: number): Uint8ClampedArray {
    const stride = width * channels;
    const out = new Uint8ClampedArray(stride * height);

    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)]!;
        const rowStart = y * (stride + 1) + 1;
        const priorOutStart = (y - 1) * stride;
        const outStart = y * stride;

        for (let x = 0; x < stride; x++) {
            const rawByte = raw[rowStart + x]!;
            const left = x >= channels ? out[outStart + x - channels]! : 0;
            const above = y > 0 ? out[priorOutStart + x]! : 0;
            const aboveLeft = y > 0 && x >= channels ? out[priorOutStart + x - channels]! : 0;

            let value = 0;
            switch (filter) {
                case 0:
                    value = rawByte;
                    break;
                case 1:
                    value = rawByte + left;
                    break;
                case 2:
                    value = rawByte + above;
                    break;
                case 3:
                    value = rawByte + Math.trunc((left + above) / 2);
                    break;
                case 4:
                    value = rawByte + paeth(left, above, aboveLeft);
                    break;
                default:
                    throw new Error(`PNG decoder: unknown filter ${filter} at row ${y}`);
            }
            out[outStart + x] = value & 0xff;
        }
    }
    return out;
}

function expandRgbToRgba(rgb: Uint8ClampedArray): Uint8ClampedArray {
    const pixelCount = rgb.length / 3;
    const rgba = new Uint8ClampedArray(pixelCount * 4);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
        rgba[j] = rgb[i]!;
        rgba[j + 1] = rgb[i + 1]!;
        rgba[j + 2] = rgb[i + 2]!;
        rgba[j + 3] = 0xff;
    }
    return rgba;
}

/** Decode a PNG blob to the structural shape of `ImageData`. */
export async function decode(blob: Blob): Promise<DecodedImage> {
    const data = new Uint8Array(await blob.arrayBuffer());
    assertPngSignature(data);

    let offset = PNG_SIGNATURE.length;
    let header: PngHeader | undefined;
    const idat: Uint8Array[] = [];

    while (offset < data.length) {
        if (offset + 12 > data.length) throw new Error('PNG decoder: truncated chunk');
        const length = readUint32(data, offset);
        const type = typeOf(data, offset + 4);
        if (offset + 12 + length > data.length) throw new Error('PNG decoder: truncated chunk data');
        const chunkData = data.subarray(offset + 8, offset + 8 + length);
        const storedCrc = readUint32(data, offset + 8 + length);
        const actualCrc = crc32(data.subarray(offset + 4, offset + 8 + length));
        if (storedCrc !== actualCrc) throw new Error(`PNG decoder: CRC mismatch in ${type} chunk`);

        switch (type) {
            case 'IHDR':
                if (header !== undefined) throw new Error('PNG decoder: duplicate IHDR');
                header = parseIhdr(chunkData);
                break;
            case 'IDAT':
                idat.push(chunkData);
                break;
            case 'IEND':
                offset = data.length;
                break;
        }
        offset += 12 + length;
    }

    if (header === undefined) throw new Error('PNG decoder: missing IHDR');
    if (idat.length === 0) throw new Error('PNG decoder: missing IDAT');

    const compressedLength = idat.reduce((sum, chunk) => sum + chunk.length, 0);
    const compressed = new Uint8Array(compressedLength);
    let pos = 0;
    for (const chunk of idat) {
        compressed.set(chunk, pos);
        pos += chunk.length;
    }

    const raw = inflateSync(compressed);
    const stride = header.width * header.channels;
    const expected = header.height * (stride + 1);
    if (raw.length !== expected) {
        throw new Error(`PNG decoder: inflated ${raw.length} bytes, expected ${expected}`);
    }

    const pixels = unfilter(raw, header.width, header.height, header.channels);
    return {
        width: header.width,
        height: header.height,
        data: header.channels === 3 ? expandRgbToRgba(pixels) : pixels,
    };
}
