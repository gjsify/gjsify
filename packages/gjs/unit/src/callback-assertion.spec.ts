// Invariant under test: an `expect` that fires in a callback OFF the awaited chain
// still lands as that test's failure, on every runtime.
//
// Each runtime reaches it by a different half of the fix — on Node the
// `uncaughtException` hook fails the test with the assertion directly, on GJS the
// promise never settles and the ledger turns the resulting timeout back into the
// assertion — so the ledger path is only ever covered by the GJS leg of this spec.
//
// The probes are `it.failing`, not `it()`: they MUST fail, and that makes each one
// two-sided, since `it.failing` fails the run if its body ever stops failing. A
// regression that swallows the callback assertion again turns THIS spec red.
//
// Import through the PACKAGE specifier, like the sibling specs: a relative
// `./index.js` resolves to a SECOND module instance in the bundle with its own copy
// of the counters, so a deliberate failure would vanish.
import { describe, expect, getTestCounters, it } from '@gjsify/unit';

/** Fire a callback that is NOT part of any promise the caller awaits. */
const fireDetached = (fn: () => void): void => {
    setTimeout(fn, 0);
};

/**
 * Required for correctness, not a speed tweak: a probe whose promise never settles
 * can only end by timing out, and it runs NESTED inside an `it()` with its own
 * budget. At the 5 s default both budgets are equal, so the OUTER test times out
 * first and the orphaned probe's xfail lands inside the NEXT test's before/after
 * window (measured on gjs 1.88.1 — three failures from one cause). Invisible on
 * Node, where the host hook ends the probe in milliseconds.
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
            // The second shape: an `async` callback whose assertion REJECTS that
            // function's promise instead of raising synchronously — why
            // `installUncaughtHooks` listens for `unhandledRejection` too. Node
            // collapses the two shapes (it re-raises an unhandled rejection as
            // `uncaughtException` when no listener exists) so a Node-only run cannot
            // tell them apart; Bun terminates the process instead, and this probe
            // failed the bun CI leg while passing on Node and Windows.
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
            // A spec may provoke a host error on purpose and install its own listener
            // to swallow it (`@gjsify/diagnostics_channel` does, to prove a throwing
            // subscriber does not stop the remaining ones). Non-assertion + another
            // listener present ⇒ probably deliberate ⇒ not a failure. Since "a
            // listener exists" only proves SOME error was anticipated, not THIS one,
            // it becomes a non-gating warning: visible to a reader, invisible to the
            // exit code.
            interface HostProcess {
                on?: (event: string, listener: (error: unknown) => void) => void;
                removeListener?: (event: string, listener: (error: unknown) => void) => void;
            }
            // GJS has no host hook, so nothing is absorbed and nothing warned. Gate on
            // the RUNTIME, not on `typeof proc.on` — see `isGjs`.
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
            expect(after.failed - before.failed).toBe(0);
            // Not silent either: this is what keeps the "spec installed a listener"
            // proxy from becoming a place where a genuine impl error disappears.
            expect(after.warnings - before.warnings).toBe(1);
        });

        await it('does not flag an assertion a matcher deliberately absorbed', async () => {
            // `toThrow` catching a nested `expect` is how the matchers' own specs are
            // written: observed and handled, so never reported as lost — getting this
            // wrong produced 9 phantom failures in this very package.
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
