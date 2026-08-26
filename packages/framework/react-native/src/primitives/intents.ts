// The `LayoutIntent` half: what L1 could not answer, answered where it can be.
//
// L1 emits an intent for every case where the SAME input compiles to DIFFERENT GTK
// depending on something no per-element function can see (ADR 0032 § 6). This file
// is the other side of that seam, and its whole content is a ledger of which facts
// L2 has and which it does not.
//
// WHAT IS RESOLVED HERE, and the fact that makes it possible:
//
//   alignChildren  the element's OWN orientation. `items-center` is `halign` on
//                  every child of a column and `valign` on every child of a row,
//                  and the element knows which it is — that is exactly the fact
//                  L1 lacked. GTK has no `align-items`, so the resolved value
//                  travels DOWN to the children rather than being applied here.
//   distribute     the element's own orientation, same reason, one axis over: the
//                  three non-`between` values are the box's own main-axis
//                  `halign`/`valign`.
//   axisSpacing    the element's own orientation. `gap-x-2` on a row IS the box's
//                  `spacing`; on a column it has nothing to space.
//   textAlign      whether the element's own widget aligns text. A `Gtk.Label`
//                  has `xalign` and `justify`; a `Gtk.Box` has neither (measured,
//                  `gtk-props.ts`), so on a non-text widget the value travels
//                  down to the first descendant that can take it.
//   overlay(child) the PARENT's identity, which the caller supplies as context.
//
// WHAT IS PASSED UP, and why no amount of local cleverness closes it:
//
//   expand         `flex-1` is `hexpand` on a row and `vexpand` on a column, and
//                  the axis is the PARENT's orientation. An element cannot see its
//                  own parent, so this is resolved only when the caller HANDS the
//                  parent's orientation in. Absent that, it stays in the returned
//                  intent — never guessed, because guessing wrong makes a full-width
//                  element full-height and the window looks plausible either way.
//   alignSelf      the parent's orientation again, one axis over.
//   overlay(child) when the caller supplies no parent context at all.
//
// THE PARAMETER IS THE SEAM, AND THAT IS THE ANSWER TO ADR 0032 § 6's CHALLENGE.
// § 6 says anyone who pushes this into the framework layer via a React context
// should first say how that context reaches the Vue and Solid adapters. It does
// not, and it is not asked to: what those adapters reach for is
// `resolvePrimitive(name, props, { parent })`, a plain function taking a plain
// record. React's carrier for that record happens to be a context, Vue's would be
// `provide`/`inject`, and neither fact is visible from here. When the host grows an
// attach-time hook, the shadow tree becomes a third caller of the same parameter
// and nothing in this file changes.

import type { AlignValue, Edge, JustifyValue, LayoutIntent } from '@gjsify/gtk-host/style';

import { PrimitiveError } from './errors.js';

export type Orientation = 'horizontal' | 'vertical';

/**
 * What a parent tells its children — and what a child reads about its parent.
 *
 * ONE record in both directions on purpose: every field is a fact the parent knows
 * and the child needs, so a second shape for "what I publish" versus "what I read"
 * would be the same four fields under different names.
 */
export interface ChildContext {
    /** The parent's own orientation. The axis a child's `flex-1` expands along. */
    readonly orientation: Orientation;
    /**
     * Properties every child carries unless it overrides them.
     *
     * A resolved `alignItems`. It is a DEFAULT rather than a command, because
     * `align-self` beats `align-items` in flexbox and a child that set its own
     * `self-*` must win — which it does, by being merged after this.
     */
    readonly props: Readonly<Record<string, unknown>>;
    /** True when the parent is a `Gtk.Overlay` and can take an absolutely positioned child. */
    readonly overlay: boolean;
    /** A `textAlign` still looking for a widget that aligns text. */
    readonly textAlign?: 'left' | 'center' | 'right' | 'justify';
}

/** What the element's own children change about the element. */
export interface ChildFacts {
    /** How many children declare `position: absolute` — non-zero makes a `View` an overlay. */
    readonly absolute: number;
    /** How many children there are at all. */
    readonly count: number;
    /** Whether any child is a text run, which competes with a prop for the text sink. */
    readonly text: boolean;
}

/** What the element's own widget can take. Declared per primitive, measured in the spec. */
export interface WidgetFacts {
    /** Installs `orientation` and `spacing` — a `Gtk.Box`. */
    readonly box: boolean;
    /** Installs `xalign` and `justify` — a `Gtk.Label`. */
    readonly alignsText: boolean;
}

export interface IntentInput {
    readonly primitive: string;
    readonly intent: LayoutIntent;
    /** The element's own orientation, for the node its children go into. */
    readonly orientation: Orientation;
    readonly widget: WidgetFacts;
    readonly parent?: ChildContext;
    readonly children?: ChildFacts;
    /** Widget properties already emitted by L1, read only to catch a clash. */
    readonly emittedProps: Readonly<Record<string, unknown>>;
}

export interface IntentResolution {
    /** Widget properties this resolution adds, GTK spelling. */
    readonly props: Readonly<Record<string, unknown>>;
    /** GTK CSS declarations this resolution adds, before the class is minted. */
    readonly css: readonly string[];
    /** What this element publishes to its children. */
    readonly childContext: ChildContext;
    /** The `slot` this element declares to its parent, or null. */
    readonly slot: string | null;
    /** What is still unresolved, for a caller that knows more. */
    readonly remaining: LayoutIntent;
}

/**
 * React Native's `alignItems`/`alignSelf` vocabulary → `GtkAlign`'s nicks.
 *
 * `stretch` → `fill` is the one that is not a rename: CSS stretches a child to the
 * line's cross size, and GTK's `fill` is the same instruction under a different
 * word. `GtkAlign` has exactly FILL, START, END, CENTER and BASELINE (measured),
 * so there is no other candidate and no room for a fifth CSS value.
 */
const ALIGN_NICK: Readonly<Record<AlignValue, string>> = {
    'flex-start': 'start',
    'flex-end': 'end',
    center: 'center',
    stretch: 'fill',
    baseline: 'baseline',
};

/** The three `justifyContent` values that ARE an alignment. `space-between` is not. */
const JUSTIFY_NICK: Readonly<Record<string, string>> = {
    'flex-start': 'start',
    'flex-end': 'end',
    center: 'center',
};

/**
 * `Gtk.Label:xalign` is a float and `Gtk.Label:justify` is an enum, and BOTH are
 * needed for one `text-*`.
 *
 * `xalign` positions a line inside the label's allocation and `justify` positions
 * the lines relative to each other — so a single-line label ignores `justify` and a
 * wrapped one looks unaligned without `xalign`. Setting one of the two is the
 * shape that works in the test and fails on the first paragraph.
 *
 * `justify` FILL is GTK's spelling of CSS `text-align: justify`, and it keeps
 * `xalign: 0` because a justified block starts at the leading edge.
 */
const TEXT_ALIGN: Readonly<Record<string, { readonly xalign: number; readonly justify: string }>> = {
    left: { xalign: 0, justify: 'left' },
    center: { xalign: 0.5, justify: 'center' },
    right: { xalign: 1, justify: 'right' },
    justify: { xalign: 0, justify: 'fill' },
};

const cross = (orientation: Orientation): 'halign' | 'valign' => (orientation === 'horizontal' ? 'valign' : 'halign');
const main = (orientation: Orientation): 'halign' | 'valign' => (orientation === 'horizontal' ? 'halign' : 'valign');

const NO_CENTER_BOX =
    "GTK's box has no main-axis justification, and ADR 0032 § 6's mapping for this one is `Gtk.CenterBox`. Measured on gtk 4.22.4, `Gtk.CenterBox` installs NO `remove` method — it clears a slot with `set_center_widget(null)` — and the host's `slotted` policy names a `remove` that `descriptorProblems()` checks exists, so the widget cannot be curated without changing the policy's shape. Until it is, spell the distribution with a spacer child (`flex-1`) or with `gap-*`";

export function resolveIntent(input: IntentInput): IntentResolution {
    const { primitive, intent, orientation, widget, parent } = input;
    const props: Record<string, unknown> = {};
    const css: string[] = [];
    const childProps: Record<string, unknown> = {};
    const remaining: Record<string, unknown> = {};
    let slot: string | null = null;
    let childTextAlign = parent?.textAlign;

    // --- resolved: the element's own orientation is enough ---------------------

    if (intent.alignChildren !== undefined) {
        if (!widget.box) {
            throw new PrimitiveError(
                primitive,
                'items-*',
                'aligns CHILDREN, and this primitive has none to align — the widget it becomes is not a box. Move the utility to the container',
            );
        }
        childProps[cross(orientation)] = ALIGN_NICK[intent.alignChildren];
    }

    if (intent.distribute !== undefined) {
        if (!widget.box) {
            throw new PrimitiveError(
                primitive,
                'justify-*',
                'distributes CHILDREN along the main axis, and the widget this primitive becomes is not a box. Move the utility to the container',
            );
        }
        const nick = JUSTIFY_NICK[intent.distribute];
        if (nick === undefined)
            throw new PrimitiveError(primitive, `justify-${label(intent.distribute)}`, NO_CENTER_BOX);
        props[main(orientation)] = nick;
    }

    if (intent.axisSpacing !== undefined) {
        if (!widget.box) {
            throw new PrimitiveError(
                primitive,
                'gap-x-*/gap-y-*',
                'is a `Gtk.Box:spacing`, and the widget this primitive becomes has none (measured, gtk-props.ts)',
            );
        }
        // The axis that IS the orientation becomes the one `spacing`. The other one
        // is a DECLARED no-op rather than a refusal, and CSS agrees: a `Gtk.Box` is
        // a single line, so a cross-axis gap has nothing between anything. Refusing
        // it would reject `gap-x-2` written defensively beside a `flex-row` that a
        // breakpoint later turns into a column.
        if (intent.axisSpacing.axis === orientation) props.spacing = intent.axisSpacing.pixels;
    }

    if (intent.textAlign !== undefined) childTextAlign = intent.textAlign;
    if (childTextAlign !== undefined && widget.alignsText) {
        const resolved = TEXT_ALIGN[childTextAlign];
        props.xalign = resolved.xalign;
        props.justify = resolved.justify;
        // Consumed: a label that aligned its own text has nothing to hand on, and
        // it can have no children to hand it to either.
        childTextAlign = undefined;
    }

    // --- resolved when the caller supplied the parent --------------------------

    if (intent.expand !== undefined) {
        if (parent === undefined) remaining.expand = intent.expand;
        else props[parent.orientation === 'horizontal' ? 'hexpand' : 'vexpand'] = true;
    }

    if (intent.alignSelf !== undefined) {
        if (parent === undefined) remaining.alignSelf = intent.alignSelf;
        else props[cross(parent.orientation)] = ALIGN_NICK[intent.alignSelf];
    }

    if (intent.overlay?.role === 'child') {
        if (parent === undefined) {
            remaining.overlay = intent.overlay;
        } else if (!parent.overlay) {
            throw new PrimitiveError(
                primitive,
                'absolute',
                'positions this element on top of its parent, so the PARENT has to be a `Gtk.Overlay` — and it is not. A `View` becomes one as soon as one of its children is absolutely positioned, so the parent here is either not a `View` (a `ScrollView`, a `Pressable`, a `Text`) or the element is a root',
            );
        } else {
            slot = 'overlay';
            placeAbsolute(primitive, intent.overlay.edges, input.emittedProps, props, css);
        }
    }

    // `relative` (`role: 'context'`) sets nothing, and it is not dropped either —
    // it is simply already true. React Native's `View` IS `position: relative` by
    // default, which is why `absolute` children work under a plain `<View>` with no
    // explicit `relative` anywhere in the measured application. L1's own comment
    // reads the pair the other way (an `absolute` child under a parent that never
    // declared `relative` is an authoring bug worth detecting), and that reading is
    // right for CSS and wrong for React Native. The RN layer follows React Native:
    // an explicit `relative` is honoured by being redundant.

    return {
        props,
        css,
        childContext: {
            orientation,
            props: childProps,
            // Filled in by the caller, which is the only party that knows whether
            // the element actually became an overlay — that decision reads the
            // CHILDREN, not the intent.
            overlay: false,
            ...(childTextAlign === undefined ? {} : { textAlign: childTextAlign }),
        },
        slot,
        remaining: remaining as LayoutIntent,
    };
}

/**
 * `inset-*` / `top-*` / `left-*` on an overlay child → alignment plus a margin.
 *
 * `Gtk.Overlay` positions an overlay child by its own `halign`/`valign` inside the
 * overlay's allocation; there is no coordinate pair to set (the
 * `get-child-position` signal is the escape hatch and it is a callback, not data).
 * So an edge offset is TWO facts: which edge the child sits against, and how far
 * from it — an alignment and a margin.
 *
 * BOTH edges of one axis is the `fill` case: `inset-0` becomes `halign: fill,
 * valign: fill` with the four margins, which is the whole point of `inset-0` and
 * the reason it cannot be two `start` alignments.
 *
 * NEITHER edge of an axis leaves that axis alone, and GTK's default for an overlay
 * child is FILL. React Native would keep the child at its static position there,
 * which GTK has no way to express — an overlay child has no static position to
 * fall back to. Declared as a limit on `View` rather than approximated.
 *
 * The horizontal margins go through CSS and the vertical ones through widget
 * properties, which is not an inconsistency but L1's measured split repeated
 * verbatim: GTK CSS has `margin-left` and no `margin-start`, `Gtk.Widget` has
 * `margin-start` and no `margin-left`. Mixing the two channels on one axis makes
 * them ADD, so an element that already authored a LOGICAL horizontal margin gets
 * the same named refusal L1 gives.
 */
function placeAbsolute(
    primitive: string,
    edges: Readonly<Partial<Record<Edge, number>>>,
    emitted: Readonly<Record<string, unknown>>,
    props: Record<string, unknown>,
    css: string[],
): void {
    const { top, right, bottom, left } = edges;

    if (top !== undefined || bottom !== undefined) {
        props.valign = top !== undefined && bottom !== undefined ? 'fill' : top !== undefined ? 'start' : 'end';
        if (top !== undefined) props['margin-top'] = top;
        if (bottom !== undefined) props['margin-bottom'] = bottom;
    }

    if (left === undefined && right === undefined) return;

    if (emitted['margin-start'] !== undefined || emitted['margin-end'] !== undefined) {
        throw new PrimitiveError(
            primitive,
            'absolute + ms-*/me-*',
            'offsets a PHYSICAL edge (`left-*`/`right-*`/`inset-*`), which becomes GTK CSS, while `ms-*`/`me-*` become the widget properties `margin-start`/`margin-end`. GTK applies both and they ADD, where CSS would have let one win. Spell the horizontal margin one way',
        );
    }
    props.halign = left !== undefined && right !== undefined ? 'fill' : left !== undefined ? 'start' : 'end';
    if (left !== undefined) css.push(`margin-left: ${left}px`);
    if (right !== undefined) css.push(`margin-right: ${right}px`);
}

/** `space-between` → `between`, so a refusal names the utility the author wrote. */
const label = (value: JustifyValue): string => value.replace(/^space-/, '');
