// The layout half of the style partition: utility classes → properties → the THREE
// destinations GTK actually has.
//
// The paint half had one destination and one question. This half has three, and
// which one a property takes is a MEASUREMENT rather than a taste (`gtk-css.ts`,
// `gtk-props.ts`):
//
//   css     — GTK's CSS parser accepts the name (`padding-left`, `margin-left`).
//   props   — some GTK class installs a property by that name (`margin-start`,
//             `orientation`, `hexpand`, `overflow`).
//   intent  — NEITHER can answer it here, because the answer needs the parent, the
//             children, or the widget this element turns into. L2 resolves it
//             against the shadow tree at attach time (ADR 0032 § 6).
//
// THE DECISIVE MEASUREMENT, and the one thing to keep if everything else is
// rewritten: GTK CSS margins are PHYSICAL ONLY — `margin-left` parses,
// `margin-start` does not — while the widget's own margins are LOGICAL ONLY —
// `Gtk.Widget:margin-start` exists, `margin-left` does not. Tailwind splits its
// vocabulary along the same line: `ml-*`/`mr-*` are physical, `ms-*`/`me-*` are
// logical. So the two GTK mechanisms are not two ways to spell one thing that a
// layer gets to choose between; each is the ONLY route for one half of the source
// vocabulary, and routing `ms-*` through CSS would produce a margin that does not
// flip under RTL — a bug visible only to a reader of Arabic or Hebrew.
//
// Padding has no second route at all: no GTK class installs a `padding` property of
// any kind (measured), so every padding is CSS, and a logical one (`ps-*`) is a
// named refusal rather than a physical approximation.
//
// `mt-*`/`mb-*` have no logical/physical distinction to preserve, so they take the
// widget channel with `ms-*`/`me-*` — which leaves `m-*` straddling both, because
// Tailwind's `m-*` is physical: its horizontal half is CSS and its vertical half is
// widget properties. That looks like an inconsistency and is the opposite: it is
// what keeps `m-4 mx-2` resolving by last-wins on ONE key instead of stacking a CSS
// margin on top of a widget margin. `m-4 ms-2` cannot be saved that way and is
// refused by name, because on GTK the two channels ADD where CSS would have let one
// win.

import { UnknownUtilityError } from './errors.js';
import { GTK_CSS_PROPERTIES } from './gtk-css.js';
import { GTK_WIDGET_PROPERTIES } from './gtk-props.js';
import { requireToken, type Scale, type StyleTokens } from './tokens.js';

/** React Native's own `alignItems`/`alignSelf` vocabulary. */
export type AlignValue = 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
/** React Native's own `justifyContent` vocabulary. */
export type JustifyValue = 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
/** The four physical edges an absolutely positioned element offsets from. */
export type Edge = 'top' | 'right' | 'bottom' | 'left';

/**
 * The properties the layout half understands, in React Native's spelling.
 *
 * The VALUES are React Native's too — `alignItems: 'flex-start'`, not `'start'` —
 * and that is the point of ADR 0032 § 4 rather than a detail. A class list and a
 * `style={{…}}` object are one information set arriving by two routes, and 48 of
 * the measured application's 57 style objects carry exactly these names and values.
 * Normalising the classes into a third spelling would put a translation table
 * between the two front ends and give the partition two truths to keep in step.
 */
export interface LayoutProps {
    marginTop?: string;
    marginRight?: string;
    marginBottom?: string;
    marginLeft?: string;
    marginStart?: string;
    marginEnd?: string;
    paddingTop?: string;
    paddingRight?: string;
    paddingBottom?: string;
    paddingLeft?: string;
    flexDirection?: 'row' | 'column';
    flexGrow?: string;
    alignItems?: AlignValue;
    justifyContent?: JustifyValue;
    alignSelf?: AlignValue;
    gap?: string;
    columnGap?: string;
    rowGap?: string;
    width?: string;
    height?: string;
    overflow?: 'visible' | 'hidden' | 'scroll';
    display?: 'flex' | 'none';
    position?: 'relative' | 'absolute';
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
}

/**
 * What L1 could not answer, for L2 to resolve against the shadow tree.
 *
 * Every field here is a case where the same input compiles to DIFFERENT GTK
 * depending on something no per-element function can see. Nothing is an intent for
 * being hard: `overflow-hidden` needs the parent no more than `bg-red` does, and it
 * is a widget property below rather than a field here.
 */
export interface LayoutIntent {
    /**
     * `flex-1` — `hexpand` on a row, `vexpand` on a column.
     *
     * ADR 0032 § 6, and the reason the intent mechanism exists at all: the axis is
     * the PARENT's orientation, which an element does not know about itself.
     */
    readonly expand?: 'main-axis';
    /**
     * `items-*` — the cross-axis alignment of every CHILD.
     *
     * Two things missing at once. GTK has no `align-items`: the alignment lives on
     * each child as `halign`/`valign`, so L2 must walk children this function has
     * never seen. And WHICH of the two it is depends on this element's own
     * orientation, which is `Gtk.Box`'s default when no `flex-row`/`flex-col` says
     * otherwise — and the defaults disagree (`Gtk.Box` is horizontal, a React
     * Native `View` is a column), so there is not even a safe fallback to guess.
     */
    readonly alignChildren?: AlignValue;
    /**
     * `justify-*` — main-axis distribution.
     *
     * `space-between` is a WIDGET CHOICE, not a property: `Gtk.CenterBox` for two or
     * three children and a named refusal beyond that (ADR 0032 § 6). The child count
     * decides, and L1 has no children. The other three are the box's own
     * `halign`/`valign`, which needs the orientation for the same reason
     * {@link LayoutIntent.alignChildren} does.
     */
    readonly distribute?: JustifyValue;
    /**
     * `self-*` — this element's own cross-axis alignment.
     *
     * `halign` or `valign` by the PARENT's orientation. Same shape as
     * {@link LayoutIntent.expand}, same reason, one axis over.
     */
    readonly alignSelf?: AlignValue;
    /**
     * `gap-x-*` / `gap-y-*` — a spacing that is only valid on one orientation.
     *
     * `Gtk.Box` has ONE `spacing` (measured), so an axis-qualified gap is either
     * that spacing or nothing at all, and which it is depends on the orientation
     * L1 cannot see. Refusing the spelling outright was the alternative and is
     * worse: `gap-x-2` on a row is ordinary, unambiguous authoring, and L2 answers
     * it exactly.
     */
    readonly axisSpacing?: { readonly axis: 'horizontal' | 'vertical'; readonly pixels: number };
    /**
     * `absolute` / `relative` / `inset-*` / `top-*` — the parent must be a `Gtk.Overlay`.
     *
     * A widget cannot make its own parent a different class, so the child's
     * `absolute` is a request L2 executes on the PARENT. The `context` role is
     * `relative`'s: it sets nothing (an overlay establishes the context by being
     * one) but it is carried rather than dropped, because it is the half of the
     * pair L2 can hold the other half against — an `absolute` child under a parent
     * that never declared `relative` is a real authoring bug, and a dropped
     * `relative` would make it undetectable.
     */
    readonly overlay?: OverlayIntent;
    /**
     * `text-*` — only a text widget aligns text.
     *
     * `xalign` and `justify` are `Gtk.Label`'s; `Gtk.Box` has neither (measured).
     * A `<View className="text-center">` wrapping a `<Text>` is ordinary React
     * Native, and on GTK the property has to travel to the label, which is a tree
     * walk and therefore L2's.
     */
    readonly textAlign?: 'left' | 'center' | 'right' | 'justify';
}

export type OverlayIntent =
    | { readonly role: 'context' }
    | { readonly role: 'child'; readonly edges: Readonly<Partial<Record<Edge, number>>> };

/** What {@link partitionLayout} contributes to the partition. */
export interface LayoutPartition {
    readonly css: readonly string[];
    readonly props: Readonly<Record<string, unknown>>;
    readonly intent: LayoutIntent;
}

// One reason per refusal, shared by the two front ends that hit it. The class path
// throws with the utility name because that is what the author wrote; the property
// path throws with the property name because a `style={{…}}` object has no class.
// The REASON is the same fact either way, and a second copy of it is a second thing
// to keep true.
const NO_FLEX_FACTOR =
    'GTK expresses main-axis growth as the boolean `hexpand`/`vexpand`, so there is no growth factor, no shrink factor and no flex basis to carry. `flex-1` is the only spelling with a GTK meaning';
const NO_SPACE_DISTRIBUTION =
    "GTK's box gives leftover main-axis space to the children that expand; it has no per-gap distribution mode, and `Gtk.CenterBox` has exactly three slots. Unlike `justify-between`, no child count makes this expressible, so it is refused here rather than deferred to the shadow tree";
const NO_SCROLL_OVERFLOW =
    'scrolling is a WIDGET on GTK, not an overflow mode: wrap the element in a `Gtk.ScrolledWindow` (React Native `ScrollView`). `Gtk.Overflow` has exactly VISIBLE and HIDDEN (measured)';
const NO_LOGICAL_PADDING =
    'GTK has no logical padding in either mechanism — `padding-start` is not a CSS property (measured) and no GTK class installs a padding property at all — so it cannot be expressed even approximately. Use `pl-*`/`pr-*`';
const NO_LOGICAL_TEXT_ALIGN =
    'GTK aligns text PHYSICALLY: `Gtk.Label:xalign` is 0 = left, and `GtkJustification` has exactly LEFT, RIGHT, CENTER and FILL (measured). There is no start/end spelling to map onto. Use `text-left`/`text-right`';
const NO_PERCENTAGE_SIZE =
    'GTK has no percentage size: a widget requests a MINIMUM in pixels (`width-request`) or expands to fill what it is given (`hexpand`). `w-full`/`h-full` are the only fractions with an exact GTK meaning';

/** Family → the {@link LayoutProps} keys one token fills. */
const MARGIN_SIDES: Readonly<Record<string, readonly (keyof LayoutProps)[]>> = {
    m: ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'],
    mt: ['marginTop'],
    mr: ['marginRight'],
    mb: ['marginBottom'],
    ml: ['marginLeft'],
    mx: ['marginLeft', 'marginRight'],
    my: ['marginTop', 'marginBottom'],
    ms: ['marginStart'],
    me: ['marginEnd'],
};

const PADDING_SIDES: Readonly<Record<string, readonly (keyof LayoutProps)[]>> = {
    p: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
    pt: ['paddingTop'],
    pr: ['paddingRight'],
    pb: ['paddingBottom'],
    pl: ['paddingLeft'],
    px: ['paddingLeft', 'paddingRight'],
    py: ['paddingTop', 'paddingBottom'],
};

const EDGE_KEYS: Readonly<Record<string, readonly Edge[]>> = {
    inset: ['top', 'right', 'bottom', 'left'],
    top: ['top'],
    right: ['right'],
    bottom: ['bottom'],
    left: ['left'],
};

const ALIGN_TOKENS: Readonly<Record<string, AlignValue>> = {
    start: 'flex-start',
    end: 'flex-end',
    center: 'center',
    stretch: 'stretch',
    baseline: 'baseline',
};

const JUSTIFY_TOKENS: Readonly<Record<string, JustifyValue>> = {
    start: 'flex-start',
    end: 'flex-end',
    center: 'center',
    between: 'space-between',
    around: 'space-around',
    evenly: 'space-evenly',
};

const fill = (keys: readonly (keyof LayoutProps)[], value: string): LayoutProps => {
    const out: LayoutProps = {};
    // Written through a string view: every key these three tables carry is a plain
    // string-valued one, and narrowing the parameter type to prove it costs more
    // mapped-type machinery than the assertion is worth.
    for (const key of keys) (out as Record<string, string>)[key] = value;
    return out;
};

/**
 * `w-<token>` reads the `width` scale and falls back to `spacing`.
 *
 * Tailwind's own layering — its default `width` scale IS `spacing` plus a handful
 * of extras — so a project that only declares `spacing` gets `w-4` for free, and a
 * project that declares both keeps the override. The error names both scales,
 * because "not in the width scale" would send a reader to the wrong file.
 */
function requireSize(tokens: StyleTokens, kind: 'width' | 'height', token: string, utility: string): string {
    const own: Scale | undefined = tokens[kind];
    const value = own?.[token] ?? tokens.spacing?.[token];
    if (value !== undefined) return value;
    const known = [...new Set([...Object.keys(own ?? {}), ...Object.keys(tokens.spacing ?? {})])].sort().join(', ');
    throw new UnknownUtilityError(
        utility,
        `"${token}" is in neither the ${kind} nor the spacing scale. Known: ${known === '' ? '(neither scale is configured)' : known}`,
    );
}

/**
 * One utility class → the layout properties it sets, or `null` for "not mine".
 *
 * `null` rather than a throw is what lets `resolve.ts` try both halves without
 * either of them knowing the other exists. A family this half DOES own with a bad
 * token still throws, and that distinction is the whole point: `flex-2` is a
 * refusal with a reason, `wibble-3` is an unknown name.
 */
export function resolveLayoutUtility(utility: string, tokens: StyleTokens): LayoutProps | null {
    switch (utility) {
        case 'flex-1':
        case 'grow':
            return { flexGrow: '1' };
        case 'flex-row':
            return { flexDirection: 'row' };
        case 'flex-col':
            return { flexDirection: 'column' };
        case 'flex-nowrap':
            // `Gtk.Box` never wraps, so this restates the platform. The empty record
            // is not a dropped utility: the name is DECLARED here and asserted empty
            // in the spec, which is what separates "means nothing on GTK" from "was
            // never recognised".
            return {};
        case 'flex-wrap':
        case 'flex-wrap-reverse':
            throw new UnknownUtilityError(
                utility,
                'a `Gtk.Box` cannot wrap. Wrapping is a different widget — `Gtk.FlowBox` — and swapping the widget under an element is L2 widget selection, not a style property',
            );
        case 'flex-row-reverse':
        case 'flex-col-reverse':
            throw new UnknownUtilityError(
                utility,
                '`Gtk.Box` has no reversed orientation (`GtkOrientation` is HORIZONTAL and VERTICAL, measured). Reverse the children instead — the shadow tree is the order',
            );
        case 'absolute':
            return { position: 'absolute' };
        case 'relative':
            return { position: 'relative' };
        case 'hidden':
            return { display: 'none' };
        case 'overflow-hidden':
            return { overflow: 'hidden' };
        case 'overflow-visible':
            return { overflow: 'visible' };
        case 'overflow-scroll':
        case 'overflow-auto':
            throw new UnknownUtilityError(utility, NO_SCROLL_OVERFLOW);
        // Before the `w`/`h` families below, so a project whose width scale happens
        // to carry a `full` token cannot turn `w-full` into a width REQUEST — the
        // one spelling that must stay an expand.
        case 'w-full':
            return { width: '100%' };
        case 'h-full':
            return { height: '100%' };
    }

    const dash = utility.indexOf('-');
    const family = dash === -1 ? utility : utility.slice(0, dash);
    const token = dash === -1 ? '' : utility.slice(dash + 1);

    const marginSides = MARGIN_SIDES[family];
    if (marginSides !== undefined) return fill(marginSides, requireToken(tokens.spacing, token, utility, 'spacing'));

    const paddingSides = PADDING_SIDES[family];
    if (paddingSides !== undefined) return fill(paddingSides, requireToken(tokens.spacing, token, utility, 'spacing'));

    const edges = EDGE_KEYS[family];
    if (edges !== undefined) return fill(edges, requireToken(tokens.spacing, token, utility, 'spacing'));

    switch (family) {
        case 'ps':
        case 'pe':
            throw new UnknownUtilityError(utility, NO_LOGICAL_PADDING);
        case 'flex':
        case 'grow':
        case 'shrink':
        case 'basis':
            throw new UnknownUtilityError(utility, NO_FLEX_FACTOR);
        case 'items': {
            const value = ALIGN_TOKENS[token];
            if (value === undefined) throw unknownToken(utility, token, ALIGN_TOKENS);
            return { alignItems: value };
        }
        case 'self': {
            // `self-baseline` is deliberately absent: `align-self: baseline` needs a
            // shared baseline group, which GTK expresses as the BOX's
            // `baseline-position` (measured on `Gtk.Box`, absent from `Gtk.Widget`)
            // rather than per child. `items-baseline` is the spelling that maps.
            const value = token === 'baseline' ? undefined : ALIGN_TOKENS[token];
            if (value === undefined) {
                throw token === 'baseline'
                    ? new UnknownUtilityError(
                          utility,
                          'a baseline is shared by a whole row, so GTK carries it on the BOX as `baseline-position` (measured on `Gtk.Box`, absent from `Gtk.Widget`) rather than per child. Use `items-baseline` on the parent',
                      )
                    : unknownToken(utility, token, ALIGN_TOKENS);
            }
            return { alignSelf: value };
        }
        case 'justify': {
            if (token === 'around' || token === 'evenly') {
                throw new UnknownUtilityError(utility, NO_SPACE_DISTRIBUTION);
            }
            const value = JUSTIFY_TOKENS[token];
            if (value === undefined) throw unknownToken(utility, token, JUSTIFY_TOKENS);
            return { justifyContent: value };
        }
        case 'gap': {
            // `gap-x-4` and `gap-y-4` are the axis-qualified spellings; anything else
            // after the family is the token itself.
            if (token.startsWith('x-')) {
                return { columnGap: requireToken(tokens.spacing, token.slice(2), utility, 'spacing') };
            }
            if (token.startsWith('y-')) {
                return { rowGap: requireToken(tokens.spacing, token.slice(2), utility, 'spacing') };
            }
            return { gap: requireToken(tokens.spacing, token, utility, 'spacing') };
        }
        case 'w':
        case 'h': {
            // `w-1/2` is Tailwind's fraction. It is the one `/` a layout utility
            // carries, and the paint half's alpha modifier never reaches here.
            if (token.includes('/')) throw new UnknownUtilityError(utility, NO_PERCENTAGE_SIZE);
            const kind = family === 'w' ? 'width' : 'height';
            return { [kind]: requireSize(tokens, kind, token, utility) } as LayoutProps;
        }
        case 'text': {
            // The paint half owns `text-*` and hands these three back as unclaimed,
            // because `text-align` is not GTK CSS at all (measured) — it is a widget
            // property on a widget only L2 can find.
            if (token === 'left' || token === 'center' || token === 'right' || token === 'justify') {
                return { textAlign: token };
            }
            if (token === 'start' || token === 'end') throw new UnknownUtilityError(utility, NO_LOGICAL_TEXT_ALIGN);
            // Every other `text-*` token is a size or a colour and the paint half
            // has already answered it. Handing it back rather than throwing keeps
            // this function independent of which tokens that filter lets through.
            return null;
        }
    }

    return null;
}

const unknownToken = (utility: string, token: string, table: Readonly<Record<string, string>>): UnknownUtilityError =>
    new UnknownUtilityError(
        utility,
        `"${token}" is not a value of this family. Known: ${Object.keys(table).join(', ')}`,
    );

interface MutableIntent {
    expand?: 'main-axis';
    alignChildren?: AlignValue;
    distribute?: JustifyValue;
    alignSelf?: AlignValue;
    axisSpacing?: { axis: 'horizontal' | 'vertical'; pixels: number };
    overlay?: { role: 'context' } | { role: 'child'; edges: Partial<Record<Edge, number>> };
    textAlign?: 'left' | 'center' | 'right' | 'justify';
}

interface Sink {
    readonly css: string[];
    readonly props: Record<string, unknown>;
    readonly intent: MutableIntent;
}

/**
 * Emit a CSS declaration, against the measured accepted set.
 *
 * Same guard as the paint half's, for the same reason: a name GTK does not accept
 * is dropped by its parser without a diagnostic, so an edit to the table below is
 * the only way this layer can go silently wrong.
 */
function emitCss(sink: Sink, property: string, value: string): void {
    if (!GTK_CSS_PROPERTIES.has(property)) {
        throw new UnknownUtilityError(property, 'is not a property GTK accepts in a stylesheet — see gtk-css.ts');
    }
    sink.css.push(`${property}: ${value}`);
}

/** Emit a widget property, against the measured installed set. */
function emitProp(sink: Sink, property: string, value: unknown): void {
    if (!GTK_WIDGET_PROPERTIES.has(property)) {
        throw new UnknownUtilityError(property, 'is not a property any GTK class installs — see gtk-props.ts');
    }
    sink.props[property] = value;
}

const PIXELS = /^(-?\d+(?:\.\d+)?)(?:px)?$/;

/**
 * A token value → the integer a GTK property stores.
 *
 * `margin-top`, `spacing` and `width-request` are all `gint` of DEVICE pixels
 * (measured), and GTK exposes no unit conversion behind them. So a spacing scale
 * spelled in `rem` or `%` reaches padding — which is CSS, and keeps its unit —
 * and is a named error the moment the same token is asked to become a margin.
 * Refusing beats the alternative, which is a `2rem` margin silently becoming 2px.
 */
function pixels(value: string, property: string): number {
    const match = PIXELS.exec(value.trim());
    if (match === null) {
        throw new UnknownUtilityError(
            property,
            `"${value}" is not a pixel length. GTK's "${property}" is a gint of device pixels (measured, gtk-props.ts) with no unit conversion behind it, so only "12px" and "12" can be stored`,
        );
    }
    return Math.round(Number(match[1]));
}

function oneOf<T extends string>(value: string, allowed: readonly T[], property: string): T {
    if ((allowed as readonly string[]).includes(value)) return value as T;
    throw new UnknownUtilityError(
        property,
        `"${value}" is not a value this partition routes. Known: ${allowed.join(', ')}`,
    );
}

type Route = (value: string, sink: Sink) => void;

const edgeRoute =
    (edge: Edge): Route =>
    (value, sink) => {
        // `position` is routed FIRST by the declaration order of this table, so an
        // absolutely positioned element already carries its overlay intent here.
        // Anything else reaching this line has an offset and no positioning, which
        // GTK cannot express at all — there is no relative offset, only a margin.
        const overlay = sink.intent.overlay;
        if (overlay === undefined || overlay.role !== 'child') {
            throw new UnknownUtilityError(
                edge,
                'only offsets an element that is absolutely positioned, and this one is not. GTK has no relative offset: add `absolute` (which makes the parent a `Gtk.Overlay`), or express the distance as a margin',
            );
        }
        overlay.edges[edge] = pixels(value, edge);
    };

/**
 * Property → destination, and WHY it is that destination.
 *
 * Typed as a TOTAL record of {@link LayoutProps} on purpose: adding a property
 * without deciding where it goes is then a type error, rather than a value that
 * partitions into nothing and shows up as a style that did not apply.
 *
 * ITERATED IN DECLARATION ORDER rather than in the record's own key order, which
 * makes the emitted CSS deterministic and lets `position` land before the four
 * edges that need it.
 */
const ROUTES: Readonly<Record<keyof LayoutProps, Route>> = {
    // Vertical margins: no logical/physical distinction exists, so they join the
    // logical pair in the widget channel rather than splitting the family across
    // two mechanisms for nothing.
    marginTop: (value, sink) => emitProp(sink, 'margin-top', pixels(value, 'margin-top')),
    marginBottom: (value, sink) => emitProp(sink, 'margin-bottom', pixels(value, 'margin-bottom')),
    // Logical horizontal margins — the widget's, and ONLY the widget's: GTK CSS has
    // no `margin-start` (measured). These are the ones that flip under RTL.
    marginStart: (value, sink) => emitProp(sink, 'margin-start', pixels(value, 'margin-start')),
    marginEnd: (value, sink) => emitProp(sink, 'margin-end', pixels(value, 'margin-end')),
    // Physical horizontal margins — CSS's, and ONLY CSS's: no widget installs
    // `margin-left` (measured). Routing `ml-*` through `margin-start` would make it
    // flip under RTL, which is the opposite of what the author asked for.
    marginLeft: (value, sink) => emitCss(sink, 'margin-left', value),
    marginRight: (value, sink) => emitCss(sink, 'margin-right', value),
    // Padding has exactly one mechanism, so there is no choice to explain — and the
    // value keeps its unit, which is why a `rem` scale pads and cannot margin.
    paddingTop: (value, sink) => emitCss(sink, 'padding-top', value),
    paddingRight: (value, sink) => emitCss(sink, 'padding-right', value),
    paddingBottom: (value, sink) => emitCss(sink, 'padding-bottom', value),
    paddingLeft: (value, sink) => emitCss(sink, 'padding-left', value),
    // `orientation` is `Gtk.Box`'s, not `Gtk.Widget`'s (measured), so this is a
    // property L1 may name and only L2 may apply — a `Gtk.Label` has none.
    //
    // The value is a NICK, not the numeric enum member: `applyProps` coerces it
    // through the ParamSpec, and a nick is what a reader can check against the GIR.
    // It is emphatically not something to assign directly — `box.orientation =
    // 'vertical'` keeps HORIZONTAL with no diagnostic at all (measured, gjs 1.88.1),
    // which is why `props` is documented as what the HOST applies.
    flexDirection: (value, sink) =>
        emitProp(
            sink,
            'orientation',
            oneOf(value, ['row', 'column'], 'flexDirection') === 'row' ? 'horizontal' : 'vertical',
        ),
    flexGrow: (value, sink) => {
        if (value !== '1') throw new UnknownUtilityError('flexGrow', NO_FLEX_FACTOR);
        sink.intent.expand = 'main-axis';
    },
    alignItems: (value, sink) => {
        sink.intent.alignChildren = oneOf(
            value,
            ['flex-start', 'flex-end', 'center', 'stretch', 'baseline'],
            'alignItems',
        );
    },
    justifyContent: (value, sink) => {
        // The class path already refused these by name. This branch is the OTHER
        // front end — a `style={{ justifyContent: 'space-around' }}` object — and
        // ADR 0032 § 4 requires both to be loud, from one stated reason.
        if (value === 'space-around' || value === 'space-evenly') {
            throw new UnknownUtilityError('justifyContent', NO_SPACE_DISTRIBUTION);
        }
        sink.intent.distribute = oneOf(value, ['flex-start', 'flex-end', 'center', 'space-between'], 'justifyContent');
    },
    alignSelf: (value, sink) => {
        sink.intent.alignSelf = oneOf(value, ['flex-start', 'flex-end', 'center', 'stretch', 'baseline'], 'alignSelf');
    },
    gap: (value, sink) => emitProp(sink, 'spacing', pixels(value, 'spacing')),
    columnGap: (value, sink) => {
        sink.intent.axisSpacing = { axis: 'horizontal', pixels: pixels(value, 'spacing') };
    },
    rowGap: (value, sink) => {
        sink.intent.axisSpacing = { axis: 'vertical', pixels: pixels(value, 'spacing') };
    },
    // `100%` is the ONLY fraction with an exact GTK meaning, and it is not a size at
    // all: `hexpand` says "take what is going", where `width-request` says "never
    // less than this". Collapsing them would make `w-full` a fixed width.
    width: (value, sink) =>
        value === '100%'
            ? emitProp(sink, 'hexpand', true)
            : emitProp(sink, 'width-request', pixels(percentGuard(value, 'width'), 'width-request')),
    height: (value, sink) =>
        value === '100%'
            ? emitProp(sink, 'vexpand', true)
            : emitProp(sink, 'height-request', pixels(percentGuard(value, 'height'), 'height-request')),
    overflow: (value, sink) => {
        if (value === 'scroll') throw new UnknownUtilityError('overflow', NO_SCROLL_OVERFLOW);
        emitProp(sink, 'overflow', oneOf(value, ['visible', 'hidden'], 'overflow'));
    },
    // `display: none` is `visible: false`, and `display: flex` is `visible: true`
    // rather than nothing — an explicit round trip beats a branch that emits
    // nothing, which is indistinguishable from a property that was never routed.
    display: (value, sink) => emitProp(sink, 'visible', oneOf(value, ['flex', 'none'], 'display') === 'flex'),
    position: (value, sink) => {
        sink.intent.overlay =
            oneOf(value, ['relative', 'absolute'], 'position') === 'absolute'
                ? { role: 'child', edges: {} }
                : { role: 'context' };
    },
    top: edgeRoute('top'),
    right: edgeRoute('right'),
    bottom: edgeRoute('bottom'),
    left: edgeRoute('left'),
    textAlign: (value, sink) => {
        sink.intent.textAlign = oneOf(value, ['left', 'center', 'right', 'justify'], 'textAlign');
    },
};

/**
 * The {@link LayoutProps} keys, for the dispatch's ownership test.
 *
 * DERIVED from the route table rather than listed: a second list is a second thing
 * to keep true, and the one that drifts is the one that decides whether a property
 * is routed at all.
 */
export const LAYOUT_PROPERTIES: ReadonlySet<string> = new Set(Object.keys(ROUTES));

/** A percentage that is not `100%` never reaches `pixels()`, so it gets the right reason. */
function percentGuard(value: string, property: string): string {
    if (value.endsWith('%')) throw new UnknownUtilityError(property, NO_PERCENTAGE_SIZE);
    return value;
}

/**
 * Layout properties → `{ css, props, intent }`.
 *
 * The two cross-key refusals run first, because both are cases where every
 * individual property is fine and the COMBINATION is what GTK cannot express.
 * They are the reason this is not a per-property `map`.
 */
export function partitionLayout(props: LayoutProps): LayoutPartition {
    const physical = props.marginLeft !== undefined || props.marginRight !== undefined;
    const logical = props.marginStart !== undefined || props.marginEnd !== undefined;
    if (physical && logical) {
        throw new UnknownUtilityError(
            'margin',
            'a physical horizontal margin (`ml-*`/`mr-*`/`mx-*`/`m-*`) becomes GTK CSS and a logical one (`ms-*`/`me-*`) becomes the widget property; GTK applies BOTH and they ADD, where CSS would have let one win. Spell the horizontal margin one way',
        );
    }

    const gaps = ['gap', 'columnGap', 'rowGap'].filter((key) => props[key as keyof LayoutProps] !== undefined);
    if (gaps.length > 1) {
        throw new UnknownUtilityError(
            gaps.join(' + '),
            'a `Gtk.Box` has ONE `spacing` (measured), so two gap spellings on one element ask for two spacings. Keep one',
        );
    }

    const sink: Sink = { css: [], props: {}, intent: {} };
    for (const key of Object.keys(ROUTES) as (keyof LayoutProps)[]) {
        const value = props[key];
        if (value === undefined) continue;
        ROUTES[key](value, sink);
    }
    return sink;
}
