// `Animated.timing` — one `Adw.TimedAnimation` per run, and the four measurements
// that decide what its callback is allowed to say.
//
// EVERY ONE OF THESE WAS MEASURED on gjs 1.88.1 / GTK 4.22.4 / libadwaita 1.9.3, and
// each one closes a way this could have reported a completion that did not happen:
//
//   1. **`play()` on an UNREALIZED widget SKIPS.** State goes straight to FINISHED,
//      `value` to `value-to`, and `done` is emitted SYNCHRONOUSLY inside the `play()`
//      call. So an animation started before its window is on screen jumps to its end
//      instead of running — which is also libadwaita's answer when the user has turned
//      animations off (`follow-enable-animations-setting` defaults to true, measured).
//      That is the honest desktop behaviour and it is why the whole run lifecycle here
//      has to survive `done` firing during `play()`.
//   2. **`done` fires on completion AND on `skip()`, never on `pause()` or
//      `reset()`.** Measured over a real frame clock: pause → PAUSED with the value
//      held and no `done`; resume → PLAYING; reset → IDLE at `value-from`, no `done`;
//      skip mid-run → FINISHED at `value-to`, `done`. That maps exactly onto React
//      Native's end callback: `done` is `{ finished: true }`, and every stop this layer
//      performs itself is `{ finished: false }`.
//   3. **DESTROYING THE WIDGET FINISHES THE ANIMATION.** Measured: with a run in
//      flight, `window.destroy()` left the animation at FINISHED, `value` at
//      `value-to`, `done` emitted, and `animation.widget` still non-null. So a run
//      whose view unmounts would report a completion nobody saw. `AnimatedValue`
//      detaches the clock first and calls `clockLost()`, which settles the run as
//      `{ finished: false }` before GTK can say otherwise.
//   4. **`Gtk.Widget:opacity` is quantised to 8 bits.** 0.9 reads back as
//      0.9019607843137255 (230/255). Nothing here corrects for it — the value this
//      layer publishes is exact and GTK's property is what rounds — but a spec that
//      asserted the widget property equalled the requested double would be red for a
//      reason that has nothing to do with this file.
//
// THE DEFAULT CURVE IS EASE_IN_OUT, AND IT IS NOT REACT NATIVE'S. React Native's
// `timing` defaults to `Easing.inOut(Easing.ease)` (measured in its own
// `TimingAnimation.js`), a composed cubic bezier that no `AdwEasing` member
// reproduces: nearest of all 35 is EASE_IN_OUT_SINE at 1.20e-2, and EASE_IN_OUT — the
// CSS-named "ease in and out" — at 2.86e-2. The named one wins over the numerically
// nearer one because the deviation is declared either way and EASE_IN_OUT is the
// curve the rest of the desktop animates with; tuning to a number nobody asked for
// would make the default harder to reason about, not more faithful. `easing.ts` holds
// the whole table and the eleven families that DO map exactly.

import Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';

import { PrimitiveError } from '../primitives/errors.js';
import { adwEasing, easingMember, type EasingFunction } from './easing.js';
import type { AnimatedValue, ValueRun } from './value.js';

/** React Native's own default, measured in `animations/TimingAnimation.js`. */
const DEFAULT_DURATION = 500;

/** What React Native calls an `EndCallback`. */
export type EndCallback = (result: { readonly finished: boolean }) => void;

/** `Animated.timing`'s config, as far as this layer answers for it. */
export interface TimingConfig {
    readonly toValue: number;
    readonly duration?: number;
    readonly easing?: EasingFunction;
    /**
     * Accepted and MEANINGLESS, which is a decision rather than an oversight.
     *
     * On a phone the flag chooses whether the JavaScript thread interpolates and ships
     * each frame over the bridge, or the native side owns the whole run. There is no
     * bridge here: this layer renders in-process onto GTK, `Adw.TimedAnimation` owns
     * the frame clock either way, and React re-renders for a frame in neither case. So
     * both values behave identically and the flag is honoured by being ignored — said
     * out loud here and in the support table, because a config key that is silently
     * dropped is indistinguishable from one that was misspelled.
     */
    readonly useNativeDriver?: boolean;
}

/** The handle `Animated.timing` returns. React Native calls it a `CompositeAnimation`. */
export interface CompositeAnimation {
    start(callback?: EndCallback): void;
    stop(): void;
    reset(): void;
}

/**
 * Config keys React Native has that this layer refuses, each with its reason.
 *
 * An unknown key falls through to a generic refusal listing what IS accepted — the
 * same shape the primitive table gives an unknown prop, and for the same reason: a
 * config key that is accepted and ignored is invisible until someone watches the
 * window.
 */
const REFUSED_CONFIG: Readonly<Record<string, string>> = {
    delay: 'has no counterpart on `Adw.TimedAnimation` — measured, it installs `value-from value-to duration easing repeat-count reverse alternate` and nothing that waits. Start the animation from a timeout if the wait matters',
    iterations:
        'would be `Adw.TimedAnimation:repeat-count`, which really is there — and it is refused because it is `Animated.loop`’s job, and `loop` is a composition this subset does not build. Nothing measured needs it, and a knob with no composition around it is half a feature',
    isInteraction:
        'registers the animation with `InteractionManager`, which is tier P3 and not built. A flag that silently registered with nothing would be worse than the refusal',
    onComplete: 'is React Native’s own internal end hook. Pass the callback to `start()`, which is the public one',
    platformConfig: 'carries native-driver configuration for a bridge that does not exist here',
    debugID: 'is a React Native devtools identifier, and this layer’s devtools are `@gjsify/devtools` over D-Bus',
};

const ACCEPTED = ['toValue', 'duration', 'easing', 'useNativeDriver'] as const;

function readConfig(config: unknown): {
    readonly to: number;
    readonly duration: number;
    readonly easing: Adw.Easing;
} {
    if (typeof config !== 'object' || config === null) {
        throw new PrimitiveError(
            'Animated.timing',
            'config',
            `takes a configuration object, and received ${config === null ? 'null' : typeof config}`,
        );
    }
    const record = config as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if ((ACCEPTED as readonly string[]).includes(key)) continue;
        throw new PrimitiveError(
            'Animated.timing',
            `config.${key}`,
            REFUSED_CONFIG[key] ??
                `is not a configuration key this layer answers for. Accepted: ${ACCEPTED.join(', ')}`,
        );
    }
    const to = record.toValue;
    if (typeof to !== 'number' || !Number.isFinite(to)) {
        throw new PrimitiveError(
            'Animated.timing',
            'config.toValue',
            `takes a finite number. React Native also accepts an Animated.Value, an {x, y} pair and a colour there; this subset animates one number to another, so anything else is refused rather than coerced (received ${to === null ? 'null' : typeof to})`,
        );
    }
    const duration = record.duration === undefined ? DEFAULT_DURATION : record.duration;
    if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 0) {
        throw new PrimitiveError(
            'Animated.timing',
            'config.duration',
            'is `Adw.TimedAnimation:duration`, a guint of milliseconds, so it takes a non-negative integer ' +
                `(received ${String(duration)})`,
        );
    }
    const easing =
        record.easing === undefined ? Adw.Easing.EASE_IN_OUT : adwEasing(easingMember(record.easing, 'config.easing'));
    return { to, duration, easing };
}

/**
 * One run: the animation, its `done` handler, and which of the two settles it.
 *
 * `#settled` is the whole point of the class. Four things can end a run — GTK's
 * `done`, a `stop()`, another animation claiming the value, and the clock widget
 * unmounting — and React Native's contract is that the end callback fires exactly
 * once. Two of those four arrive from GTK's side and two from this side, so a flag is
 * the only thing that can hold "exactly once" across both.
 */
class TimingRun implements ValueRun, CompositeAnimation {
    #value: AnimatedValue;
    #to: number;
    #duration: number;
    #easing: Adw.Easing;
    #animation: Adw.TimedAnimation | null = null;
    #handler = 0;
    #callback: EndCallback | undefined;
    #from = 0;
    #claimed = false;
    #settled = true;

    constructor(value: AnimatedValue, config: TimingConfig) {
        const { to, duration, easing } = readConfig(config);
        this.#value = value;
        this.#to = to;
        this.#duration = duration;
        this.#easing = easing;
    }

    start(callback?: EndCallback): void {
        // A restart stops the previous pass, which is what `__claim` does through the
        // value: it interrupts whatever ran before — including this same object.
        this.#callback = callback;
        this.#from = this.#value.__getValue();
        this.#claimed = true;
        this.#settled = false;
        this.#value.__claim(this);
    }

    stop(): void {
        // Through the VALUE and not directly, so "which run owns this value" has one
        // answer. A handle whose run was superseded must not be able to stop the run
        // that replaced it.
        if (!this.#claimed) return;
        this.#value.stopAnimation();
    }

    /**
     * React Native's `CompositeAnimation.reset()`: stop, and put the value back.
     *
     * A no-op when this handle no longer owns the value, and the reason is stated
     * rather than assumed: another animation replaced this run, and reaching past it
     * to rewind a value it is currently driving would be this handle undoing someone
     * else's work.
     */
    reset(): void {
        if (this.#claimed) this.#value.resetAnimation();
    }

    // --- the value's side ------------------------------------------------------

    clockAvailable(widget: object): void {
        // The animation is built HERE rather than in `start`, because
        // `Adw.Animation:widget` is where its frame clock comes from and a run may be
        // started before any view is bound to its value — a `useEffect` in a parent
        // runs after its children's, so the ordinary case has a widget, and the
        // ordinary case is not the only one.
        const animation = new Adw.TimedAnimation({
            widget: widget as Gtk.Widget,
            valueFrom: this.#from,
            valueTo: this.#to,
            duration: this.#duration,
            easing: this.#easing,
            // ONE callback target for the whole run, publishing into the value, which
            // fans out to every bound widget property. `value.ts` records why this is
            // not `Adw.PropertyAnimationTarget` — the short version is that a bad
            // property name there is a SIGABRT and the value would go blind.
            target: Adw.CallbackAnimationTarget.new((value: number) => this.#value.__publish(value)),
        });
        this.#animation = animation;
        this.#handler = animation.connect('done', () => this.#finish(true));
        // `done` can fire INSIDE this call — measured, that is exactly what happens on
        // an unrealized widget — so nothing may be recorded about the run after it.
        animation.play();
    }

    clockLost(): void {
        this.#finish(false);
    }

    interrupted(): void {
        this.#finish(false);
    }

    rewind(): void {
        this.#value.__publish(this.#from);
    }

    // --- one exit ---------------------------------------------------------------

    #finish(finished: boolean): void {
        if (this.#settled) return;
        this.#settled = true;
        this.#claimed = false;
        const animation = this.#animation;
        this.#animation = null;
        if (animation !== null) {
            // PAUSE BEFORE DISCONNECT, and disconnect at all: GJS blocks a JS callback
            // during the sweeping phase of GC, so an animation left playing with a
            // live handler is a callback connected for the life of the process — the
            // same rule `press.ts` carries, with the same incident behind it.
            if (finished === false && animation.state === Adw.AnimationState.PLAYING) animation.pause();
            if (this.#handler !== 0) animation.disconnect(this.#handler);
            this.#handler = 0;
        }
        if (finished) this.#value.__release(this);
        const callback = this.#callback;
        this.#callback = undefined;
        callback?.({ finished });
    }
}

/**
 * Animate `value` to `config.toValue` over `config.duration` milliseconds.
 *
 * Nothing starts until `.start()` — React Native's own shape, and here it is also
 * what lets the run pick up a frame clock from whichever view binds the value.
 */
export function timing(value: AnimatedValue, config: TimingConfig): CompositeAnimation {
    return new TimingRun(value, config);
}
