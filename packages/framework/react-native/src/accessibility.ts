// The accessibility props → `Gtk.Accessible.update_property()`/`update_state()`,
// and the two GTK calls they take.
//
// L2 decided everything (`primitives/accessibility.ts` and the table's rows): which
// attribute set each prop writes, which member of it, and what a tri-state value is
// as a number. What is left here is the call — and it is here rather than in either
// L3 because BOTH bindings make it, which is the second truth this layer keeps
// removing. Exactly the arrangement `announce.ts` has for `accessibilityLiveRegion`.
//
// WHY THIS IS EXPRESSIBLE AT ALL, which the table denied until now. GTK carries
// these attributes through an imperative call rather than a widget property, and
// the old refusal read that as "there is nothing for this layer to set as data".
// The premise is right and the conclusion was not: a route can hold the whole of a
// DECISION and none of the call, which is what `FileRoute`, `GestureRoute` and
// `AnnounceRoute` already do.
//
// WHY IT IS A ONE-SHOT WRITE WITH A RESET, and not a subscription. React Native's
// accessibility props are plain values, so the moment is the commit and the message
// is the prop — there is no signal to bind and nothing to watch. What there IS is a
// removal: `accessibilityLabel` going from a string to absent has to CLEAR the
// attribute, and GTK's own `reset_property`/`reset_state` are the only way to say
// so (measured: after `reset_property(LABEL)`, `Gtk.test_accessible_has_property`
// answers false again). So the write returns a disposer that resets exactly what it
// set, and the L3s re-run it when the resolved set changes — the same
// signature-keyed effect `useSignals`, `useGestures` and `useLiveRegions` use.
//
// A WRONG GVALUE TYPE IS NOT AN ERROR, WHICH IS WHY L2 HOLDS THE TYPE. GTK reads
// each attribute with a specific `g_value_get_*`; handed another type it emits a
// `GLib-GObject-CRITICAL` assertion, RECORDS THE ATTRIBUTE ANYWAY, and exits 0.
// Measured — and it is why the specs pair `Gtk.test_accessible_has_*` with a
// diagnostics gate: presence alone answers `true` for a write GTK complained about.
// Nothing here picks a type; the JS type of L2's already-resolved value does, which
// is what keeps the vocabulary in one place.
//
// VALUES through `gi://`, types through `@girs/*`.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import type { ResolvedAccessible } from './primitives/accessibility.js';

/**
 * A nick → the enum member it names, or `undefined`.
 *
 * The same resolution `@gjsify/gtk-host`'s `props.ts` performs for every enum nick
 * it coerces, and for the same reason: an enum member cannot travel through a layer
 * that imports no `gi://`, so the nick does and this is where it lands.
 */
function member(enumObject: Record<string, number>, nick: string): number | undefined {
    return enumObject[nick.toUpperCase().replace(/-/g, '_')];
}

const PROPERTIES = Gtk.AccessibleProperty as unknown as Record<string, number>;
const STATES = Gtk.AccessibleState as unknown as Record<string, number>;

/**
 * The GValue GTK reads this attribute out of, chosen by the JS type L2 resolved to.
 *
 * A number is an INT and never the attribute's own enum GType — measured: a
 * tri-state written through a `GtkAccessibleTristate` GValue raises
 * `g_value_get_int: assertion 'G_VALUE_HOLDS_INT (value)' failed`, because GTK
 * stores every tri-state and every enum-valued state as a plain int.
 */
function valueFor(value: string | boolean | number): GObject.Value {
    const gvalue = new GObject.Value();
    if (typeof value === 'string') {
        gvalue.init(GObject.TYPE_STRING);
        gvalue.set_string(value);
        return gvalue;
    }
    if (typeof value === 'boolean') {
        gvalue.init(GObject.TYPE_BOOLEAN);
        gvalue.set_boolean(value);
        return gvalue;
    }
    gvalue.init(GObject.TYPE_INT);
    gvalue.set_int(value);
    return gvalue;
}

/**
 * The error a nick no GTK enum carries gets.
 *
 * A real path rather than a paranoid probe: the nick is TABLE DATA, and GTK's
 * answer to an out-of-range enum member is a critical followed by exit 0 — the
 * failure mode this package exists to remove. A table typo is worth one named
 * throw.
 */
const unknownAttribute = (entry: ResolvedAccessible): Error =>
    new Error(
        `@gjsify/react-native: the prop "${entry.prop}" is routed to the GTK accessible ${entry.set} ` +
            `"${entry.name}", which Gtk.Accessible${entry.set === 'property' ? 'Property' : 'State'} does not carry. ` +
            'The table is wrong, not the call',
    );

/**
 * Write `entries` onto `widget`, and return the reset.
 *
 * Batched into at most two GTK calls, because both take parallel arrays and one
 * call per attribute would be one AT-SPI notification per attribute (measured:
 * `update_property` accepts several members and their values together).
 */
export function applyAccessibility(widget: Gtk.Widget, entries: readonly ResolvedAccessible[]): () => void {
    const properties: number[] = [];
    const propertyValues: GObject.Value[] = [];
    const states: number[] = [];
    const stateValues: GObject.Value[] = [];

    for (const entry of entries) {
        const isProperty = entry.set === 'property';
        const resolved = member(isProperty ? PROPERTIES : STATES, entry.name);
        if (resolved === undefined) throw unknownAttribute(entry);
        (isProperty ? properties : states).push(resolved);
        (isProperty ? propertyValues : stateValues).push(valueFor(entry.value));
    }

    if (properties.length > 0) widget.update_property(properties, propertyValues);
    if (states.length > 0) widget.update_state(states, stateValues);

    return () => {
        for (const property of properties) widget.reset_property(property);
        for (const state of states) widget.reset_state(state);
    };
}
