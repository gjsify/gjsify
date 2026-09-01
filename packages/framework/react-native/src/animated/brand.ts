// What makes an object an `Animated.Value`, in a module that knows nothing else.
//
// TWO READERS THAT MUST NOT SEE EACH OTHER. `Animated.View` needs to pick the
// animated entries out of a style object, and `primitives/style.ts` needs to REFUSE
// one that reached a plain `<View>` — and `primitives/` is the layer whose whole
// promise is that it holds no framework and no `gi://` import (ADR 0032 § 1). A
// brand in its own file is what lets L2 recognise the type without importing the
// class that implements it.
//
// WHY THE REFUSAL IS WORTH A MODULE. MEASURED against `@gjsify/gtk-host/style`:
// `partitionPaint` pushes `${cssName}: ${value}` with no check on the value's type,
// so `style={{ opacity: someObject }}` becomes the GTK CSS declaration
// `opacity: [object Object]` — which GTK's CSS parser drops in silence. Forgetting
// the `Animated.` on a `<View>` is therefore invisible: the element renders, the
// animation runs, and nothing moves. That is the exact failure mode this whole
// partition exists against.
//
// `Symbol.for` and not `Symbol()`, deliberately: two copies of this package in one
// tree (a consumer pinning a different version alongside a workspace link) would
// otherwise mint two brands, and a value from one would read as un-animated to the
// other — a silent drop again, in the one place that exists to prevent one.

/** The brand key. On the class, and read by L2 without importing it. */
export const ANIMATED_VALUE: unique symbol = Symbol.for('gjsify.react-native.AnimatedValue') as never;

/** The shape a brand reader can rely on. `AnimatedValue` implements it. */
export interface AnimatedValueLike {
    readonly [ANIMATED_VALUE]: true;
}

/** Is this an `Animated.Value`? */
export function isAnimatedValue(candidate: unknown): candidate is AnimatedValueLike {
    return (
        typeof candidate === 'object' &&
        candidate !== null &&
        (candidate as Record<PropertyKey, unknown>)[ANIMATED_VALUE] === true
    );
}
