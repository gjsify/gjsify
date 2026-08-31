// Which style keys an animated number can drive, and where each one writes.
//
// A DECLARED TABLE AND NEVER A PASS-THROUGH, for a measured reason. Writing a
// GObject property from JavaScript by a name the class does not install creates a
// plain JS expando and reports NOTHING: measured on gjs 1.88.1, `box.notAProperty =
// 1` reads back `1` and GTK never hears about it. So an author's style key handed
// straight to a widget would make every unmappable animation a silent no-op — the
// failure mode ADR 0032's whole style partition exists against. `animated.spec.ts`
// holds every entry below against the installed typelib, the same way
// `widgets.spec.ts` holds the primitive table's property claims.
//
// WHY THE SET IS ONE KEY. ADR 0032 measured `Animated` in exactly one file of a
// production-shaped application, and the whole of its use is
// `<Animated.View style={{ opacity: value }}>`. The mechanism below is per-key data,
// so a second key is a row plus its measurement — but a row nobody has measured is a
// promise with no evidence, and this table is what a porter reads to find out what
// the layer does.
//
// AND WHY A CLASH IS A REFUSAL. L1 partitions `opacity` into GTK **CSS**
// (`@gjsify/gtk-host/style`'s `paint.ts`: the paint half becomes declarations, which
// is where `active:opacity-70` lands), while an animation writes a **widget
// property** — `Gtk.Widget:opacity`, a writable `gdouble` on every widget (measured).
// Those are two independent channels painting one appearance. An element that
// authored `opacity-70` AND animated `opacity` would get both, and which one a reader
// sees is not something this layer can say — so it says no instead.

import type { StyleTokens } from '@gjsify/gtk-host/style';

import { PrimitiveError } from '../primitives/errors.js';
import { normalise, partition, variantDeclarations, type StyleAuthored } from '../primitives/style.js';

/** One animatable style key. */
export interface AnimatedPropertySpec {
    /** The GTK widget property the number is written to, in GTK's kebab spelling. */
    readonly property: string;
    /** The GTK CSS property the STATIC form of this key becomes, for the clash check. */
    readonly css: string;
}

/**
 * The style keys `Animated.View` answers for.
 *
 * `opacity` is a `gdouble` on `Gtk.Widget` and therefore on every widget a primitive
 * can become — measured: `GtkBox` installs 41 properties, `opacity` among them, and
 * `GtkOverlay` has it too, so the `View` overlay switch does not change the answer.
 */
export const ANIMATED_PROPERTIES: Readonly<Record<string, AnimatedPropertySpec>> = {
    opacity: { property: 'opacity', css: 'opacity' },
};

/**
 * The keys a porter will reach for, each with the reason GTK has no number to drive.
 *
 * Listed rather than left to the generic refusal because the generic one can only say
 * what IS animatable, and "why not transform" is the question actually being asked.
 */
const REFUSED_KEYS: Readonly<Record<string, string>> = {
    transform:
        'is a `Gsk.Transform` on a render node, not a widget property — measured, `GtkBox` installs 41 properties and not one of them translates, scales or rotates. A translation is expressible as a `Gtk.Fixed` child position, which is a different widget and a different tree, so it is a component rather than an animated key',
    translateX: 'is `transform`’s, and has the same answer',
    translateY: 'is `transform`’s, and has the same answer',
    scale: 'is `transform`’s, and has the same answer',
    rotate: 'is `transform`’s, and has the same answer',
    width: '`Gtk.Widget:width-request` is a MINIMUM and not a size, so animating it animates the floor under GTK’s own measurement while the widget stays free to be wider. The honest desktop counterpart is a layout change, which is React’s to make',
    height: 'is `width`’s, and has the same answer',
    backgroundColor:
        'is paint, and L1 partitions paint into GTK CSS (measured, `paint.ts`) — an `Adw.Animation` writes a VALUE into a property, and a background colour is a declaration in a stylesheet, with no widget property behind it',
    color: 'is `backgroundColor`’s, and has the same answer',
    borderRadius: 'is `backgroundColor`’s, and has the same answer',
    fontSize:
        'is a Pango attribute on a label’s own text rather than a widget property, so there is nothing for an animation to write',
    top: 'resolves to an ALIGNMENT plus a margin on a `Gtk.Overlay` child (`intents.ts`), which is two facts and one of them an enum — not one number to interpolate',
    left: 'is `top`’s, and has the same answer',
    right: 'is `top`’s, and has the same answer',
    bottom: 'is `top`’s, and has the same answer',
};

/** The animatable key `key` names, or a named refusal. */
export function animatedProperty(primitive: string, key: string): AnimatedPropertySpec {
    const spec = ANIMATED_PROPERTIES[key];
    if (spec !== undefined) return spec;
    const known = REFUSED_KEYS[key];
    throw new PrimitiveError(
        primitive,
        `style={{ ${key}: <Animated.Value> }}`,
        known ??
            `is not a style key this layer can animate. The animatable set is: ${Object.keys(ANIMATED_PROPERTIES).join(', ')} — an animation writes a GTK widget property, and most of React Native’s style vocabulary becomes GTK CSS or a layout decision instead`,
    );
}

/**
 * Refuse when the element also AUTHORS one of the properties it animates.
 *
 * `authored` is the PLAIN half — the style with the animated entries already taken
 * out — because `normalise` refuses a style value that is not a string or a number,
 * which is exactly what an `Animated.Value` is.
 *
 * The check runs the real partition rather than looking for the literal utility, for
 * the reason `declaresAbsolute` does: `opacity` reaches GTK CSS from a class
 * (`opacity-70`), from a style object (`style={{ opacity: 0.7 }}`) and from a variant
 * (`active:opacity-70`), and a syntactic test would be exact only while that stays
 * three spellings.
 */
export function assertNoStaticClash(
    primitive: string,
    authored: StyleAuthored,
    animatedKeys: readonly string[],
    tokens: StyleTokens,
): void {
    const conflicts = animatedKeys.map((key) => animatedProperty(primitive, key).css);
    if (conflicts.length === 0) return;
    const { props, groups } = normalise(authored, tokens, primitive);
    const declarations = [
        ...partition(props).css,
        ...Object.values(variantDeclarations(groups, tokens, primitive)).flat(),
    ];
    for (const css of conflicts) {
        const clash = declarations.find((declaration) => declaration.startsWith(`${css}:`));
        if (clash === undefined) continue;
        throw new PrimitiveError(
            primitive,
            `an animated "${css}" beside "${clash}"`,
            `paints one appearance through two independent channels: this element’s style resolves to the GTK CSS declaration "${clash}", and the animation writes the widget property "${css}". GTK applies both and this layer cannot say which one a reader ends up seeing. Drop the static one, or animate something else`,
        );
    }
}
