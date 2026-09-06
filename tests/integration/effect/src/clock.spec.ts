// SPDX-License-Identifier: MIT
// Ported from packages/effect/test/Clock.test.ts (effect@4.0.0-rc.112).
// Original: Copyright (c) 2023 Effectful Technologies Inc. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Upstream spies on `Date.now` and `process.hrtime.bigint` to prove Effect's Clock
// keeps two independent sources: wall time that can jump backwards (NTP, a
// suspend) and a monotonic source that cannot. On GJS `process.hrtime.bigint` is
// @gjsify/process, so this case also PINS which of our APIs the Clock reads — the
// kind of fact that otherwise only surfaces when a release changes it.
//
// The second case is authored: the spy proves the Clock reads `hrtime`, not that
// our `hrtime` is monotonic, and those are different claims.
//
// Dialect: `vi.spyOn(…).mockImplementation(…)` hand-rolled, same shape as
// scheduler.spec.ts. `assert.isTrue` → `expect(…).toBe(true)`.

import { describe, expect, it } from '@gjsify/unit';
import { Clock, Effect } from 'effect';

export default async () => {
    await describe('effect/Clock', async () => {
        await it('keeps wall time aligned while exposing the monotonic source', async () => {
            let wallMillis = 1_000_000;
            let monotonicNanos = 5_000_000_000n;

            const dateNow = Date.now;
            const hrtimeBigint = process.hrtime.bigint;
            Date.now = () => wallMillis;
            process.hrtime.bigint = () => monotonicNanos;

            try {
                await Effect.runPromise(
                    Effect.gen(function* () {
                        const clock = yield* Clock.Clock;
                        const nanosPerMilli = 1_000_000n;

                        expect(clock.currentTimeNanosUnsafe()).toBe(BigInt(wallMillis) * nanosPerMilli);
                        expect(clock.monotonicTimeNanosUnsafe()).toBe(monotonicNanos);

                        wallMillis += 250;
                        monotonicNanos += 250_000_000n;
                        expect(clock.currentTimeNanosUnsafe()).toBe(BigInt(wallMillis) * nanosPerMilli);

                        // Wall clock jumps forward with the monotonic source standing
                        // still: only the first reading may move.
                        wallMillis += 5_000;
                        const beforeSuspend = clock.monotonicTimeNanosUnsafe();
                        expect(clock.currentTimeNanosUnsafe()).toBe(BigInt(wallMillis) * nanosPerMilli);
                        expect(clock.monotonicTimeNanosUnsafe()).toBe(beforeSuspend);

                        // And backwards, which is the case a single-source clock gets wrong.
                        wallMillis -= 3_000;
                        monotonicNanos += 100_000_000n;
                        expect(clock.currentTimeNanosUnsafe()).toBe(BigInt(wallMillis) * nanosPerMilli);
                        expect(clock.monotonicTimeNanosUnsafe() > beforeSuspend).toBe(true);
                    }),
                );
            } finally {
                Date.now = dateNow;
                process.hrtime.bigint = hrtimeBigint;
            }
        });

        await it('the real monotonic source advances across a real sleep — authored', async () => {
            await Effect.runPromise(
                Effect.gen(function* () {
                    const clock = yield* Clock.Clock;
                    const before = clock.monotonicTimeNanosUnsafe();
                    yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)));
                    expect(clock.monotonicTimeNanosUnsafe() > before).toBe(true);
                }),
            );
        });
    });
};
