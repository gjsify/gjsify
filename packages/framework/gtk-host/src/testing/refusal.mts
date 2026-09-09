// Test-only: what a call REFUSED with, or what it did instead.
//
// A spec asserting `toThrow()` alone passes for the wrong throw — a `TypeError` from a
// missing binding reads the same as the named refusal — so the vectors compare the
// CODE. And a call that did not throw must read as a distinct answer, never as an empty
// string that some assertion happens to accept.
//
// `.mts` for the same reason as `gate.mts`: the library build globs `src/**/*.{ts,js}`, so
// nothing test-only reaches the published bundle.

import { GtkHostError } from '../errors.js';

/** The refusal code `fn` raises, or what it did instead — so a wrong refusal reads as one. */
export function codeOf(fn: () => unknown): string {
    try {
        fn();
    } catch (error) {
        return error instanceof GtkHostError ? error.code : `not-a-GtkHostError: ${String(error)}`;
    }
    return 'no throw';
}
