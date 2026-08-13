// Coverage for the per-axis record behind `RunOptions.requireAxes`.
//
// The invariant worth guarding is the one that makes the record worth keeping: a
// gate that MATCHED and then executed nothing must score zero, not one. Counting
// gates would make the silent case — an axis whose tests stopped being registered —
// look exactly like coverage, which is the state this ledger exists to end.
//
// Import through the PACKAGE specifier, like the sibling specs and `test.mts`'s
// `run()`: a relative `./index.js` resolves to a SECOND module instance with its own
// copy of the ledger, so every assertion here would read zeros.
import { describe, it, expect, on, getAxisLedger, type Runtime } from '@gjsify/unit';
import { runtimeName } from '@gjsify/runtime';

/** The axis this leg is actually on, in `on()`'s vocabulary. */
const HOST_AXIS: Runtime =
    ({ GJS: 'Gjs', 'Node.js': 'Node.js', Bun: 'Bun', Deno: 'Deno' } as Record<string, Runtime>)[runtimeName] ??
    'Unknown';

/**
 * A real runtime that is definitely NOT this one, so the miss path is exercised on
 * every leg — including the Bun and Deno legs `test:cross-runtime` drives, where a
 * hardcoded foreign name would otherwise match the host.
 */
const FOREIGN_AXIS: Runtime = HOST_AXIS === 'Deno' ? 'Bun' : 'Deno';

export default async () => {
    await describe('axis ledger', async () => {
        await it('credits a matched gate with the tests it actually executed', async () => {
            const before = getAxisLedger()[HOST_AXIS]?.tests ?? 0;

            await on(HOST_AXIS, async () => {
                await it('a probe inside a matched gate', () => {
                    expect(1).toBe(1);
                });
            });

            expect(getAxisLedger()[HOST_AXIS].tests).toBe(before + 1);
        });

        await it('scores a matched gate that registered NO test as zero', async () => {
            // The whole point: this gate fired, so `matched` moves, but it produced no
            // test and must not read as coverage.
            const before = getAxisLedger()[HOST_AXIS] ?? { matched: 0, tests: 0, ignored: 0 };

            await on(HOST_AXIS, async () => {
                /* a body whose tests have silently stopped being registered */
            });

            const after = getAxisLedger()[HOST_AXIS];
            expect(after.matched).toBe(before.matched + 1);
            expect(after.tests).toBe(before.tests);
        });

        await it('records a gate the host does not match as stood down, not matched', async () => {
            const before = getAxisLedger()[FOREIGN_AXIS] ?? { matched: 0, tests: 0, ignored: 0 };

            await on(FOREIGN_AXIS, async () => {
                await it('never runs on this host', () => {
                    throw new Error(`the ${FOREIGN_AXIS} gate ran on ${HOST_AXIS}`);
                });
            });

            const after = getAxisLedger()[FOREIGN_AXIS];
            expect(after.ignored).toBe(before.ignored + 1);
            expect(after.matched).toBe(before.matched);
            expect(after.tests).toBe(before.tests);
        });

        await it('credits ONLY the axis that matched, never every axis named', async () => {
            // `on(['Node.js', 'Gjs'], …)` is a real spelling in this tree. Running it
            // under Node exercised Node and nothing else — crediting 'Gjs' as well
            // would let the Node leg satisfy a Gjs declaration, which is the false
            // claim the whole ledger exists to make impossible.
            const before = getAxisLedger();
            const beforeHost = before[HOST_AXIS]?.tests ?? 0;
            const beforeForeign = before[FOREIGN_AXIS] ?? { matched: 0, tests: 0, ignored: 0 };

            await on([HOST_AXIS, FOREIGN_AXIS], async () => {
                await it('a probe inside a gate naming two axes', () => {
                    expect(1).toBe(1);
                });
            });

            const after = getAxisLedger();
            const afterForeign = after[FOREIGN_AXIS] ?? { matched: 0, tests: 0, ignored: 0 };
            expect(after[HOST_AXIS].tests).toBe(beforeHost + 1);
            expect(afterForeign.tests).toBe(beforeForeign.tests);
            expect(afterForeign.matched).toBe(beforeForeign.matched);
        });
    });
};
