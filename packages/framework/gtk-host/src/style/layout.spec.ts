// The layout half — pure TypeScript, so it runs without a display or a widget.
//
// Same seam as `paint.spec.ts`: the partition's DECISIONS are data and testable
// here, while the two claims about another program — which CSS properties GTK
// parses, which widget properties GTK installs — are measured against the real
// thing in `gtk-css.spec.ts` and `gtk-props.spec.ts`. A vector here that asserts
// `margin-left` is emitted is only worth anything because another file proves GTK
// accepts that name.

import { describe, expect, it } from '@gjsify/unit';

import { UnknownUtilityError } from './errors.js';
import { GTK_CSS_PROPERTIES } from './gtk-css.js';
import { GTK_WIDGET_PROPERTIES } from './gtk-props.js';
import { LAYOUT_PROPERTIES, type LayoutProps, partitionLayout, resolveLayoutUtility } from './layout.js';
import { PAINT_PROPERTIES } from './paint.js';
import { partition, resolveUtilities, resolveUtility } from './resolve.js';
import { MINIMAL_TOKENS, type StyleTokens } from './tokens.js';

// A token file's own vocabulary, not Tailwind's numbers: `2xs` and `s` are what the
// measured application spells, and the point of the scales is that the compiler
// never had to know them.
const TOKENS: StyleTokens = {
    ...MINIMAL_TOKENS,
    spacing: { ...MINIMAL_TOKENS.spacing, '2xs': '4px', xs: '8px', s: '12px', m: '16px' },
    width: { icon: '24px' },
};

const threw = (fn: () => unknown): UnknownUtilityError => {
    try {
        fn();
    } catch (error) {
        if (error instanceof UnknownUtilityError) return error;
        throw error;
    }
    throw new Error('expected an UnknownUtilityError, nothing was thrown');
};

const of = (...utilities: string[]) => partition(resolveUtilities(utilities, TOKENS));

export default async () => {
    await describe('the layout vocabulary', async () => {
        await it('splits the horizontal margin by the SOURCE spelling, not by convenience', async () => {
            // The measurement this whole half is built on. GTK CSS has no
            // `margin-start` and no widget has `margin-left`, so Tailwind's physical
            // pair and its logical pair are forced into different mechanisms — and
            // sending `ms-*` through CSS would produce a margin that does not flip
            // under RTL, which is a bug nobody reading English ever sees.
            expect(of('ml-xs').css).toStrictEqual(['margin-left: 8px']);
            expect(of('mr-xs').css).toStrictEqual(['margin-right: 8px']);
            expect(of('ms-xs').props).toStrictEqual({ 'margin-start': 8 });
            expect(of('me-xs').props).toStrictEqual({ 'margin-end': 8 });
            // Vertical margins have no such distinction to preserve, so they join
            // the widget channel rather than splitting the family for nothing.
            expect(of('mt-xs', 'mb-s').props).toStrictEqual({ 'margin-top': 8, 'margin-bottom': 12 });
        });

        await it('keeps m-* and mx-* on ONE key, so the common override still resolves', async () => {
            // `m-4 mx-2` is ordinary authoring. It only works by last-wins while both
            // spellings write the same key — which is why `m-*` puts its horizontal
            // half in CSS with `mx-*` instead of taking the widget channel wholesale.
            const { css, props } = of('m-s', 'mx-2xs');
            expect(css).toStrictEqual(['margin-left: 4px', 'margin-right: 4px']);
            expect(props).toStrictEqual({ 'margin-top': 12, 'margin-bottom': 12 });
        });

        await it('refuses a physical and a logical horizontal margin together', async () => {
            // The case last-wins cannot save: the two land in different mechanisms
            // and GTK applies BOTH, so `m-s ms-2xs` would silently be a 16px start
            // margin. An approximation here is invisible until someone measures the
            // window.
            const error = threw(() => of('m-s', 'ms-2xs'));
            expect(error.message).toContain('ADD');
        });

        await it('sends every padding to CSS, because there is no second route', async () => {
            // No GTK class installs a padding property of any kind (measured), so
            // this family has no channel to choose between — and a LOGICAL padding
            // cannot be expressed at all, in either mechanism.
            expect(of('p-xs').css).toStrictEqual([
                'padding-top: 8px',
                'padding-right: 8px',
                'padding-bottom: 8px',
                'padding-left: 8px',
            ]);
            expect(of('px-xs', 'py-2xs').css).toStrictEqual([
                'padding-top: 4px',
                'padding-right: 8px',
                'padding-bottom: 4px',
                'padding-left: 8px',
            ]);
            expect(threw(() => resolveUtility('ps-xs', TOKENS)).message).toContain('no logical padding');
        });

        await it('maps the box axis to orientation, as a NICK', async () => {
            // A nick because the host coerces through the ParamSpec. Assigning the
            // string directly is the documented silent failure — `box.orientation =
            // 'vertical'` keeps HORIZONTAL with no diagnostic at all.
            expect(of('flex-row').props).toStrictEqual({ orientation: 'horizontal' });
            expect(of('flex-col').props).toStrictEqual({ orientation: 'vertical' });
        });

        await it('makes flex-1 an intent, because the axis is the PARENT’s', async () => {
            // ADR 0032 § 6, and the reason intents exist: the same class compiles to
            // `hexpand` in a row and `vexpand` in a column, and an element does not
            // know which it is in.
            expect(of('flex-1').intent).toStrictEqual({ expand: 'main-axis' });
            expect(of('flex-1').props).toStrictEqual({});
            expect(of('flex-1').css).toStrictEqual([]);
        });

        await it('makes a wrap an intent, because wrapping is a different WIDGET', async () => {
            // The same shape as `justify-between`: a `Gtk.Box` has no second line to
            // put anything on, and the answer is `Gtk.FlowBox` — another class, not
            // another property. L1 names it and L2 swaps it.
            expect(of('flex-wrap').intent).toStrictEqual({ wrap: { lines: 'multi' } });
            expect(of('flex-wrap').props).toStrictEqual({});
            expect(of('flex-wrap').css).toStrictEqual([]);
            // A `Gtk.Box` is already one line, so the no-wrap spelling restates the
            // platform — and is still CARRIED, because L2 refuses a wrap utility on
            // a widget that cannot wrap and needs the spelling to name the element.
            expect(of('flex-nowrap').intent).toStrictEqual({ wrap: { lines: 'single' } });
            expect(resolveLayoutUtility('flex-nowrap', TOKENS)).toStrictEqual({ flexWrap: 'nowrap' });
            // Reversal has no property behind it on either widget.
            expect(threw(() => resolveUtility('flex-wrap-reverse', TOKENS)).message).toContain('Gtk.FlowBox');
        });

        await it('sends a wrapping element’s gap to the two spacings a FlowBox has', async () => {
            // `Gtk.FlowBox` installs NO `spacing` (measured, gtk-props.ts). A gap
            // that took the box's route would be a property the widget refuses at
            // attach time, in a consumer's window — so the wrap carries it instead,
            // and an unqualified gap is both spacings at once.
            expect(of('flex-wrap', 'gap-xs').intent).toStrictEqual({
                wrap: { lines: 'multi', rowSpacing: 8, columnSpacing: 8 },
            });
            expect(of('flex-wrap', 'gap-xs').props).toStrictEqual({});
            // The axis-qualified spellings stop being an orientation question: both
            // spacings are real on a FlowBox, whichever way the lines run.
            expect(of('flex-wrap', 'gap-x-xs', 'gap-y-s').intent).toStrictEqual({
                wrap: { lines: 'multi', columnSpacing: 8, rowSpacing: 12 },
            });
            // …which is also why the two-spellings refusal stops applying, and only
            // then: without the wrap it is still one `Gtk.Box:spacing` being asked
            // for twice.
            expect(of('flex-wrap', 'gap-xs', 'gap-y-s').intent).toStrictEqual({
                wrap: { lines: 'multi', rowSpacing: 12, columnSpacing: 8 },
            });
            expect(threw(() => of('gap-xs', 'gap-y-s')).message).toContain('ONE `spacing`');
            // The class order does not decide it: the route table is iterated in its
            // own declaration order, with `flexWrap` ahead of the gaps.
            expect(of('gap-xs', 'flex-wrap').intent).toStrictEqual({
                wrap: { lines: 'multi', rowSpacing: 8, columnSpacing: 8 },
            });
        });

        await it('defers both axes of alignment to the shadow tree', async () => {
            // `items-*` sets a property on every CHILD and `self-*` reads the
            // PARENT's orientation; neither is knowable from one element's classes.
            expect(of('items-center').intent).toStrictEqual({ alignChildren: 'center' });
            expect(of('items-start').intent).toStrictEqual({ alignChildren: 'flex-start' });
            expect(of('self-end').intent).toStrictEqual({ alignSelf: 'flex-end' });
            expect(of('items-center').props).toStrictEqual({});
        });

        await it('defers justify-between and REFUSES the two no child count can save', async () => {
            // `space-between` is a widget choice — `Gtk.CenterBox` for two or three
            // children — so the child count decides and L2 holds it (ADR 0032 § 6).
            // `space-around`/`space-evenly` are different: GTK has no per-gap
            // distribution at ANY child count, so deferring them would only move the
            // refusal somewhere later and less specific.
            expect(of('justify-between').intent).toStrictEqual({ distribute: 'space-between' });
            expect(of('justify-center').intent).toStrictEqual({ distribute: 'center' });
            expect(threw(() => resolveUtility('justify-around', TOKENS)).message).toContain('no per-gap distribution');
            expect(threw(() => resolveUtility('justify-evenly', TOKENS)).message).toContain('Gtk.CenterBox');
        });

        await it('gives a plain gap the box property and an axis-qualified one an intent', async () => {
            // A `Gtk.Box` has ONE spacing, so `gap-x-*` is that spacing or nothing,
            // and which it is depends on an orientation whose DEFAULTS disagree
            // between the two vocabularies (Gtk.Box is horizontal, a View is a
            // column) — there is not even a safe guess to fall back on.
            expect(of('gap-xs').props).toStrictEqual({ spacing: 8 });
            expect(of('gap-x-xs').intent).toStrictEqual({ axisSpacing: { axis: 'horizontal', pixels: 8 } });
            expect(of('gap-y-s').intent).toStrictEqual({ axisSpacing: { axis: 'vertical', pixels: 12 } });
            // Two spellings on one element ask for two spacings a box does not have.
            expect(threw(() => of('gap-xs', 'gap-y-s')).message).toContain('ONE `spacing`');
        });

        await it('separates “fill what you are given” from “never be smaller than”', async () => {
            // `w-full` is not a size at all: `hexpand` takes the space that is going,
            // `width-request` sets a floor. Collapsing them would make `w-full` a
            // fixed width, which looks right until the window is resized.
            expect(of('w-full', 'h-full').props).toStrictEqual({ hexpand: true, vexpand: true });
            expect(of('w-icon').props).toStrictEqual({ 'width-request': 24 });
            // The width scale falls back to spacing, Tailwind's own layering.
            expect(of('h-m').props).toStrictEqual({ 'height-request': 16 });
            expect(threw(() => resolveUtility('w-1/2', TOKENS)).message).toContain('no percentage size');
        });

        await it('maps overflow to the real widget property, and scrolling to a widget', async () => {
            // Not every layout utility is an intent: `overflow` is on `Gtk.Widget`
            // and `GtkOverflow` has exactly VISIBLE and HIDDEN (measured), so this
            // one is an ordinary property. `scroll` is not an overflow mode on GTK
            // at all — it is a different widget around the element.
            expect(of('overflow-hidden').props).toStrictEqual({ overflow: 'hidden' });
            expect(of('overflow-visible').props).toStrictEqual({ overflow: 'visible' });
            expect(threw(() => resolveUtility('overflow-scroll', TOKENS)).message).toContain('Gtk.ScrolledWindow');
        });

        await it('turns absolute positioning into a request against the PARENT', async () => {
            // A widget cannot make its own parent a `Gtk.Overlay`, and the measured
            // application only ever writes `absolute` on the child — so the intent
            // travels up. `relative` is carried rather than dropped because it is
            // the half L2 can hold the other half against.
            expect(of('absolute', 'inset-0').intent).toStrictEqual({
                overlay: { role: 'child', edges: { top: 0, right: 0, bottom: 0, left: 0 } },
            });
            expect(of('absolute', 'top-xs', 'left-2xs').intent).toStrictEqual({
                overlay: { role: 'child', edges: { top: 8, left: 4 } },
            });
            expect(of('relative').intent).toStrictEqual({ overlay: { role: 'context' } });
            // An offset with no positioning has nothing to offset from: GTK has no
            // relative offset, only a margin.
            expect(threw(() => of('top-xs')).message).toContain('no relative offset');
        });

        await it('sends text alignment to a widget only the tree can find', async () => {
            // `xalign` and `justify` are `Gtk.Label`'s; `Gtk.Box` has neither
            // (measured). And GTK aligns text PHYSICALLY, so the logical spellings
            // have nothing to map onto — the mirror image of the margin story.
            expect(of('text-center').intent).toStrictEqual({ textAlign: 'center' });
            expect(of('text-justify').intent).toStrictEqual({ textAlign: 'justify' });
            expect(threw(() => resolveUtility('text-start', TOKENS)).message).toContain('PHYSICALLY');
        });

        await it('maps hidden onto visibility, and refuses a growth factor', async () => {
            expect(of('hidden').props).toStrictEqual({ visible: false });
            // GTK's growth is a boolean, so there is no factor to carry and no basis.
            expect(threw(() => resolveUtility('flex-2', TOKENS)).message).toContain('no growth factor');
            expect(threw(() => resolveUtility('basis-xs', TOKENS)).message).toContain('no growth factor');
        });

        await it('names the scale a spacing token is missing from', async () => {
            const error = threw(() => resolveUtility('mt-nonsuch', TOKENS));
            expect(error.message).toContain('spacing scale');
            expect(error.message).toContain('2xs');
        });

        await it('refuses a token whose unit the widget channel cannot store', async () => {
            // A real wart, and a loud one. `padding` keeps its unit because it is
            // CSS; `margin-top` is a `gint` of device pixels with no conversion
            // behind it. So a `rem` scale pads and cannot margin — reported by name
            // rather than silently rounded to 2px.
            const rem: StyleTokens = { spacing: { m: '2rem' } };
            expect(partition(resolveUtilities(['p-m'], rem)).css).toStrictEqual([
                'padding-top: 2rem',
                'padding-right: 2rem',
                'padding-bottom: 2rem',
                'padding-left: 2rem',
            ]);
            expect(threw(() => partition(resolveUtilities(['mt-m'], rem))).message).toContain('not a pixel length');
        });

        await it('reports an unknown utility as unknown, from the only place that knows', async () => {
            // Neither half claimed it. Both halves returning null is the ONLY signal
            // that distinguishes this from a bad token in a family that does exist.
            expect(threw(() => resolveUtility('wibble-3', TOKENS)).message).toContain(
                'not a utility this vocabulary declares',
            );
        });
    });

    await describe('the layout partition', async () => {
        // One sample per routed property, so the invariants below cover the vocabulary
        // rather than whatever the vectors above happened to touch.
        const SAMPLES: LayoutProps = {
            marginTop: '8px',
            marginRight: '8px',
            marginBottom: '8px',
            marginLeft: '8px',
            marginStart: '8px',
            marginEnd: '8px',
            paddingTop: '8px',
            paddingRight: '8px',
            paddingBottom: '8px',
            paddingLeft: '8px',
            flexDirection: 'row',
            flexWrap: 'nowrap',
            flexGrow: '1',
            alignItems: 'center',
            justifyContent: 'center',
            alignSelf: 'center',
            gap: '8px',
            columnGap: '8px',
            rowGap: '8px',
            width: '48px',
            height: '48px',
            overflow: 'hidden',
            display: 'none',
            position: 'absolute',
            top: '0px',
            right: '0px',
            bottom: '0px',
            left: '0px',
            textAlign: 'center',
        };
        const SAMPLED = Object.keys(SAMPLES) as (keyof LayoutProps)[];

        const pick = (...keys: readonly (keyof LayoutProps)[]): LayoutProps => {
            const out: LayoutProps = {};
            for (const key of keys) (out as Record<string, unknown>)[key] = SAMPLES[key];
            return out;
        };

        // Grouped so the CROSS-KEY refusals stay refusals: a physical and a logical
        // horizontal margin cannot meet, and neither can two gap spellings. Splitting
        // them here is the alternative to weakening the rules to make one big record
        // partition, which would test the opposite of what the rules say.
        const APART: readonly (keyof LayoutProps)[] = ['marginStart', 'marginEnd', 'columnGap', 'rowGap'];
        const GROUPS: readonly LayoutProps[] = [
            pick(...SAMPLED.filter((key) => !APART.includes(key))),
            pick('marginStart', 'marginEnd', 'columnGap'),
            pick('rowGap'),
            // The `100%` branch, the only one that reaches hexpand/vexpand.
            { width: '100%', height: '100%' },
            { display: 'flex' },
        ];

        await it('has a sample for every property it routes', async () => {
            // Without this the two invariants below would pass by testing less.
            expect([...LAYOUT_PROPERTIES].filter((key) => !(key in SAMPLES)).sort()).toStrictEqual([]);
            expect(SAMPLED.filter((key) => !LAYOUT_PROPERTIES.has(key)).sort()).toStrictEqual([]);
        });

        await it('emits only CSS properties GTK measurably accepts', async () => {
            // The silence the whole partition exists against: GTK's parser drops an
            // unknown declaration without a word, so a wrong name here is invisible
            // in CI and obvious on screen.
            const emitted = GROUPS.flatMap((group) => partitionLayout(group).css).map((rule) => rule.split(':')[0]);
            expect([...new Set(emitted)].filter((name) => !GTK_CSS_PROPERTIES.has(name))).toStrictEqual([]);
        });

        await it('emits only widget properties some GTK class measurably installs', async () => {
            const emitted = GROUPS.flatMap((group) => Object.keys(partitionLayout(group).props));
            expect([...new Set(emitted)].filter((name) => !GTK_WIDGET_PROPERTIES.has(name))).toStrictEqual([]);
        });

        await it('claims no property the paint half also claims', async () => {
            // The dispatch routes a key by asking paint first, so a key in both sets
            // would be silently painted and never laid out — a class of bug that
            // cannot be found by reading either file alone.
            expect([...LAYOUT_PROPERTIES].filter((key) => PAINT_PROPERTIES.has(key))).toStrictEqual([]);
        });

        await it('carries paint and layout through one call, without either losing anything', async () => {
            // The composed shape, which is what a renderer actually consumes.
            const { css, props, intent } = of('bg-black', 'p-xs', 'mt-xs', 'flex-col', 'flex-1');
            expect(css).toStrictEqual([
                'background-color: rgb(0 0 0)',
                'padding-top: 8px',
                'padding-right: 8px',
                'padding-bottom: 8px',
                'padding-left: 8px',
            ]);
            expect(props).toStrictEqual({ 'margin-top': 8, orientation: 'vertical' });
            expect(intent).toStrictEqual({ expand: 'main-axis' });
        });
    });
};
