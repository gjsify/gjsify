// L2 — pure TypeScript, so it runs without a display, a widget or a reconciler.
//
// That is the point of the seam ADR 0032 § 1 draws: the primitive vocabulary's
// decisions are DATA, and data is assertable by comparison rather than by looking at
// a window. What needs a real GTK is the claim that every tag, property and signal
// this table names actually exists — `widgets.spec.ts`, which asks the installed
// GTK — and the claim that the tree renders, which is the same file.
//
// The sink is a fake, and it has to be: `StyleSheet` constructs a `Gtk.CssProvider`
// and installs it on a `Gdk.Display`, so a spec that wanted to assert which class a
// `<View className="p-2">` gets would need a session to check a pure-data decision.
// `RecordingSink` also records what it was HANDED, which is the only way to assert
// the declarations rather than the opaque name they hash to.

import { describe, expect, it } from '@gjsify/unit';
import { MINIMAL_TOKENS, type StyleTokens, UnknownUtilityError } from '@gjsify/gtk-host/style';

import { PrimitiveError } from './errors.js';
import { declaresAbsolute, resolvePrimitive, type ChildContext, type PrimitivePlan } from './resolve.js';
import type { ClassNameSink } from './style.js';
import { PRIMITIVES, PRIMITIVE_NAMES } from './table.js';
import { SUPPORT_TABLE } from '../support-table.js';

const TOKENS: StyleTokens = {
    ...MINIMAL_TOKENS,
    spacing: { ...MINIMAL_TOKENS.spacing, '1': '4px', '2': '8px', '3': '12px', '4': '16px', '2xs': '2px' },
    colors: { ...MINIMAL_TOKENS.colors, emphasis: 'rgb(var(--color-emphasis))' },
};

class RecordingSink implements ClassNameSink {
    readonly calls: { declarations: readonly string[]; variants: Readonly<Record<string, readonly string[]>> }[] = [];
    classFor(declarations: readonly string[], variants: Readonly<Record<string, readonly string[]>> = {}): string {
        this.calls.push({ declarations, variants });
        return `c${this.calls.length}`;
    }
    /** The declarations of the LAST mint, which is the element's own. */
    get last(): readonly string[] {
        return this.calls[this.calls.length - 1]?.declarations ?? [];
    }
}

const parentOf = (orientation: 'horizontal' | 'vertical', extra: Partial<ChildContext> = {}): ChildContext => ({
    orientation,
    props: {},
    overlay: false,
    ...extra,
});

interface PlanArgs {
    readonly parent?: ChildContext;
    readonly children?: { absolute: number; count: number; text: boolean };
}

const plan = (
    primitive: string,
    props: Readonly<Record<string, unknown>>,
    args: PlanArgs = {},
): { readonly plan: PrimitivePlan; readonly sink: RecordingSink } => {
    const sink = new RecordingSink();
    return { plan: resolvePrimitive(primitive, props, { tokens: TOKENS, sheet: sink, ...args }), sink };
};

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
    await describe('the two inverted defaults', async () => {
        await it('makes a View a VERTICAL box', async () => {
            // The single most consequential line in the table. React Native's `View`
            // is a column and `Gtk.Box` defaults to horizontal, so every layout in a
            // ported application is wrong in the same way if this is absent — and
            // wrong silently: the widgets are all there, in a row.
            const { plan: p } = plan('View', {});
            expect(p.node.tag).toBe('GtkBox');
            expect(p.node.props.orientation).toBe('vertical');
        });

        await it('lets flex-row override it', async () => {
            expect(plan('View', { className: 'flex-row' }).plan.node.props.orientation).toBe('horizontal');
        });

        await it('makes a Text label WRAP', async () => {
            const { plan: p } = plan('Text', {});
            expect(p.node.tag).toBe('GtkLabel');
            expect(p.node.props.wrap).toBe(true);
            expect(p.textSink).toBe('label');
        });
    });

    await describe('one normalised property set (ADR 0032 § 4)', async () => {
        await it('lets style win over className, as CSS does for an inline style', async () => {
            const { plan: p } = plan('View', { className: 'mt-2', style: { marginTop: 0 } });
            expect(p.node.props['margin-top']).toBe(0);
        });

        await it('flattens a style array with later entries winning', async () => {
            const { plan: p } = plan('View', { style: [{ marginTop: 4 }, false, [{ marginTop: 16 }]] });
            expect(p.node.props['margin-top']).toBe(16);
        });

        await it('reads a React Native number as a pixel length', async () => {
            expect(plan('View', { style: { marginTop: 8 } }).plan.node.props['margin-top']).toBe(8);
        });

        await it('leaves the UNITLESS numbers alone, so flexGrow is not "1px"', async () => {
            // `flexGrow: 1` became `"1px"` and came back as L1's "there is no growth
            // factor" — a refusal of a spelling nobody wrote.
            expect(
                plan('View', { style: { flexGrow: 1 } }, { parent: parentOf('vertical') }).plan.node.props.vexpand,
            ).toBe(true);
            const { sink } = plan('View', { style: { opacity: 0.5 } });
            expect(sink.last).toStrictEqual(['opacity: 0.5']);
        });

        await it('keeps GTK’s own orientation class when it writes css-classes', async () => {
            // MEASURED: a `Gtk.Box` carries its orientation as a class with nothing authored —
            // `Gtk.Orientable` adds it — and `css-classes` is a whole-list property,
            // so writing the generated name alone REPLACED it. Adwaita selects on
            // those classes, so the loss is a paint change with nothing to attribute
            // it to. ADR 0032 § 5's union rule, where the other author is GTK.
            expect(plan('View', { className: 'p-2' }).plan.node.cssClasses).toStrictEqual(['vertical', 'c1']);
            expect(plan('View', { className: 'flex-row p-2' }).plan.node.cssClasses).toStrictEqual([
                'horizontal',
                'c1',
            ]);
            // Nothing to write means the property is never touched, so GTK's list
            // survives on its own and prepending would be a spurious write.
            expect(plan('View', {}).plan.node.cssClasses).toStrictEqual([]);
        });

        await it('sends the paint half to ONE generated class', async () => {
            const { plan: p, sink } = plan('View', { className: 'p-2 bg-emphasis' });
            expect(p.node.cssClasses).toStrictEqual(['vertical', 'c1']);
            expect(sink.last).toContain('background-color: rgb(var(--color-emphasis))');
            expect(sink.last).toContain('padding-top: 8px');
        });

        await it('mints NO class when nothing paints', async () => {
            expect(plan('View', { className: 'mt-2' }).plan.node.cssClasses).toStrictEqual([]);
        });

        await it('lets an unknown utility raise L1’s own error, unwrapped', async () => {
            // Deliberately NOT re-thrown as a `PrimitiveError`: the message already
            // names the utility and lists what the scale holds, and wrapping would
            // hide the class from a caller's `catch`.
            let caught: unknown = null;
            try {
                plan('View', { className: 'wibble-3' });
            } catch (error) {
                caught = error;
            }
            expect(caught instanceof UnknownUtilityError).toBe(true);
        });
    });

    await describe('variants', async () => {
        await it('hands base and variant declarations to ONE class name', async () => {
            const { plan: p, sink } = plan('Pressable', { className: 'opacity-100 active:opacity-70' });
            expect(p.node.cssClasses).toHaveLength(2); // `flat`, plus the generated one
            expect(sink.calls[0].declarations).toStrictEqual(['opacity: 1']);
            expect(sink.calls[0].variants.active).toStrictEqual(['opacity: 0.7']);
        });

        await it('refuses a variant on a WIDGET PROPERTY, because GTK has no pseudo-class form', async () => {
            const error = threw(() => plan('View', { className: 'active:flex-row' }));
            expect(error.message).toContain('GTK WIDGET PROPERTY');
            expect(error.message).toContain('orientation');
        });

        await it('refuses a variant on a layout INTENT for the same reason', async () => {
            expect(threw(() => plan('View', { className: 'active:flex-1' })).message).toContain('layout INTENT');
        });
    });

    await describe('the intents L2 resolves (ADR 0032 § 6)', async () => {
        await it('turns items-* into a property on every CHILD, on the cross axis', async () => {
            expect(plan('View', { className: 'items-center' }).plan.childContext.props).toStrictEqual({
                halign: 'center',
            });
            expect(plan('View', { className: 'flex-row items-center' }).plan.childContext.props).toStrictEqual({
                valign: 'center',
            });
        });

        await it('maps stretch onto GtkAlign FILL rather than inventing a fifth value', async () => {
            expect(plan('View', { className: 'items-stretch' }).plan.childContext.props).toStrictEqual({
                halign: 'fill',
            });
        });

        await it('turns the three alignable justify values into the box’s own main-axis align', async () => {
            expect(plan('View', { className: 'justify-center' }).plan.node.props.valign).toBe('center');
            expect(plan('View', { className: 'flex-row justify-end' }).plan.node.props.halign).toBe('end');
        });

        await it('refuses justify-between with the CenterBox measurement', async () => {
            const error = threw(() => plan('View', { className: 'justify-between' }));
            expect(error.message).toContain('Gtk.CenterBox');
            expect(error.message).toContain('NO `remove` method');
        });

        await it('makes an axis gap the box’s spacing when the axis matches', async () => {
            expect(plan('View', { className: 'flex-row gap-x-2' }).plan.node.props.spacing).toBe(8);
        });

        await it('makes a CROSS-axis gap a declared no-op, exactly as CSS does', async () => {
            // A `Gtk.Box` is a single line, so a cross-axis gap has nothing between
            // anything. Declared rather than refused, because `gap-x-2` written
            // beside a `flex-row` that a breakpoint later turns into a column is
            // ordinary authoring.
            expect(plan('View', { className: 'gap-x-2' }).plan.node.props.spacing).toBeUndefined();
        });

        await it('aligns text on a widget that CAN, and hands it down from one that cannot', async () => {
            const label = plan('Text', { className: 'text-center' }).plan;
            expect(label.node.props.xalign).toBe(0.5);
            // BOTH, and that is the point: `xalign` positions a line inside the
            // allocation, `justify` positions the lines relative to each other, so a
            // single-line label ignores one and a wrapped one looks unaligned
            // without the other.
            expect(label.node.props.justify).toBe('center');

            const box = plan('View', { className: 'text-center' }).plan;
            expect(box.node.props.xalign).toBeUndefined();
            expect(box.childContext.textAlign).toBe('center');
        });

        await it('lets a Text inherit the textAlign its ancestor could not use', async () => {
            const p = plan('Text', {}, { parent: parentOf('vertical', { textAlign: 'right' }) }).plan;
            expect(p.node.props.xalign).toBe(1);
            expect(p.childContext.textAlign).toBeUndefined();
        });

        await it('refuses items-* on a primitive with no children to align', async () => {
            expect(threw(() => plan('Text', { className: 'items-center' })).message).toContain('not a box');
        });
    });

    await describe('the intents L2 passes up', async () => {
        await it('keeps flex-1 unresolved without a parent, rather than guessing an axis', async () => {
            // Guessing wrong makes a full-width element full-height, and the window
            // looks plausible either way.
            const p = plan('View', { className: 'flex-1' }).plan;
            expect(p.intent.expand).toBe('main-axis');
            expect(p.node.props.hexpand).toBeUndefined();
            expect(p.node.props.vexpand).toBeUndefined();
        });

        await it('resolves flex-1 against the PARENT’s orientation once it has one', async () => {
            expect(
                plan('View', { className: 'flex-1' }, { parent: parentOf('horizontal') }).plan.node.props.hexpand,
            ).toBe(true);
            expect(
                plan('View', { className: 'flex-1' }, { parent: parentOf('vertical') }).plan.node.props.vexpand,
            ).toBe(true);
        });

        await it('resolves self-* on the parent’s CROSS axis', async () => {
            expect(
                plan('View', { className: 'self-end' }, { parent: parentOf('horizontal') }).plan.node.props.valign,
            ).toBe('end');
            expect(
                plan('View', { className: 'self-end' }, { parent: parentOf('vertical') }).plan.node.props.halign,
            ).toBe('end');
        });
    });

    await describe('absolute positioning, which the CHILD triggers', async () => {
        await it('reports what a style declares, for the parent to read', async () => {
            expect(declaresAbsolute({ className: 'absolute' }, TOKENS)).toBe(true);
            expect(declaresAbsolute({ style: { position: 'absolute' } }, TOKENS)).toBe(true);
            expect(declaresAbsolute({ className: 'mt-2' }, TOKENS)).toBe(false);
        });

        await it('makes the PARENT a Gtk.Overlay, with the box moved inside it', async () => {
            const p = plan('View', { className: 'p-2' }, { children: { absolute: 1, count: 2, text: false } }).plan;
            expect(p.node.tag).toBe('GtkOverlay');
            expect(p.content?.tag).toBe('GtkBox');
            expect(p.absoluteSlot).toBe('overlay');
            // Only the two properties a `Gtk.Overlay` does not install move inside;
            // the padding and the class stay on the outer node, which is what keeps
            // an overlay child positioned against the PADDING box.
            expect(p.content?.props.orientation).toBe('vertical');
            expect(p.node.props.orientation).toBeUndefined();
            expect(p.node.cssClasses).toStrictEqual(['c1']);
        });

        await it('stays a box when no child is absolute', async () => {
            const p = plan('View', {}, { children: { absolute: 0, count: 3, text: false } }).plan;
            expect(p.node.tag).toBe('GtkBox');
            expect(p.content).toBeNull();
            expect(p.absoluteSlot).toBeNull();
        });

        await it('turns edge offsets into an alignment plus a margin, per axis', async () => {
            const { plan: p, sink } = plan(
                'View',
                { className: 'absolute top-2 left-1' },
                { parent: parentOf('vertical', { overlay: true }) },
            );
            expect(p.slot).toBe('overlay');
            expect(p.node.props.valign).toBe('start');
            expect(p.node.props['margin-top']).toBe(8);
            expect(p.node.props.halign).toBe('start');
            // The horizontal margin goes through CSS and the vertical through a
            // widget property — L1's measured split repeated verbatim, because GTK
            // CSS has `margin-left` and no `margin-start` while `Gtk.Widget` has
            // `margin-start` and no `margin-left`.
            expect(sink.last).toContain('margin-left: 4px');
        });

        await it('makes both edges of an axis the FILL case', async () => {
            const p = plan(
                'View',
                { className: 'absolute inset-0' },
                { parent: parentOf('vertical', { overlay: true }) },
            ).plan;
            expect(p.node.props.valign).toBe('fill');
            expect(p.node.props.halign).toBe('fill');
        });

        await it('refuses an absolute element whose parent is not an overlay', async () => {
            const error = threw(() =>
                plan('View', { className: 'absolute' }, { parent: parentOf('vertical', { overlay: false }) }),
            );
            expect(error.message).toContain('`Gtk.Overlay`');
        });

        await it('refuses a physical offset beside a LOGICAL margin, because GTK ADDS them', async () => {
            const error = threw(() =>
                plan(
                    'View',
                    { className: 'absolute left-1 ms-2' },
                    { parent: parentOf('vertical', { overlay: true }) },
                ),
            );
            expect(error.message).toContain('they ADD');
        });

        await it('honours an explicit relative by being redundant, not by refusing', async () => {
            // React Native's `View` IS `position: relative` by default, which is why
            // `absolute` children work under a plain `<View>` in the measured
            // application with no `relative` anywhere.
            const p = plan('View', { className: 'relative' }).plan;
            expect(p.node.props).toStrictEqual({ orientation: 'vertical' });
            expect(p.intent.overlay).toBeUndefined();
        });
    });

    await describe('Text', async () => {
        await it('gives numberOfLines the two companions the value needs', async () => {
            // `lines` alone does nothing: `Gtk.Label` honours it only while the label
            // BOTH wraps and ellipsizes.
            const p = plan('Text', { numberOfLines: 2 }).plan;
            expect(p.node.props.lines).toBe(2);
            expect(p.node.props.ellipsize).toBe('end');
            expect(p.node.props.wrap).toBe(true);
        });

        await it('refuses ellipsizeMode="clip", naming the modes Pango has', async () => {
            const error = threw(() => plan('Text', { ellipsizeMode: 'clip' }));
            expect(error.message).toContain('head, middle, tail');
        });

        await it('sends onPress to Pressable instead of binding a signal a label has not got', async () => {
            expect(threw(() => plan('Text', { onPress: () => {} })).message).toContain('<Pressable>');
        });

        await it('contributes nothing for a declared no-op', async () => {
            const p = plan('Text', { allowFontScaling: true, maxFontSizeMultiplier: 2 }).plan;
            expect(p.node.props).toStrictEqual({ wrap: true });
        });
    });

    await describe('Pressable', async () => {
        await it('is a FLAT button', async () => {
            const p = plan('Pressable', {}).plan;
            expect(p.node.tag).toBe('GtkButton');
            expect(p.node.cssClasses).toStrictEqual(['flat']);
            expect(p.textSink).toBe('label');
        });

        await it('binds onPress to clicked, with no argument to read', async () => {
            expect(plan('Pressable', { onPress: () => {} }).plan.events).toStrictEqual([
                { prop: 'onPress', signal: 'clicked', read: null },
            ]);
        });

        await it('inverts disabled into sensitive', async () => {
            expect(plan('Pressable', { disabled: true }).plan.node.props.sensitive).toBe(false);
        });

        await it('refuses onPressIn, naming the mechanism that replaces it', async () => {
            expect(threw(() => plan('Pressable', { onPressIn: () => {} })).message).toContain('`:active`');
        });

        await it('refuses a callback that is not a function', async () => {
            expect(threw(() => plan('Pressable', { onPress: 'nope' })).message).toContain('needs a function');
        });
    });

    await describe('ScrollView, and its second styleable node', async () => {
        await it('is a scrolled window with an implicit content box', async () => {
            const p = plan('ScrollView', {}).plan;
            expect(p.node.tag).toBe('GtkScrolledWindow');
            expect(p.content?.tag).toBe('GtkBox');
            expect(p.content?.props.orientation).toBe('vertical');
            // The unused axis is pinned to `never` so a vertical scroller is as WIDE
            // as its content: a `Gtk.ScrolledWindow` that scrolls both ways
            // propagates no natural size on either.
            expect(p.node.props['hscrollbar-policy']).toBe('never');
        });

        await it('turns horizontal into one content orientation and two policies', async () => {
            const p = plan('ScrollView', { horizontal: true }).plan;
            expect(p.content?.props.orientation).toBe('horizontal');
            expect(p.node.props['hscrollbar-policy']).toBe('automatic');
            expect(p.node.props['vscrollbar-policy']).toBe('never');
        });

        await it('hides a scrollbar with EXTERNAL, which keeps the scrolling', async () => {
            expect(
                plan('ScrollView', { showsVerticalScrollIndicator: false }).plan.node.props['vscrollbar-policy'],
            ).toBe('external');
        });

        await it('styles the content node from its own two props', async () => {
            const { plan: p, sink } = plan('ScrollView', {
                className: 'bg-emphasis',
                contentContainerClassName: 'p-2 items-center',
            });
            expect(p.node.cssClasses).toHaveLength(1);
            // `c2`: the OUTER node mints first, so the content's is the second call —
            // which is also the assertion that the two nodes get two classes rather
            // than sharing one.
            expect(p.content?.cssClasses).toStrictEqual(['vertical', 'c2']);
            expect(sink.last).toContain('padding-top: 8px');
            // The content box is what has children, so it is the content's intent
            // that reaches them.
            expect(p.childContext.props).toStrictEqual({ halign: 'center' });
        });

        await it('resolves flexGrow on the content against the SCROLL axis', async () => {
            // React Native's own idiom for "the content is at least as tall as the
            // viewport". Without a parent context for the content node it would pass
            // up unresolved and do nothing.
            expect(plan('ScrollView', { contentContainerStyle: { flexGrow: 1 } }).plan.content?.props.vexpand).toBe(
                true,
            );
            expect(
                plan('ScrollView', { horizontal: true, contentContainerStyle: { flexGrow: 1 } }).plan.content?.props
                    .hexpand,
            ).toBe(true);
        });

        await it('refuses a box utility on style, where React Native refuses it too', async () => {
            expect(threw(() => plan('ScrollView', { className: 'items-center' })).message).toContain('not a box');
        });

        await it('refuses onScroll, naming the adjustment that carries it', async () => {
            expect(threw(() => plan('ScrollView', { onScroll: () => {} })).message).toContain('Gtk.Adjustment');
        });
    });

    await describe('ActivityIndicator', async () => {
        await it('is an Adw.Spinner', async () => {
            expect(plan('ActivityIndicator', {}).plan.node.tag).toBe('AdwSpinner');
        });

        await it('hides the widget for animating={false}, because nothing stops the spin', async () => {
            // MEASURED: `Adw.Spinner` installs 36 properties and every one is
            // `Gtk.Widget`'s — there is no `spinning`.
            expect(plan('ActivityIndicator', { animating: false }).plan.node.props.visible).toBe(false);
        });

        await it('sizes from GTK’s own two steps, or from a number verbatim', async () => {
            const small = plan('ActivityIndicator', { size: 'small' }).plan.node.props;
            expect(small['width-request']).toBe(16);
            expect(small['height-request']).toBe(16);
            expect(plan('ActivityIndicator', { size: 24 }).plan.node.props['width-request']).toBe(24);
        });

        await it('refuses a size GTK has no step for, listing the ones it has', async () => {
            expect(threw(() => plan('ActivityIndicator', { size: 'huge' })).message).toContain('large, small');
        });

        await it('sends color through the paint partition, not straight to a property', async () => {
            const { plan: p, sink } = plan('ActivityIndicator', { color: 'rgb(1 2 3)' });
            expect(sink.last).toStrictEqual(['color: rgb(1 2 3)']);
            expect(p.node.props.color).toBeUndefined();
        });
    });

    await describe('TextInput — one prop, two widgets', async () => {
        await it('is a Gtk.Entry without multiline', async () => {
            const p = plan('TextInput', { value: 'a', placeholder: 'b', maxLength: 5 }).plan;
            expect(p.node.tag).toBe('GtkEntry');
            expect(p.node.props.text).toBe('a');
            expect(p.node.props['placeholder-text']).toBe('b');
            expect(p.node.props['max-length']).toBe(5);
        });

        await it('is a Gtk.TextView with it, and wraps by default', async () => {
            const p = plan('TextInput', { multiline: true }).plan;
            expect(p.node.tag).toBe('GtkTextView');
            expect(p.node.props['wrap-mode']).toBe('word-char');
            expect(p.textSink).toBeNull();
        });

        await it('refuses value on a multiline input, naming the buffer', async () => {
            expect(threw(() => plan('TextInput', { multiline: true, value: 'a' })).message).toContain('Gtk.TextBuffer');
            expect(threw(() => plan('TextInput', { multiline: true, placeholder: 'a' })).message).toContain(
                'placeholder-text',
            );
        });

        await it('inverts secureTextEntry into visibility', async () => {
            expect(plan('TextInput', { secureTextEntry: true }).plan.node.props.visibility).toBe(false);
        });

        await it('maps keyboardType onto input-purpose', async () => {
            expect(plan('TextInput', { keyboardType: 'email-address' }).plan.node.props['input-purpose']).toBe('email');
            expect(plan('TextInput', { multiline: true, keyboardType: 'url' }).plan.node.props['input-purpose']).toBe(
                'url',
            );
        });

        await it('names the property to read for onChangeText', async () => {
            // `notify::text`, not `Gtk.Editable::changed` — MEASURED, one
            // programmatic write over existing text emits `changed` twice
            // (`["", "abc"]`, a delete followed by an insert) and `notify::text` once.
            expect(plan('TextInput', { onChangeText: () => {} }).plan.events).toStrictEqual([
                { prop: 'onChangeText', signal: 'notify::text', read: 'text' },
            ]);
        });

        await it('refuses a prop and a text child writing the same slot', async () => {
            const error = threw(() =>
                plan('TextInput', { value: 'a' }, { children: { absolute: 0, count: 1, text: true } }),
            );
            expect(error.message).toContain('Keep one');
        });
    });

    await describe('Switch', async () => {
        await it('binds notify::active rather than state-set', async () => {
            // `state-set` runs BEFORE the state changes and must return false to let
            // the default handler proceed; a handler that forgets makes the switch
            // stick, at exit 0.
            expect(plan('Switch', { value: true, onValueChange: () => {} }).plan.events).toStrictEqual([
                { prop: 'onValueChange', signal: 'notify::active', read: 'active' },
            ]);
            expect(plan('Switch', { value: true }).plan.node.props.active).toBe(true);
        });

        await it('refuses trackColor, naming where the style belongs', async () => {
            expect(threw(() => plan('Switch', { trackColor: 'x' })).message).toContain('stylesheet');
        });
    });

    await describe('the refusals that make the layer worth having', async () => {
        await it('refuses an unknown prop, listing what the primitive takes', async () => {
            const error = threw(() => plan('View', { onMagic: 1 }));
            expect(error.message).toContain('onMagic');
            expect(error.message).toContain('testID');
            expect(error.message).toContain('indistinguishable from a bug in the application');
        });

        await it('refuses an unknown primitive, listing the ones it has', async () => {
            expect(threw(() => plan('FlatList', {})).message).toContain('ActivityIndicator');
        });

        await it('ignores an absent prop, so a spread of optionals costs nothing', async () => {
            expect(plan('View', { onLayout: undefined, pointerEvents: undefined }).plan.node.props).toStrictEqual({
                orientation: 'vertical',
            });
        });

        await it('refuses a pointerEvents value can-target cannot split', async () => {
            expect(plan('View', { pointerEvents: 'none' }).plan.node.props['can-target']).toBe(false);
            expect(threw(() => plan('View', { pointerEvents: 'box-none' })).message).toContain('auto, none');
        });

        await it('refuses id and nativeID rather than letting two props own one property', async () => {
            expect(threw(() => plan('View', { id: 'x' })).message).toContain('use `testID`');
            expect(plan('View', { testID: 'x' }).plan.node.props.name).toBe('x');
        });
    });

    await describe('the table and the contract agree', async () => {
        await it('claims every implemented primitive in the support table', async () => {
            const wrong = PRIMITIVE_NAMES.filter((name) => {
                const status = SUPPORT_TABLE[name]?.status;
                return status !== 'supported' && status !== 'partial';
            });
            expect(wrong).toStrictEqual([]);
        });

        await it('leaves Modal out, because appending an AdwDialog ABORTS the process', async () => {
            // The measurement, and it needs its precondition: the box must be ROOTED in a
            // window. A detached box accepts the append in silence.
            // `box.append(dialog)` calls `g_error()` — SIGABRT and a
            // core dump, not an exception a host can catch. A `partial` here would be
            // a promise that kills the process on first render.
            expect(PRIMITIVES.Modal).toBeUndefined();
            expect(SUPPORT_TABLE.Modal?.status).toBe('planned');
            expect(SUPPORT_TABLE.Modal?.reason).toContain('g_error()');
        });

        await it('gives every refusal a reason, and makes every cross-reference resolve', async () => {
            // Three refusals are legitimately one-liners — `see \`onLongPress\`` and
            // its two siblings — and a length threshold would either reject them or
            // be too low to catch anything. What actually matters is that a
            // cross-reference POINTS SOMEWHERE: a `see \`onFoo\`` whose target was
            // renamed sends a reader looking for a prop that is not in the list.
            const bad: string[] = [];
            for (const [primitive, spec] of Object.entries(PRIMITIVES)) {
                const specs = [spec, ...(spec.switchOn === undefined ? [] : [spec.switchOn.whenTrue])];
                for (const one of specs) {
                    for (const [prop, route] of Object.entries(one.props)) {
                        for (const single of Array.isArray(route) ? route : [route]) {
                            if (single.to !== 'refused' && single.to !== 'ignored') continue;
                            const why = single.why.trim();
                            if (why.length === 0) {
                                bad.push(`${primitive}.${prop}: empty`);
                                continue;
                            }
                            const reference = /^see `([A-Za-z_$][\w$]*)`/.exec(why);
                            if (reference === null) continue;
                            if (one.props[reference[1]] === undefined) {
                                bad.push(
                                    `${primitive}.${prop}: points at ${reference[1]}, which this primitive does not list`,
                                );
                            }
                        }
                    }
                }
            }
            expect(bad).toStrictEqual([]);
        });
    });
};
