// SPDX-License-Identifier: MIT
// Ported from packages/effect/test/Stream.test.ts (effect@4.0.0-rc.112),
// describe("callback") in full plus describe("timeout").
// Original: Copyright (c) 2023 Effectful Technologies Inc. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// `Stream.callback` is the constructor that turns a push source into a pull
// stream, which is exactly the shape a GTK signal has — a handler that fires when
// it likes, into a consumer that reads when it likes. So this describe block is
// simultaneously an upstream port and the contract the showcase's
// `signalStream()` is written against: emit, end, fail, throw, and hold the
// producer when the buffer is full.
//
// The backpressure case is the one that needs a working microtask/timer split:
// `Effect.yieldNow` has to return control to the offering fibers, exactly twice,
// before the assertion reads the counters.

import { describe, expect, it } from '@gjsify/unit';
import { Cause, Duration, Effect, Exit, Fiber, Latch, Queue, Stream } from 'effect';
import { pipe } from 'effect/Function';

import { runLive, runTest } from './run.js';

export default async () => {
    await describe('effect/Stream', async () => {
        await describe('callback', async () => {
            await it('with take', async () => {
                await runTest(
                    Effect.gen(function* () {
                        const array = [1, 2, 3, 4, 5];
                        const result = yield* Stream.callback<number>((mb) =>
                            Effect.sync(() => {
                                array.forEach((n) => {
                                    Queue.offerUnsafe(mb, n);
                                });
                            }),
                        ).pipe(Stream.take(array.length), Stream.runCollect);
                        expect(result).toStrictEqual(array);
                    }),
                );
            });

            await it('with cleanup', async () => {
                await runTest(
                    Effect.gen(function* () {
                        let cleanup = false;
                        const latch = yield* Latch.make();
                        const fiber = yield* Stream.callback<void>(
                            Effect.fnUntraced(function* (mb) {
                                yield* Effect.addFinalizer(() =>
                                    Effect.sync(() => {
                                        cleanup = true;
                                    }),
                                );
                                yield* Queue.offer(mb, undefined);
                            }),
                        ).pipe(
                            Stream.tap(() => latch.open),
                            Stream.runDrain,
                            Effect.forkChild,
                        );
                        yield* latch.await;
                        yield* Fiber.interrupt(fiber);
                        expect(cleanup).toBe(true);
                    }),
                );
            });

            await it('signals the end of the stream', async () => {
                await runTest(
                    Effect.gen(function* () {
                        const result = yield* Stream.callback<number>((mb) => {
                            Queue.endUnsafe(mb);
                            return Effect.void;
                        }).pipe(Stream.runCollect);
                        expect(result.length).toBe(0);
                    }),
                );
            });

            await it('handles errors', async () => {
                await runTest(
                    Effect.gen(function* () {
                        const error = new Error('boom');
                        const result = yield* Stream.callback<number, Error>((mb) => {
                            Queue.failCauseUnsafe(mb, Cause.fail(error));
                            return Effect.void;
                        }).pipe(Stream.runCollect, Effect.exit);
                        expect(result).toStrictEqual(Exit.fail(error));
                    }),
                );
            });

            await it('handles defects', async () => {
                await runTest(
                    Effect.gen(function* () {
                        const error = new Error('boom');
                        const result = yield* Stream.callback<number, Error>(() => {
                            throw error;
                        }).pipe(Stream.runCollect, Effect.exit);
                        expect(result).toStrictEqual(Exit.die(error));
                    }),
                );
            });

            await it('backpressure', async () => {
                // `Stream.toPull` is scoped; upstream's `it.effect` supplies the Scope
                // its harness opens per case, so the port has to open one explicitly.
                await runTest(
                    Effect.scoped(
                        Effect.gen(function* () {
                            let count = 0;
                            let offered = 0;
                            let done = false;
                            const pull = yield* Stream.callback<number>(
                                (mb) =>
                                    Effect.forEach(
                                        [1, 2, 3, 4, 5, 6, 7],
                                        Effect.fnUntraced(function* (n) {
                                            count++;
                                            yield* Queue.offer(mb, n);
                                            offered++;
                                        }),
                                        { concurrency: 'unbounded' },
                                    ).pipe(
                                        Effect.tap(() =>
                                            Effect.sync(() => {
                                                done = true;
                                            }),
                                        ),
                                    ),
                                { bufferSize: 2 },
                            ).pipe(Stream.toPull);
                            yield* Effect.yieldNow;
                            expect(count).toBe(7);
                            expect(offered).toBe(2);
                            expect(done).toBe(false);
                            yield* pull;
                            expect(offered).toBe(4);
                            expect(done).toBe(false);
                        }),
                    ),
                );
            });
        });

        await describe('timeout', async () => {
            await it('timeoutOrElse - succeed', async () => {
                await runTest(
                    Effect.gen(function* () {
                        const result = yield* pipe(
                            Stream.succeed(1),
                            Stream.timeoutOrElse({
                                duration: Duration.infinity,
                                orElse: () => Stream.succeed(-1),
                            }),
                            Stream.runCollect,
                        );
                        expect(result).toStrictEqual([1]);
                    }),
                );
            });

            await it('timeoutOrElse - should switch streams', async () => {
                await runTest(
                    Effect.gen(function* () {
                        const result = yield* pipe(
                            Stream.range(0, 4),
                            Stream.tap(() => Effect.sleep(Duration.infinity)),
                            Stream.timeoutOrElse({
                                duration: Duration.zero,
                                orElse: () => Stream.succeed(4),
                            }),
                            Stream.runCollect,
                        );
                        expect(result).toStrictEqual([4]);
                    }),
                );
            });

            await it('timeout - succeed', async () => {
                await runTest(
                    Effect.gen(function* () {
                        const result = yield* pipe(
                            Stream.succeed(1),
                            Stream.timeout(Duration.infinity),
                            Stream.runCollect,
                        );
                        expect(result).toStrictEqual([1]);
                    }),
                );
            });

            await it('timeout - should end the stream', async () => {
                await runTest(
                    Effect.gen(function* () {
                        const result = yield* pipe(
                            Stream.range(0, 4),
                            Stream.tap(() => Effect.sleep(Duration.infinity)),
                            Stream.timeout(Duration.zero),
                            Stream.runCollect,
                        );
                        expect(result).toStrictEqual([]);
                    }),
                );
            });
        });

        await describe('on the REAL clock — authored, not ported', async () => {
            // Every case above runs on a TestClock, which is upstream's choice and
            // the right one for asserting order. It also means not one of them
            // reaches a host timer. These two do, so a broken @gjsify/timers fails
            // here rather than passing everything and breaking in an app.
            await it('debounce emits only the last value of a burst', async () => {
                await runLive(
                    Effect.gen(function* () {
                        const result = yield* pipe(
                            Stream.make(1, 2, 3),
                            Stream.debounce(Duration.millis(20)),
                            Stream.runCollect,
                        );
                        expect(result).toStrictEqual([3]);
                    }),
                );
            });

            await it('a real sleep between elements is observed as elapsed time', async () => {
                await runLive(
                    Effect.gen(function* () {
                        const before = Date.now();
                        const result = yield* pipe(
                            Stream.make(1, 2, 3),
                            Stream.mapEffect((n) => Effect.as(Effect.sleep(Duration.millis(10)), n)),
                            Stream.runCollect,
                        );
                        expect(result).toStrictEqual([1, 2, 3]);
                        expect(Date.now() - before >= 25).toBe(true);
                    }),
                );
            });
        });
    });
};
