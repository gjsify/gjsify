// The published prop surface answers exactly what a render would answer.
//
// The whole value of `@gjsify/react-native/prop-table` is that a consumer can ask
// BEFORE rendering, so the one thing this file has to hold is that the static answer
// and the runtime answer are the same — not similar, the same string. A prop table
// that drifted from the resolver would be worse than none: a test would go green on a
// prop the render then refuses, which is exactly the "considered it" reading ADR 0036
// warns about, one grain finer.
//
// So the sweep below is the load-bearing case: EVERY refusal the table declares, on
// EVERY primitive and both `TextInput` variants, is thrown by `resolvePrimitive` with
// `explainProp`'s message. It is generated from the table rather than listed, so a
// row added tomorrow is covered without anyone remembering to add a vector.

import { describe, expect, it } from '@gjsify/unit';
import { MINIMAL_TOKENS, type StyleTokens } from '@gjsify/gtk-host/style';

import { routeValueVocabulary } from './primitives/answers.js';
import { PrimitiveError } from './primitives/errors.js';
import { resolvePrimitive } from './primitives/resolve.js';
import type { ClassNameSink } from './primitives/style.js';
import { PRIMITIVES, type Coercion, type PrimitiveSpec, type PropRoute } from './primitives/table.js';
import {
    PRIMITIVE_NAMES,
    PRIMITIVE_VARIANTS,
    acceptsProp,
    acceptsPropValue,
    explainProp,
    explainPropValue,
    propAllowedValues,
    propAnswer,
    propNames,
    propRefusedValues,
    propTable,
    type PropVariant,
} from './prop-table.js';

const TOKENS: StyleTokens = MINIMAL_TOKENS;

/** The sink `primitives.spec.ts` uses, and for its reason: a real one needs a display. */
const SINK: ClassNameSink = { classFor: () => 'c1' };

/** What the render would say, or null when it renders. */
function rendered(primitive: string, props: Readonly<Record<string, unknown>>): string | null {
    try {
        resolvePrimitive(primitive, props, { tokens: TOKENS, sheet: SINK });
        return null;
    } catch (error) {
        if (error instanceof PrimitiveError) return error.message;
        throw error;
    }
}

/**
 * A value that reaches the ROUTE rather than a coercion.
 *
 * A refusal is thrown before any value is read (`applyRoute`'s `refused` case is its
 * first), and an unknown prop before that again — so any non-`undefined` value
 * exercises the path this file is about. `true` is the one shape that is never
 * `undefined` and never an object the style partition would try to read.
 */
const MARKER = true;

/**
 * Every SHAPE a route can have, spelt so a new one cannot arrive unnoticed.
 *
 * `to` alone is not the shape: a `property` route's value grain is decided by its
 * COERCION (`as: 'map'` enumerates its values, `as: 'string'` takes every string) and
 * an `accessible` route's by `from`. The template literal over `Coercion` is what
 * makes {@link OUTSIDE} below fail to compile when a coercion is added, and the
 * `switch` with no `default` does the same for a new `to`.
 */
type RouteShape =
    | `property:${Coercion}`
    | 'style-property'
    | 'event'
    | 'file'
    | 'gesture'
    | 'announce'
    | 'accessible:value'
    | 'accessible:members'
    | 'ignored'
    | 'refused';

function shapeOf(route: PropRoute): RouteShape {
    switch (route.to) {
        case 'property':
            return `property:${route.as}`;
        case 'accessible':
            return route.from === 'members' ? 'accessible:members' : 'accessible:value';
        case 'style-property':
        case 'event':
        case 'file':
        case 'gesture':
        case 'announce':
        case 'ignored':
        case 'refused':
            return route.to;
    }
}

/**
 * Per shape: a spelling of the RIGHT KIND that no vocabulary of that shape can hold,
 * or `null` for a shape that enumerates nothing.
 *
 * THIS IS THE COMPLETENESS GUARD FOR #1648, and its value is that it is written
 * INDEPENDENTLY of `routeValueVocabulary`. The defect was not a typo — it was a whole
 * grain of refusal the oracle could not see: `refuses` lists what is forbidden, a map
 * lists what is allowed, and the table has three kinds of the second. A fix that only
 * taught the `'property'` arm about `as: 'map'` would have left `announce` and the
 * accessible records exactly as broken, which is how the single case gets fixed and
 * the class survives.
 *
 * So the sweep below takes each route's shape, probes it with a value of the right
 * kind, and requires the static answer and the render to agree. A new route shape has
 * no entry here and does not compile; an entry that disagrees with the classifier
 * fails the cross-check; and a shape that DOES enumerate but whose answer is blind
 * fails the sweep with both strings printed.
 *
 * THE `null`S ARE DECISIONS, not gaps:
 *   - `string`/`boolean`/`not`/`int` refuse a TYPE, not a spelling. `coerce` takes
 *     every string for `string`, and "not a boolean" is not a list — the oracle
 *     deliberately does not claim that grain, and `explainPropValue` says so.
 *   - `file` DOES refuse by value (`http:` has no synchronous loader, a `require()`
 *     id has no asset registry) and those refusals are computed from the value's
 *     shape rather than drawn from a list. Nothing enumerable to publish.
 *   - `style-property` hands the value to the style partition, whose vocabulary is
 *     L1's and is answered by `UnknownUtilityError`, not by this table.
 *   - `event`/`gesture` want a function; `ignored`/`refused` answer at the PROP grain
 *     and are already swept above.
 */
const OUTSIDE: Readonly<Record<RouteShape, string | null>> = {
    'property:map': '__outside_every_map__',
    'property:pixels-or-map': '__outside_every_map__',
    'property:string': null,
    'property:boolean': null,
    'property:not': null,
    'property:int': null,
    'style-property': null,
    event: null,
    file: null,
    gesture: null,
    announce: '__outside_every_map__',
    'accessible:value': null,
    'accessible:members': '__outside_every_record__',
    ignored: null,
    refused: null,
};

/** Every route in the table, with the primitive and variant it belongs to. */
function everyRoute(): {
    primitive: string;
    variant: PropVariant | undefined;
    prop: string;
    route: PropRoute;
}[] {
    const out: { primitive: string; variant: PropVariant | undefined; prop: string; route: PropRoute }[] = [];
    for (const [primitive, base] of Object.entries(PRIMITIVES)) {
        const branch = base.switchOn;
        const cases: (readonly [PropVariant | undefined, PrimitiveSpec])[] = [[undefined, base]];
        if (branch !== undefined) cases.push([{ [branch.prop]: true }, branch.whenTrue]);
        for (const [variant, spec] of cases) {
            for (const [prop, declared] of Object.entries(spec.props)) {
                const routes: readonly PropRoute[] = Array.isArray(declared)
                    ? (declared as readonly PropRoute[])
                    : [declared as PropRoute];
                for (const route of routes) out.push({ primitive, variant, prop, route });
            }
        }
    }
    return out;
}

export default async () => {
    await describe('the answer a consumer gets without rendering', async () => {
        await it('refuses onPress on Text, which is the prop that ended a tree', async () => {
            expect(acceptsProp('Text', 'onPress')).toBe(false);
            expect(propAnswer('Text', 'onPress').status).toBe('refused');
            expect(explainProp('Text', 'onPress')).toContain('Wrap it in a `<Pressable>`');
        });

        await it('accepts onPress on Pressable, and names the signal it becomes', async () => {
            expect(acceptsProp('Pressable', 'onPress')).toBe(true);
            expect(propAnswer('Pressable', 'onPress').status).toBe('event');
            expect(propAnswer('Pressable', 'onPress').gtk).toStrictEqual(['clicked']);
            expect(explainProp('Pressable', 'onPress')).toBe(null);
        });

        await it('reports a name no row carries as unknown rather than accepted', async () => {
            expect(acceptsProp('View', 'onPressishly')).toBe(false);
            expect(propAnswer('View', 'onPressishly').status).toBe('unknown');
            expect(explainProp('View', 'onPressishly')).toContain('It takes:');
        });

        await it('treats a declared no-op as accepted — it is an answer, not a refusal', async () => {
            expect(propAnswer('TextInput', 'autoCapitalize').status).toBe('ignored');
            expect(acceptsProp('TextInput', 'autoCapitalize')).toBe(true);
            expect(explainProp('TextInput', 'autoCapitalize')).toBe(null);
        });

        await it('answers the framework’s own props without consulting a row', async () => {
            for (const prop of ['children', 'key', 'ref', 'className', 'style']) {
                expect(propAnswer('View', prop).status).toBe('framework');
                expect(acceptsProp('View', prop)).toBe(true);
            }
        });

        await it('refuses style on Button, which is the one primitive that takes none', async () => {
            expect(acceptsProp('Button', 'style')).toBe(false);
            expect(acceptsProp('Button', 'className')).toBe(false);
            expect(explainProp('Button', 'style')).toContain('Use `<Pressable>`');
        });

        await it('throws for a primitive nobody declared, naming the ones that exist', async () => {
            let message = '';
            try {
                propAnswer('Nonesuch', 'style');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('is not a primitive this layer answers for');
            expect(message).toContain('Pressable');
        });
    });

    await describe('the variant that is a different widget', async () => {
        await it('names multiline as TextInput’s branch, and only TextInput’s', async () => {
            expect(PRIMITIVE_VARIANTS).toStrictEqual({ TextInput: 'multiline' });
        });

        await it('answers value on a Gtk.Entry and refuses it on a Gtk.TextView', async () => {
            expect(acceptsProp('TextInput', 'value')).toBe(true);
            expect(acceptsProp('TextInput', 'value', { multiline: true })).toBe(false);
            expect(explainProp('TextInput', 'value', { multiline: true })).toContain('Gtk.TextBuffer');
        });
    });

    await describe('the static answer IS the runtime answer', async () => {
        const variants: readonly (PropVariant | undefined)[] = [undefined, { multiline: true }];
        for (const primitive of PRIMITIVE_NAMES) {
            for (const variant of variants) {
                // Only `TextInput` has a second variant; asking for one on any other
                // primitive resolves to the base spec, so the pass would be a copy.
                if (variant !== undefined && PRIMITIVE_VARIANTS[primitive] === undefined) continue;
                const label = variant === undefined ? primitive : `${primitive} multiline`;
                await it(`<${label}> refuses exactly what prop-table says it refuses`, async () => {
                    const props = variant ?? {};
                    for (const prop of propNames(primitive, variant)) {
                        const answer = propAnswer(primitive, prop, variant);
                        if (answer.status !== 'refused') continue;
                        const message = rendered(primitive, { ...props, [prop]: MARKER });
                        expect(message).toBe(explainProp(primitive, prop, variant));
                    }
                    // An unknown prop, on every primitive, with the same equality.
                    const message = rendered(primitive, { ...props, notAPropAnywhere: MARKER });
                    expect(message).toBe(explainProp(primitive, 'notAPropAnywhere', variant));
                });

                await it(`<${label}> refuses exactly the VALUES prop-table says it refuses`, async () => {
                    // The same equality one grain finer (#1555). A prop can be answered
                    // and still refuse some of its values, and until this existed those
                    // sentences were reachable only by rendering one and catching the
                    // throw — the state ADR 0039 § 1 was written to end, reintroduced for
                    // the newest refusals in the table. Generated from the table, so the
                    // eighth role name is covered by writing the row.
                    const props = variant ?? {};
                    for (const prop of propNames(primitive, variant)) {
                        for (const value of propRefusedValues(primitive, prop, variant)) {
                            const answer = propAnswer(primitive, prop, variant);
                            // An accessible record refuses a KEY, so the value that
                            // reaches the route is `{ [key]: … }` rather than the key.
                            const authored = answer.status === 'accessible' ? { [value]: MARKER } : value;
                            const message = rendered(primitive, { ...props, [prop]: authored });
                            expect(message).toBe(explainPropValue(primitive, prop, value, variant));
                            expect(acceptsPropValue(primitive, prop, value, variant)).toBe(false);
                        }
                    }
                });
            }
        }
    });

    await describe('the values an answered prop still refuses (#1555)', async () => {
        await it('names the role spellings GTK has no member for', async () => {
            // A literal list, because this is the vector: the row above them says
            // `property`, and a reader of PROPS.md could not tell WHICH values that
            // covered until the refusals were on the answer. Adding an eighth spelling
            // to the table has to touch this line.
            expect(propRefusedValues('View', 'accessibilityRole')).toStrictEqual([
                'drawerlayout',
                'horizontalscrollview',
                'keyboardkey',
                'pager',
                'scrollview',
                'slidingdrawer',
                'summary',
            ]);
        });

        await it('answers a refused value with the sentence, not with “Known: …”', async () => {
            const message = explainPropValue('View', 'accessibilityRole', 'keyboardkey');
            expect(message).toContain('describes a key of an on-screen keyboard');
            expect(message).toContain('prop "accessibilityRole" = "keyboardkey"');
        });

        await it('accepts every role name that DOES map, value by value', async () => {
            // The whole mapped set and not one sample of it: "the values that map are
            // accepted" is the claim, and a single `button` would be a measurement
            // narrower than it — green while any other row silently answered `false`.
            const route = PRIMITIVES.View.props.accessibilityRole as {
                readonly map?: Readonly<Record<string, unknown>>;
            };
            const mapped = Object.keys(route.map ?? {});
            // Non-vacuous: an empty map would make the loop below assert nothing, and
            // the mapped names outnumber the refused ones by construction.
            expect(mapped.length > propRefusedValues('View', 'accessibilityRole').length).toBe(true);
            for (const value of mapped) {
                expect(acceptsPropValue('View', 'accessibilityRole', value)).toBe(true);
                expect(explainPropValue('View', 'accessibilityRole', value)).toBe(null);
            }
        });

        await it('answers a value of a REFUSED prop with the prop’s own refusal', async () => {
            // The prop-level answer wins: `<Text onPress>` is refused whatever the
            // callback is, and reporting "this value is fine" would be worse than
            // useless.
            expect(explainPropValue('Text', 'onPress', () => {})).toBe(explainProp('Text', 'onPress'));
            expect(acceptsPropValue('Text', 'onPress', () => {})).toBe(false);
        });

        await it('answers a value that is merely ABSENT from the map, with the render\u2019s own sentence', async () => {
            // THE INVERSE OF WHAT THIS FILE USED TO PIN (#1648), and the old pinning is
            // the whole reason the defect shipped: "a value absent from the map is a
            // typo, and this surface is about the values refused ON PURPOSE" reads
            // fine and is false. `pointerEvents="box-none"` is not a typo — it is a
            // real React Native spelling with no `can-target` expression — and the
            // consumer that asked this surface deleted a working mapping of their own
            // because the answer was `null`.
            expect(explainPropValue('View', 'pointerEvents', 'box-none')).toBe(
                rendered('View', { pointerEvents: 'box-none' }),
            );
            expect(acceptsPropValue('View', 'pointerEvents', 'box-none')).toBe(false);
            expect(explainPropValue('View', 'accessibilityRole', 'notarole')).toBe(
                rendered('View', { accessibilityRole: 'notarole' }),
            );
            // Non-vacuous: an equality between two `null`s would pass on the defect.
            expect(rendered('View', { pointerEvents: 'box-none' })).toContain('Known: auto, none');
        });

        await it('publishes the ALLOW-list beside the deny-list, because they are two facts', async () => {
            expect(propAllowedValues('View', 'pointerEvents')).toStrictEqual(['auto', 'none']);
            // A prop with no enumerable vocabulary says so, rather than claiming an
            // empty one — "takes nothing" and "takes anything of the right type" are
            // opposite answers and a reader acts on them differently.
            expect(propAllowedValues('View', 'testID')).toBe(null);
            expect(propAllowedValues('ActivityIndicator', 'size')).toStrictEqual(['large', 'small']);
            // ...and the pixel half is still accepted, which no list can say.
            expect(acceptsPropValue('ActivityIndicator', 'size', 24)).toBe(true);
            expect(acceptsPropValue('ActivityIndicator', 'size', 'medium')).toBe(false);
        });
    });

    await describe('the oracle can see every grain the table refuses at (#1648)', async () => {
        // WHY A CENSUS AND NOT THREE VECTORS. The defect was reported as one prop and
        // it was one GRAIN: `refuses` enumerates what is forbidden, a map enumerates
        // what is allowed, and the answer read only the first. Three route shapes do
        // the second, so a fix aimed at `pointerEvents` would have left two of them
        // blind. `OUTSIDE` names every shape the table can hold and what it takes to
        // probe one, so the next shape is a compile error rather than a report.

        await it('classifies every route shape the table actually uses', async () => {
            const seen = [...new Set(everyRoute().map(({ route }) => shapeOf(route)))].sort();
            // Non-vacuous in the direction that matters: all four shapes that DO
            // enumerate a vocabulary are present in the real table, so the sweep
            // below has something to sweep.
            for (const shape of ['property:map', 'property:pixels-or-map', 'announce', 'accessible:members'] as const) {
                expect(seen.includes(shape)).toBe(true);
            }
            // Every shape in use has a decision here. `OUTSIDE`'s type makes a MISSING
            // key a compile error; this makes a key nobody uses visible as one.
            for (const shape of seen) expect(shape in OUTSIDE).toBe(true);
        });

        await it('agrees with the classifier about WHICH shapes enumerate a vocabulary', async () => {
            // Two independently written statements about the same fact: `OUTSIDE` is
            // this file's, `routeValueVocabulary` is the implementation's. A route
            // shape added to one and not the other fails here, which is the whole
            // point of writing it twice.
            const disagreements: string[] = [];
            for (const { primitive, prop, route } of everyRoute()) {
                const enumerated = routeValueVocabulary(route) !== null;
                const probed = OUTSIDE[shapeOf(route)] !== null;
                if (enumerated !== probed) disagreements.push(`${primitive}.${prop} (${shapeOf(route)})`);
            }
            expect(disagreements).toStrictEqual([]);
        });

        await it('refuses a value outside the vocabulary with EXACTLY what the render throws', async () => {
            // The sweep, generated from the table: every route whose shape enumerates
            // its values is probed with a spelling of the right kind that no map can
            // contain, and the static answer must be the render's own string. On the
            // state this test was written against it failed for `pointerEvents`,
            // `accessibilityRole`, `accessibilityLiveRegion`, `horizontal`, `size`
            // and `accessibilityState` — six props across all four shapes, from one
            // reported prop.
            let probed = 0;
            for (const { primitive, variant, prop, route } of everyRoute()) {
                const outside = OUTSIDE[shapeOf(route)];
                if (outside === null) continue;
                // A value the table refuses BY NAME has its own sentence and is swept
                // above; this is about the ones refused by omission.
                if (propRefusedValues(primitive, prop, variant).includes(outside)) continue;
                const authored = route.to === 'accessible' ? { [outside]: MARKER } : outside;
                const message = rendered(primitive, { ...variant, [prop]: authored });
                expect(message).toBe(explainPropValue(primitive, prop, outside, variant));
                // Non-vacuous: `null === null` would pass on exactly the defect.
                expect(typeof message).toBe('string');
                probed++;
            }
            expect(probed > 20).toBe(true);
        });

        await it('accepts every value the vocabulary DOES hold, on every such route', async () => {
            // The other arm, and the one that keeps the fix from being "refuse
            // everything": a gate that is red on correct behaviour gets switched off.
            for (const { primitive, variant, prop, route } of everyRoute()) {
                if (OUTSIDE[shapeOf(route)] === null) continue;
                const refused = propRefusedValues(primitive, prop, variant);
                for (const value of propAllowedValues(primitive, prop, variant) ?? []) {
                    if (refused.includes(value)) continue;
                    expect(explainPropValue(primitive, prop, value, variant)).toBe(null);
                }
            }
        });
    });

    await describe('the surface as data', async () => {
        await it('covers every primitive the table declares', async () => {
            expect([...PRIMITIVE_NAMES].sort()).toStrictEqual(Object.keys(PRIMITIVES).sort());
        });

        await it('gives every row a status, and the refusals a reason', async () => {
            const rows = propTable();
            expect(rows.length > 100).toBe(true);
            for (const row of rows) {
                expect(typeof row.status).toBe('string');
                if (row.status === 'refused' || row.status === 'unknown') expect(row.why.length > 0).toBe(true);
            }
        });

        await it('carries a row for every prop the resolver skips by NAME', async () => {
            // THE ONE WAY THE TWO CAN STILL DIVERGE, and it is the drift the sweep above
            // cannot see. `resolvePrimitive` skips a content or backdrop node's own style
            // props (`contentContainerStyle`, `imageStyle`, …) BEFORE it looks a route up,
            // so a render accepts them whether or not the table names them —
            // `answers.ts` has no such list and would call an unnamed one `unknown`, i.e.
            // publish a refusal for a prop that renders. Every one of them is a declared
            // `ignored` row today; a content node added tomorrow without one fails here
            // instead of shipping a table that refuses working code.
            const skipped: string[] = [];
            for (const [name, base] of Object.entries(PRIMITIVES)) {
                const branch = base.switchOn;
                const cases: (readonly [PropVariant | undefined, PrimitiveSpec])[] = [[undefined, base]];
                if (branch !== undefined) cases.push([{ [branch.prop]: true }, branch.whenTrue]);
                for (const [variant, spec] of cases) {
                    for (const prop of [
                        spec.content?.styleProp,
                        spec.content?.classNameProp,
                        spec.backdrop?.styleProp,
                        spec.backdrop?.classNameProp,
                    ]) {
                        if (typeof prop !== 'string') continue;
                        if (!propNames(name, variant).includes(prop)) skipped.push(`${name}.${prop}`);
                    }
                }
            }
            expect(skipped).toStrictEqual([]);
        });
    });
};
