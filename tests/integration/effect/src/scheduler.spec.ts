// SPDX-License-Identifier: MIT
// Ported from packages/effect/test/Scheduler.test.ts (effect@4.0.0-rc.112).
// Original: Copyright (c) 2023 Effectful Technologies Inc. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// This is the file that pays for the whole suite on the timing axis. Effect's
// `MixedScheduler` decides, per yield, whether to drain its queue synchronously or
// hand the rest to the host — and the host it hands to is `setImmediate` if the
// global exists, `setTimeout` otherwise. Bare GJS has neither; both are
// @gjsify/timers here, dispatched off the GLib main loop.
//
// The third case is the sharp one: `runSyncExit` must complete a yielding effect
// WITHOUT scheduling a host timer at all. If it ever schedules one, `Effect.runSync`
// on GJS stops returning a value and starts returning "not completed" — the effect
// finishes on the next main-loop turn, which for a synchronous caller is never.
//
// Dialect: `vi.spyOn(obj, 'name')` has no @gjsify/unit equivalent, so the two spies
// are hand-rolled below. `spyOn` records calls and `restore()` puts the original
// back; the upstream `mockImplementation(() => { throw … })` shape is kept, because
// a spy that only counts would let a scheduled timer pass as long as nobody looked.

import { describe, expect, it } from '@gjsify/unit';
import { Effect, Exit } from 'effect';
import * as Scheduler from 'effect/Scheduler';

interface Spy {
    calls: number;
    restore: () => void;
}

/** `vi.spyOn(host, name).mockImplementation(impl)`, hand-rolled. */
const spyOn = (
    host: Record<string, unknown>,
    name: string,
    impl: (this: unknown, ...args: never[]) => unknown,
): Spy => {
    const original = host[name];
    const spy: Spy = {
        calls: 0,
        restore: () => {
            if (original === undefined) delete host[name];
            else host[name] = original;
        },
    };
    // `function` and not an arrow: the call-through case applies `impl` with the
    // receiver, and an arrow would hand it `undefined`. Latent today because the one
    // call-through case asserts a count of zero, which is exactly the kind of thing
    // that stops being latent when someone adds a second case.
    host[name] = function (this: unknown, ...args: never[]) {
        spy.calls++;
        return impl.apply(this, args);
    };
    return spy;
};

export default async () => {
    await describe('effect/Scheduler', async () => {
        await it('runSyncExit does not create a dispatcher for synchronous effects', async () => {
            const prototype = Scheduler.MixedScheduler.prototype as unknown as Record<string, unknown>;
            const original = prototype.makeDispatcher;
            const makeDispatcher = spyOn(prototype, 'makeDispatcher', function (this: unknown, ...args: never[]) {
                return (original as (...a: never[]) => unknown).apply(this, args);
            });

            const exit = Effect.runSyncExit(Effect.sync(() => 1));
            const calls = makeDispatcher.calls;
            makeDispatcher.restore();

            expect(exit).toStrictEqual(Exit.succeed(1));
            expect(calls).toBe(0);
        });

        await it('runSyncExit flushes dispatcher work after yielding', async () => {
            const exit = Effect.runSyncExit(Effect.as(Effect.yieldNow, 1));

            expect(exit).toStrictEqual(Exit.succeed(1));
        });

        await it('runSyncExit does not schedule timers after yielding', async () => {
            const host = globalThis as unknown as Record<string, unknown>;
            const setImmediate = spyOn(host, 'setImmediate', () => {
                throw new Error('setImmediate is not supported');
            });
            const setTimeout = spyOn(host, 'setTimeout', () => {
                throw new Error('setTimeout is not supported');
            });

            try {
                const exit = Effect.runSyncExit(Effect.as(Effect.yieldNow, 1));

                expect(exit).toStrictEqual(Exit.succeed(1));
                expect(setImmediate.calls).toBe(0);
                expect(setTimeout.calls).toBe(0);
            } finally {
                setImmediate.restore();
                setTimeout.restore();
            }
        });

        await it('MixedScheduler orders by priority (sync)', async () => {
            const scheduler = new Scheduler.MixedScheduler('sync').makeDispatcher();
            const order: Array<string> = [];

            scheduler.scheduleTask(() => order.push('p0-1'), 0);
            scheduler.scheduleTask(() => order.push('p10-1'), 10);
            scheduler.scheduleTask(() => order.push('p-1-1'), -1);
            scheduler.scheduleTask(() => order.push('p10-2'), 10);
            scheduler.scheduleTask(() => order.push('p0-2'), 0);

            expect(order).toStrictEqual([]);

            scheduler.flush();

            expect(order).toStrictEqual(['p-1-1', 'p0-1', 'p0-2', 'p10-1', 'p10-2']);
        });

        await it('MixedScheduler is FIFO within a priority', async () => {
            const scheduler = new Scheduler.MixedScheduler('sync').makeDispatcher();
            const order: Array<number> = [];

            scheduler.scheduleTask(() => order.push(1), 5);
            scheduler.scheduleTask(() => order.push(2), 5);
            scheduler.scheduleTask(() => order.push(3), 5);

            scheduler.flush();

            expect(order).toStrictEqual([1, 2, 3]);
        });

        await it('PreventSchedulerYield disables shouldYield checks', async () => {
            let calls = 0;
            const scheduler: Scheduler.Scheduler = {
                executionMode: 'sync',
                shouldYield: () => {
                    calls++;
                    return false;
                },
                makeDispatcher() {
                    return {} as never;
                },
            };

            await Effect.runPromise(
                Effect.sync(() => undefined).pipe(Effect.provideService(Scheduler.Scheduler, scheduler)),
            );
            expect(calls > 0).toBe(true);

            calls = 0;
            await Effect.runPromise(
                Effect.sync(() => undefined).pipe(
                    Effect.provideService(Scheduler.Scheduler, scheduler),
                    Effect.provideService(Scheduler.PreventSchedulerYield, true),
                ),
            );
            expect(calls).toBe(0);
        });
    });
};
