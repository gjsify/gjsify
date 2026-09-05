// The two ways this suite runs an Effect, and why there are two.
//
// `@effect/vitest` gives `it.effect` a `TestClock` and `it.live` the real one.
// Ports keep whichever the upstream case used, because a case written against a
// virtual clock asserts about ORDER and a case written against the real one
// asserts about elapsed time — swapping them silently turns one test into
// another. `runTest`/`runLive` are that distinction, spelled out.
//
// For this repo the live path is the load-bearing one: it is where Effect's fiber
// runtime reaches @gjsify/timers and the GLib main loop. So specs that exist to
// measure gjsify (rather than to port upstream) say `runLive` on purpose.

import { Effect } from 'effect';
import { TestClock } from 'effect/testing';

/** Upstream's `it.effect`: a virtual clock only `TestClock.adjust` advances. */
export const runTest = <E, A>(self: Effect.Effect<A, E, never>): Promise<A> =>
    Effect.runPromise(Effect.provide(self, TestClock.layer()));

/** Upstream's `it.live`: the host's real clock and real timers. */
export const runLive = <E, A>(self: Effect.Effect<A, E, never>): Promise<A> => Effect.runPromise(self);
