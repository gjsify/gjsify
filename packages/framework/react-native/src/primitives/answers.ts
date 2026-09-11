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
import type { PrimitiveSpec, PropertyRoute, PropRoute } from './table.js';

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
    /**
     * The values this prop ACCEPTS by name, when the table enumerates them — the
     * inverse grain of {@link refuses}, and `null` when there is no such list.
     *
     * THE TWO GRAINS ARE NOT THE SAME FACT, and reading only one is how #1648
     * happened. `refuses` enumerates what is forbidden; a `map` enumerates what is
     * allowed, and a value outside it is refused BY OMISSION. `pointerEvents` is
     * `{ auto, none }` with no `refuses` at all, so the oracle answered ACCEPTED for
     * `box-none` — a real React Native spelling that a render throws on — and a
     * consumer deleted their own working mapping on the strength of it.
     */
    readonly allows: ValueVocabulary | null;
}

/**
 * The values one route accepts by name, for the routes whose table row says.
 *
 * `numbers` is not a special case bolted on: `pixels-or-map` accepts a pixel COUNT
 * beside its two named steps, and a vocabulary that could not say so would make
 * `<ActivityIndicator size={24}>` read as refused.
 */
export interface ValueVocabulary {
    /** Accepted spellings, in the table's own keys. Compared against `String(value)`. */
    readonly values: readonly string[];
    /** A finite number is accepted without appearing in {@link values}. */
    readonly numbers: boolean;
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
    allows: ValueVocabulary | null;
};

const NO_REFUSALS: Readonly<Record<string, string>> = {};

/** A vocabulary of named spellings and nothing else. */
const named = (values: readonly string[]): ValueVocabulary => ({ values, numbers: false });

/**
 * Which values a COERCION lets through, for the one route kind that has coercions.
 *
 * Its own function so the switch below stays one arm per {@link PropRoute} kind, and
 * so a coercion added to `Coercion` fails to compile HERE — the declared return type
 * with no `default` is what asks the question rather than answering it by silence.
 *
 * The four non-map coercions have no enumerable vocabulary and that is a decision,
 * not an omission: `string` takes every string, and what `boolean`/`not`/`int` refuse
 * is a TYPE rather than a spelling. A type refusal is a different grain, it is not
 * expressible as a list, and the oracle does not claim it — see `prop-table.ts`.
 */
function coercionVocabulary(route: PropertyRoute): ValueVocabulary | null {
    switch (route.as) {
        case 'map':
            return named(Object.keys(route.map ?? {}));
        case 'pixels-or-map':
            return { values: Object.keys(route.map ?? {}), numbers: true };
        case 'string':
        case 'boolean':
        case 'not':
        case 'int':
            return null;
    }
}

/**
 * One route → the values it accepts by name, or `null` when it enumerates none.
 *
 * THE COMPLETENESS QUESTION, asked of every route kind in one place (#1648). A route
 * that refuses a value by OMISSION from a list is invisible to {@link PropAnswer.refuses},
 * and three kinds do it — a mapped property, an `announce` map, and an accessible
 * record's member keys. Before this function each of them was a separate oversight
 * waiting to be reported; now the switch has no `default`, so the next route kind
 * cannot be added without answering the question for it.
 *
 * `file` is the deliberate `null` worth naming: its refusals ARE value-level
 * (`http:` has no synchronous loader, a `require()` id has no asset registry) but
 * they are computed from the value's shape rather than drawn from a list, so no
 * vocabulary can express them and the oracle must not pretend otherwise.
 */
export function routeValueVocabulary(route: PropRoute): ValueVocabulary | null {
    switch (route.to) {
        case 'property':
            return coercionVocabulary(route);
        case 'announce':
            return named(Object.keys(route.map));
        case 'accessible':
            // The grain is the record's KEY, which is what `refuses` is keyed by here
            // too — one question at the table's own two grains.
            return route.from === 'members' ? named(Object.keys(route.members)) : null;
        case 'style-property':
        case 'event':
        case 'file':
        case 'gesture':
        case 'ignored':
        case 'refused':
            return null;
    }
}

/**
 * The vocabularies of a prop's routes → the prop's own.
 *
 * INTERSECTION, because a render applies every route the prop carries and a value
 * has to survive all of them — the dual of the union {@link PropAnswer.refuses}
 * takes, and for the same reason. `ScrollView`'s `horizontal` is three mapped
 * properties over two nodes, so a spelling one of them does not map is refused by
 * the prop. A route with no vocabulary constrains nothing and drops out.
 */
function intersectVocabularies(all: readonly (ValueVocabulary | null)[]): ValueVocabulary | null {
    const present = all.filter((one): one is ValueVocabulary => one !== null);
    if (present.length === 0) return null;
    const first = present[0] as ValueVocabulary;
    return {
        values: first.values.filter((value) => present.every((one) => one.values.includes(value))),
        numbers: present.every((one) => one.numbers),
    };
}

function answerForRoute(route: PropRoute): RouteAnswer {
    const allows = routeValueVocabulary(route);
    switch (route.to) {
        case 'property':
            return { status: 'property', why: '', gtk: route.names, refuses: route.refuses ?? NO_REFUSALS, allows };
        case 'style-property':
            return { status: 'style', why: '', gtk: [`style: ${route.name}`], refuses: NO_REFUSALS, allows };
        case 'event':
            return { status: 'event', why: '', gtk: [route.signal], refuses: NO_REFUSALS, allows };
        case 'file':
            return { status: 'file', why: '', gtk: [route.property], refuses: NO_REFUSALS, allows };
        case 'gesture':
            return {
                status: 'gesture',
                why: '',
                gtk: [`Gtk.GestureClick::${route.signal}`],
                refuses: NO_REFUSALS,
                allows,
            };
        case 'announce':
            return {
                status: 'announcement',
                why: '',
                gtk: [route.signal, 'Gtk.Accessible.announce()'],
                refuses: NO_REFUSALS,
                allows,
            };
        case 'accessible':
            return {
                status: 'accessible',
                why: '',
                gtk: accessibleReach(route),
                // `from: 'value'` has no per-key grain to refuse at; `from: 'members'`
                // carries the record's own refusals, empty today and not for long.
                refuses: route.from === 'members' ? route.refuses : NO_REFUSALS,
                allows,
            };
        case 'ignored':
            return { status: 'ignored', why: route.why, gtk: [], refuses: NO_REFUSALS, allows };
        case 'refused':
            return { status: 'refused', why: route.why, gtk: [], refuses: NO_REFUSALS, allows };
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
        return {
            primitive,
            prop,
            status: 'refused',
            why: spec.refusesStyle,
            gtk: [],
            refuses: NO_REFUSALS,
            allows: null,
        };
    }
    if (frameworkProps.has(prop)) {
        return { primitive, prop, status: 'framework', why: '', gtk: [], refuses: NO_REFUSALS, allows: null };
    }
    const route = spec.props[prop];
    if (route === undefined) {
        return {
            primitive,
            prop,
            status: 'unknown',
            why: unknownPropDetail(spec),
            gtk: [],
            refuses: NO_REFUSALS,
            allows: null,
        };
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
        allows: intersectVocabularies(answers.map((answer) => answer.allows)),
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
