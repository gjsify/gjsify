// The MEASUREMENT behind `canDelegateRef`'s positive probe, kept in its own file
// because the `.gjs.spec.ts` suffix is load-bearing rather than cosmetic:
// `scripts/audit-runtimes.mjs` skips exactly that suffix — "specs are allowed to
// exercise GJS-only paths" — and scans every other `.ts`. With the
// `await import('gi://GLib')` in `timeout.spec.ts`, the auditor read a test as a
// source signal and reported this package's declared triplet as drifting to
// `node:partial, browser:partial` — a required check, red, for a test. Same trap
// `@gjsify/console` documents at the head of `gerror.gjs.spec.ts`.
//
// The file still runs on BOTH legs: `test.mts` imports the suite, and the
// `on('Gjs')` gate below stands the suite down on Node, where a `gi://` import
// would have nothing to resolve against.

import { describe, expect, it, on } from '@gjsify/unit';
import { Timeout } from './timeout.js';

export default async () => {
    await describe('Timeout GSource delegation guard', async () => {
        // The regression this guard exists for: a delegation guard written as a
        // NEGATIVE test ("the host is not a GLib source") let a real
        // `GLib.Source` through and `.unref()` reached `g_source_unref`, killing
        // the process with `g_source_unref_internal: assertion 'old_ref > 0'
        // failed`.
        //
        // The negative test does not work, and the measurement below is why: on
        // gjs 1.88.1 a native `setTimeout` handle has `'$gtype' in t === false`,
        // `t.constructor.name === 'GLib_Source'`, `ref`/`unref` present and
        // `hasRef`/`refresh` absent. So the only probe that keeps delegation away
        // from it is the POSITIVE one.
        await on('Gjs', async () => {
            await it('never delegates ref/unref to a GLib.Source-shaped host', async () => {
                // The measured shape, built so the assertion can be about
                // DELEGATION rather than about a GLib warning that arrives
                // asynchronously and would let a broken guard pass.
                const GLib = (await import('gi://GLib?version=2.0' as string)).default as {
                    PRIORITY_DEFAULT: number;
                    timeout_add(priority: number, interval: number, fn: () => boolean): number;
                    Source: { remove(id: number): void };
                    MainContext: { default(): { find_source_by_id(id: number): unknown } };
                };
                const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10_000, () => false);
                const real = GLib.MainContext.default().find_source_by_id(id);
                expect(typeof (real as { unref?: unknown }).unref).toBe('function');
                expect(typeof (real as { hasRef?: unknown }).hasRef).toBe('undefined');
                expect('$gtype' in (real as object)).toBe(false);

                let delegated = 0;
                const gsourceShaped = {
                    ref: () => {
                        ++delegated;
                    },
                    unref: () => {
                        ++delegated;
                    },
                };
                const t = new Timeout(() => {}, 10_000, [], false);
                (t as unknown as { _id: unknown })._id = gsourceShaped;
                t.unref();
                t.ref();
                // Zero is the whole contract: `.unref()` on a GSource is
                // `g_source_unref`, and it destroys the source.
                expect(delegated).toBe(0);
                // The intent is still recorded, so `hasRef()` stays truthful.
                expect(t.hasRef()).toBe(true);
                GLib.Source.remove(id);
            });
        });
    });
};
