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

import { PrimitiveError } from './primitives/errors.js';
import { resolvePrimitive } from './primitives/resolve.js';
import type { ClassNameSink } from './primitives/style.js';
import { PRIMITIVES, type PrimitiveSpec } from './primitives/table.js';
import {
    PRIMITIVE_NAMES,
    PRIMITIVE_VARIANTS,
    acceptsProp,
    acceptsPropValue,
    explainProp,
    explainPropValue,
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
        await it('names the seven role spellings GTK has no member for', async () => {
            // SEVEN of React Native's forty, and the row above them says `property`. A
            // reader of PROPS.md could not tell which until the refusals were on the
            // answer; this is the assertion that they are.
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

        await it('accepts the 33 role names that DO map, value by value', async () => {
            expect(acceptsPropValue('View', 'accessibilityRole', 'button')).toBe(true);
            expect(explainPropValue('View', 'accessibilityRole', 'button')).toBe(null);
        });

        await it('answers a value of a REFUSED prop with the prop’s own refusal', async () => {
            // The prop-level answer wins: `<Text onPress>` is refused whatever the
            // callback is, and reporting "this value is fine" would be worse than
            // useless.
            expect(explainPropValue('Text', 'onPress', () => {})).toBe(explainProp('Text', 'onPress'));
            expect(acceptsPropValue('Text', 'onPress', () => {})).toBe(false);
        });

        await it('says nothing about a value that is merely absent from the map', async () => {
            // A typo is not a declared refusal, and this surface is about the values the
            // table refuses ON PURPOSE. The render still throws — with the "Known: …"
            // message it builds from the map at the throw.
            expect(explainPropValue('View', 'accessibilityRole', 'notarole')).toBe(null);
            expect(rendered('View', { accessibilityRole: 'notarole' })).toContain('Known:');
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
