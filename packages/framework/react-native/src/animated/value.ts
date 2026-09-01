// `Animated.Value` — the number, and everywhere it lands.
//
// WHY THE VALUE IS THE SOURCE OF TRUTH AND NOT THE WIDGET PROPERTY. libadwaita
// offers two animation targets and the choice between them is this file's whole
// shape. `Adw.PropertyAnimationTarget(widget, "opacity")` would let GTK write the
// property with no JavaScript per frame at all — and it was rejected, for two
// measured reasons:
//
//   1. IT IS A CORE DUMP ON A BAD PROPERTY NAME. Measured on libadwaita 1.9.3:
//      `Adw.PropertyAnimationTarget.new(new Gtk.Box(), 'no-such-prop')` calls
//      `g_error()` — `Adwaita-ERROR **: Type 'GtkBox' does not have a property
//      named 'no-such-prop'`, exit 134, SIGABRT, not a catchable exception. An
//      author's style key would then be one typo away from killing the process, so
//      the mapping would have to be a declared table either way (it is —
//      `properties.ts`), and the target buys nothing once the table exists.
//   2. IT MAKES THE VALUE BLIND. `Animated.timing(value, …)` takes the VALUE, not
//      the view, and React Native's model is that the value is what animates and the
//      views follow. With a property target the widget property is the only thing
//      that moves: `__getValue()` would report the pre-animation number for the whole
//      run, a second bound view would need a second animation with its own clock, and
//      a view mounted mid-run would start from `value-from` again.
//
// So the run is ONE `Adw.TimedAnimation` with a `Adw.CallbackAnimationTarget`
// (`timing.ts`), the callback publishes into this value, and the value writes each
// bound widget property directly. **React never re-renders for a frame** — that is
// the part that matters, and it is the same either way; what changes is which of the
// two knows the number.
//
// NOTHING IN HERE IMPORTS `gi://`. The animation, the frame clock and the widget are
// all on the other side of `ValueSink` and `ValueRun`, which is what lets the value's
// own arithmetic and lifecycle be asserted with no display and no toolkit.

import { PrimitiveError } from '../primitives/errors.js';
import { ANIMATED_VALUE, type AnimatedValueLike } from './brand.js';

/**
 * One place an animated number lands: a widget property this layer writes.
 *
 * `widget` is typed `object` rather than `Gtk.Widget` on purpose — see the module
 * comment. It is here at all because an `Adw.Animation` needs a widget for its frame
 * clock, and the only widgets this value knows about are the ones bound to it.
 */
export interface ValueSink {
    /** The widget whose frame clock an animation of this value can use. */
    readonly widget: object;
    /** Write the number where it belongs. */
    write(value: number): void;
}

/**
 * The half of a running animation this value drives, implemented in `timing.ts`.
 *
 * Three callbacks and no getters: the value tells the run what happened to its
 * clock, and the run tells the value what the number is. Anything more would put
 * frame state on both sides.
 */
export interface ValueRun {
    /** A sink arrived and this run has no clock yet — start now. */
    clockAvailable(widget: object): void;
    /** The sink that supplied the clock is gone. */
    clockLost(): void;
    /** `setValue`, or another animation, took this value over. */
    interrupted(): void;
    /**
     * `resetAnimation`: put the value back to the number this run started from.
     *
     * `rewind` and not `reset`, because the handle `Animated.timing` returns has a
     * PUBLIC `reset()` of its own that routes through the value — two methods called
     * `reset` calling each other is a stack overflow, and it is one this name avoids
     * rather than documents.
     */
    rewind(): void;
}

/** Module counter, so a bound value has a stable identity a React dependency list can compare. */
let nextId = 1;

const finite = (subject: string, value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new PrimitiveError(
            'Animated.Value',
            subject,
            `takes a finite number, and received ${value === null ? 'null' : typeof value}${
                typeof value === 'number' ? ` (${value})` : ''
            }. A NaN or an Infinity reaches GTK as a double and paints nothing, with no diagnostic`,
        );
    }
    return value;
};

/**
 * A number that animates, and the views bound to it.
 *
 * The subset ADR 0032's measured application uses — `new Animated.Value(n)`, handed
 * to `Animated.timing` and read by an `<Animated.View>` style — plus `setValue`,
 * `__getValue`, `stopAnimation` and `resetAnimation`, which are the four that cost
 * nothing once the run bookkeeping exists. Everything else on React Native's
 * `AnimatedValue` is a named refusal in `index.ts`, with its reason.
 *
 * The `__`-prefixed methods are React Native's own convention for a node's internals
 * (`__getValue` is in its public type declarations), and they are how `timing.ts` and
 * `Animated.View` reach the run and the sinks. They are not part of the surface a
 * ported application should call.
 */
export class AnimatedValue implements AnimatedValueLike {
    readonly [ANIMATED_VALUE] = true as const;

    /** Stable per instance. `Animated.View` puts it in an effect's dependency list. */
    readonly id: number = nextId++;

    #current: number;
    #sinks = new Set<ValueSink>();
    /** The sink that supplied the running animation's frame clock, or null. */
    #clock: ValueSink | null = null;
    #run: ValueRun | null = null;

    constructor(value: number) {
        this.#current = finite('constructor', value);
    }

    /** The number right now. React Native's own spelling for this read. */
    __getValue(): number {
        return this.#current;
    }

    /**
     * Jump to a value, stopping whatever was animating it.
     *
     * Stopping first is React Native's own behaviour and it is not a detail: a
     * `setValue` that left the animation running would be overwritten on the next
     * frame, so the write would appear to do nothing for the rest of the run.
     */
    setValue(value: number): void {
        const next = finite('setValue', value);
        this.#interrupt();
        this.#publish(next);
    }

    /**
     * Stop the running animation where it is; the callback gets the value it stopped at.
     *
     * React Native's signature is `stopAnimation(callback?: (value: number) => void)`,
     * and the value it reports is the one the animation reached — which is why this
     * cannot be written as `stop(); callback(0)`.
     */
    stopAnimation(callback?: (value: number) => void): void {
        this.#interrupt();
        callback?.(this.#current);
    }

    /**
     * Stop and go back to where the run started.
     *
     * `Adw.Animation.reset()` does exactly this on its own side (measured: state
     * returns to IDLE and `value` to `value-from`, with no `done`), and the run is
     * what knows the starting number — so the reset is the run's, and this method is
     * the value's way of asking for it.
     */
    resetAnimation(callback?: (value: number) => void): void {
        const run = this.#run;
        this.#run = null;
        this.#clock = null;
        // Settle FIRST: the run pauses its animation there, and rewinding a value
        // something is still driving would be overwritten by its next frame.
        run?.interrupted();
        run?.rewind();
        callback?.(this.#current);
    }

    // --- the internals `timing.ts` and `Animated.View` use --------------------

    /**
     * Bind a widget property to this value; returns the unbind.
     *
     * The sink is written IMMEDIATELY, because a view that only hears about changes
     * starts out disagreeing with the value — a `new Animated.Value(0)` behind an
     * `opacity` must make the widget transparent on its first frame, not on the
     * animation's.
     */
    __attach(sink: ValueSink): () => void {
        this.#sinks.add(sink);
        sink.write(this.#current);
        if (this.#run !== null && this.#clock === null) {
            this.#clock = sink;
            this.#run.clockAvailable(sink.widget);
        }
        return () => {
            this.#sinks.delete(sink);
            if (this.#clock !== sink) return;
            // THE CLOCK WENT WITH IT, and that is not a detail to swallow. MEASURED
            // on libadwaita 1.9.3: destroying the widget an `Adw.TimedAnimation`
            // hangs on makes it SKIP — state FINISHED, `value` at `value-to`, `done`
            // emitted — so a run whose view unmounted would otherwise report a
            // completion that never happened.
            this.#clock = null;
            const run = this.#run;
            this.#run = null;
            run?.clockLost();
        };
    }

    /** The widget a new run can take its frame clock from, or null. */
    __clockWidget(): object | null {
        for (const sink of this.#sinks) return sink.widget;
        return null;
    }

    /** Take this value over. Any previous run is interrupted, as React Native's is. */
    __claim(run: ValueRun): void {
        this.#interrupt();
        this.#run = run;
        const sink = this.#firstSink();
        if (sink === null) return;
        this.#clock = sink;
        run.clockAvailable(sink.widget);
    }

    /** The run finished on its own; nothing to interrupt. */
    __release(run: ValueRun): void {
        if (this.#run !== run) return;
        this.#run = null;
        this.#clock = null;
    }

    /** One frame. Called by the run's animation target. */
    __publish(value: number): void {
        this.#publish(value);
    }

    #publish(value: number): void {
        this.#current = value;
        for (const sink of this.#sinks) sink.write(value);
    }

    #firstSink(): ValueSink | null {
        for (const sink of this.#sinks) return sink;
        return null;
    }

    #interrupt(): void {
        const run = this.#run;
        this.#run = null;
        this.#clock = null;
        run?.interrupted();
    }
}
