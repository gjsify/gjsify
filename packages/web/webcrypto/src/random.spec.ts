// Coverage for the shared random source chain.
//
// The regression it pins: `@gjsify/webcrypto`'s polyfill fell back to
// `Math.random()` while claiming GLib, and `@gjsify/crypto.randomBytes()` sat
// on top of it via `globalThis.crypto` — so on GJS the "WebCrypto" tier WAS
// Math.random, with nothing in either package able to observe it. The tier is
// now a return value, which is what makes it assertable at all.

import { describe, expect, it } from '@gjsify/unit';
import {
    _resetRandomSourceCache,
    fillRandomBytes,
    isSecureRandomSource,
    type WebCryptoRandomSource,
} from './random.js';

/** A WebCrypto stand-in that records how it was called. */
function recordingSource(): WebCryptoRandomSource & { calls: number[] } {
    const calls: number[] = [];
    return {
        calls,
        getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
            calls.push(array.byteLength);
            for (let i = 0; i < array.length; i++) array[i] = (i + 1) & 0xff;
            return array;
        },
    };
}

export default async () => {
    await describe('webcrypto.fillRandomBytes', async () => {
        await it('uses the supplied WebCrypto source and reports the tier', () => {
            const source = recordingSource();
            const view = new Uint8Array(8);
            expect(fillRandomBytes(view, { webcrypto: source })).toBe('webcrypto');
            expect(source.calls).toStrictEqual([8]);
            expect([...view]).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        });

        await it('chunks past the 64 KiB getRandomValues quota', () => {
            const source = recordingSource();
            fillRandomBytes(new Uint8Array(65536 + 10), { webcrypto: source });
            expect(source.calls).toStrictEqual([65536, 10]);
        });

        await it('fills a view that is a window onto a larger buffer', () => {
            const source = recordingSource();
            const buffer = new ArrayBuffer(8);
            const view = new Uint8Array(buffer, 4, 4);
            fillRandomBytes(view, { webcrypto: source });
            // Only the window is written — the leading bytes stay untouched.
            expect([...new Uint8Array(buffer)]).toStrictEqual([0, 0, 0, 0, 1, 2, 3, 4]);
        });

        await it('skips the WebCrypto tier entirely when given null', () => {
            // The `@gjsify/webcrypto` case: the polyfill IS globalThis.crypto,
            // so it must be able to opt out rather than recurse into itself.
            // Reset the module caches so this test probes the fallback tiers
            // fresh instead of inheriting an earlier test's cached stream/warn.
            _resetRandomSourceCache();
            const view = new Uint8Array(32);
            const source = fillRandomBytes(view, { webcrypto: null });
            expect(source === 'webcrypto').toBe(false);
            // Whatever tier answered, it produced bytes.
            expect(view.some((b) => b !== 0)).toBe(true);
        });

        await it('produces varied bytes on the host default chain', () => {
            const view = new Uint8Array(256);
            const source = fillRandomBytes(view);
            expect(typeof source).toBe('string');
            expect(new Set(view).size).toBeGreaterThan(1);
        });

        await it('treats an empty view as a no-op', () => {
            const source = recordingSource();
            fillRandomBytes(new Uint8Array(0), { webcrypto: source });
            expect(source.calls).toStrictEqual([]);
        });
    });

    await describe('webcrypto.isSecureRandomSource', async () => {
        await it('accepts only the CSPRNG tiers', () => {
            expect(isSecureRandomSource('webcrypto')).toBe(true);
            expect(isSecureRandomSource('urandom')).toBe(true);
            expect(isSecureRandomSource('glib')).toBe(false);
            expect(isSecureRandomSource('math')).toBe(false);
        });
    });
};
