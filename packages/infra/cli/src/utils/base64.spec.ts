// SPDX-License-Identifier: MIT
// The CLI's own base64, held against an INDEPENDENT oracle.
//
// This file exists because the CLI's Node entry may not import `@gjsify/buffer` — see the module's
// own header for the layering reason. A duplicate that is merely "probably the same" would be the
// worse half of that trade, so the equivalence is asserted rather than assumed, and the oracle is
// Node's `Buffer`, which is a different implementation family from `btoa`/`atob`.

import { describe, expect, it } from '@gjsify/unit';
import { base64Decode, base64Encode } from './base64.js';

const CASES: Array<[string, Uint8Array]> = [
    ['empty', new Uint8Array(0)],
    ['one byte', new Uint8Array([0])],
    ['pad 2', new Uint8Array([1])],
    ['pad 1', new Uint8Array([1, 2])],
    ['pad 0', new Uint8Array([1, 2, 3])],
    ['every byte value', new Uint8Array(Array.from({ length: 256 }, (_, i) => i))],
    // Encoding spreads into `String.fromCharCode`, so the chunk boundary is where a naive
    // implementation throws RangeError rather than returning something wrong.
    ['across the 0x8000 chunk boundary', new Uint8Array(0x8000 * 2 + 7).fill(0xab)],
    ['utf-8 bytes', new TextEncoder().encode('Grüße, Дом, 日本語, 🌍')],
];

export default async () => {
    await describe('base64Encode', async () => {
        for (const [name, bytes] of CASES) {
            await it(`agrees with Buffer.toString('base64') — ${name}`, () => {
                expect(base64Encode(bytes)).toBe(Buffer.from(bytes).toString('base64'));
            });
        }

        await it('is exact across every length that changes the padding class', () => {
            // 0..300 covers each residue mod 3 a hundred times over, which is where a
            // hand-written encoder gets the tail wrong.
            for (let n = 0; n <= 300; n++) {
                const bytes = new Uint8Array(Array.from({ length: n }, (_, i) => (i * 7 + 3) & 0xff));
                expect(base64Encode(bytes)).toBe(Buffer.from(bytes).toString('base64'));
            }
        });
    });

    await describe('base64Decode', async () => {
        for (const [name, bytes] of CASES) {
            await it(`round-trips — ${name}`, () => {
                expect(Array.from(base64Decode(base64Encode(bytes)))).toStrictEqual(Array.from(bytes));
            });
        }

        await it("agrees with Buffer.from(…, 'base64') on text this tree did not encode", () => {
            // Decoding must also read what SOMEONE ELSE wrote: the sidecar is read back by a
            // second process, and a decoder that only understands its own encoder is not one.
            for (const text of ['', 'QQ==', 'QUI=', 'QUJD', 'AAECAwQFBgcICQ==', 'Zm9vYmFy']) {
                expect(Array.from(base64Decode(text))).toStrictEqual(Array.from(Buffer.from(text, 'base64')));
            }
        });
    });
};
