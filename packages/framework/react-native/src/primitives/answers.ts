// One prop of one primitive → what this layer does about it, and the sentence it says.
//
// TWO GRAINS, BECAUSE THE TABLE HAS TWO. A prop can be refused outright, and a prop
// that is ACCEPTED can refuse some of its values by name — `accessibilityRole` maps most
// of React Native's role names onto a GTK member and refuses the rest, each with its own
// sentence. Both belong here: a per-value refusal that only existed inside the resolver
// was reachable only by rendering one and catching the throw, which is the state § 1 of
// ADR 0039 exists to end (#1555).
//
// THE POINT IS THAT THERE IS ONE OF THESE. `resolve.ts` used to build the "unknown
// prop" and "refused" sentences inline, which made the answer reachable only by
// RENDERING — a consumer could not ask "does this layer take `onPress` on `Text`?"
// without mounting a tree and catching a throw. `prop-table.ts` publishes the
// question and this module answers it, so the sentence a test reads and the sentence
// the resolver throws are the same string rather than two copies of one claim.
//
// NO VALUE IMPORTS, and that is load-bearing rather than tidy. `scripts/
// generate-exports.mjs` renders `PROPS.md` by IMPORTING this module and `table.ts`
// under Node's type stripping — no build, no install, which is what
// `check-rn-surface.mjs` needs (audit-runtimes.yml deliberately does neither). Node
// does not rewrite a `./x.js` specifier to `./x.ts`, so a module the generator loads
// may only import TYPES from its siblings. Everything this file needs about a
// primitive arrives as an argument.
//
// A source PARSER over `table.ts` was the obvious alternative and is the wrong one:
// its rows spread shared records (`...COMMON`, `...TEXT_INPUT_COMMON`) and CALL
// functions to build refusal sentences (`PRESSED_STYLE_IS_CSS('active:opacity-70')`),
// so a parser would report the spread instead of the row's real answer — a second
// truth about the one question this whole layer exists to answer.

import type { AccessibleRoute } from './accessibility.js';
import type { PrimitiveSpec, PropRoute } from './table.js';

/**
 * What this layer does about a prop.
 *
 * The first six are ACCEPTED — the prop reaches GTK, by the route the name says.
 * `ignored` is accepted too and reaches nothing, deliberately. Only `refused` and
 * `unknown` throw, and they are separate because they have different fixes: a
 * refusal is a decision with a reason, an unknown prop is a name nobody recognised
 * (usually a typo, sometimes a prop this table has not grown yet).
 */
export type PropStatus =
    /** Becomes one or more GTK widget properties. */
    | 'property'
    /** Binds a GObject signal. */
    | 'event'
    /** Joins the normalised style record and goes through the style partition. */
    | 'style'
    /** Becomes a `Gio.File` on a widget property. */
    | 'file'
    /** Binds a `Gtk.GestureClick` signal through a controller. */
    | 'gesture'
    /** Calls `Gtk.Accessible.announce()` when a signal reports the content changed. */
    | 'announcement'
    /** Writes a `Gtk.Accessible` property or state through `update_property()`/`update_state()`. */
    | 'accessible'
    /** Recognised and deliberately without effect on a desktop window. */
    | 'ignored'
    /** Refused by name, with a reason. Throws a `PrimitiveError` when rendered. */
    | 'refused'
    /** The framework's own (`children`, `key`, `ref`, `className`, `style`); never reaches a widget. */
    | 'framework'
    /** Not a name this primitive carries at all. Throws a `PrimitiveError` when rendered. */
    | 'unknown';

/** What this layer does about one prop of one primitive. */
export interface PropAnswer {
    readonly primitive: string;
    readonly prop: string;
    readonly status: PropStatus;
    /**
     * The reason, for every status that has one.
     *
     * For `refused` and `unknown` it is the DETAIL of the `PrimitiveError` the
     * resolver throws — the same string, not a paraphrase. For `ignored` it is why
     * the no-op is the right answer. Empty for a prop that simply lands.
     */
    readonly why: string;
    /** What it reaches on the GTK side: property names, a signal, or nothing. */
    readonly gtk: readonly string[];
    /**
     * The VALUES this prop refuses by name, each with its own reason (#1555).
     *
     * A field rather than a fold into {@link why}, because the prop is ACCEPTED and
     * only some of its values are not: `accessibilityRole` answers most role names and
     * refuses a handful, and a row that said `property | — ` could not tell a reader
     * which — `propRefusedValues` is the reader that can. Keyed by the VALUE for a
     * mapped property route and by the KEY for an accessible record
     * (`accessibilityState`), which is the same question at the two grains the table
     * has.
     *
     * The reason is the table's own string, not a sentence built here: `prop-table.ts`
     * wraps it in the subject the resolver throws, so the static answer and the render
     * stay one string (ADR 0039 § 2).
     */
    readonly refuses: Readonly<Record<string, string>>;
}

/**
 * What an accessible route reaches, in GTK's spelling.
 *
 * Here rather than beside the route's own types because THIS is the module that
 * may hold no relative value import — see the header — and every other route's
 * reach string is built inline below for the same reason.
 */
function accessibleReach(route: AccessibleRoute): readonly string[] {
    const call = (set: 'property' | 'state'): string =>
        set === 'property' ? 'Gtk.Accessible.update_property()' : 'Gtk.Accessible.update_state()';
    if (route.from === 'value') return [`${call(route.attribute.set)}: ${route.attribute.name}`];
    return Object.keys(route.members)
        .sort()
        .map((key) => {
            const attribute = route.members[key] as AccessibleAttributeOf<typeof route>;
            return `${key} → ${call(attribute.set)}: ${attribute.name}`;
        });
}

/** The member type of an accessible members route, without importing it as a value. */
type AccessibleAttributeOf<R> = R extends { readonly members: Readonly<Record<string, infer A>> } ? A : never;

/** Does this status let a render proceed? `ignored` counts — it is a declared no-op, not a refusal. */
export const isAccepted = (status: PropStatus): boolean => status !== 'refused' && status !== 'unknown';

/** The detail of the refusal a prop no primitive row carries gets. `resolve.ts` throws exactly this. */
export const unknownPropDetail = (spec: PrimitiveSpec): string =>
    `is not a prop this primitive answers for. It takes: ${Object.keys(spec.props).sort().join(', ')}. ` +
    'An unlisted prop is refused rather than dropped: a prop that silently does nothing is indistinguishable from a bug in the application, forever';

/** The detail of the refusal an unknown PRIMITIVE gets. `resolve.ts` throws exactly this. */
export const unknownPrimitiveDetail = (names: readonly string[]): string =>
    `is not a primitive this layer answers for. Known: ${[...names].sort().join(', ')}`;

/**
 * One route → its status, reason and GTK reach.
 *
 * A prop may carry SEVERAL routes (`ScrollView`'s `horizontal` writes three widget
 * properties across two nodes); they are the same status by construction, so the
 * merge below unions the GTK reach and keeps the first reason.
 */
type RouteAnswer = {
    status: PropStatus;
    why: string;
    gtk: readonly string[];
    refuses: Readonly<Record<string, string>>;
};

const NO_REFUSALS: Readonly<Record<string, string>> = {};

function answerForRoute(route: PropRoute): RouteAnswer {
    switch (route.to) {
        case 'property':
            return { status: 'property', why: '', gtk: route.names, refuses: route.refuses ?? NO_REFUSALS };
        case 'style-property':
            return { status: 'style', why: '', gtk: [`style: ${route.name}`], refuses: NO_REFUSALS };
        case 'event':
            return { status: 'event', why: '', gtk: [route.signal], refuses: NO_REFUSALS };
        case 'file':
            return { status: 'file', why: '', gtk: [route.property], refuses: NO_REFUSALS };
        case 'gesture':
            return { status: 'gesture', why: '', gtk: [`Gtk.GestureClick::${route.signal}`], refuses: NO_REFUSALS };
        case 'announce':
            return {
                status: 'announcement',
                why: '',
                gtk: [route.signal, 'Gtk.Accessible.announce()'],
                refuses: NO_REFUSALS,
            };
        case 'accessible':
            return {
                status: 'accessible',
                why: '',
                gtk: accessibleReach(route),
                // `from: 'value'` has no per-key grain to refuse at; `from: 'members'`
                // carries the record's own refusals, empty today and not for long.
                refuses: route.from === 'members' ? route.refuses : NO_REFUSALS,
            };
        case 'ignored':
            return { status: 'ignored', why: route.why, gtk: [], refuses: NO_REFUSALS };
        case 'refused':
            return { status: 'refused', why: route.why, gtk: [], refuses: NO_REFUSALS };
    }
}

/**
 * What `primitive` does about `prop`.
 *
 * `frameworkProps` and `spec` arrive as arguments rather than being imported — see
 * the header: this module is loaded by a Node script that cannot follow a `./x.js`
 * specifier into a `.ts` file.
 */
export function answerFor(
    primitive: string,
    spec: PrimitiveSpec,
    prop: string,
    frameworkProps: ReadonlySet<string>,
): PropAnswer {
    // BEFORE the framework-prop check, because `Button` refuses exactly the two props
    // that are in it — and `resolve.ts` checks `refusesStyle` before its own prop
    // loop for the same reason, so that the refusal names the primitive rather than
    // whichever prop the loop reached first.
    if (spec.refusesStyle !== undefined && (prop === 'style' || prop === 'className')) {
        return { primitive, prop, status: 'refused', why: spec.refusesStyle, gtk: [], refuses: NO_REFUSALS };
    }
    if (frameworkProps.has(prop)) {
        return { primitive, prop, status: 'framework', why: '', gtk: [], refuses: NO_REFUSALS };
    }
    const route = spec.props[prop];
    if (route === undefined) {
        return { primitive, prop, status: 'unknown', why: unknownPropDetail(spec), gtk: [], refuses: NO_REFUSALS };
    }
    const routes = Array.isArray(route) ? (route as readonly PropRoute[]) : [route as PropRoute];
    const answers = routes.map(answerForRoute);
    const first = answers[0] as RouteAnswer;
    return {
        primitive,
        prop,
        status: first.status,
        why: first.why,
        gtk: answers.flatMap((answer) => answer.gtk),
        // Unioned across the routes for the same reason the reach is: `ScrollView`'s
        // `horizontal` is three widget properties over two nodes and one question, so a
        // value one of them refuses is refused by the prop.
        refuses: Object.assign({}, ...answers.map((answer) => answer.refuses)) as Readonly<Record<string, string>>,
    };
}

/**
 * The props a primitive names, in the order a reader wants them: accepted first.
 *
 * Sorted within a status so the generated document is stable — an object's key order
 * is the table's authoring order, which is not a promise anyone should read a diff
 * against.
 */
export function propNamesOf(spec: PrimitiveSpec): readonly string[] {
    return Object.keys(spec.props).sort();
}
