// The core-profile storage for ALPHA / LUMINANCE / LUMINANCE_ALPHA, checked
// without a GL context — so the mapping is pinned on every host, including the
// GLES and compatibility-profile ones whose driver never needs it.
// `legacy-core-profile.spec.ts` checks what a context then samples.

import { describe, expect, it } from '@gjsify/unit';
import {
    IDENTITY_SWIZZLE,
    coreStorageForLegacyFormat,
    coreTransferFormat,
    extractLegacyChannels,
    isLegacyFormat,
    textureParameterTarget,
} from './legacy-formats.js';

const ALPHA = 0x1906;
const RGB = 0x1907;
const RGBA = 0x1908;
const LUMINANCE = 0x1909;
const LUMINANCE_ALPHA = 0x190a;
const RED = 0x1903;
const GREEN = 0x1904;
const RG = 0x8227;
const UNSIGNED_BYTE = 0x1401;
const UNSIGNED_SHORT_4_4_4_4 = 0x8033;
const FLOAT = 0x1406;
const HALF_FLOAT = 0x140b;
const HALF_FLOAT_OES = 0x8d61;

export default async () => {
    await describe('legacy texture formats on a core profile', async () => {
        await it('recognises exactly the three legacy formats', async () => {
            expect([ALPHA, LUMINANCE, LUMINANCE_ALPHA].every(isLegacyFormat)).toBe(true);
            expect([RED, RG, RGB, RGBA].some(isLegacyFormat)).toBe(false);
        });

        await it('stores one channel in R8 and two in RG8', async () => {
            expect(coreStorageForLegacyFormat(ALPHA, UNSIGNED_BYTE)).toStrictEqual({
                internalFormat: 0x8229,
                format: RED,
                swizzle: [0, 0, 0, RED],
            });
            expect(coreStorageForLegacyFormat(LUMINANCE, UNSIGNED_BYTE)).toStrictEqual({
                internalFormat: 0x8229,
                format: RED,
                swizzle: [RED, RED, RED, 1],
            });
            expect(coreStorageForLegacyFormat(LUMINANCE_ALPHA, UNSIGNED_BYTE)).toStrictEqual({
                internalFormat: 0x822b,
                format: RG,
                swizzle: [RED, RED, RED, GREEN],
            });
        });

        await it('keeps float and half-float precision with a sized format', async () => {
            expect(coreStorageForLegacyFormat(LUMINANCE, FLOAT)?.internalFormat).toBe(0x822e); // R32F
            expect(coreStorageForLegacyFormat(LUMINANCE_ALPHA, FLOAT)?.internalFormat).toBe(0x8230); // RG32F
            expect(coreStorageForLegacyFormat(ALPHA, HALF_FLOAT)?.internalFormat).toBe(0x822d); // R16F
            expect(coreStorageForLegacyFormat(LUMINANCE_ALPHA, HALF_FLOAT_OES)?.internalFormat).toBe(0x822f); // RG16F
        });

        await it('leaves other formats and invalid types to the driver', async () => {
            expect(coreStorageForLegacyFormat(RGBA, UNSIGNED_BYTE)).toBe(null);
            expect(coreStorageForLegacyFormat(LUMINANCE, UNSIGNED_SHORT_4_4_4_4)).toBe(null);
        });

        await it('maps the transfer format to the storage layout, and nothing else', async () => {
            expect(coreTransferFormat(ALPHA)).toBe(RED);
            expect(coreTransferFormat(LUMINANCE)).toBe(RED);
            expect(coreTransferFormat(LUMINANCE_ALPHA)).toBe(RG);
            expect(coreTransferFormat(RGBA)).toBe(RGBA);
            expect(IDENTITY_SWIZZLE).toStrictEqual([RED, GREEN, 0x1905, ALPHA]);
        });

        await it('sets a cube face swizzle on the cube map', async () => {
            expect(textureParameterTarget(0x8515)).toBe(0x8513); // +X
            expect(textureParameterTarget(0x851a)).toBe(0x8513); // -Z
            expect(textureParameterTarget(0x0de1)).toBe(0x0de1); // TEXTURE_2D
            expect(textureParameterTarget(0x8c1a)).toBe(0x8c1a); // TEXTURE_2D_ARRAY
        });

        await it('picks A, R, and R+A out of read-back RGBA', async () => {
            const px = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
            expect(Array.from(extractLegacyChannels(px, ALPHA))).toStrictEqual([40, 80]);
            expect(Array.from(extractLegacyChannels(px, LUMINANCE))).toStrictEqual([10, 50]);
            expect(Array.from(extractLegacyChannels(px, LUMINANCE_ALPHA))).toStrictEqual([10, 40, 50, 80]);
        });
    });
};
