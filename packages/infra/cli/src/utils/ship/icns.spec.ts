import { describe, expect, it } from '@gjsify/unit';

import { pngSize, rasters, tinyPng } from './icon-fixture.spec.js';
import { buildIcns, ICNS_ELEMENTS, ICNS_SIZES } from './icns.js';

/** Walk the container by its own framing: `icns` + length, then `type` + length elements. */
function readIcns(bytes: Uint8Array): { type: string; data: Uint8Array }[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(Buffer.from(bytes.subarray(0, 4)).toString('latin1')).toBe('icns');
    expect(view.getUint32(4)).toBe(bytes.length);
    const out: { type: string; data: Uint8Array }[] = [];
    let at = 8;
    while (at < bytes.length) {
        const type = Buffer.from(bytes.subarray(at, at + 4)).toString('latin1');
        const length = view.getUint32(at + 4);
        expect(length).toBeGreaterThan(8);
        out.push({ type, data: bytes.subarray(at + 8, at + length) });
        at += length;
    }
    expect(at).toBe(bytes.length);
    return out;
}

export default async () => {
    await describe('ship: the macOS icon container', async () => {
        const icon = rasters(ICNS_SIZES);

        await it('carries the ten PNG-backed elements, each holding the PNG of its size', async () => {
            const elements = readIcns(buildIcns(icon));
            expect(elements[0]?.type).toBe('TOC ');
            const images = elements.slice(1);
            expect(images.map((element) => element.type)).toStrictEqual(ICNS_ELEMENTS.map((element) => element.type));
            ICNS_ELEMENTS.forEach((element, index) => {
                const data = images[index]?.data ?? new Uint8Array();
                expect(pngSize(data).width).toBe(element.size);
                // A `@2x` element and the 1x element of double the point size hold
                // the SAME pixels: `ic11` (16@2x) and `icp5` (32@1x) are both the
                // 32 px PNG, byte for byte.
                expect(Buffer.from(data).equals(Buffer.from(tinyPng(element.size)))).toBe(true);
            });
        });

        await it('writes a table of contents that agrees with the elements that follow', async () => {
            const elements = readIcns(buildIcns(icon));
            const toc = elements[0]?.data ?? new Uint8Array();
            const view = new DataView(toc.buffer, toc.byteOffset, toc.byteLength);
            expect(toc.length).toBe(8 * ICNS_ELEMENTS.length);
            elements.slice(1).forEach((element, index) => {
                expect(Buffer.from(toc.subarray(index * 8, index * 8 + 4)).toString('latin1')).toBe(element.type);
                expect(view.getUint32(index * 8 + 4)).toBe(element.data.length + 8);
            });
        });

        await it('asks for exactly seven sizes, the ones ten elements need', async () => {
            expect(ICNS_SIZES).toStrictEqual([16, 32, 64, 128, 256, 512, 1024]);
        });

        await it('refuses a raster set missing a size, by its iconset name', async () => {
            const partial = rasters(ICNS_SIZES.filter((size) => size !== 512));
            expect(() => buildIcns(partial)).toThrow('icon_256x256@2x.png');
        });
    });
};
