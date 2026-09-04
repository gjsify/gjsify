// React Native's accessibility props → GTK's accessible attributes, as a DECISION.
//
// The table used to refuse all of these with one sentence: "GTK carries
// accessibility through `Gtk.Accessible.update_property()`, an imperative call, not
// through a widget property — so there is nothing for this layer to set as data."
// The fact is right and the conclusion was wrong, and `accessibilityLiveRegion` on
// `<Text>` was already the counter-example sitting in the same file: an imperative
// GTK call is expressible here exactly like a property is, as long as the TABLE
// holds the whole of the decision and the CALL lives one layer up ({@link
// AnnounceRoute}, {@link FileRoute}, {@link GestureRoute} are the same shape).
//
// So this module is the decision half — what each prop means on GTK, which
// attribute set it belongs to, and which GValue GTK reads it out of — and
// `../accessibility.ts` is the call half. Nothing here imports `gi://`, which is
// what lets every mapping below be asserted with no display and no toolkit.
//
// WHY `accessibilityRole` IS NOT HERE. It is an ordinary {@link PropertyRoute} in
// the table, writing the GObject property `accessible-role`, and the reason is a
// MEASUREMENT that contradicts the received wisdom. `Gtk.Accessible:accessible-role`
// is widely documented — and was true in earlier GTK4 — as construct-only, which is
// why an application that reaches a finished widget through a ref cannot set it at
// all. MEASURED on gtk 4.22.4 / gjs 1.88.1, on all eight widget classes this layer
// builds: the ParamSpec flags are `READABLE|WRITABLE` with no `CONSTRUCT_ONLY`, and
// a post-construction assignment STICKS — `new Gtk.Box()` reads role 15 (GENERIC),
// `box.accessible_role = BUTTON` then reads 3, and `Gtk.test_accessible_has_role`
// agrees. There is nothing for this module to do about it, and a widget property is
// strictly better than an imperative call: the host coerces the nick, replays it
// through `materialize`, and rebuilds on a change if a future GTK makes it
// construct-only again.
//
// The GVALUE TYPE PER ATTRIBUTE IS MEASURED, NOT DERIVED, and it is the whole
// reason {@link AccessibleAttribute.as} exists as data. GTK reads each attribute out
// of one specific GValue type and reads it with `g_value_get_*` — the WRONG type is
// a `GLib-GObject-CRITICAL` assertion, the attribute is recorded anyway, and the
// process exits 0. Measured, on gtk 4.22.4, by writing every state through all three
// candidate types and watching stderr:
//
//   `checked` `pressed` `selected` `expanded`  G_TYPE_INT holding a tristate
//   `busy` `disabled` `hidden`                 G_TYPE_BOOLEAN
//   `visited`                                  G_TYPE_INT
//   `invalid`                                  G_TYPE_INT holding an invalid-state
//   every property in `Gtk.AccessibleProperty` this layer writes   G_TYPE_STRING
//
// Two of those are worth naming because they contradict the type GTK's own
// documentation reads like: a tristate state is NOT written through a
// `GtkAccessibleTristate` GValue (that raises `g_value_get_int: assertion
// 'G_VALUE_HOLDS_INT (value)' failed`), and `visited` is an int rather than the
// boolean its siblings are.

/**
 * One GTK accessible attribute, and the GValue GTK reads its value out of.
 *
 * `set` picks the call — `Gtk.Accessible.update_property()` or `update_state()`.
 * They are two enums (`Gtk.AccessibleProperty`, `Gtk.AccessibleState`) with
 * overlapping nicks, so which SET an attribute belongs to is not derivable from
 * its name and is declared here.
 */
export interface AccessibleAttribute {
    readonly set: 'property' | 'state';
    /**
     * The enum member's nick — `label`, `help-text`, `checked`, `disabled`.
     *
     * A nick rather than the enum member, for the reason every other route holds
     * strings: nothing under `primitives/` imports `gi://`. The call layer resolves
     * it the way `@gjsify/gtk-host`'s `props.ts` resolves any enum nick, by
     * upper-casing and swapping `-` for `_`.
     */
    readonly name: string;
    /** Which GValue GTK reads it out of — see this module's header; every one is measured. */
    readonly as: 'string' | 'boolean' | 'tristate';
}

/** A prop whose own value is one accessible attribute — `accessibilityLabel`. */
export interface AccessibleValueRoute {
    readonly to: 'accessible';
    readonly from: 'value';
    readonly attribute: AccessibleAttribute;
}

/**
 * A prop whose value is a RECORD of accessible attributes — `accessibilityState`.
 *
 * React Native has exactly one of these and its five keys all land, which is the
 * happier half of a mapping that is otherwise full of refusals: `disabled` and
 * `busy` are GTK booleans, and `selected`, `checked` and `expanded` are GTK
 * TRISTATES — so `checked: 'mixed'`, the one genuinely three-valued thing in
 * React Native's accessibility surface, has an exact GTK member
 * (`Gtk.AccessibleTristate.MIXED`) rather than an approximation.
 *
 * `refuses` is empty today and is kept because the next key React Native adds is
 * more likely to have no GTK attribute than to have one, and a key refused BY NAME
 * with a reason is the answer this table gives everywhere else.
 */
export interface AccessibleMembersRoute {
    readonly to: 'accessible';
    readonly from: 'members';
    readonly members: Readonly<Record<string, AccessibleAttribute>>;
    /** Keys this layer recognises and cannot answer, each with what to do instead. */
    readonly refuses: Readonly<Record<string, string>>;
}

export type AccessibleRoute = AccessibleValueRoute | AccessibleMembersRoute;

/**
 * One accessible attribute write, decided here and CALLED one layer up.
 *
 * `value` is already the shape the call layer puts in a GValue: a string for
 * `string`, a boolean for `boolean`, and 0/1/2 for `tristate` — the numeric
 * `Gtk.AccessibleTristate` member, resolved here so the call layer holds no
 * vocabulary of its own.
 */
export interface ResolvedAccessible {
    /** The React Native prop that asked for it, for a refusal's benefit. */
    readonly prop: string;
    readonly set: 'property' | 'state';
    readonly name: string;
    readonly value: string | boolean | number;
}

/**
 * The accessibility props every primitive accepts, declared ONCE for both L3s.
 *
 * Here rather than in either binding because the two `CommonProps` are
 * hand-maintained and this set is identical in both — the second copy is where a
 * prop that exists in React and not in Solid comes from, and `PROPS.md` would keep
 * claiming both answered it. L2 owns the vocabulary; a binding extends it.
 */
export interface AccessibilityProps {
    /**
     * Recognised and without effect — every GTK widget is already in the
     * accessibility tree. The table's row carries the whole reason and names the
     * prop that takes an element OUT of it (`accessibilityRole="none"`).
     */
    accessible?: boolean;
    /** The accessible NAME — `Gtk.AccessibleProperty.LABEL`, what a screen reader says on focus. */
    accessibilityLabel?: string;
    /**
     * The accessible ROLE — the GObject property `Gtk.Accessible:accessible-role`.
     *
     * `string` rather than React Native's own union, because the mapping is the
     * table's and an unmapped value is a named refusal at render rather than a type
     * error: React Native's own type ends in `| string`, so a union here would
     * reject nothing the table accepts and accept nothing extra.
     */
    accessibilityRole?: string;
    /** What acting on this element does — `Gtk.AccessibleProperty.HELP_TEXT`. */
    accessibilityHint?: string;
    /** The accessible STATES — `Gtk.Accessible.update_state()`; `checked` is a real tri-state. */
    accessibilityState?: {
        disabled?: boolean;
        busy?: boolean;
        checked?: boolean | 'mixed';
        selected?: boolean;
        expanded?: boolean;
    };
}

/** `Gtk.AccessibleTristate`, by number. Declared, because nothing here may import `gi://`. */
const TRISTATE = { false: 0, true: 1, mixed: 2 } as const;

/**
 * `value` → the string, boolean or number the call layer hands GTK, or `null` for
 * "this attribute cannot hold that", which the caller turns into a refusal.
 *
 * `false` IS a value and never `null`: a screen reader has to be told "not checked"
 * as much as "checked", and GTK's own way of saying nothing is for no attribute to
 * be set at all — which is what an ABSENT prop already produces, since `undefined`
 * is skipped before a route is consulted.
 *
 * An explicit `null` is a refusal rather than a clear, which is this layer's
 * existing convention: `coerce()` answers `testID={null}` the same way. Removing
 * the prop is how React Native clears it.
 */
function coerceAttribute(attribute: AccessibleAttribute, value: unknown): string | boolean | number | null {
    switch (attribute.as) {
        case 'string':
            return typeof value === 'string' ? value : null;
        case 'boolean':
            return typeof value === 'boolean' ? value : null;
        case 'tristate':
            if (typeof value === 'boolean') return value ? TRISTATE.true : TRISTATE.false;
            // ONLY `mixed` arrives as a string. React Native's type is
            // `boolean | 'mixed'`, so `checked: 'true'` is a mistake worth naming —
            // a lookup keyed by the value would have accepted it as TRUE.
            return value === 'mixed' ? TRISTATE.mixed : null;
    }
}

/** What a bad value is told, naming the type GTK reads the attribute out of. */
const EXPECTED: Readonly<Record<AccessibleAttribute['as'], string>> = {
    string: 'a string',
    boolean: 'true or false',
    tristate: 'true, false or "mixed" — GTK reads it as a Gtk.AccessibleTristate',
};

/**
 * A route plus the authored value → the attribute writes it stands for.
 *
 * Throws nothing itself: it reports a bad value as a `problem` so the caller raises
 * the one `PrimitiveError` this layer raises, with the primitive's own name in it.
 */
export function resolveAccessible(
    route: AccessibleRoute,
    prop: string,
    value: unknown,
): { entries: readonly ResolvedAccessible[]; problem: string | null } {
    if (route.from === 'value') {
        const coerced = coerceAttribute(route.attribute, value);
        if (coerced === null) {
            return {
                entries: [],
                problem: `writes the GTK accessible ${route.attribute.set} "${route.attribute.name}" and needs ${EXPECTED[route.attribute.as]}`,
            };
        }
        return {
            entries: [{ prop, set: route.attribute.set, name: route.attribute.name, value: coerced }],
            problem: null,
        };
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return {
            entries: [],
            problem: `is a record of accessibility states and needs an object — its keys are ${Object.keys(route.members).sort().join(', ')}`,
        };
    }
    const entries: ResolvedAccessible[] = [];
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
        // Same rule as the prop loop one layer up: `undefined` is React's absent
        // key, not an authored one, and every optional field of a spread object is
        // `undefined`.
        if (member === undefined) continue;
        const refusal = route.refuses[key];
        if (refusal !== undefined) return { entries: [], problem: `carries "${key}", which ${refusal}` };
        const attribute = route.members[key];
        if (attribute === undefined) {
            return {
                entries: [],
                problem: `carries "${key}", which is not a state this layer answers for. It takes: ${Object.keys(route.members).sort().join(', ')}`,
            };
        }
        const coerced = coerceAttribute(attribute, member);
        if (coerced === null) {
            return { entries: [], problem: `carries "${key}", which needs ${EXPECTED[attribute.as]}` };
        }
        entries.push({ prop, set: attribute.set, name: attribute.name, value: coerced });
    }
    return { entries, problem: null };
}
