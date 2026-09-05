// The THIRD door into a widget of this package — an optional construct-props bag,
// beside the XML attribute and the XML child (`scripts/nativescript-xml-doors.mjs`).
//
// WHY IT EXISTS. On GJS a widget is built in one shot,
// `new Adw.Avatar({ size: 96, text: 'Ada Lovelace' })`, and the website's gallery had to
// print a second, longer NativeScript spelling beside every such block: `new Adw.Avatar()`
// and then one assignment per property. ADR 0034 § 4 closes the constructor half of that
// difference. It is an OPTIONAL parameter and nothing else: NativeScript's XML builder
// calls `new instanceType()` with no arguments at all
// (`ui/builder/component-builder/index.ts:96`, measured against @nativescript/core
// 9.0.21-next.15), so the XML door neither gains nor loses anything here.
//
// WHY IT IS A FUNCTION AND NOT A BASE CLASS. The 46 widget classes extend EIGHT different
// `@nativescript/core` bases — GridLayout (21), StackLayout (7), ScrollView (2),
// FlexboxLayout, Button, Image and Observable — so there is no single class to insert one
// into, and a mixin would have to re-declare each base's type surface. A base is also
// hostile territory: `ViewBase`'s own constructor ASSIGNS `this.cssClasses = new Set()`
// (`ui/core/view-base/index.ts:559-568`), so a subclass that shadows one of its members
// kills the widget inside its own constructor. The rule this file follows instead is that
// each class applies its OWN bag as the last statement of its OWN constructor and never
// forwards one to `super()` — a subclass of a subclass (`AdwPasswordEntryRow` over
// `AdwEntryRow` over `AdwActionRow`) would otherwise apply the same bag two or three times,
// once before its own children exist.
//
// WHY AN UNKNOWN KEY THROWS. `instance[key] = value` on a plain class with a key nothing
// declares adds a DEAD own-property and returns, at exit 0 — measured: applying
// `{ size: 96, text: 'Ada Lovelace', showInitals: true }` to a widget-shaped class leaves
// `Object.keys()` equal to `['showInitals']`, the typo silently the only thing that stuck.
// That is the same silent drop one door over that `xml-values.ts` exists for, and a bag
// that reproduced it would be a new surface for it rather than a convenience.

import { GTK_ALIGN, gtkAlignRefusal, NS_HORIZONTAL_ALIGNMENT, NS_VERTICAL_ALIGNMENT } from './gtk-align.js';

/**
 * The keys a widget's construct-props bag accepts, derived from the widget itself.
 *
 * Methods are dropped; everything else a caller could assign stays, its type read off the
 * GETTER (so `size?: number` even though `set size(value: number | string)` also takes the
 * string XML hands over — the bag is the TypeScript door, the attribute is the string one).
 *
 * A read-only accessor survives this type and is refused at RUNTIME instead. The
 * `readonly`-detecting mapped type that would have caught `parent` at compile time was
 * measured to drop `size` as well — a getter/setter pair with different types does not
 * compare equal under it — and a type that silently loses real properties is worse than
 * one that admits two impossible ones and says so when they arrive.
 */
export type ConstructProps<T> = Partial<{
    [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]: T[K];
}>;

/**
 * The NativeScript properties whose value this package reads as a `Gtk.Align`.
 *
 * `horizontalAlignment` and `verticalAlignment` are NativeScript's own — declared by
 * `View`, never re-declared by a widget here — so this is a WIDENING of what they accept
 * and not a second vocabulary: every NativeScript spelling passes through untouched, and
 * only the GTK-side ones are translated. XML is unaffected for the same reason; an author
 * writing `<adw:Avatar horizontalAlignment="center">` was always writing the NativeScript
 * value and still is.
 */
const ALIGNMENT_AXES: Readonly<Record<string, 'horizontal' | 'vertical'>> = {
    horizontalAlignment: 'horizontal',
    verticalAlignment: 'vertical',
};

/** How an assignment to `key` would land, or `null` when it would land nowhere. */
function settableDoor(target: object, key: string): 'accessor' | 'data' | null {
    for (let owner: object | null = target; owner !== null; owner = Object.getPrototypeOf(owner)) {
        const descriptor = Object.getOwnPropertyDescriptor(owner, key);
        if (descriptor === undefined) continue;
        if (descriptor.set !== undefined) return 'accessor';
        // A getter with no setter: the descriptor carries `set: undefined`, so the
        // assignment throws in strict mode — which every NativeScript bundle is — and is a
        // silent no-op anywhere else. Neither is a property this bag can carry.
        if (descriptor.get !== undefined) return null;
        return descriptor.writable === true ? 'data' : null;
    }
    return null;
}

/**
 * A `Gtk.Align` value — the nick, or the constant a GJS caller's `Gtk.Align.CENTER` is —
 * as the NativeScript alignment for `axis`. Any other value is NativeScript's own and is
 * returned unchanged.
 *
 * The number spelling is resolved through {@link GTK_ALIGN} rather than assumed, because
 * the constants are NOT the positions in the nick list: `GTK_ALIGN_BASELINE` was
 * deprecated in GTK 4.12 and made an ALIAS of `GTK_ALIGN_BASELINE_FILL`, so both are 4 and
 * `GTK_ALIGN_BASELINE_CENTER` is 5 where its position says 6.
 */
export function nsAlignment(value: unknown, axis: 'horizontal' | 'vertical'): unknown {
    const table = axis === 'horizontal' ? NS_HORIZONTAL_ALIGNMENT : NS_VERTICAL_ALIGNMENT;
    let nick: string | null = null;
    if (typeof value === 'number') {
        nick = Object.keys(GTK_ALIGN).find((name) => GTK_ALIGN[name] === value) ?? null;
        if (nick === null) {
            throw new TypeError(
                `${value} is not a Gtk.Align constant. The seven members are ` +
                    `${Object.keys(GTK_ALIGN).join(', ')}, holding the values ` +
                    `${[...new Set(Object.values(GTK_ALIGN))].join(', ')}.`,
            );
        }
    } else if (typeof value === 'string' && Object.hasOwn(GTK_ALIGN, value)) {
        nick = value;
    }
    if (nick === null) return value;
    const mapped = table[nick];
    if (mapped !== undefined) return mapped;
    throw new TypeError(
        `Gtk.Align '${nick}' has no ${axis} counterpart in NativeScript: ${gtkAlignRefusal(nick)} ` +
            `The ${axis} alignments that do are ${Object.keys(table).join(', ')}.`,
    );
}

/**
 * Apply a construct-props bag through the target's declared setters.
 *
 * Called as the LAST statement of a widget's own constructor, so the bag wins over whatever
 * that constructor set up — which is the point of a construct property.
 *
 * An `undefined` VALUE is skipped rather than assigned: every key of a `Partial` is
 * optional, so `{ title: maybeTitle }` is the ordinary spelling of "set it if I have one",
 * and assigning `undefined` there would clear a default the constructor had just chosen. An
 * unknown KEY still throws — the key is what the caller got wrong.
 *
 * The parameter is a bare record rather than `ConstructProps<T>` because inside a
 * constructor `this` has the POLYMORPHIC this-type: a generic `<T extends object>(target: T,
 * props?: ConstructProps<T>)` infers `T` as `this`, and `ConstructProps<AdwAvatar>` is not
 * assignable to `ConstructProps<this>` — 46 of 46 call sites failed to compile that way. The
 * typed door is the widget's own constructor signature; this is what it hands over.
 */
export function applyConstructProps(target: object, props?: Readonly<Record<string, unknown>>): void {
    if (props === undefined || props === null) return;
    for (const [key, value] of Object.entries(props)) {
        if (settableDoor(target, key) === null) {
            throw new TypeError(
                `${target.constructor.name} has no settable '${key}'. A construct-props bag goes through the ` +
                    'declared setters, so a key nothing declares is refused here rather than left as a dead ' +
                    'own-property that renders nothing — the silent drop `xml-values.ts` exists for one door over.',
            );
        }
        if (value === undefined) continue;
        const axis = ALIGNMENT_AXES[key];
        (target as Record<string, unknown>)[key] = axis === undefined ? value : nsAlignment(value, axis);
    }
}
