// Coverage for `it.failing` — the expected-failure marker.
//
// The behaviour worth guarding is not "a failing test may fail". It is the
// SECOND half: a marked test that starts PASSING must fail the suite, because
// that is what makes the marker self-retiring instead of a skip that rots.
//
// These specs drive the real `it.failing` and observe the run summary through
// `getTestCounters()`, so they assert the counters the CI gate actually reads
// rather than the printed text.

// Import through the PACKAGE specifier, exactly like the sibling specs and
// like `test.mts`'s `run()`. A relative `./index.js` here resolves to a
// SECOND module instance in the bundle, with its own copy of the run counters
// — the probes then increment one copy while the summary prints the other, so
// a deliberate failure vanishes and the run exits 0. Measured while writing
// this spec.
import { describe, it, expect, getTestCounters } from '@gjsify/unit';

export default async () => {
    await describe('it.failing', async () => {
        await it('does not charge an expected failure to the failure count', async () => {
            const before = getTestCounters();
            await it.failing(
                'a deliberately failing probe',
                () => {
                    throw new Error('expected');
                },
                'probe for the it-failing spec',
            );
            const after = getTestCounters();
            expect(after.failed).toBe(before.failed);
            expect(after.xfail).toBe(before.xfail + 1);
        });

        await it('counts a rejected async callback as the expected failure', async () => {
            const before = getTestCounters();
            await it.failing(
                'a deliberately rejecting probe',
                async () => {
                    await Promise.reject(new Error('expected'));
                },
                'probe for the it-failing spec',
            );
            expect(getTestCounters().xfail).toBe(before.xfail + 1);
        });

        await it('with when:false the test runs as an ordinary it() and must pass', async () => {
            // The scoped form. `when: false` must NOT tolerate a failure and must
            // NOT skip: it is a plain `it()`. A PASSING body is the only case that
            // can be asserted from inside this run — a failing one would put a
            // real failure into it (same reason as the note below).
            const before = getTestCounters();
            await it.failing(
                'a body that passes, with the expectation scoped out',
                () => {
                    expect(1).toBe(1);
                },
                'declared failing only on a platform this run is not',
                { when: false },
            );
            const after = getTestCounters();
            expect(after.xfail - before.xfail).toBe(0); // not tolerated
            expect(after.ignored - before.ignored).toBe(0); // not skipped
            expect(after.failed - before.failed).toBe(0); // and it passed
        });

        await it('with when:true it still counts as the expected failure', async () => {
            const before = getTestCounters();
            await it.failing(
                'a deliberately failing probe, expectation in scope',
                () => {
                    expect(1).toBe(2);
                },
                'probe for the scoped it-failing spec',
                { when: true },
            );
            expect(getTestCounters().xfail).toBe(before.xfail + 1);
        });

        // The self-retiring half — "a marked test that starts passing must FAIL
        // the suite" — is NOT asserted here on purpose: triggering it would add
        // a real failure to THIS run and turn the unit suite red. It is covered
        // in a child process by `tests/e2e/unit-it-failing`, which is the only
        // way to observe an exit code without becoming it.
        //
        // The same reasoning covers the interesting half of `when: false`: a
        // FAILING body with the expectation scoped out must redden the run, and
        // that too can only be observed from outside.
    });
};
