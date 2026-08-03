// Coverage for assertions that fire in a callback OFF the awaited chain.
//
// The behaviour under test is not "a failing expect fails a test" — it is that a
// failing expect the runner cannot see through its promise chain still lands as
// that test's failure, on every runtime.
//
// Why this spec exists: on Node such a throw reaches `uncaughtException` and, by
// default, ends the process. One of them in `@gjsify/fs`'s `callback.spec.ts`
// stopped that run inside the FIRST of 19 spec modules with no summary line —
// the other 18 modules never executed, hiding ~56 lines of real Windows
// failures. On GJS the host only logs it, and the test timed out 5 s later under
// a message naming neither the assertion nor the file.
//
// The probes are `it.failing`, not `it()`: they MUST fail, and an expected
// failure is counted as xfail instead of reddening this package's own suite.
// That also makes each probe a two-sided assertion — `it.failing` fails the run
// if its body ever stops failing, so a regression that silently swallows the
// callback assertion again turns THIS spec red rather than quietly passing.
//
// The probes exercise a different half of the fix per runtime, deliberately: on
// Node the `uncaughtException` hook catches the throw and fails the test with the
// assertion directly; on GJS there is no such hook, the promise is never settled,
// and the ledger turns the resulting timeout back into the assertion. So the
// ledger path is only reachable on GJS and is covered by the GJS leg of this same
// spec — not by the Node run. Both paths must end in a counted expected failure.
//
// Import through the PACKAGE specifier, exactly like the sibling specs: a
// relative `./index.js` resolves to a SECOND module instance in the bundle with
// its own copy of the counters, so a deliberate failure would vanish.
import { describe, expect, getTestCounters, it } from '@gjsify/unit';

/** Fire a callback that is NOT part of any promise the caller awaits. */
const fireDetached = (fn: () => void): void => {
    setTimeout(fn, 0);
};

/**
 * Every inner probe gets an EXPLICIT short timeout, and that is not a speed
 * tweak — it is required for correctness.
 *
 * A probe whose promise is never settled can only end by timing out, and it runs
 * NESTED inside an `it()` that has its own budget. Left at the 5 s default both
 * budgets are equal, so the OUTER test times out first: it reported ⏱ 5.00s while
 * its own probe was still running, and that orphaned probe's xfail then landed
 * inside the NEXT test's before/after window (measured on gjs 1.88.1 — three
 * failures from one cause). On Node the bug is invisible because the host hook
 * ends the probe in milliseconds.
 */
const PROBE_TIMEOUT_MS = 300;

/**
 * True on real GJS. Same signal `installUncaughtHooks` gates on, and it must be
 * this one: `@gjsify/process` DOES provide `process.on`, so probing for that
 * function is not a test for "is there a host hook here" — it silently passes on
 * GJS, where nothing ever emits the event.
 */
const gjsVersion = (globalThis as { process?: { versions?: { gjs?: string } } }).process?.versions?.gjs;
const isGjs = typeof gjsVersion === 'string';

export default async () => {
    await describe('assertion in a callback off the awaited chain', async () => {
        await it('is charged to the test that armed the callback', async () => {
            const before = getTestCounters();

            // The probe never settles its promise — that is the whole shape. It
            // must still be recognised as a failure of THIS test.
            await it.failing(
                'assertion thrown in a detached callback',
                async () => {
                    await new Promise<void>((resolve) => {
                        fireDetached(() => {
                            expect(1).toBe(2); // throws OUTSIDE the promise chain
                            resolve(); // never reached
                        });
                    });
                },
                'probe for callback-assertion detection — the assertion is thrown from a ' +
                    'host callback the awaited promise never observes',
                PROBE_TIMEOUT_MS,
            );

            const after = getTestCounters();
            // Recognised as the expected failure...
            expect(after.xfail - before.xfail).toBe(1);
            // ...and NOT as a real failure of anything.
            expect(after.failed - before.failed).toBe(0);
        });

        await it('does not double-count a normally failing test', async () => {
            // The ledger must not add a second failure when `it()`'s own catch
            // already observed the error.
            const before = getTestCounters();
            await it.failing(
                'assertion thrown synchronously',
                () => {
                    expect(1).toBe(2);
                },
                'probe: a plain synchronous assertion failure, already visible before this change',
                PROBE_TIMEOUT_MS,
            );
            const after = getTestCounters();
            expect(after.xfail - before.xfail).toBe(1);
            expect(after.failed - before.failed).toBe(0);
        });

        await it('also catches it when the callback is async', async () => {
            // The second shape: an `async` callback, whose assertion REJECTS that
            // function's promise rather than raising synchronously.
            //
            // This probe is why `installUncaughtHooks` listens for
            // `unhandledRejection` as well. On Node the two shapes collapse — its
            // default re-raises an unhandled rejection as `uncaughtException`
            // when no listener exists — so a Node-only run cannot tell the
            // difference. Bun does NOT: it terminates the process. This probe
            // failed the cross-runtime CI leg on bun (no summary, exit 1) while
            // passing on Node and Windows, which is exactly the asymmetry it now
            // guards.
            //
            // Short timeout so that if the hooks ever stop firing, this probe
            // falls back to the ledger's timeout path in 0.3 s rather than 5 s.
            const before = getTestCounters();
            await it.failing(
                'assertion rejected inside an async detached callback',
                async () => {
                    await new Promise<void>((resolve) => {
                        fireDetached(async () => {
                            expect('lost').toBe('seen');
                            resolve();
                        });
                    });
                },
                'probe: the assertion rejects a detached async callback, so the awaited promise ' +
                    'is never settled — the failure must still be attributed to this test',
                PROBE_TIMEOUT_MS,
            );
            const after = getTestCounters();
            expect(after.xfail - before.xfail).toBe(1);
            expect(after.failed - before.failed).toBe(0);
        });

        await it('leaves a passing detached callback passing', async () => {
            // The mirror case: an assertion that PASSES inside a detached
            // callback must not be mistaken for a lost one.
            const before = getTestCounters();
            await it('a probe that resolves from its callback', async () => {
                await new Promise<void>((resolve) => {
                    fireDetached(() => {
                        expect(1).toBe(1);
                        resolve();
                    });
                });
            });
            const after = getTestCounters();
            expect(after.failed - before.failed).toBe(0);
        });

        await it('warns about an escaped error a spec handles itself, without failing', async () => {
            // Not every error that escapes to the host is a test failure. A spec
            // may provoke one on purpose and install its own listener to swallow
            // it — `@gjsify/diagnostics_channel` does exactly that to prove a
            // throwing subscriber does not stop the remaining subscribers. This
            // hook used to claim that error and fail a test that was behaving
            // exactly as designed (caught by CI's GJS shard, not by Node or
            // Windows).
            //
            // Non-assertion + another listener present ⇒ probably deliberate ⇒
            // not a failure. But "a listener exists" only proves SOME error was
            // anticipated, not THIS one, so it is reported as a non-gating
            // warning rather than dropped — visible to a reader, invisible to the
            // exit code.
            interface HostProcess {
                on?: (event: string, listener: (error: unknown) => void) => void;
                removeListener?: (event: string, listener: (error: unknown) => void) => void;
            }
            // GJS has no host hook, so nothing can be absorbed and nothing warned.
            // Gate on the RUNTIME, not on `typeof proc.on` — see `isGjs`.
            if (isGjs) return;
            const proc = (globalThis as { process?: HostProcess }).process;
            if (typeof proc?.on !== 'function') return; // no host hook at all

            const before = getTestCounters();
            const expected = new Error('deliberately escaped, handled by this spec');
            const own = (err: unknown) => {
                if (err === expected) return; // suppress, exactly as the real spec does
            };
            proc.on('uncaughtException', own);
            try {
                // Escapes into the host, like the real spec's throwing
                // subscriber. Must NOT be charged to this test.
                setTimeout(() => {
                    throw expected;
                }, 0);
                // Give the host a turn to deliver it.
                await new Promise<void>((resolve) => setTimeout(resolve, 50));
            } finally {
                proc.removeListener?.('uncaughtException', own);
            }

            const after = getTestCounters();
            // Not a failure...
            expect(after.failed - before.failed).toBe(0);
            // ...but not silent either. This is the assertion that keeps the
            // "spec installed a listener" proxy from becoming a place where a
            // genuine impl error can disappear.
            expect(after.warnings - before.warnings).toBe(1);
        });

        await it('does not flag an assertion a matcher deliberately absorbed', async () => {
            // `toThrow` catching a nested `expect` is how the matchers' own
            // specs are written. Such an error is observed and handled, so it
            // must never be reported as lost — the first version of this fix got
            // this wrong and produced 9 phantom failures in this very package.
            const before = getTestCounters();
            await it('a probe whose inner assertion is absorbed by toThrow', () => {
                expect(() => {
                    expect({ a: 1 }).toMatchObject({ a: 2 });
                }).toThrow();
            });
            const after = getTestCounters();
            expect(after.failed - before.failed).toBe(0);
        });
    });
};
