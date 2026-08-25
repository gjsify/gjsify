// Coverage for the rule that decides the process exit code.
//
// The regression it guards is measured rather than imagined: a throw out of a
// suite BODY (an `expect()` in a `describe` callback, a failing import) rejected
// `run()`'s promise chain, which had no `catch`. Both terminal steps were skipped,
// so nothing printed and `process.exit` never ran — and Node, with nothing left
// pending, exited **0** with the log cut off mid-suite. Every later suite was
// silently dropped and CI read the run as a pass.
//
// gtk-host found it: its `buildable.spec.ts` asserts directly in a `describe` body,
// that assertion holds on GJS and fails under `@gjsify/node-gi`, and the node leg
// reported SUCCESS having run one suite out of nine.
//
// The tally alone cannot answer this, and that is the point of the second argument:
// a suite body that threw says nothing about the tests that never started, so it
// must not be counted as a test failure — but it must still fail the process.
import { describe, expect, exitCodeFor, it } from '@gjsify/unit';

export default async () => {
    await describe('exit code', async () => {
        await it('passes when nothing failed and no suite body threw', async () => {
            expect(exitCodeFor(0, false)).toBe(0);
        });

        await it('fails on a counted test failure', async () => {
            expect(exitCodeFor(3, false)).toBe(1);
        });

        await it('fails when a suite body threw, even with a clean tally', async () => {
            // THE regression. Before the fix this answered 0.
            expect(exitCodeFor(0, true)).toBe(1);
        });

        await it('fails on both at once without double-deciding', async () => {
            expect(exitCodeFor(2, true)).toBe(1);
        });
    });
};
