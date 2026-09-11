// SPDX-License-Identifier: MIT
// The pure half of the entry's exit funnel.
//
// The half that cannot be unit-tested — does `index.ts` actually call it, and
// does GJS then carry the status to the shell — is `tests/e2e/cli-exit-status`,
// which runs the same argv on both hosts and asserts they agree. Split for the
// same reason `cli-fail.spec.ts` splits: a rule this small is only worth pinning
// because something real depends on it, and the dependency is what the e2e
// states.

import { describe, expect, it } from '@gjsify/unit';
import { pendingFailureCode } from './cli-exit.js';

export default async () => {
    await describe('pendingFailureCode', async () => {
        await it('owes nothing when no handler reported a failure', async () => {
            expect(pendingFailureCode(undefined, false)).toBeNull();
            expect(pendingFailureCode(null, false)).toBeNull();
            expect(pendingFailureCode(0, false)).toBeNull();
        });

        await it('owes the status a handler reported', async () => {
            expect(pendingFailureCode(1, false)).toBe(1);
            // Not collapsed to 1: `gjsify gresource`/`gjsify gsettings` pass the
            // code `glib-compile-*` exited with, and `run-gjs.ts` documents why
            // a chain reading `$?` needs "tool failed" and "tool says no" to
            // stay distinguishable.
            expect(pendingFailureCode(2, false)).toBe(2);
            expect(pendingFailureCode(127, false)).toBe(127);
        });

        await it('accepts the string form Node allows for process.exitCode', async () => {
            expect(pendingFailureCode('1', false)).toBe(1);
            expect(pendingFailureCode('0', false)).toBeNull();
        });

        await it('owes nothing for a daemon command, whose resolution is not an ending', async () => {
            // A watch loop resolves as soon as it is armed and then keeps
            // running. Exiting on that resolution is the #1237 incident —
            // `gjsify run dev` took down the loop it had just started — and this
            // funnel must not reintroduce it one layer up.
            expect(pendingFailureCode(1, true)).toBeNull();
            expect(pendingFailureCode(0, true)).toBeNull();
        });

        await it('invents no failure from a value that is not a status', async () => {
            // `process.exitCode = 'nope'` throws on Node, so there is nothing
            // here to translate into an exit — and guessing 1 would make the two
            // runtimes disagree, which is the whole defect this module closes.
            expect(pendingFailureCode(Number.NaN, false)).toBeNull();
        });
    });
};
