// The summary counts TWO things, and conflating them cost a week (#1557).
//
// `N completed` was assertions, printed in a sentence every consumer read as
// tests — including two commit messages now on `main`. Worse than imprecise: a
// suite that asserts inside data-driven loops moves the number without changing
// what it verifies, so it is not comparable across commits in either direction.
// Measured on `@gjsify/react-native`: 25 tests added, 58 `expect(` call sites
// added, nothing skipped and nothing deleted — and the number FELL by 114.
//
// The two counters are separated here rather than in a doc comment because the
// distinction is only worth anything if it holds: a test count that drifted back
// into counting assertions would read exactly like the line this replaced.
import { describe, expect, formatFailureVerdict, getTestCounters, it } from '@gjsify/unit';

export default async () => {
    await describe('run counters', async () => {
        let snapshot = getTestCounters();

        await it('counts one assertion per expect(), whatever the test does', async () => {
            const before = getTestCounters();
            expect(true).toBe(true);
            expect(true).toBe(true);
            expect(true).toBe(true);
            const after = getTestCounters();
            // Three `expect(…)` calls between the two reads. `toBe` does not add
            // one: `expect()` is where the count happens.
            expect(after.assertions - before.assertions).toBe(3);
            snapshot = after;
        });

        await it.skip('a skipped test, which must not read as a test that ran', async () => {
            throw new Error('unreachable: it.skip never invokes the body');
        });

        await it('advances `tests` once per test and `ignored` once per skip', async () => {
            const now = getTestCounters();
            // ONE test since the snapshot: the skip between them is not a test that
            // ran, and a total alone can never say so — a skip is arithmetically
            // indistinguishable from a deleted test in one number.
            expect(now.tests - snapshot.tests).toBe(1);
            expect(now.ignored - snapshot.ignored).toBe(1);
            // …while assertions kept moving independently, which is the whole point
            // of carrying both.
            expect(now.assertions > snapshot.assertions).toBe(true);
        });

        await it('never states a ratio that cannot be true', async () => {
            // Three paths raise the failure count without a test having run — a
            // stray assertion, a timed-out suite or run, a declared axis that
            // exercised nothing. Counted into one number they printed `3 of 2 tests
            // failed`, and with no real tests, `2 of 0`.
            expect(formatFailureVerdict({ failed: 1, outside: 0, tests: 7 })).toBe('1 of 7 tests failed');
            expect(formatFailureVerdict({ failed: 1, outside: 2, tests: 7 })).toBe(
                '1 of 7 tests failed, and 2 failures outside any test',
            );
            expect(formatFailureVerdict({ failed: 0, outside: 2, tests: 0 })).toBe(
                '2 failures outside any test, 0 tests passed',
            );
            expect(formatFailureVerdict({ failed: 0, outside: 1, tests: 3 })).toBe(
                '1 failure outside any test, 3 tests passed',
            );
        });
    });
};
