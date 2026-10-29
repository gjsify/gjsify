// `acquireMainLoop`/`releaseMainLoop` are the counted layer over the
// uncounted loop primitives. The assertions here are about STATE, not about a
// driving loop: the suite itself runs inside `@gjsify/unit`'s own main loop, so
// the only observable surface is the module's singleton identity — acquire on
// an empty module creates the loop, further acquires reuse it, and the
// release-quit discards it (a later `ensureMainLoop()` answers a NEW loop).
// On Node the pair is a no-op, and the no-observability of a no-op has no
// test worth its place here. The parked-entry behavior these releases price
// is asserted where it actually runs: `tests/e2e/worker-keepalive/` and,
// for counted requests, `tests/e2e/child-then-fs/`.
// This package runs `test:gjs` only — keep this spec within that budget.

import { describe, expect, it, on } from '@gjsify/unit';
import {
    acquireMainLoop,
    ensureMainLoop,
    quitMainLoop,
    releaseMainLoop,
    trackRequest,
    trackTimer,
    untrackRequest,
    untrackTimer,
} from './main-loop.js';

export default async () => {
    await on('Gjs', async () => {
        await describe('counted holds over the loop singleton', async () => {
            await it('should hold count-wise and drain-quit at zero', async () => {
                // Start from the module's resting state so this test owns the
                // singleton it asserts about.
                quitMainLoop();

                const first = acquireMainLoop(); // creates the loop: the holds own it
                const second = acquireMainLoop();
                expect(second).toBe(first); // ref-counted, no second loop

                releaseMainLoop(); // one handle gone — the loop still exists
                releaseMainLoop(); // the last handle — loop drained
                expect(ensureMainLoop()).not.toBe(first); // the quit-cycle discards the loop

                releaseMainLoop(); // past zero — must not throw
                quitMainLoop();
            });

            await it('should leave a loop it does not own running at zero', async () => {
                quitMainLoop();

                // A server/GTK owner got there first: the holds only count,
                // the loop must outlive them like it does on Node.
                const ensured = ensureMainLoop();
                acquireMainLoop();
                releaseMainLoop();
                expect(ensureMainLoop()).toBe(ensured);

                // An uncounted caller that joins LATER takes the loop over too.
                quitMainLoop();
                const owned = acquireMainLoop();
                ensureMainLoop();
                releaseMainLoop();
                expect(ensureMainLoop()).toBe(owned);

                quitMainLoop();
            });

            await it('should count timers without creating or owning a loop', async () => {
                quitMainLoop();

                trackTimer(); // a timer alone must not park anything
                const ensured = ensureMainLoop(); // so this is the FIRST loop
                untrackTimer(); // not the owner (no hold): the last timer leaves it alone
                expect(ensureMainLoop()).toBe(ensured);

                untrackTimer(); // past zero — must not throw
                quitMainLoop();
            });

            await it('should count requests the same way, in the shared count', async () => {
                quitMainLoop();

                trackRequest(); // an fs request alone must not park anything either
                trackTimer();
                const ensured = ensureMainLoop();
                untrackRequest();
                untrackTimer(); // the count is shared: this reaches zero, still not the owner
                expect(ensureMainLoop()).toBe(ensured);

                untrackRequest(); // past zero — must not throw
                quitMainLoop();
            });
        });
    });
};
