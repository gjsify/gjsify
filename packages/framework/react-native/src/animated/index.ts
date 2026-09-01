// `Animated`, and every name it does not answer for.
//
// THE SUBSET IS THE MEASUREMENT. ADR 0032 read `Animated` in a production-shaped
// React Native application of 28 routes and found it in EXACTLY ONE FILE, using
// exactly three things: `new Animated.Value(n)`,
// `Animated.timing(value, { toValue, duration, useNativeDriver }).start()`, and
// `<Animated.View style={{ opacity: value }}>`. That is what is built. The support
// table's `Animated` entry states the same boundary, so a porter learns the limit from
// the table rather than from a window in which nothing moved.
//
// WHY NOT THE WHOLE SUBSYSTEM, which the planning entry called it. React Native's
// `Animated` is a graph of nodes — `add`, `multiply`, `interpolate`, `diffClamp` —
// evaluated per frame, with two drivers, a native allowlist and an event mapping
// language. `Adw.TimedAnimation` interpolates ONE number between two others. The graph
// is buildable on top of that and it is a project; a value, a timing and a view are
// three files and answer the measured need completely.
//
// THE REFUSALS ARE THROWING FUNCTIONS, NOT ABSENT KEYS, and not the `unsupported()`
// proxy either. Absent keys give `undefined is not a function` at the call site, which
// names nothing. The proxy is for MODULE exports and throws on any property READ,
// which would make `Animated` itself unreadable to `support-table.spec.ts`' own
// probe — it distinguishes a real export from a refusing one by reading an arbitrary
// property off it. A present function that throws with a reason is what both readers
// need.

import { PrimitiveError } from '../primitives/errors.js';
import { AnimatedView } from '../components.js';
import { timing } from './timing.js';
import { AnimatedValue } from './value.js';

export { Easing } from './easing.js';
export type { AdwEasingName, EasingDirection, EasingFunction } from './easing.js';
export { timing } from './timing.js';
export type { CompositeAnimation, EndCallback, TimingConfig } from './timing.js';
export { AnimatedValue } from './value.js';
export type { ValueRun, ValueSink } from './value.js';
export { ANIMATED_VALUE, isAnimatedValue } from './brand.js';
export type { AnimatedValueLike } from './brand.js';
export { ANIMATED_PROPERTIES } from './properties.js';
export type { AnimatedPropertySpec } from './properties.js';

/**
 * One refusing member of `Animated`.
 *
 * A function rather than a getter, because a `typeof Animated.spring === 'function'`
 * feature check is ordinary in library code and a throwing getter would fail it before
 * anything decided to call the thing.
 */
const refuse =
    (name: string, detail: string) =>
    (...args: unknown[]): never => {
        void args;
        throw new PrimitiveError('Animated', name, detail);
    };

/** What the graph names have in common, so the reason is written once. */
const GRAPH =
    'is a node in React Native’s animated GRAPH, evaluated per frame by its own driver. `Adw.TimedAnimation` interpolates one number between two others and has no composition of its own (measured: it installs value-from, value-to, duration, easing, repeat-count, reverse and alternate — no inputs). Building the graph over it is reachable and it is a project, not a member: derive the number in your own code and drive one value per property';

/** What the composition names have in common. */
const COMPOSE =
    'composes several animations into one handle. Each would be its own `Adw.TimedAnimation` on its own frame clock, and the handle has to reconcile their four end conditions (done, skip, pause, and the clock widget unmounting) into one callback — the same bookkeeping `timing.ts` does for a single run, times the composition. Sequence them from the end callback until it is built';

/**
 * React Native's `Animated`, as far as this layer answers for it.
 *
 * A plain object and not a class, which is what React Native's own is
 * (`AnimatedExports.js` spreads `AnimatedImplementation` into an object literal).
 */
export const Animated = {
    /** The number. `value.ts` holds the design and why the VALUE is the source of truth. */
    Value: AnimatedValue,
    /** One number to another over a duration. */
    timing,
    /** A `View` whose animated style entries drive widget properties instead of re-rendering. */
    View: AnimatedView,

    // --- the components ---------------------------------------------------------
    //
    // The mechanism `Animated.View` uses is per-primitive data, so each of these is
    // one line away — and a component nobody has measured is a promise with no
    // evidence, which is what the support table exists to keep out. They refuse by
    // name pointing at the one that is built.

    Text: refuse(
        'Text',
        'is not built. `Animated.View` is, and the binding mechanism behind it is per-primitive data rather than View-specific — so this is a small addition with a measurement missing, not a design gap. Wrap the text in an `<Animated.View>`',
    ),
    Image: refuse('Image', 'is not built, for `Animated.Text`’s reason. Wrap it in an `<Animated.View>`'),
    ScrollView: refuse(
        'ScrollView',
        'is not built, for `Animated.Text`’s reason. Wrap it in an `<Animated.View>`, or animate the view inside it',
    ),
    FlatList: refuse(
        'FlatList',
        'is not built, and it is the one in this group that is NOT one line away: `FlatList` owns its `Gtk.ListView` and drives it from data (see `lists/controller.ts`), so an animated prop would have to reach a row the model produced rather than an element React rendered',
    ),
    SectionList: refuse('SectionList', 'is not built, for `Animated.FlatList`’s reason — it is the same component'),
    createAnimatedComponent: refuse(
        'createAnimatedComponent',
        'wraps an ARBITRARY component, and an animated style here needs to know which GTK widget property a style key becomes (`properties.ts`) — knowledge an arbitrary component does not carry. React Native can do it because its host view accepts a style object; this layer partitions the style into widget properties and GTK CSS before a widget ever sees it',
    ),

    // --- the value graph --------------------------------------------------------

    ValueXY: refuse(
        'ValueXY',
        'is a pair of values, and this subset animates one number. Two `Animated.Value`s and two timings say the same thing with no shared clock — which is also the honest description of what a desktop can offer, since the two properties are written separately either way',
    ),
    Color: refuse(
        'Color',
        'animates a colour, and paint on this layer is GTK CSS (measured, `paint.ts`) — there is no widget property for a background or a text colour to drive. `properties.ts` records the same refusal for the style key',
    ),
    Interpolation: refuse('Interpolation', GRAPH),
    Node: refuse('Node', GRAPH),
    add: refuse('add', GRAPH),
    subtract: refuse('subtract', GRAPH),
    divide: refuse('divide', GRAPH),
    multiply: refuse('multiply', GRAPH),
    modulo: refuse('modulo', GRAPH),
    diffClamp: refuse('diffClamp', GRAPH),

    // --- the other animation classes -------------------------------------------

    spring: refuse(
        'spring',
        '`Adw.SpringAnimation` is the exact counterpart and it is a different class with a different configuration — damping, mass, stiffness and an epsilon against React Native’s tension/friction/bounciness/speed, which are not the same parameters under other names. Mapping them needs a measurement this subset does not have',
    ),
    decay: refuse(
        'decay',
        'animates from a velocity with no end value, and `Adw.TimedAnimation` is defined by its `value-to`. `Adw.SpringAnimation` with a zero-stiffness spring is the shape to measure, and nobody has',
    ),

    // --- the compositions -------------------------------------------------------

    sequence: refuse('sequence', COMPOSE),
    parallel: refuse('parallel', COMPOSE),
    stagger: refuse('stagger', COMPOSE),
    loop: refuse('loop', COMPOSE),
    delay: refuse(
        'delay',
        'is a composition of one animation with a wait, and `Adw.TimedAnimation` has no delay (measured). It is also what `timing({ delay })` refuses, for the same reason',
    ),

    // --- the event mapping ------------------------------------------------------

    event: refuse(
        'event',
        'maps a native event’s payload onto animated values through an argument-mapping language, and there is no native event bridge here — a GTK signal is connected to a JavaScript function directly (`components.ts`). Write the value from the handler',
    ),
    Event: refuse('Event', 'is `Animated.event`’s class, and has the same answer'),
    attachNativeEvent: refuse(
        'attachNativeEvent',
        'attaches an animated value to a native view’s event stream over the bridge. There is no bridge; this layer renders in-process onto GTK',
    ),
    forkEvent: refuse('forkEvent', 'is `Animated.event`’s plumbing, and has the same answer'),
    unforkEvent: refuse('unforkEvent', 'is `Animated.event`’s plumbing, and has the same answer'),
} as const;
