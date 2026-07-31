// GJS-only spec for the shared Gio codec (gio-codec.ts).
//
// Two concerns, both born from a real production regression (`gjsify install`
// under GJS projected to 30-60+ minutes for a cold install because
// `findGzipMemberEnd` passed the ENTIRE remaining input to every
// `Gio.Converter.convert()` call — GJS copies the whole inbuf across the GI
// boundary per call, so the scan was O(n²) in the member size):
//
// 1. Multi-member gzip round-trips with members LARGER than the bounded
//    convert() input slice — the member walk is what the scan exists for, and
//    the bounded slicing must not break member boundaries.
// 2. A SHAPE guard on the scan itself: no convert() call may ever receive an
//    unbounded input slice again, and the total bytes marshalled must stay
//    linear in input+output. This is asserted by counting, not by wall-clock:
//    a throughput floor on shared CI hardware is noisy (a loaded 2-core runner
//    can be 10x slower than a dev box), while the slice bound is the exact
//    invariant that MAKES the scan linear and is deterministic on any host.
//
// GJS-only: on Node the `node:zlib` specifier resolves to the native
// implementation, which never touches this code path.

import { describe, it, expect, on } from '@gjsify/unit';
import Gio from '@girs/gio-2.0';
import { gzipSync, gunzipSync } from './index.js';
import { CONVERT_INPUT_SLICE } from './gio-codec.js';

/** Deterministic pseudo-random (incompressible) bytes via a 32-bit LCG. */
function lcgBytes(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length);
    let state = seed >>> 0;
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        out[i] = state >>> 24;
    }
    return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

/** Index of the first differing byte, or -1 when equal (length included). */
function firstMismatch(a: Uint8Array, b: Uint8Array): number {
    if (a.length !== b.length) return Math.min(a.length, b.length);
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return i;
    }
    return -1;
}

export default async () => {
    await on('Gjs', async () => {
        // Members chosen so the FIRST member's compressed size exceeds
        // CONVERT_INPUT_SLICE: incompressible data compresses to slightly more
        // than its own size, so the scan must walk it in several bounded
        // slices and still find the exact member boundary.
        const memberA = lcgBytes(3 * CONVERT_INPUT_SLICE, 0xdecafbad);
        const memberB = new TextEncoder().encode('The quick brown fox jumps over the lazy dog. '.repeat(11000));
        const memberC = new TextEncoder().encode('tail member');
        const gzA = gzipSync(memberA);
        const gzB = gzipSync(memberB);
        const gzC = gzipSync(memberC);

        await describe('gio-codec: multi-member gzip with large members', async () => {
            await it('round-trips members larger than the convert() slice bound', async () => {
                expect(gzA.length).toBeGreaterThan(CONVERT_INPUT_SLICE);
                const decompressed = gunzipSync(concatBytes([gzA, gzB, gzC]));
                const expected = concatBytes([memberA, memberB, memberC]);
                expect(decompressed.length).toBe(expected.length);
                expect(firstMismatch(decompressed, expected)).toBe(-1);
            });

            await it('round-trips a single member larger than the slice bound', async () => {
                const decompressed = gunzipSync(gzA);
                expect(firstMismatch(decompressed, memberA)).toBe(-1);
            });
        });

        await describe('gio-codec: convert() marshalling shape', async () => {
            await it('never passes an unbounded input slice to convert()', async () => {
                const input = concatBytes([gzA, gzB]);
                const outputSize = memberA.length + memberB.length;

                // Count what actually crosses the GI boundary by shadowing the
                // (interface-inherited) convert() on the decompressor class.
                // ConverterInputStream drives the converter from C and never
                // dispatches through JS, so this observes exactly the member
                // scan — the code path the quadratic bug lived in.
                const proto = Gio.ZlibDecompressor.prototype as unknown as Record<string, unknown>;
                const original = proto.convert as (...args: unknown[]) => unknown;
                const hadOwn = Object.prototype.hasOwnProperty.call(proto, 'convert');
                let calls = 0;
                let maxInbuf = 0;
                let totalInbuf = 0;
                proto.convert = function (this: unknown, ...args: unknown[]) {
                    const inbuf = args[0] as Uint8Array;
                    calls++;
                    maxInbuf = Math.max(maxInbuf, inbuf.length);
                    totalInbuf += inbuf.length;
                    return original.apply(this, args);
                };
                try {
                    const decompressed = gunzipSync(input);
                    expect(decompressed.length).toBe(outputSize);
                } finally {
                    if (hadOwn) proto.convert = original;
                    else delete proto.convert;
                }

                expect(calls).toBeGreaterThan(0);
                // The quadratic shape's defining symptom: the first scan call
                // received the entire remaining input (>= one whole member).
                expect(maxInbuf).toBeLessThan(CONVERT_INPUT_SLICE + 1);
                // Linearity: the scan re-marshals a slice only while the
                // out-buffer limits consumption, so the total stays within a
                // small constant of input + output (quadratic was ~calls×N/2).
                expect(totalInbuf).toBeLessThan(2 * (input.length + outputSize) + 1024 * 1024);
            });
        });
    });
};
