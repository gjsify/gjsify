// SPDX-License-Identifier: MIT
// Tagged-JSON wire codec — the parent half of what crosses the worker
// subprocess boundary (`structured-clone-wire.ts`).
//
// The binary cases are here because the codec's base64 may not depend on
// `btoa`/`atob`: the mirror of this codec in `BOOTSTRAP_CODE` runs under a
// bare `gjs`, which has neither. The `without btoa/atob` case states that
// directly; `file-based-worker.spec.ts` covers the bootstrap's copy through a
// real subprocess, which is where the dependency actually broke.

import { describe, it, expect } from '@gjsify/unit';

import { decode, encode } from './structured-clone-wire.js';

/** Encode, serialise, parse, decode — exactly what the transport does. */
function roundTrip(value: unknown): unknown {
    return decode(JSON.parse(JSON.stringify(encode(value))));
}

/**
 * Run `fn` with `btoa`/`atob` removed from the global object, then restore
 * them. Deliberately no fall-back for a host that refuses the delete: the
 * sibling SAB suite records what a conditional `expect(true)` costs, and a
 * codec that cannot be stripped of its globals is a result worth failing on.
 */
function withoutBase64Globals(fn: () => void): void {
    const g = globalThis as Record<string, unknown>;
    const savedBtoa = g.btoa;
    const savedAtob = g.atob;
    delete g.btoa;
    delete g.atob;
    try {
        expect(g.btoa).toBe(undefined);
        expect(g.atob).toBe(undefined);
        fn();
    } finally {
        if (savedBtoa !== undefined) g.btoa = savedBtoa;
        if (savedAtob !== undefined) g.atob = savedAtob;
    }
}

export default async () => {
    await describe('structured-clone-wire — binary', async () => {
        await it('round-trips a Uint8Array at every base64 padding length', async () => {
            // 0..5 bytes covers all three padding shapes twice over; a wrong
            // alphabet or a mis-sized output buffer shows up as a length or
            // byte mismatch here rather than three layers up.
            for (let len = 0; len <= 5; len++) {
                const sent = new Uint8Array(len);
                for (let i = 0; i < len; i++) sent[i] = i * 51 + 1;
                const back = roundTrip(sent) as Uint8Array;
                expect(back instanceof Uint8Array).toBe(true);
                expect(back.length).toBe(len);
                expect([...back]).toStrictEqual([...sent]);
            }
        });

        await it('produces standard base64 on the wire', async () => {
            // Pins the alphabet and the padding against a known encoding, so a
            // self-consistent but non-standard codec cannot pass.
            const wire = encode(new TextEncoder().encode('Mankind')) as { data: string };
            expect(wire.data).toBe('TWFua2luZA==');
        });

        await it('round-trips every byte value', async () => {
            const sent = new Uint8Array(256);
            for (let i = 0; i < 256; i++) sent[i] = i;
            const back = roundTrip(sent) as Uint8Array;
            expect([...back]).toStrictEqual([...sent]);
        });

        await it('round-trips an ArrayBuffer', async () => {
            const back = roundTrip(new Uint8Array([9, 8, 7]).buffer) as ArrayBuffer;
            expect(back instanceof ArrayBuffer).toBe(true);
            expect(back.byteLength).toBe(3);
            expect([...new Uint8Array(back)]).toStrictEqual([9, 8, 7]);
        });

        await it('round-trips a Float64Array and a BigInt64Array', async () => {
            const floats = roundTrip(new Float64Array([0.5, -1.25])) as Float64Array;
            expect(floats instanceof Float64Array).toBe(true);
            expect(floats[1]).toBe(-1.25);
            const bigs = roundTrip(new BigInt64Array([1n, -2n])) as BigInt64Array;
            expect(bigs instanceof BigInt64Array).toBe(true);
            expect(bigs[1]).toBe(-2n);
        });

        await it('carries only a view, not the whole backing buffer', async () => {
            const view = new Uint8Array(new Uint8Array([1, 2, 3, 4, 5]).buffer, 1, 3);
            const back = roundTrip(view) as Uint8Array;
            expect(back.length).toBe(3);
            expect([...back]).toStrictEqual([2, 3, 4]);
        });

        await it('encodes and decodes without btoa/atob on the global', async () => {
            const sent = new Uint8Array([0, 1, 127, 128, 255]);
            let back: Uint8Array | undefined;
            withoutBase64Globals(() => {
                back = roundTrip(sent) as Uint8Array;
            });
            expect([...back!]).toStrictEqual([...sent]);
        });
    });
};
