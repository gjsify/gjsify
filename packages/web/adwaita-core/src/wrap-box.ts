// `Adw.WrapBox` — the portable half, headless (ADR 0004).
//
// WHAT IS AND IS NOT HERE
//
// The line-BREAKING engine stays out: `count_line_children` walks children until
// the line overflows and `box_allocate` distributes the leftover, and neither
// renderer can be fed that decision — CSS flexbox breaks lines itself and
// NativeScript's `FlexboxLayout` breaks them in native code. What IS portable is
// everything the engine decides BEFORE it measures: the property normalisers,
// the justify/align/last-line decision table, and the child-ORDER arithmetic.
//
// This module exists because there was a second copy. `conformance/wrap-box.ts`
// recorded that there was "no core IMPLEMENTATION behind these rows on purpose",
// on the grounds that "the NativeScript port has nowhere to land them, because NS
// `WrapLayout` exposes `orientation`, `itemWidth` and `itemHeight` and nothing
// else". That grounding was wrong: NativeScript also ships `FlexboxLayout`, with
// `flexDirection`, `flexWrap`, `justifyContent`, `alignItems`, `alignContent` and
// per-child `setFlexGrow`/`setFlexShrink` — the same primitives the browser port
// maps onto. So the NS widget can land the whole family, the browser element's
// private `resolveLine` became the first of two copies, and the rule is that the
// SECOND copy is where you lift.
//
// Reference: refs/libadwaita/src/adw-wrap-box.c
// Reference: refs/libadwaita/src/adw-wrap-layout.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { type AdwLengthUnit, adwLengthToPx, DEFAULT_DPI, normalizeLengthUnit } from './length-unit.js';

// --- Vocabulary ---------------------------------------------------------------

/** `AdwJustifyMode` — the three values of `Adw.WrapBox:justify` (adw-wrap-layout.h:26-30). */
export type AdwWrapBoxJustify = 'none' | 'fill' | 'spread';

/** `AdwWrapPolicy` — whether children may shrink before a line wraps (adw-wrap-layout.h:39-43). */
export type AdwWrapPolicy = 'minimum' | 'natural';

/** `AdwPackDirection` — which end of a line children are packed from. */
export type AdwWrapBoxPackDirection = 'start-to-end' | 'end-to-start';

/** `GtkOrientation` — the axis children are packed along. */
export type AdwWrapBoxOrientation = 'horizontal' | 'vertical';

/** The three justify modes, for validating an attribute against the C enum. */
export const ADW_WRAP_BOX_JUSTIFY_MODES: readonly AdwWrapBoxJustify[] = ['none', 'fill', 'spread'];

/** The two wrap policies, for validating an attribute against the C enum. */
export const ADW_WRAP_POLICIES: readonly AdwWrapPolicy[] = ['minimum', 'natural'];

// --- Property defaults (adw-wrap-box.c) ----------------------------------------

/**
 * `Adw.WrapBox:child-spacing` and `:line-spacing` defaults, in px.
 *
 * Both are `g_param_spec_int (…, 0, G_MAXINT, 0, …)` — adw-wrap-box.c:285-287
 * and :393-395. The NativeScript port defaulted BOTH to 6 DIPs, so identical
 * markup was looser on a phone than in the browser.
 */
export const ADW_WRAP_BOX_DEFAULT_SPACING = 0;

/**
 * `Adw.WrapBox:align` default (adw-wrap-box.c:335-337).
 *
 * Declared `g_param_spec_float (…, 0, 1, 0, …)`, so GObject validates an
 * out-of-range value back into `[0, 1]` on set.
 */
export const ADW_WRAP_BOX_DEFAULT_ALIGN = 0;

/** `Adw.WrapBox:justify` default — `ADW_JUSTIFY_NONE` (adw-wrap-box.c:364-366). */
export const ADW_WRAP_BOX_DEFAULT_JUSTIFY: AdwWrapBoxJustify = 'none';

/** `Adw.WrapBox:justify-last-line` default — `FALSE` (adw-wrap-box.c:379-381). */
export const ADW_WRAP_BOX_DEFAULT_JUSTIFY_LAST_LINE = false;

/** `Adw.WrapBox:wrap-policy` default — `ADW_WRAP_NATURAL` (adw-wrap-box.c:491-495). */
export const ADW_WRAP_BOX_DEFAULT_WRAP_POLICY: AdwWrapPolicy = 'natural';

/**
 * `Adw.WrapBox:natural-line-length` default — `-1`, i.e. UNSET
 * (adw-wrap-box.c:438-441, range `-1 … G_MAXINT`).
 *
 * `-1` is not "zero length": it means the box asks for whatever its children
 * need, so a renderer must not write it into a size.
 */
export const ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET = -1;

/**
 * The unit default for all three length properties — `ADW_LENGTH_UNIT_PX`
 * (adw-wrap-box.c:300-305, :408-413, :454-458).
 *
 * Note this DIFFERS from the split views, which default to `sp`
 * (`DEFAULT_SIDEBAR_WIDTH_UNIT`). Sharing `normalizeLengthUnit` between them is
 * only safe because the default is the caller's argument, not the helper's.
 */
export const ADW_WRAP_BOX_DEFAULT_LENGTH_UNIT: AdwLengthUnit = 'px';

/** `Adw.WrapBox:pack-direction` default — `ADW_PACK_START_TO_END` (adw-wrap-box.c:313-318). */
export const ADW_WRAP_BOX_DEFAULT_PACK_DIRECTION: AdwWrapBoxPackDirection = 'start-to-end';

/** The two pack directions, for validating an attribute against the C enum. */
export const ADW_WRAP_BOX_PACK_DIRECTIONS: readonly AdwWrapBoxPackDirection[] = ['start-to-end', 'end-to-start'];

// --- Property normalisers ------------------------------------------------------

/**
 * `adw_wrap_box_set_child_spacing` / `set_line_spacing`
 * (adw-wrap-box.c:587-588, :927-928) — a negative spacing is clamped to 0 BEFORE
 * anything else happens, so it never reaches the layout.
 *
 * The property is declared with a minimum of 0, which is why the clamp exists at
 * all: without it GObject would reject the value and warn. The non-numeric cases
 * have no C counterpart — the property is an `int` — and resolve to the default,
 * so a typo cannot put `NaN` into a `column-gap` or a native layout pass.
 */
export function normalizeWrapBoxSpacing(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (!Number.isFinite(parsed) || parsed < 0) return ADW_WRAP_BOX_DEFAULT_SPACING;
    return parsed;
}

/** `Adw.WrapBox:align` — `g_param_spec_float (…, 0, 1, 0, …)`, adw-wrap-box.c:335-337. */
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

/**
 * `Adw.WrapBox:natural-line-length` — an `int` in `[-1, G_MAXINT]`.
 *
 * Anything below -1 is out of the declared range, so it lands on the sentinel
 * rather than on 0: a GObject setter would have refused it and left the property
 * where it was, and "unset" is what the property was born as.
 */
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

/**
 * One length property resolved to pixels — the `adw_length_unit_to_px` call the
 * measure and allocate paths both make before laying anything out
 * (adw-wrap-layout.c:554-565, :798-804).
 *
 * The UNSET natural line length passes through untouched, mirroring the C's own
 * `if (self->natural_line_length >= 0)` gate (:562): converting `-1` would turn
 * a sentinel into a length, and at dpi ≠ 96 it would not even stay -1.
 */
export function wrapBoxLengthToPx(value: number, unit: AdwLengthUnit, dpi: number = DEFAULT_DPI): number {
    if (value < 0) return ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET;
    return adwLengthToPx(unit, value, dpi);
}

// --- The justify / align / last-line decision ----------------------------------

/** What a renderer has to do with a line's leftover space. */
export interface WrapBoxLineLayout {
    /**
     * The justify mode that governs THIS line, after the last-line gate. It is
     * the widget's `justify` for every line except the final one, and for the
     * final one only when `justify-last-line` is set
     * (adw-wrap-layout.c:397-400, :705-706).
     */
    justify: AdwWrapBoxJustify;
    /**
     * Whether the CHILDREN absorb the leftover (`allocated_size` grows to
     * `available_size`, adw-wrap-layout.c:336-341). CSS: `flex-grow` on the
     * items.
     */
    growChildren: boolean;
    /**
     * Whether the GAPS absorb the leftover — children keep `minimum_size` and
     * are spread apart by `size_delta` (adw-wrap-layout.c:338-339, :752-757).
     * CSS: `justify-content: space-between`.
     */
    growGaps: boolean;
    /**
     * The MAIN-axis offset factor applied to the whole line block when nothing
     * grows: `widget_offset += roundf (length_delta * align)`
     * (adw-wrap-layout.c:717-725). 0 packs the line at the start of the main
     * axis, 1 at its end. Meaningless — and reported as 0 — as soon as the line
     * is justified, because C only computes `length_delta` inside
     * `if (!justify_line)`.
     */
    align: number;
}

/**
 * The line-layout decision, straight from the C.
 *
 * `lastLine` is the FINAL line, complete or not (`i == *n_lines - 1`,
 * adw-wrap-layout.c:463-464), so a wrap box whose children all fit on one line
 * has that line governed by `justify-last-line` rather than by `justify` — which
 * makes the single-line case, the common one, the counter-intuitive one.
 *
 * `spread` with exactly ONE child in the line does not spread anything:
 * `n_children > 1` guards the branch that keeps children at `minimum_size`, so a
 * lone child is STRETCHED instead, which the property documentation states
 * outright (adw-wrap-box.c:349-352).
 *
 * Held to `WRAP_BOX_LINE_VECTORS` in `@gjsify/adwaita-core/conformance`, which
 * both renderer suites drive their real widgets with.
 */
export function resolveWrapBoxLine(input: {
    justify: AdwWrapBoxJustify;
    justifyLastLine: boolean;
    align: number;
    lastLine: boolean;
    childrenInLine: number;
}): WrapBoxLineLayout {
    // adw-wrap-layout.c:397-400 / :705-706 — the final line is only justified on
    // request; otherwise it falls back to ADW_JUSTIFY_NONE and to `align`.
    const effective: AdwWrapBoxJustify = input.lastLine && !input.justifyLastLine ? 'none' : input.justify;
    if (effective === 'none') return { justify: 'none', growChildren: false, growGaps: false, align: input.align };
    const spreadsGaps = effective === 'spread' && input.childrenInLine > 1;
    return { justify: effective, growChildren: !spreadsGaps, growGaps: spreadsGaps, align: 0 };
}

/**
 * `wrap-policy` as the child `flex-shrink` both flex-based renderers express it
 * with.
 *
 * `ADW_WRAP_NATURAL` wraps "as soon as the previous line cannot fit any more
 * children without shrinking them past their natural size"; `ADW_WRAP_MINIMUM`
 * "shrink[s] them down to their minimum size before wrapping"
 * (adw-wrap-box.c:476-489).
 *
 * STATE THE LIMIT, because it is not a full mapping. Flexbox breaks lines on the
 * items' HYPOTHETICAL main sizes and `flex-shrink` only distributes negative
 * free space WITHIN a line that is already broken — so no value of it makes CSS
 * pack more children per line, which is exactly what `minimum` is for. What it
 * does decide is whether a line that still overflows squeezes its children or
 * lets them spill, and that half is faithful.
 *
 * The reason to derive it anyway is the default. CSS defaults `flex-shrink` to
 * **1**, i.e. to `minimum`; libadwaita defaults `wrap-policy` to `natural`. Both
 * renderers had no policy at all, so both drew the one Adwaita does not choose,
 * on every wrap box, silently.
 */
export function wrapPolicyFlexShrink(policy: AdwWrapPolicy): number {
    return policy === 'minimum' ? 1 : 0;
}

// --- Child order ---------------------------------------------------------------

/** Which child-list operation is being resolved. */
export type WrapBoxChildOrderOp = 'insert-after' | 'reorder-after';

/**
 * Where `adw_wrap_box_insert_child_after` / `reorder_child_after` put a child.
 *
 * Both delegate to `gtk_widget_insert_after (child, self, sibling)`
 * (adw-wrap-box.c:1283-1300, :1315-1332), whose documented rule is the
 * counter-intuitive one: a NULL sibling inserts at the FIRST position, not the
 * last. Reading it as "append" is the obvious misreading, and it is silent —
 * the child lands somewhere plausible.
 *
 * The guards are the C's `g_return_if_fail`s, expressed as a refusal rather than
 * a throw because a renderer has no `g_critical` to fall through to: an insert
 * demands the child be UNPARENTED and the sibling be a child of this box, a
 * reorder demands the child already be one, and `child === sibling` is an
 * explicit early return in both.
 *
 * Returns the new child list, or `null` when the operation is refused — the
 * caller then leaves its view tree exactly as it was, which is what C does.
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
