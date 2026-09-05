// SPDX-License-Identifier: MIT
// Ported from packages/effect/test/Scope.test.ts (effect@4.0.0-rc.112).
// Original: Copyright (c) 2023 Effectful Technologies Inc. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// Upstream is one case. The three that follow it are AUTHORED, marked as such, and
// exist because `Scope` is the piece a GNOME consumer actually adopts: a scope tied
// to a widget's lifetime is what gives a GJS application the deterministic cleanup
// it otherwise leaves to the garbage collector. So the questions are the ones a
// widget asks — do finalizers run in reverse order, does an interrupted fiber still
// run them, and does closing twice run them once. Which SIGNAL a widget should
// close its scope on is a separate question with a surprising answer, measured in
// `showcases/gtk/effect-adw-services/src/effect-gio/scope.ts`; these three are
// about what closing does once it happens.

import { describe, expect, it } from '@gjsify/unit';
import { Duration, Effect, Exit, Fiber, Ref, Scope } from 'effect';
import { TestClock } from 'effect/testing';

import { runLive, runTest } from './run.js';

export default async () => {
    await describe('effect/Scope', async () => {
        await describe('parallel finalization', async () => {
            await it('executes finalizers in parallel', async () => {
                await runTest(
                    Effect.gen(function* () {
                        const scope = Scope.makeUnsafe('parallel');
                        yield* Scope.addFinalizer(scope, Effect.sleep(Duration.seconds(1)));
                        yield* Scope.addFinalizer(scope, Effect.sleep(Duration.seconds(1)));
                        yield* Scope.addFinalizer(scope, Effect.sleep(Duration.seconds(1)));
                        const fiber = yield* Effect.forkChild(Scope.close(scope, Exit.void), {
                            startImmediately: true,
                        });
                        expect(fiber.pollUnsafe()).toBe(undefined);
                        // One second, not three: parallel means the three sleeps overlap.
                        yield* TestClock.adjust(Duration.seconds(1));
                        expect(fiber.pollUnsafe() !== undefined).toBe(true);
                    }),
                );
            });
        });

        await describe('sequential finalization — authored, not ported', async () => {
            await it('runs finalizers in reverse acquisition order', async () => {
                await runLive(
                    Effect.gen(function* () {
                        const log = yield* Ref.make<ReadonlyArray<string>>([]);
                        const record = (what: string) => Ref.update(log, (xs) => [...xs, what]);

                        const scope = Scope.makeUnsafe('sequential');
                        yield* Scope.addFinalizer(scope, record('first'));
                        yield* Scope.addFinalizer(scope, record('second'));
                        yield* Scope.addFinalizer(scope, record('third'));
                        yield* Scope.close(scope, Exit.void);

                        expect(yield* Ref.get(log)).toStrictEqual(['third', 'second', 'first']);
                    }),
                );
            });

            await it('runs finalizers when the fiber is interrupted', async () => {
                // The reason a widget scope is worth having: the cleanup path that
                // matters is the one nobody reaches on purpose.
                await runLive(
                    Effect.gen(function* () {
                        const log = yield* Ref.make<ReadonlyArray<string>>([]);
                        const fiber = yield* Effect.forkChild(
                            Effect.scoped(
                                Effect.gen(function* () {
                                    yield* Effect.addFinalizer(() => Ref.update(log, (xs) => [...xs, 'released']));
                                    yield* Effect.never;
                                }),
                            ),
                            { startImmediately: true },
                        );
                        yield* Fiber.interrupt(fiber);
                        expect(yield* Ref.get(log)).toStrictEqual(['released']);
                    }),
                );
            });

            await it('closing a scope twice runs its finalizers once', async () => {
                // A widget can emit `destroy` and then be finalized; both would close
                // the same scope.
                await runLive(
                    Effect.gen(function* () {
                        const log = yield* Ref.make<ReadonlyArray<string>>([]);
                        const scope = Scope.makeUnsafe('sequential');
                        yield* Scope.addFinalizer(
                            scope,
                            Ref.update(log, (xs) => [...xs, 'closed']),
                        );

                        yield* Scope.close(scope, Exit.void);
                        yield* Scope.close(scope, Exit.void);

                        expect(yield* Ref.get(log)).toStrictEqual(['closed']);
                    }),
                );
            });
        });
    });
};
