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
import { PRIMITIVES } from './primitives/table.js';
import {
    PRIMITIVE_NAMES,
    PRIMITIVE_VARIANTS,
    acceptsProp,
    explainProp,
    propAnswer,
    propNames,
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
            }
        }
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
    });
};
