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
import { createHandle, type TextInputHandle } from './handles.js';
import { declaresAbsolute, resolvePrimitive, type ChildContext, type PrimitivePlan } from './resolve.js';
import type { ClassNameSink } from './style.js';
import { PRIMITIVES, PRIMITIVE_NAMES, type PropRoute } from './table.js';
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

/**
 * Primitives that are NOT React Native names, so no support-table row judges them.
 *
 * `Icon` is the whole set today and it exists for ADR 0036's `@expo/vector-icons`
 * surface: a component that named `GtkImage` itself would put a widget name in L3,
 * which ADR 0032 § 1 and ADR 0027 rule 1 both forbid — so the widget is a primitive
 * and the Ionicons vocabulary is translated one layer up.
 *
 * It is a NAMED set rather than a status check, because "the table has no row for it"
 * is exactly what a primitive escaping the contract would also look like. The vector
 * below asserts the exemption is real: a name here that react-native DOES export fails.
 */
const NOT_REACT_NATIVE: ReadonlySet<string> = new Set(['Icon']);

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

        await it('refuses justify-between by naming the widget AND what decides it', async () => {
            // A refusal without its reason sends the reader to try the next class
            // name. The reason is the CHILD COUNT, and this assertion used to read
            // `NO \`remove\` method` — a blocker the message outlived, because
            // `slotted.remove` became optional and `Gtk.CenterBox`'s three slots
            // are all setters. Held on the reason that still applies.
            const error = threw(() => plan('View', { className: 'justify-between' }));
            expect(error.message).toContain('Gtk.CenterBox');
            expect(error.message).toContain('CHILD COUNT');
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

        await it('swaps the WIDGET for a wrap, because no property makes a box wrap', async () => {
            // The second widget-changing intent, and the one ADR 0032 § 6's
            // `justify-between` precedent is about: L1 names the class, L2 owns the
            // tag. A `Gtk.Box` has one line and nothing to set to give it two.
            const p = plan('View', { className: 'flex-wrap' }).plan;
            expect(p.node.tag).toBe('GtkFlowBox');
            // …and the element keeps everything that describes it AS an element: the
            // orientation means the same thing on both classes (measured), so
            // `flex-row` still selects rows and `flex-col` still selects columns.
            expect(plan('View', { className: 'flex-wrap' }).plan.node.props.orientation).toBe('vertical');
            expect(plan('View', { className: 'flex-row flex-wrap' }).plan.node.props.orientation).toBe('horizontal');
        });

        await it('corrects the two GtkFlowBox defaults that would make it not a flex container', async () => {
            // Both silent. `max-children-per-line` defaults to 7, so a wrap would cap
            // a line at seven children however much room was left; `selection-mode`
            // defaults to SINGLE, so a click would select a child and draw a focus
            // ring a flexbox container never draws. 65535 is not a round number
            // picked for looks — it is what GTK stores when handed G_MAXUINT, and `0`
            // is out of range for the `guint` rather than meaning "no limit".
            const p = plan('View', { className: 'flex-wrap' }).plan;
            expect(p.node.props['max-children-per-line']).toBe(65535);
            expect(p.node.props['selection-mode']).toBe('none');
        });

        await it('sends a wrapping element’s gap to the two spacings, never to `spacing`', async () => {
            // `Gtk.FlowBox` installs NO `spacing` (measured). Emitting one would be a
            // property the host refuses at attach time, in a consumer's window.
            const both = plan('View', { className: 'flex-wrap gap-2' }).plan;
            expect(both.node.props.spacing).toBeUndefined();
            expect(both.node.props['row-spacing']).toBe(8);
            expect(both.node.props['column-spacing']).toBe(8);
            // And the axis-qualified gaps stop being an orientation question: both
            // spacings are real, whichever way the lines run.
            const axes = plan('View', { className: 'flex-wrap gap-x-1 gap-y-4' }).plan;
            expect(axes.node.props['column-spacing']).toBe(4);
            expect(axes.node.props['row-spacing']).toBe(16);
        });

        await it('consumes flex-nowrap instead of dropping it or refusing it', async () => {
            // A `Gtk.Box` is already one line, so the resolution is "nothing to do" —
            // and it is a RESOLUTION rather than a pass-up, because no caller knowing
            // more could answer it differently. The tag is the proof it was consumed.
            const p = plan('View', { className: 'flex-nowrap' }).plan;
            expect(p.node.tag).toBe('GtkBox');
            expect(p.intent).toStrictEqual({});
        });

        await it('refuses a wrap on a primitive whose widget has no wrapping counterpart', async () => {
            // There is no wrapping `Gtk.Label` and no wrapping `Gtk.ScrolledWindow`,
            // so the refusal points at the node that IS a box — which on a
            // `ScrollView` is reached through `contentContainerClassName`.
            expect(threw(() => plan('Text', { className: 'flex-wrap' })).message).toContain('no wrapping counterpart');
            const scroller = threw(() => plan('ScrollView', { className: 'flex-wrap' }));
            expect(scroller.message).toContain('contentContainerClassName');
        });

        await it('wraps a ScrollView’s CONTENT box, which is the node that holds children', async () => {
            const p = plan('ScrollView', { contentContainerClassName: 'flex-wrap gap-2' }).plan;
            expect(p.node.tag).toBe('GtkScrolledWindow');
            expect(p.content?.tag).toBe('GtkFlowBox');
            expect(p.content?.props['row-spacing']).toBe(8);
        });

        await it('wraps the INNER box when an absolute child made the element an overlay', async () => {
            // Two widget swaps on one element, and they do not collide: the outer
            // node becomes the overlay the absolute child needs, and the node the
            // ordinary children go into becomes the one that wraps.
            const p = plan(
                'View',
                { className: 'flex-wrap gap-1' },
                { children: { absolute: 1, count: 2, text: false } },
            ).plan;
            expect(p.node.tag).toBe('GtkOverlay');
            expect(p.content?.tag).toBe('GtkFlowBox');
            expect(p.content?.props['column-spacing']).toBe(4);
            // The spacings belong to the inner class and must not be left on the
            // overlay, which installs neither (measured: 37 properties, no spacing).
            expect(p.node.props['column-spacing']).toBeUndefined();
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
            // The three are `Gtk.Label` defaults this layer normalises to React
            // Native's, enumerated with the rest of the set in `defaults.ts`; a
            // declared no-op adds nothing to them.
            const p = plan('Text', { allowFontScaling: true, maxFontSizeMultiplier: 2 }).plan;
            expect(p.node.props).toStrictEqual({ wrap: true, xalign: 0, yalign: 0 });
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
            expect(threw(() => plan('Animated.View', {})).message).toContain('ActivityIndicator');
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
                if (NOT_REACT_NATIVE.has(name)) return false;
                const status = SUPPORT_TABLE[name]?.status;
                return status !== 'supported' && status !== 'partial';
            });
            expect(wrong).toStrictEqual([]);
            // Not vacuous: the exemption set must stay small and must be REAL — a name
            // in it that react-native does export would be a primitive quietly escaping
            // the table that is supposed to be the contract.
            const escaped = [...NOT_REACT_NATIVE].filter((name) => SUPPORT_TABLE[name] !== undefined);
            expect(escaped).toStrictEqual([]);
        });

        await it('carries Modal as a PORTAL, and never as a child of anything', async () => {
            // THE MEASUREMENT THAT KEPT THIS ROW OUT IS UNCHANGED, and it needs its
            // precondition: the box must be ROOTED in a window, because a detached
            // box accepts the same append in silence. `box.append(dialog)` calls
            // `g_error()` — SIGABRT and a core dump, not an exception a host can
            // catch. What changed is where the fact lives: `@gjsify/gtk-host` grew a
            // placement axis (ADR 0045) and `AdwDialog` declares `present` /
            // `force_close` on it, so nothing is appended and the abort is
            // unreachable. This vector pins the two halves that make that true.
            expect(PRIMITIVES.Modal?.tag).toBe('AdwDialog');
            expect(SUPPORT_TABLE.Modal?.status).toBe('partial');
            expect(SUPPORT_TABLE.Modal?.reason).toContain('g_error()');
            // `can-close: false` is what makes `visible` the only thing that
            // dismisses it. Written here as well as in `defaults.ts` because a table
            // that quietly dropped it would leave the dialog closing itself while
            // React still believed it was up — and nothing else would fail.
            expect(PRIMITIVES.Modal?.widgetProps['can-close']).toBe(false);
            // The content box: `Adw.Dialog` holds ONE child, so two children under a
            // `<Modal>` would be an assignment that evicts the first, silently.
            expect(PRIMITIVES.Modal?.content?.tag).toBe('GtkBox');
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

        await it('advises only props and values it would then accept', async () => {
            // THE SAME MECHANISM ONE STEP FURTHER, and it found three. The vector
            // above holds a ``see `onFoo``` cross-reference to the prop list; this one
            // holds ``prop="value"`` — the shape a refusal uses to say what to do
            // INSTEAD — against what the table would actually do with it. Three
            // `accessibilityRole` refusals pointed at `status`, `navigation` and
            // `group`: real ARIA roles GTK carries, and not React Native
            // `accessibilityRole` spellings, so a caller who followed the advice got a
            // SECOND refusal. That is worse than the generic "Known: …" message the
            // per-value reason exists to replace, and nothing else can see it — a
            // reason is prose to every other reader in this repo.
            const bad: string[] = [];
            let advised = 0;
            for (const [primitive, spec] of Object.entries(PRIMITIVES)) {
                const specs = [spec, ...(spec.switchOn === undefined ? [] : [spec.switchOn.whenTrue])];
                for (const one of specs) {
                    // `Array.isArray` does not narrow a `readonly T[]` out of a
                    // union — it is typed as a guard for the MUTABLE array — so the
                    // else branch keeps both members and the annotation rejects it.
                    // The cast is on the branch the guard already decided.
                    const routesOf = (prop: string): readonly PropRoute[] => {
                        const route = one.props[prop];
                        if (route === undefined) return [];
                        return Array.isArray(route) ? (route as readonly PropRoute[]) : [route as PropRoute];
                    };
                    const reasons: string[] = [];
                    for (const prop of Object.keys(one.props)) {
                        for (const route of routesOf(prop)) {
                            if (route.to === 'refused' || route.to === 'ignored') reasons.push(route.why);
                            if (route.to === 'property') reasons.push(...Object.values(route.refuses ?? {}));
                            if (route.to === 'accessible' && route.from === 'members') {
                                reasons.push(...Object.values(route.refuses));
                            }
                        }
                    }
                    for (const why of reasons) {
                        for (const [, prop, value] of why.matchAll(/`([A-Za-z_$][\w$]*)="([^"`]+)"`/g)) {
                            advised += 1;
                            const routes = routesOf(prop);
                            if (routes.length === 0) {
                                bad.push(
                                    `${primitive}: advises ${prop}="${value}", which <${primitive}> does not take`,
                                );
                                continue;
                            }
                            for (const route of routes) {
                                if (route.to === 'refused') {
                                    bad.push(`${primitive}: advises ${prop}, which <${primitive}> refuses`);
                                } else if (
                                    route.to === 'property' &&
                                    route.as === 'map' &&
                                    route.map?.[value] === undefined
                                ) {
                                    bad.push(`${primitive}: advises ${prop}="${value}", which ${prop} does not map`);
                                }
                            }
                        }
                    }
                }
            }
            expect(bad).toStrictEqual([]);
            // …and the scan found something to check, which is what keeps the line
            // above an assertion rather than a loop over nothing.
            expect(advised).toBeGreaterThan(0);
        });

        await it('declares a per-value refusal only where one is READ', async () => {
            // `PropertyRoute.refuses` is optional on the whole type, and `resolve.ts`
            // consults it in `lookup()` — reached for `as: 'map'` and
            // `'pixels-or-map'` and for nothing else. So a `refuses` on any other
            // coercion is a reason nobody ever says: the value takes the ordinary
            // path and the sentence sits in the table looking answered. A silent
            // no-op in the mechanism whose whole point is not being silent.
            const stranded: string[] = [];
            for (const [primitive, spec] of Object.entries(PRIMITIVES)) {
                const specs = [spec, ...(spec.switchOn === undefined ? [] : [spec.switchOn.whenTrue])];
                for (const one of specs) {
                    for (const [prop, route] of Object.entries(one.props)) {
                        const routes: readonly PropRoute[] = Array.isArray(route)
                            ? (route as readonly PropRoute[])
                            : [route as PropRoute];
                        for (const single of routes) {
                            if (single.to !== 'property' || single.refuses === undefined) continue;
                            if (single.as !== 'map' && single.as !== 'pixels-or-map') {
                                stranded.push(`${primitive}.${prop}: refuses under as="${single.as}", never read`);
                            }
                        }
                    }
                }
            }
            expect(stranded).toStrictEqual([]);
        });
    });

    await describe('the P2 rows, as data', async () => {
        await it('inverts Gtk.Picture’s content-fit default, as View and Text invert theirs', async () => {
            // The third inverted default of this layer. React Native's `Image`
            // defaults to `cover`; a fresh `Gtk.Picture` reports CONTAIN (measured).
            // Absent, every ported image is letterboxed instead of filled — which
            // renders, looks deliberate, and is wrong.
            expect(plan('Image', {}).plan.node.props['content-fit']).toBe('cover');
            expect(plan('Image', { resizeMode: 'contain' }).plan.node.props['content-fit']).toBe('contain');
            expect(plan('Image', { resizeMode: 'stretch' }).plan.node.props['content-fit']).toBe('fill');
            expect(plan('Image', { resizeMode: 'center' }).plan.node.props['content-fit']).toBe('scale-down');
        });

        await it('refuses resizeMode="repeat", because GtkContentFit has no tiling member', async () => {
            const error = threw(() => plan('Image', { resizeMode: 'repeat' }));
            // The message lists what the enum DOES hold, which is the actionable half.
            expect(error.message).toContain('center, contain, cover, stretch');
        });

        await it('turns a source into the one file GTK can open, saying which call to make', async () => {
            expect(plan('Image', { source: { uri: '/tmp/x.png' } }).plan.files).toStrictEqual([
                { on: 'outer', property: 'file', kind: 'path', value: '/tmp/x.png' },
            ]);
            expect(plan('Image', { source: { uri: 'file:///tmp/x.png' } }).plan.files[0]?.kind).toBe('uri');
            expect(plan('Image', { source: { uri: 'resource:///a/b.png' } }).plan.files[0]?.kind).toBe('uri');
        });

        await it('refuses every source shape that would need a loader, by name', async () => {
            expect(threw(() => plan('Image', { source: { uri: 'https://example.test/a.png' } })).message).toContain(
                'fetch, a decoder and a cache',
            );
            expect(threw(() => plan('Image', { source: { uri: 'data:image/png;base64,AA' } })).message).toContain(
                '`data:` URI',
            );
            expect(threw(() => plan('Image', { source: 42 })).message).toContain('asset registry');
            expect(threw(() => plan('Image', { source: [{ uri: '/a.png' }] })).message).toContain(
                'per-device-scale picker',
            );
            expect(threw(() => plan('Image', { source: '/a.png' })).message).toContain('bare string');
            expect(threw(() => plan('Image', { source: { uri: '/a.png', width: 10 } })).message).toContain('width');
            expect(threw(() => plan('Image', { source: { uri: 'sftp://host/a.png' } })).message).toContain('`sftp:`');
        });

        await it('gives ImageBackground three nodes, with the picture as the overlay’s MAIN child', async () => {
            // The arrangement is forced, not chosen: a `Gtk.Overlay` paints every
            // overlay child ABOVE its main child, so a picture in the overlay slot
            // would cover the children it is supposed to sit behind.
            const { plan: p } = plan('ImageBackground', { source: { uri: '/bg.png' }, className: 'p-2' });
            expect(p.node.tag).toBe('GtkOverlay');
            expect(p.backdrop?.tag).toBe('GtkPicture');
            expect(p.backdropSlot).toBe('child');
            expect(p.content?.tag).toBe('GtkBox');
            expect(p.contentSlot).toBe('overlay');
            expect(p.files).toStrictEqual([{ on: 'backdrop', property: 'file', kind: 'path', value: '/bg.png' }]);
        });

        await it('styles the picture from imageStyle and the container from style', async () => {
            const { plan: p, sink } = plan('ImageBackground', {
                className: 'p-2',
                imageStyle: { opacity: 0.5 },
            });
            // Two mints, one per styleable node — the same shape `ScrollView`'s
            // `contentContainerStyle` has, which is what makes the backdrop a second
            // `ContentSpec` rather than a type of its own.
            expect(sink.calls.length).toBe(2);
            expect(sink.calls.some((call) => call.declarations.includes('opacity: 0.5'))).toBe(true);
            expect(p.backdrop?.cssClasses.length).toBe(1);
        });

        await it('writes the Touchables over Pressable’s own routes', async () => {
            for (const primitive of ['TouchableOpacity', 'TouchableHighlight']) {
                const { plan: p } = plan(primitive, { onPress: () => {} });
                expect(p.node.tag).toBe('GtkButton');
                expect(p.node.cssClasses).toContain('flat');
                expect(p.events).toStrictEqual([{ prop: 'onPress', signal: 'clicked', read: null }]);
            }
        });

        await it('sends the pressed appearance to `active:`, not to a prop', async () => {
            // ADR 0032 § 3's rule, not § 7's: honouring a raw number or colour here
            // would put a value into the styling path that never came from the
            // project's token scale.
            expect(threw(() => plan('TouchableOpacity', { activeOpacity: 0.6 })).message).toContain(
                'active:opacity-70',
            );
            expect(threw(() => plan('TouchableHighlight', { underlayColor: '#000' })).message).toContain(
                'active:bg-<token>',
            );
        });

        await it('gives TouchableWithoutFeedback a BOX and a gesture, not a button', async () => {
            const { plan: p } = plan('TouchableWithoutFeedback', { onPress: () => {} });
            expect(p.node.tag).toBe('GtkBox');
            expect(p.node.props.orientation).toBe('vertical');
            // A gesture, not an event: a `Gtk.Box` emits no `clicked` (measured), so
            // the press arrives through a `Gtk.GestureClick` the framework layer adds.
            expect(p.events).toStrictEqual([]);
            expect(p.gestures).toStrictEqual([{ prop: 'onPress', signal: 'released' }]);
            // `can-target`, not `sensitive`: greying out every descendant of a wrapper
            // with no appearance of its own is a different thing from not being pressed.
            expect(plan('TouchableWithoutFeedback', { disabled: true }).plan.node.props['can-target']).toBe(false);
        });

        await it('refuses a gesture prop that is not a function, naming the controller', async () => {
            expect(threw(() => plan('TouchableWithoutFeedback', { onPress: 'go' })).message).toContain(
                'Gtk.GestureClick',
            );
        });

        await it('refuses style and className on Button, which is React Native’s own answer', async () => {
            expect(plan('Button', { title: 'Go' }).plan.node.props.label).toBe('Go');
            expect(threw(() => plan('Button', { title: 'Go', className: 'p-2' })).message).toContain(
                'takes no `style` and no `className`',
            );
            expect(threw(() => plan('Button', { title: 'Go', style: { opacity: 1 } })).message).toContain('Pressable');
            // The refusal fires BEFORE any prop is routed, so it names the styling and
            // not whichever prop the loop reached first.
            expect(threw(() => plan('Button', { className: 'p-2', nonsuch: 1 })).subject).toBe('prop "className"');
        });

        await it('lays SafeAreaView and KeyboardAvoidingView out exactly like a View', async () => {
            for (const primitive of ['SafeAreaView', 'KeyboardAvoidingView']) {
                const { plan: p } = plan(primitive, { className: 'flex-row items-center' });
                expect(p.node.tag).toBe('GtkBox');
                expect(p.node.props.orientation).toBe('horizontal');
                // The inherited cross-axis alignment still reaches the children, which
                // is the half a "renders nothing" no-op would have lost.
                expect(p.childContext.props.valign).toBe('center');
            }
        });

        await it('keeps the keyboard props declared no-ops and contentContainerStyle a refusal', async () => {
            expect(plan('KeyboardAvoidingView', { behavior: 'padding', enabled: false }).plan.node.props).toStrictEqual(
                {
                    orientation: 'vertical',
                },
            );
            expect(
                threw(() => plan('KeyboardAvoidingView', { contentContainerStyle: { opacity: 1 } })).message,
            ).toContain('Put it on `style`');
        });

        await it('gives the list family a box and a scroller, and flips both on horizontal', async () => {
            const { plan: p } = plan('FlatList', { className: 'p-2' });
            expect(p.node.tag).toBe('GtkBox');
            expect(p.node.props.orientation).toBe('vertical');
            expect(p.content?.tag).toBe('GtkScrolledWindow');
            expect(p.content?.props.vexpand).toBe(true);
            expect(p.content?.props['hscrollbar-policy']).toBe('never');
            const horizontal = plan('FlatList', { horizontal: true }).plan;
            expect(horizontal.node.props.orientation).toBe('horizontal');
            expect(horizontal.content?.props['hscrollbar-policy']).toBe('automatic');
            expect(horizontal.content?.props['vscrollbar-policy']).toBe('never');
        });

        await it('ignores the props the list COMPONENT reads, and refuses the virtualisation knobs', async () => {
            // `data` and its siblings are React trees and functions: a widget property
            // cannot hold one, so they are `ignored` in the table and read by the
            // component. Listed rather than absent, so a misspelling is still named.
            expect(
                plan('FlatList', { data: [1, 2], renderItem: () => null, keyExtractor: () => 'k' }).plan.node.props,
            ).toStrictEqual({ orientation: 'vertical' });
            for (const prop of ['initialNumToRender', 'windowSize', 'getItemLayout', 'removeClippedSubviews']) {
                expect(threw(() => plan('FlatList', { [prop]: 1 })).message).toContain('does that job itself');
            }
            expect(threw(() => plan('FlatList', { numColumns: 2 })).message).toContain('Gtk.GridView');
            expect(threw(() => plan('FlatList', { onRefresh: () => {} })).message).toContain('pull-to-refresh');
            expect(threw(() => plan('FlatList', { stickySectionHeadersEnabled: true })).message).toContain(
                'header ROWS',
            );
        });

        await it('keeps every P2 name in the table and the table in step with the primitives', async () => {
            // The one place the two data sources are held against each other: a
            // primitive whose row still says `planned` is an export the bundler gate
            // refuses while the code answers it, which is the drift ADR 0032 § 8 is
            // built to make impossible.
            for (const name of Object.keys(PRIMITIVES)) {
                if (NOT_REACT_NATIVE.has(name)) continue;
                const status = SUPPORT_TABLE[name]?.status;
                expect(`${name}: ${status}`).toBe(`${name}: ${status === 'supported' ? 'supported' : 'partial'}`);
            }
            for (const name of ['Image', 'ImageBackground', 'Button', 'FlatList', 'SafeAreaView', 'StatusBar']) {
                expect(SUPPORT_TABLE[name]?.limits?.length ?? 0).toBeGreaterThan(0);
            }
        });
    });

    await describe('the imperative handle (ADR 0039)', async () => {
        await it('is declared by the table, not by a binding', async () => {
            // Both L3s read `plan.handle`, so this is where the answer lives. Every
            // other primitive hands a `ref` the widget, which is what it always did.
            expect(plan('TextInput', {}).plan.handle).toBe('text-input');
            expect(plan('TextInput', { multiline: true }).plan.handle).toBe('text-input');
            expect(plan('View', {}).plan.handle).toBe(null);
            expect(plan('Text', {}).plan.handle).toBe(null);
        });

        await it('focuses through grab_focus, and blurs only what it holds itself', async () => {
            // A STUB root, because a real one cannot answer: `Gtk.Root.get_focus()`
            // stays null until the compositor activates the window (measured, and
            // `widgets.spec.ts` holds the other half — that every method called below
            // is one the real GTK classes install). What IS asserted here is the
            // behaviour that would otherwise be a bug in a user's window: `blur()`
            // writes `set_focus(null)`, which unsets the root's focus widget WHOEVER
            // it is, so an unguarded blur on an unfocused input takes the focus away
            // from whatever really had it.
            let grabs = 0;
            const root = {
                focused: null as unknown,
                get_focus(): unknown {
                    return this.focused;
                },
                set_focus(widget: unknown): void {
                    this.focused = widget;
                },
            };
            const widget = {
                grab_focus: () => {
                    grabs++;
                    return true;
                },
                is_focus: () => root.focused === widget,
                get_root: () => root,
                set_text: () => undefined,
                select_region: () => undefined,
            };
            const handle = createHandle('text-input', widget, 'GtkEntry') as TextInputHandle;

            handle.focus();
            expect(grabs).toBe(1);

            const somebodyElse = { name: 'other' };
            root.focused = somebodyElse;
            expect(handle.isFocused()).toBe(false);
            handle.blur();
            expect(root.focused).toBe(somebodyElse);

            root.focused = widget;
            expect(handle.isFocused()).toBe(true);
            handle.blur();
            expect(root.focused).toBe(null);
        });

        await it('hands the widget back, so nothing the ref used to reach is lost', async () => {
            const widget = { grab_focus: () => true, is_focus: () => false, get_root: () => null };
            expect((createHandle('text-input', widget, 'GtkEntry') as TextInputHandle).widget).toBe(widget);
            // The ordinary case: no handle kind, and the ref value IS the widget.
            expect(createHandle(null, widget, 'GtkBox')).toBe(widget);
        });
    });

    await describe('accessibilityLiveRegion (ADR 0039)', async () => {
        await it('is a live region on Text, with GTK’s own priority for each level', async () => {
            expect(plan('Text', { accessibilityLiveRegion: 'polite' }).plan.announcements).toStrictEqual([
                { prop: 'accessibilityLiveRegion', signal: 'notify::label', read: 'label', priority: 'medium' },
            ]);
            expect(plan('Text', { accessibilityLiveRegion: 'assertive' }).plan.announcements[0]?.priority).toBe('high');
        });

        await it('records nothing for "none", which is React Native’s own default', async () => {
            expect(plan('Text', { accessibilityLiveRegion: 'none' }).plan.announcements).toStrictEqual([]);
            expect(plan('Text', {}).plan.announcements).toStrictEqual([]);
        });

        await it('refuses a level GTK has no answer for, by name', async () => {
            expect(threw(() => plan('Text', { accessibilityLiveRegion: 'loud' })).message).toContain(
                'has no GTK equivalent',
            );
        });

        await it('refuses the prop elsewhere for the RIGHT reason — announce exists, the watch does not', async () => {
            // The reason matters as much as the refusal: "GTK4 has no property" would
            // send a reader looking for one, and `Gtk.Accessible.announce()` has been
            // there since 4.14. What a `View` lacks is the moment and the message.
            const message = threw(() => plan('View', { accessibilityLiveRegion: 'polite' })).message;
            expect(message).toContain('`Gtk.Accessible.announce(message, priority)` since 4.14');
            expect(message).toContain('content is a SUBTREE');
        });
    });

    await describe('the accessibility props (ADR 0039)', async () => {
        await it('routes accessibilityLabel to the accessible NAME', async () => {
            expect(plan('View', { accessibilityLabel: 'Save document' }).plan.accessibility).toStrictEqual([
                { prop: 'accessibilityLabel', set: 'property', name: 'label', value: 'Save document' },
            ]);
        });

        await it('routes accessibilityHint to HELP_TEXT, not DESCRIPTION', async () => {
            // DESCRIPTION is taken: `<Image alt>` writes it through
            // `Gtk.Picture:alternative-text` (measured), and two props on one
            // attribute is the silent-drop shape this table refuses by name.
            expect(plan('View', { accessibilityHint: 'Opens the editor' }).plan.accessibility).toStrictEqual([
                { prop: 'accessibilityHint', set: 'property', name: 'help-text', value: 'Opens the editor' },
            ]);
        });

        await it('carries accessibilityRole as a GObject property, not an imperative call', async () => {
            // The measurement this whole entry turns on: `accessible-role` is
            // READ-WRITE on gtk 4.22.4, so the 41 call sites an application had to
            // drop are an ordinary property write here.
            const { plan: resolved } = plan('View', { accessibilityRole: 'button' });
            expect(resolved.node.props['accessible-role']).toBe('button');
            expect(resolved.accessibility).toStrictEqual([]);
        });

        await it('maps a platform spelling onto the portable idea behind it', async () => {
            // React Native's list is Android's and iOS's traits merged; GTK's is
            // ARIA's. These four are one platform's NAME for a role GTK has.
            expect(plan('View', { accessibilityRole: 'tabbar' }).plan.node.props['accessible-role']).toBe('tab-list');
            expect(plan('View', { accessibilityRole: 'dropdownlist' }).plan.node.props['accessible-role']).toBe(
                'combo-box',
            );
            expect(plan('View', { accessibilityRole: 'viewgroup' }).plan.node.props['accessible-role']).toBe('generic');
            // `search` is ARIA's search LANDMARK; React Native means the FIELD.
            expect(plan('View', { accessibilityRole: 'search' }).plan.node.props['accessible-role']).toBe('search-box');
        });

        await it('refuses a role GTK has no member for BY NAME, with what to do instead', async () => {
            // The generic "Known: …" message is right for a typo and wrong here:
            // `keyboardkey` is a real React Native spelling, so the refusal has to
            // answer it rather than list the alternatives.
            const message = threw(() => plan('View', { accessibilityRole: 'keyboardkey' })).message;
            expect(message).toContain('neither GTK nor ARIA has a role for one');
            expect(message).toContain('accessibilityRole="button"');
            expect(message).not.toContain('Known:');
            expect(threw(() => plan('View', { accessibilityRole: 'drawerlayout' })).message).toContain(
                'Adw.OverlaySplitView',
            );
        });

        await it('still reports an unknown role as the typo it is', async () => {
            const message = threw(() => plan('View', { accessibilityRole: 'buton' })).message;
            expect(message).toContain('Known:');
            expect(message).toContain('has no GTK equivalent');
        });

        await it('splits accessibilityState into one GTK state per key', async () => {
            const { plan: resolved } = plan('View', { accessibilityState: { disabled: true, busy: false } });
            expect(resolved.accessibility).toStrictEqual([
                { prop: 'accessibilityState', set: 'state', name: 'disabled', value: true },
                { prop: 'accessibilityState', set: 'state', name: 'busy', value: false },
            ]);
        });

        await it('gives checked GTK’s real tri-state, rather than rounding it to a boolean', async () => {
            // The one genuinely three-valued thing in React Native's accessibility
            // surface, and `Gtk.AccessibleTristate` has an exact member for it.
            // The numbers are the enum: FALSE 0, TRUE 1, MIXED 2.
            const value = (checked: unknown): unknown =>
                plan('View', { accessibilityState: { checked } }).plan.accessibility[0]?.value;
            expect(value('mixed')).toBe(2);
            expect(value(true)).toBe(1);
            expect(value(false)).toBe(0);
        });

        await it('skips an undefined state key, because every spread carries them', async () => {
            expect(plan('View', { accessibilityState: { checked: undefined } }).plan.accessibility).toStrictEqual([]);
            expect(plan('View', {}).plan.accessibility).toStrictEqual([]);
        });

        await it('refuses a state key this layer does not answer for, listing the five it does', async () => {
            const message = threw(() => plan('View', { accessibilityState: { pressed: true } })).message;
            expect(message).toContain('"pressed"');
            expect(message).toContain('busy, checked, disabled, expanded, selected');
        });

        await it('refuses a bad value naming the GValue GTK reads the attribute out of', async () => {
            expect(threw(() => plan('View', { accessibilityLabel: 7 })).message).toContain('needs a string');
            expect(threw(() => plan('View', { accessibilityState: { checked: 'half' } })).message).toContain(
                'Gtk.AccessibleTristate',
            );
            expect(threw(() => plan('View', { accessibilityState: 'checked' })).message).toContain('needs an object');
            // `'true'` is the one a value-keyed lookup would have taken for TRUE.
            // React Native's type is `boolean | 'mixed'`, so the string is a mistake.
            expect(threw(() => plan('View', { accessibilityState: { checked: 'true' } })).message).toContain(
                'Gtk.AccessibleTristate',
            );
            // An explicit `null` is a refusal, not a clear — this layer's existing
            // convention, the same answer `testID={null}` gets. Removing the prop is
            // how React Native clears one.
            expect(threw(() => plan('View', { accessibilityLabel: null })).message).toContain('needs a string');
        });

        await it('answers `accessible` as a declared no-op, naming the prop that does the job', async () => {
            const { plan: resolved } = plan('View', { accessible: true });
            expect(resolved.accessibility).toStrictEqual([]);
            expect(resolved.node.props['accessible-role']).toBe(undefined);
        });

        await it('answers every accessibility prop on every primitive that takes props', async () => {
            // The set is COMMON, so a primitive that overrode one by accident would
            // be the only place the answer differed — which is exactly the drift the
            // shared record exists to prevent.
            const props = [
                'accessible',
                'accessibilityLabel',
                'accessibilityRole',
                'accessibilityHint',
                'accessibilityState',
            ];
            const missing: string[] = [];
            for (const [name, spec] of Object.entries(PRIMITIVES)) {
                for (const prop of props) if (spec.props[prop] === undefined) missing.push(`${name}.${prop}`);
            }
            expect(missing).toStrictEqual([]);
        });
    });

    await describe('the three props with no addressee on a desktop (ADR 0039)', async () => {
        await it('accepts autoComplete, textContentType and submitBehavior as declared no-ops', async () => {
            // Ordinary React Native code that a porter cannot rewrite into something a
            // desktop would honour, so a refusal would refuse a correct program. What
            // the entries buy is that the argument is written down ONCE, in the layer,
            // instead of being made again in every application.
            const { plan: resolved } = plan('TextInput', {
                autoComplete: 'email',
                textContentType: 'emailAddress',
                submitBehavior: 'submit',
            });
            expect(resolved.node.tag).toBe('GtkEntry');
            expect(resolved.node.props).toStrictEqual({});
        });
    });
};
