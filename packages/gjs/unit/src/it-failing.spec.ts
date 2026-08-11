// Coverage for `it.failing`. The invariant worth guarding is the SECOND half of the
// marker: a marked test that starts PASSING must fail the suite, which is what makes
// it self-retiring instead of a skip that rots. Asserted against `getTestCounters()`,
// the counters the CI gate reads, rather than against printed text.
//
// Import through the PACKAGE specifier, like the sibling specs and `test.mts`'s
// `run()`: a relative `./index.js` resolves to a SECOND module instance with its own
// copy of the counters, so a deliberate failure vanishes and the run exits 0.
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
            // `when: false` must neither tolerate a failure nor skip: it is a plain
            // `it()`. Only a PASSING body can be asserted from inside this run — a
            // failing one would put a real failure into it (see the note below).
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

        // The self-retiring half — a marked test that starts passing must FAIL the
        // suite — cannot be asserted here: triggering it would add a real failure to
        // THIS run. It is covered in a child process by `tests/e2e/unit-it-failing`,
        // as is the mirror case of a FAILING body with `when: false`.
    });
};
