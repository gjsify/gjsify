import { describe, expect, it } from '@gjsify/unit';

import { pngSize, rasters, tinyPng } from './icon-fixture.spec.js';
import { buildIco, ICO_SIZES, iconResources } from './ico.js';

/**
 * Read an `.ico` back by the format's own arithmetic: ICONDIR, then 16-byte
 * entries, then each image at its `dwImageOffset`. Not `buildIco`'s inverse
 * written by the same hand — the offsets are followed, not recomputed.
 */
function readIco(bytes: Uint8Array): { size: number; declared: number; png: Uint8Array }[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(0, true)).toBe(0);
    expect(view.getUint16(2, true)).toBe(1);
    const count = view.getUint16(4, true);
    const out: { size: number; declared: number; png: Uint8Array }[] = [];
    for (let index = 0; index < count; index++) {
        const at = 6 + index * 16;
        const declared = view.getUint8(at);
        const length = view.getUint32(at + 8, true);
        const offset = view.getUint32(at + 12, true);
        const png = bytes.subarray(offset, offset + length);
        out.push({ size: pngSize(png).width, declared, png });
    }
    return out;
}

export default async () => {
    await describe('ship: the Windows icon container', async () => {
        const icon = rasters(ICO_SIZES);

        await it('writes one PNG entry per size, each at the offset its entry names', async () => {
            const entries = readIco(buildIco(icon));
            expect(entries.map((entry) => entry.size)).toStrictEqual([...ICO_SIZES]);
            for (const entry of entries) {
                // The bytes at the offset ARE the input PNG for that size, whole.
                expect(Buffer.from(entry.png).equals(Buffer.from(tinyPng(entry.size)))).toBe(true);
                // 0 means 256 in the one-byte width field; every smaller size is literal.
                expect(entry.declared).toBe(entry.size === 256 ? 0 : entry.size);
            }
        });

        await it('names the images by resource id in the group, not by offset', async () => {
            const { group, icons } = iconResources(icon);
            const view = new DataView(group.buffer, group.byteOffset, group.byteLength);
            expect(view.getUint16(4, true)).toBe(ICO_SIZES.length);
            // 14-byte entries: the file form's 16 minus two, because a 2-byte id
            // replaces the 4-byte file offset. A 16-byte stride here is the
            // classic way to write a group Windows reads as garbage.
            expect(group.length).toBe(6 + 14 * ICO_SIZES.length);
            ICO_SIZES.forEach((size, index) => {
                const at = 6 + index * 14;
                expect(view.getUint8(at)).toBe(size === 256 ? 0 : size);
                expect(view.getUint16(at + 6, true)).toBe(32); // wBitCount
                expect(view.getUint32(at + 8, true)).toBe(icons[index]?.length);
                expect(view.getUint16(at + 12, true)).toBe(index + 1); // nId, 1-based
                expect(pngSize(icons[index] ?? new Uint8Array()).width).toBe(size);
            });
        });

        await it('refuses a raster set missing a size, naming it', async () => {
            const partial = rasters(ICO_SIZES.filter((size) => size !== 48));
            expect(() => buildIco(partial)).toThrow('48 px');
            expect(() => iconResources(partial)).toThrow('48 px');
        });

        await it('refuses an image keyed at a size it is not', async () => {
            const wrong = { source: 'x', png: new Map(rasters(ICO_SIZES).png) };
            wrong.png.set(32, tinyPng(48));
            expect(() => buildIco(wrong)).toThrow('48×48');
        });
    });
};
