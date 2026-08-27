// `StyleSheet`, and the claim that makes `create` allowed to be identity.
//
// ADR 0032 § 4 says a style object is the SAME normalised property set as a class list
// arriving by a different route, and `create` must feed the ONE partition that already
// exists. That is not a promise a vector can read off `create` — it returns its
// argument — so the vector that matters here runs `StyleSheet.absoluteFill` through
// `resolvePrimitive` and asserts it lands where the equivalent CLASS LIST lands. If
// `create` had grown a second front end, those two would stop agreeing.
//
// `hairlineWidth` is NOT here: it reads `Gdk.Display`, so its vector lives in
// `primitives/widgets.spec.ts` where a display is the gate's declared precondition.
// This file is the pure-data half, and it imports GTK only for the types the partition
// speaks.

import { describe, expect, it } from '@gjsify/unit';
import { MINIMAL_TOKENS, type StyleTokens } from '@gjsify/gtk-host/style';

import { PrimitiveError } from './primitives/errors.js';
import { resolvePrimitive, type ChildContext } from './primitives/resolve.js';
import type { ClassNameSink } from './primitives/style.js';
import { StyleSheet, absoluteFillObject } from './stylesheet.js';

const TOKENS: StyleTokens = { ...MINIMAL_TOKENS, spacing: { ...MINIMAL_TOKENS.spacing, '2': '8px' } };

class RecordingSink implements ClassNameSink {
    readonly calls: readonly string[][] = [];
    classFor(declarations: readonly string[]): string {
        (this.calls as string[][]).push([...declarations]);
        return `c${this.calls.length}`;
    }
}

/** A parent that IS a `Gtk.Overlay`, which is what an absolutely positioned child needs. */
const OVERLAY_PARENT: ChildContext = { orientation: 'vertical', props: {}, overlay: true };

const resolve = (props: Readonly<Record<string, unknown>>) =>
    resolvePrimitive('View', props, { tokens: TOKENS, sheet: new RecordingSink(), parent: OVERLAY_PARENT });

const threw = (fn: () => unknown): PrimitiveError => {
    try {
        fn();
    } catch (error) {
        if (error instanceof PrimitiveError) return error;
        throw error;
    }
    throw new Error('expected a PrimitiveError, nothing was thrown');
};

export default async () => {
    await describe('StyleSheet.create', async () => {
        await it('hands the style set straight back, which is what React Native’s own does', async () => {
            // It once registered each style and returned NUMERIC IDS; since those were
            // removed it returns the object. There is nothing here to register with, and
            // ADR 0032 § 4 forbids the alternative: validating here would be a SECOND
            // partition beside the one every class list already goes through.
            const styles = { row: { flexDirection: 'row' as const }, pad: { paddingTop: 8 } };
            expect(StyleSheet.create(styles)).toBe(styles);
        });

        await it('does NOT freeze the caller’s object', async () => {
            // React Native freezes in development. Freezing here would mutate an
            // application's own record — a package quietly making a consumer's data
            // immutable is a side effect, not a safety feature.
            const styles = StyleSheet.create({ a: { paddingTop: 1 } });
            expect(Object.isFrozen(styles)).toBe(false);
        });
    });

    await describe('StyleSheet.flatten and compose', async () => {
        await it('flattens an array with LATER entries winning', async () => {
            expect(StyleSheet.flatten([{ paddingTop: 1 }, { paddingTop: 2 }])).toStrictEqual({ paddingTop: 2 });
        });

        await it('drops what a short-circuit leaves behind', async () => {
            // `style={[base, active && overlay]}` is ordinary authoring, and `false` is
            // what the second half becomes when the condition is not met.
            expect(StyleSheet.flatten([{ paddingTop: 1 }, false, null, undefined])).toStrictEqual({ paddingTop: 1 });
            expect(StyleSheet.flatten(null)).toStrictEqual({});
        });

        await it('flattens nested arrays, because a style prop nests', async () => {
            expect(StyleSheet.flatten([[{ paddingTop: 1 }], [[{ paddingBottom: 2 }]]])).toStrictEqual({
                paddingTop: 1,
                paddingBottom: 2,
            });
        });

        await it('composes into an ARRAY, which is what React Native returns', async () => {
            const a = { paddingTop: 1 };
            const b = { paddingTop: 2 };
            expect(StyleSheet.compose(a, b)).toStrictEqual([a, b]);
            // A missing half is returned unchanged rather than wrapped: code downstream
            // compares identities, and `[a]` is not `a`.
            expect(StyleSheet.compose(a, null)).toBe(a);
            expect(StyleSheet.compose(null, b)).toBe(b);
            expect(StyleSheet.flatten(StyleSheet.compose(a, b))).toStrictEqual({ paddingTop: 2 });
        });
    });

    await describe('StyleSheet.absoluteFill', async () => {
        await it('is React Native’s own object, and the two names are one value', async () => {
            expect(StyleSheet.absoluteFill).toBe(absoluteFillObject);
            expect(StyleSheet.absoluteFillObject).toBe(absoluteFillObject);
            expect(absoluteFillObject).toStrictEqual({
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
            });
        });

        await it('resolves through the SAME partition as the class list that means the same thing', async () => {
            // ADR 0032 § 4, as a measurement. `style={StyleSheet.absoluteFill}` and
            // `className="absolute inset-0"` are the same information by two routes, and
            // the widget properties they produce have to be identical — a second front
            // end would show up here first.
            const fromStyle = resolve({ style: StyleSheet.absoluteFill });
            const fromClasses = resolve({ className: 'absolute inset-0' });
            expect(fromStyle.node.props).toStrictEqual(fromClasses.node.props);
            // Both fill both axes, which is the one inset a `Gtk.Overlay` child can
            // express without a coordinate pair.
            expect(fromStyle.node.props.halign).toBe('fill');
            expect(fromStyle.node.props.valign).toBe('fill');
            expect(fromStyle.slot).toBe('overlay');
            expect(fromStyle.intent).toStrictEqual({});
        });

        await it('is still refused when the parent is not an overlay', async () => {
            // The value is not magic: it carries the same overlay intent a class does,
            // and a parent that cannot host it is the same named refusal.
            const error = threw(() =>
                resolvePrimitive(
                    'View',
                    { style: StyleSheet.absoluteFill },
                    {
                        tokens: TOKENS,
                        sheet: new RecordingSink(),
                        parent: { orientation: 'vertical', props: {}, overlay: false },
                    },
                ),
            );
            expect(error.message).toContain('Gtk.Overlay');
        });
    });

    await describe('what StyleSheet refuses', async () => {
        await it('refuses a process-wide style preprocessor, naming the scoped hook', async () => {
            expect(threw(() => StyleSheet.setStyleAttributePreprocessor()).message).toContain('configureStyle');
        });
    });
};
