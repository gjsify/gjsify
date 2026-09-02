// `Adw.WrapBox` — the portable half, headless (ADR 0004).
//
// The line-BREAKING engine stays out: no renderer can be fed that decision, because CSS
// flexbox breaks lines itself, NativeScript's `FlexboxLayout` breaks them in native code
// and React Native's Yoga does the same. What IS portable is everything the engine
// decides BEFORE it measures — the property normalisers, the justify/align/last-line
// decision table and the child-ORDER arithmetic — and every renderer maps onto the same
// flex primitives, so all of them consume all three.
//
// AND THE FLEX MAPPING ITSELF IS HERE for the same reason, one step further out:
// `wrapBoxFlexStyle`/`wrapBoxChildFlex` turn that decision into `flex-direction`,
// `justify-content`, `align-content` and the two child factors, which is the SAME answer
// on a browser, on NativeScript and on React Native. The `align` snap below is the part
// that had drifted furthest from being a shared rule: it is an approximation of a
// continuum, so it is not a conformance vector, and a per-renderer copy of an
// approximation is how two renderers end up approximating differently.
//
// TWO OF THE THREE RENDERERS READ IT, NOT THREE. It was written out in
// `@gjsify/adwaita-nativescript` first; that copy is gone and both it and
// `@gjsify/adwaita-react-native` call in here. `@gjsify/adwaita-web`'s `<adw-wrap-box>`
// still has its own `alignToJustifyContent` and its own container mapping, so the
// duplication this lift was for is closed on two sides and open on the third — the exact
// shape that produces two renderers approximating differently. Closing it is an edit to
// that element and belongs with the next change to it.
//
// Reference: refs/libadwaita/src/adw-wrap-box.c
// Reference: refs/libadwaita/src/adw-wrap-layout.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { type AdwLengthUnit, adwLengthToPx, DEFAULT_DPI, normalizeLengthUnit } from './length-unit.js';

/** `AdwJustifyMode` — the three values of `Adw.WrapBox:justify`. */
export type AdwWrapBoxJustify = 'none' | 'fill' | 'spread';

/** `AdwWrapPolicy` — whether children may shrink before a line wraps. */
export type AdwWrapPolicy = 'minimum' | 'natural';

/** `AdwPackDirection` — which end of a line children are packed from. */
export type AdwWrapBoxPackDirection = 'start-to-end' | 'end-to-start';

/** `GtkOrientation` — the axis children are packed along. */
export type AdwWrapBoxOrientation = 'horizontal' | 'vertical';

/** The three justify modes, for validating an attribute against the C enum. */
export const ADW_WRAP_BOX_JUSTIFY_MODES: readonly AdwWrapBoxJustify[] = ['none', 'fill', 'spread'];

/** The two wrap policies, for validating an attribute against the C enum. */
export const ADW_WRAP_POLICIES: readonly AdwWrapPolicy[] = ['minimum', 'natural'];

/** `Adw.WrapBox:child-spacing` / `:line-spacing` default, in px — both
 * `g_param_spec_int (…, 0, G_MAXINT, 0, …)`. */
export const ADW_WRAP_BOX_DEFAULT_SPACING = 0;

/** `Adw.WrapBox:align` default — `g_param_spec_float (…, 0, 1, 0, …)`, so GObject
 * clamps back into `[0, 1]` on set. */
export const ADW_WRAP_BOX_DEFAULT_ALIGN = 0;

/** `Adw.WrapBox:justify` default — `ADW_JUSTIFY_NONE`. */
export const ADW_WRAP_BOX_DEFAULT_JUSTIFY: AdwWrapBoxJustify = 'none';

/** `Adw.WrapBox:justify-last-line` default — `FALSE`. */
export const ADW_WRAP_BOX_DEFAULT_JUSTIFY_LAST_LINE = false;

/** `Adw.WrapBox:wrap-policy` default — `ADW_WRAP_NATURAL`. */
export const ADW_WRAP_BOX_DEFAULT_WRAP_POLICY: AdwWrapPolicy = 'natural';

/** `Adw.WrapBox:natural-line-length` default — `-1` = UNSET, range `-1 … G_MAXINT`.
 * Not "zero length": the box asks for whatever its
 * children need, so a renderer must not write it into a size. */
export const ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET = -1;

/** The unit default for all three length properties — `ADW_LENGTH_UNIT_PX`. DIFFERS from
 * the split views' `sp` (`DEFAULT_SIDEBAR_WIDTH_UNIT`); sharing `normalizeLengthUnit` is
 * only safe because the default is the caller's argument, not the helper's. */
export const ADW_WRAP_BOX_DEFAULT_LENGTH_UNIT: AdwLengthUnit = 'px';

/** `Adw.WrapBox:pack-direction` default — `ADW_PACK_START_TO_END`. */
export const ADW_WRAP_BOX_DEFAULT_PACK_DIRECTION: AdwWrapBoxPackDirection = 'start-to-end';

/** The two pack directions, for validating an attribute against the C enum. */
export const ADW_WRAP_BOX_PACK_DIRECTIONS: readonly AdwWrapBoxPackDirection[] = ['start-to-end', 'end-to-start'];

/** `adw_wrap_box_set_child_spacing` / `set_line_spacing`  — a negative spacing is clamped to 0 before it can reach the layout.
 * The non-numeric cases have no C counterpart (the property is an `int`) and
 * resolve to the default, so a typo cannot put `NaN` into a `column-gap`. */
export function normalizeWrapBoxSpacing(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed) || parsed < 0) return ADW_WRAP_BOX_DEFAULT_SPACING;
    return parsed;
}

/** `Adw.WrapBox:align` — `g_param_spec_float (…, 0, 1, 0, …)`, so GObject clamps on set. */
export function normalizeWrapBoxAlign(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed)) return ADW_WRAP_BOX_DEFAULT_ALIGN;
    return Math.min(1, Math.max(0, parsed));
}

/** An out-of-range enum value leaves a GObject property at its default. */
export function normalizeWrapBoxJustify(value: unknown): AdwWrapBoxJustify {
    return ADW_WRAP_BOX_JUSTIFY_MODES.includes(value as AdwWrapBoxJustify)
        ? (value as AdwWrapBoxJustify)
        : ADW_WRAP_BOX_DEFAULT_JUSTIFY;
}

/** `Adw.WrapBox:wrap-policy` — same enum gate, defaulting to `natural`. */
export function normalizeWrapPolicy(value: unknown): AdwWrapPolicy {
    return ADW_WRAP_POLICIES.includes(value as AdwWrapPolicy)
        ? (value as AdwWrapPolicy)
        : ADW_WRAP_BOX_DEFAULT_WRAP_POLICY;
}

/** `Adw.WrapBox:natural-line-length` — an `int` in `[-1, G_MAXINT]`. Any NEGATIVE value
 * lands on the sentinel rather than on 0: a GObject setter would have refused an
 * out-of-range write, and "unset" is where the property started. */
export function normalizeNaturalLineLength(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed) || parsed < 0) return ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET;
    return Math.trunc(parsed);
}

/** `Adw.WrapBox`'s three length units — `px` by default, unlike the split views' `sp`. */
export function normalizeWrapBoxLengthUnit(value: unknown): AdwLengthUnit {
    return normalizeLengthUnit(value, ADW_WRAP_BOX_DEFAULT_LENGTH_UNIT);
}

/** `Adw.WrapBox:pack-direction` — the same enum gate, defaulting to `start-to-end`. */
export function normalizeWrapBoxPackDirection(value: unknown): AdwWrapBoxPackDirection {
    return ADW_WRAP_BOX_PACK_DIRECTIONS.includes(value as AdwWrapBoxPackDirection)
        ? (value as AdwWrapBoxPackDirection)
        : ADW_WRAP_BOX_DEFAULT_PACK_DIRECTION;
}

/** One length property resolved to pixels — the `adw_length_unit_to_px` call the measure
 * and allocate paths both make. The UNSET natural line length passes through untouched,
 * mirroring the C's `if (self->natural_line_length >= 0)` gate: converting `-1` would turn
 * a sentinel into a length, and at dpi ≠ 96 would not even leave it -1. */
export function wrapBoxLengthToPx(value: number, unit: AdwLengthUnit, dpi: number = DEFAULT_DPI): number {
    if (value < 0) return ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET;
    return adwLengthToPx(unit, value, dpi);
}

/** What a renderer has to do with a line's leftover space. */
export interface WrapBoxLineLayout {
    /** The justify mode governing THIS line, after the last-line gate — the widget's
     * `justify` except on the final line, which needs `justify-last-line`. */
    justify: AdwWrapBoxJustify;
    /** Whether the CHILDREN absorb the leftover (`allocated_size` grows to
     * `available_size`). CSS: `flex-grow` on the items. */
    growChildren: boolean;
    /** Whether the GAPS absorb it instead — children keep `minimum_size` and are spread by
     * `size_delta`. CSS: `justify-content: space-between`. */
    growGaps: boolean;
    /** The MAIN-axis offset factor applied to the whole line block when nothing grows:
     * `widget_offset += roundf (length_delta * align)`, 0 = line start, 1 = line end.
     * Reported as 0 once the line is justified, because C computes `length_delta` only
     * inside `if (!justify_line)`. */
    align: number;
}

/**
 * The line-layout decision, straight from the C.
 *
 * `lastLine` is the FINAL line, complete or not (`i == *n_lines - 1`), so a wrap box whose
 * children all fit on one line has that line governed by `justify-last-line` rather than
 * by `justify` — which makes the single-line case, the common one, the counter-intuitive
 * one.
 *
 * `spread` with exactly ONE child in the line does not spread anything: `n_children > 1`
 * guards the branch that keeps children at `minimum_size`, so a lone child is STRETCHED.
 *
 * Held to `WRAP_BOX_LINE_VECTORS` in `@gjsify/adwaita-core/conformance`.
 */
export function resolveWrapBoxLine(input: {
    justify: AdwWrapBoxJustify;
    justifyLastLine: boolean;
    align: number;
    lastLine: boolean;
    childrenInLine: number;
}): WrapBoxLineLayout {
    // The final line is only justified on request; otherwise it falls back to
    // ADW_JUSTIFY_NONE and to `align`.
    const effective: AdwWrapBoxJustify = input.lastLine && !input.justifyLastLine ? 'none' : input.justify;
    if (effective === 'none') return { justify: 'none', growChildren: false, growGaps: false, align: input.align };
    const spreadsGaps = effective === 'spread' && input.childrenInLine > 1;
    return { justify: effective, growChildren: !spreadsGaps, growGaps: spreadsGaps, align: 0 };
}

/**
 * `wrap-policy` as the child `flex-shrink` both flex-based renderers express it
 * with. `ADW_WRAP_NATURAL` wraps "as soon as the previous line cannot fit any more
 * children without shrinking them past their natural size"; `ADW_WRAP_MINIMUM`
 * "shrink[s] them down to their minimum size before wrapping".
 *
 * NOT a full mapping, and the limit matters: flexbox breaks lines on the items'
 * HYPOTHETICAL main sizes and `flex-shrink` only distributes negative free space WITHIN an
 * already-broken line, so no value of it packs more children per line — which is what
 * `minimum` is for. It does faithfully decide whether an overflowing line squeezes its
 * children or lets them spill.
 *
 * Deriving it is still worth it for the DEFAULT: CSS defaults `flex-shrink` to 1
 * (= `minimum`) where libadwaita defaults `wrap-policy` to `natural`, so a renderer with
 * no policy silently draws the one Adwaita does not choose.
 */
export function wrapPolicyFlexShrink(policy: AdwWrapPolicy): number {
    return policy === 'minimum' ? 1 : 0;
}

/** The flexbox knobs a wrap box's properties resolve to. */
export interface WrapBoxFlexStyle {
    /** The main axis, reversed for `end-to-start`. */
    flexDirection: 'row' | 'row-reverse' | 'column' | 'column-reverse';
    /** Always wrapping; reversed by `wrap-reverse`. */
    flexWrap: 'wrap' | 'wrap-reverse';
    /** Where a COMPLETE line's leftover space goes. */
    justifyContent: 'flex-start' | 'center' | 'flex-end' | 'space-between';
    /** `line-homogeneous` stretches the lines across the cross axis. */
    alignContent: 'stretch' | 'flex-start';
    /** `flex-grow` for a child on a complete line. */
    childFlexGrow: number;
    /** `flex-shrink` for every child — `wrap-policy`. */
    childFlexShrink: number;
}

/** The widget properties {@link wrapBoxFlexStyle} and {@link wrapBoxChildFlex} read. */
export interface WrapBoxFlexInput {
    orientation: AdwWrapBoxOrientation;
    packDirection: AdwWrapBoxPackDirection;
    wrapReverse: boolean;
    justify: AdwWrapBoxJustify;
    justifyLastLine: boolean;
    align: number;
    lineHomogeneous: boolean;
    wrapPolicy: AdwWrapPolicy;
}

/**
 * `align` as a `justify-content` keyword.
 *
 * C offsets the whole line block by `roundf (length_delta * align)` — a continuum.
 * Flexbox has three main-axis positions, so the nearest one is taken. This is the
 * RENDERERS' approximation and not libadwaita's rule, which is why it is not a
 * conformance vector; it is here rather than in each renderer because every renderer
 * that has to make it is flex-based and each had written it out for itself. Which ones
 * read it today, and which one still does not, is at the top of this file.
 */
function alignToJustifyContent(align: number): 'flex-start' | 'center' | 'flex-end' {
    if (align < 0.25) return 'flex-start';
    if (align < 0.75) return 'center';
    return 'flex-end';
}

/**
 * The CONTAINER half of the line decision, resolved onto flexbox.
 *
 * The line DECISION is {@link resolveWrapBoxLine}, held to `WRAP_BOX_LINE_VECTORS`;
 * this only maps its answer onto the knobs a flex container has. A flex container has
 * ONE `justify-content` for every line, so it can carry the COMPLETE-line rule and
 * nothing else — the final-line rule needs a per-child answer
 * ({@link wrapBoxChildFlex}) or, in a browser, a `:only-child` selector.
 */
export function wrapBoxFlexStyle(input: WrapBoxFlexInput): WrapBoxFlexStyle {
    const axis = input.orientation === 'vertical' ? 'column' : 'row';
    const line = resolveWrapBoxLine({
        justify: input.justify,
        justifyLastLine: input.justifyLastLine,
        align: input.align,
        lastLine: false,
        childrenInLine: 2,
    });
    return {
        flexDirection: input.packDirection === 'end-to-start' ? (`${axis}-reverse` as const) : axis,
        flexWrap: input.wrapReverse ? 'wrap-reverse' : 'wrap',
        justifyContent: line.growGaps ? 'space-between' : alignToJustifyContent(line.align),
        alignContent: input.lineHomogeneous ? 'stretch' : 'flex-start',
        childFlexGrow: line.growChildren ? 1 : 0,
        childFlexShrink: wrapPolicyFlexShrink(input.wrapPolicy),
    };
}

/** What one child of the box gets set on it. */
export interface WrapBoxChildFlex {
    /** `flex-grow` — whether this child absorbs its line's leftover. */
    flexGrow: number;
    /** `flex-shrink` — `wrap-policy`, the same for every child. */
    flexShrink: number;
}

/**
 * The PER-CHILD half of the decision, which the container knobs cannot carry.
 *
 * A box with exactly ONE child has one line, that line is the LAST one, and its child
 * is alone on it — so it is governed by `justify-last-line`, and `spread` STRETCHES it
 * rather than spreading anything (C guards the keep-at-minimum branch with
 * `n_children > 1`).
 *
 * `childCount` is the box's own child count, the most a renderer knows without a layout
 * pass: 1 is the lone-child-on-the-final-line case exactly, anything more means at
 * least one complete line.
 */
export function wrapBoxChildFlex(input: WrapBoxFlexInput, childCount: number): WrapBoxChildFlex {
    const alone = childCount === 1;
    const line = resolveWrapBoxLine({
        justify: input.justify,
        justifyLastLine: input.justifyLastLine,
        align: input.align,
        lastLine: alone,
        childrenInLine: alone ? 1 : 2,
    });
    return { flexGrow: line.growChildren ? 1 : 0, flexShrink: wrapPolicyFlexShrink(input.wrapPolicy) };
}

/** Which child-list operation is being resolved. */
export type WrapBoxChildOrderOp = 'insert-after' | 'reorder-after';

/**
 * Where `adw_wrap_box_insert_child_after` / `reorder_child_after` put a child.
 *
 * Both delegate to `gtk_widget_insert_after (child, self, sibling)`, whose rule is
 * counter-intuitive: a NULL sibling inserts at the FIRST position, not the last. Reading
 * it as "append" fails silently — the child lands somewhere plausible.
 *
 * MODIFICATION: the C's `g_return_if_fail`s become a refusal (`null`) rather than a throw,
 * because a renderer has no `g_critical` to fall through to; the caller then leaves its
 * view tree untouched, as C does. Insert demands an UNPARENTED child and a sibling of this
 * box, reorder demands the child already be one, and `child === sibling` returns early in
 * both.
 */
export function resolveWrapBoxChildOrder<T>(input: {
    /** The box's children, in order. */
    children: readonly T[];
    /** The child being placed. */
    child: T;
    /** The child to place it after, or `null`/`undefined` for the FIRST position. */
    sibling?: T | null;
    /** Which operation — they differ only in whether `child` is expected to be present. */
    op: WrapBoxChildOrderOp;
}): T[] | null {
    const { children, child, op } = input;
    const sibling = input.sibling ?? null;
    if (sibling !== null && sibling === child) return null;

    const present = children.indexOf(child);
    if (op === 'insert-after' && present !== -1) return null;
    if (op === 'reorder-after' && present === -1) return null;

    const rest = present === -1 ? [...children] : children.filter((_, index) => index !== present);
    if (sibling === null) return [child, ...rest];

    const at = rest.indexOf(sibling);
    if (at === -1) return null;
    return [...rest.slice(0, at + 1), child, ...rest.slice(at + 1)];
}
