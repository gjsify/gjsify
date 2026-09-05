// SPDX-License-Identifier: MIT
//
// A GObject signal read as an Effect `Stream`.
//
// WHY THIS SHAPE FITS. A signal is a push source with no backpressure: it fires
// when it fires, and a handler that blocks blocks the main loop. A `Stream` is a
// pull source. `Stream.callback` is the constructor written for exactly that seam —
// it hands the producer a bounded `Queue` and lets the consumer read at its own
// rate. What the bound means here is the whole design decision, so it is a
// parameter rather than a default nobody reads:
//
//   'sliding' (default)  a full buffer DROPS THE OLDEST. Right for state — the
//                        latest `notify::text` is the only one that matters, and
//                        dropping the ones before it is what a debounce would have
//                        done anyway.
//   'suspend'            a full buffer makes the producer WAIT. Never right for a
//                        GTK signal: the producer is the main loop, and suspending
//                        it is a frozen window.
//
// So the interesting failure mode is not losing an event, it is choosing 'suspend'
// for something the main loop emits. There is no strategy that both keeps every
// event and keeps the window responsive; a consumer that needs every event needs
// to not be a stream.

import type GObject from 'gi://GObject?version=2.0';

import { Effect, Stream } from 'effect';
import * as Queue from 'effect/Queue';

export interface SignalStreamOptions {
    /** Queue depth. Small on purpose: a UI signal's backlog has no value. */
    readonly bufferSize?: number;
    /**
     * What a full buffer does. `'sliding'` drops the oldest; `'suspend'` blocks the
     * emitter, which for a main-loop signal means the window stops drawing.
     *
     * `'suspend'` is offered rather than forbidden because the type is `Queue`'s own
     * and a non-main-loop `GObject` — a worker's `Gio.Task`, an `EventBus` — can
     * legitimately want it. For anything GTK emits it is the wrong answer.
     */
    readonly strategy?: 'sliding' | 'suspend';
}

/**
 * Every emission of `signalName` on `source`, as a `Stream` of the handler's
 * arguments (the emitting object itself is dropped, as it is always `source`).
 *
 * The handler returns nothing, so this is only correct for signals whose return
 * value GTK ignores. A signal with a meaningful return — `key-pressed`,
 * `close-request` — must be handled synchronously; see `runInScope` in `scope.ts`
 * for the split.
 *
 * The connection is a resource: `Effect.addFinalizer` disconnects it when the
 * stream's scope closes, so a stream held by a widget scope stops listening the
 * moment the widget is destroyed.
 *
 * SUBSCRIBING IS ASYNCHRONOUS, and nothing buffers an emission that beats it. The
 * `connect()` below runs when the stream is first PULLED, not when it is
 * constructed and not when a fiber running it is forked — so an emission between
 * those two moments is simply not seen. In an application this is invisible,
 * because the subscription is set up in a constructor and the first emission comes
 * from a user; it is visible the moment a test emits programmatically, and the
 * showcase's probe has to sleep before it emits for that reason.
 */
export const signalStream = <A extends ReadonlyArray<unknown> = ReadonlyArray<unknown>>(
    source: GObject.Object,
    signalName: string,
    options: SignalStreamOptions = {},
): Stream.Stream<A> =>
    Stream.callback<A>(
        (queue) =>
            Effect.gen(function* () {
                const handler = source.connect(signalName, (_emitter: GObject.Object, ...args: unknown[]) => {
                    Queue.offerUnsafe(queue, args as unknown as A);
                });
                yield* Effect.addFinalizer(() => Effect.sync(() => source.disconnect(handler)));
            }),
        {
            bufferSize: options.bufferSize ?? 16,
            strategy: options.strategy ?? 'sliding',
        },
    );

/**
 * The common special case: a GObject property, as a stream of its values, starting
 * with the value it has now.
 *
 * Starting with the current value is what makes this usable as a source of truth
 * rather than a change log — a consumer subscribing after the property was already
 * set otherwise renders an empty view until the user types again. It does NOT close
 * the subscription gap above: `Stream.concat` reads the seed before the second
 * stream is pulled, so a change landing in between is still missed. What it fixes is
 * the steady state, not the race.
 *
 * `read` IS EXPLICIT, and both reasons are worth stating. `GObject.Object.get_property`
 * is the GIR method, which takes a name AND a `GObject.Value` to fill — a
 * one-argument call throws `At least 2 arguments required, but only 1 passed`,
 * measured here on the showcase's first probe run. And even given a working
 * reflective read, the GObject name and the JS name differ (`icon-name` is
 * `iconName`), so a helper that mapped between them would be guessing at a
 * convention that has exceptions. Passing the getter costs one closure and is
 * typed.
 */
export const propertyStream = <T>(
    source: GObject.Object,
    property: string,
    read: () => T,
    options: SignalStreamOptions = {},
): Stream.Stream<T> =>
    Stream.concat(Stream.sync(read), Stream.map(signalStream(source, `notify::${property}`, options), read));
