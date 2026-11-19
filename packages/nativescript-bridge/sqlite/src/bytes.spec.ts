import { describe, it, expect } from '@gjsify/unit';

import { fromSignedBytes, writeSignedBytes } from './bytes.js';

export default async () => {
    await describe('signed byte conversion', async () => {
        await it('writes bytes above 127 as negative values', async () => {
            // A plain array stands in for a Java byte[]: it stores what it is given.
            const target = writeSignedBytes(
                new Uint8Array([0, 1, 127, 128, 200, 255]),
                Array.from<number>({ length: 6 }),
            );
            expect(target).toStrictEqual([0, 1, 127, -128, -56, -1]);
        });

        await it('reads signed bytes back as 0..255', async () => {
            expect(Array.from(fromSignedBytes([0, 1, 127, -128, -56, -1]))).toStrictEqual([0, 1, 127, 128, 200, 255]);
        });

        await it('round-trips every byte value', async () => {
            const all = Uint8Array.from({ length: 256 }, (_, i) => i);
            const signed = writeSignedBytes(all, new Int8Array(256));
            expect(Array.from(fromSignedBytes(signed))).toStrictEqual(Array.from(all));
        });

        await it('reads a missing array and an empty one as empty', async () => {
            expect(fromSignedBytes(null).length).toBe(0);
            expect(fromSignedBytes([]).length).toBe(0);
        });
    });
};
