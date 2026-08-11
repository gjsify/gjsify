// Wrap-box conformance vectors — the portable slice of Adw.WrapBox.
//
// The line-BREAKING engine is deliberately not ported (ADR 0004):
// `count_line_children` walks children until the line overflows and
// `box_allocate` distributes the leftover, and neither renderer can be FED that
// decision — CSS flexbox breaks lines itself and NativeScript's `FlexboxLayout`
// breaks them in native code.
//
// What IS portable is everything the engine decides BEFORE it measures: the
// property normalisers, the DECISION about where a line's leftover space goes
// (into the CHILDREN, into the GAPS, or into one offset applied to the whole
// line), and the child-ORDER arithmetic. Four bugs in issue #1048 were wrong
// answers to those: `align` bound to the CROSS axis where C applies it along the
// MAIN one; `justify="fill"` and `"spread"` both rendered as `space-between`, so
// `fill` grew the gaps where C grows the children; `justify-last-line` observed
// and read by nothing, so the last line was ALWAYS justified; and a negative
// spacing reaching the layout with a notification, for a value libadwaita clamps
// to 0 and early-returns on.
//
// The implementation behind these rows is `@gjsify/adwaita-core`'s `wrap-box.ts`,
// which both renderers delegate to.
//
// Reference: refs/libadwaita/src/adw-wrap-box.c
// Reference: refs/libadwaita/src/adw-wrap-layout.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { AdwWrapBoxJustify, AdwWrapPolicy, WrapBoxLineLayout } from '../wrap-box.js';

// --- The justify / align / last-line decision table --------------------------

/** One row of the decision table. */
export interface WrapBoxLineVector {
    /** The widget's `justify` property. */
    justify: AdwWrapBoxJustify;
    /** The widget's `justify-last-line` property. */
    justifyLastLine: boolean;
    /** The widget's `align` property, already validated into `[0, 1]`. */
    align: number;
    /**
     * Whether this is the FINAL line — `i == *n_lines - 1`
     * (adw-wrap-layout.c:463-464). The final one, NOT merely an incomplete one:
     * a box whose children all fit on one line has that line as its last, so by
     * default `justify` does nothing to it at all.
     */
    lastLine: boolean;
    /**
     * How many children the line holds. Only `spread` reads it, and only to
     * distinguish 1 from more (adw-wrap-layout.c:338).
     */
    childrenInLine: number;
    /** What the renderer must do. */
    layout: WrapBoxLineLayout;
    /** The rule or edge case this row pins down. */
    rule: string;
}

/**
 * The line-layout decision, row by row (adw-wrap-layout.c:317-341, :397-400,
 * :705-706, :717-725).
 *
 * Two counter-intuitive rows are why this is a table and not a sentence.
 * `lastLine` is the FINAL line whether or not it is full, so the single-line case
 * — the common one — is governed by `justify-last-line`, not `justify`. And
 * `spread` with exactly ONE child in the line spreads nothing: `n_children > 1`
 * guards the branch keeping children at `minimum_size`, so a lone child is
 * STRETCHED instead (adw-wrap-box.c:349-352).
 */
export const WRAP_BOX_LINE_VECTORS: ReadonlyArray<WrapBoxLineVector> = [
    // --- justify=none: align is the only thing that moves ---
    {
        justify: 'none',
        justifyLastLine: false,
        align: 0,
        lastLine: false,
        childrenInLine: 3,
        layout: { justify: 'none', growChildren: false, growGaps: false, align: 0 },
        rule: 'the defaults: nothing grows, the line packs at the start of the main axis',
    },
    {
        justify: 'none',
        justifyLastLine: false,
        align: 0.5,
        lastLine: false,
        childrenInLine: 3,
        layout: { justify: 'none', growChildren: false, growGaps: false, align: 0.5 },
        rule: 'align 0.5 offsets the line block by half the leftover — MAIN axis, not cross',
    },
    {
        justify: 'none',
        justifyLastLine: false,
        align: 1,
        lastLine: true,
        childrenInLine: 3,
        layout: { justify: 'none', growChildren: false, growGaps: false, align: 1 },
        rule: 'align 1 packs the line at the END of the main axis (:717-725)',
    },
    {
        justify: 'none',
        justifyLastLine: true,
        align: 0.25,
        lastLine: true,
        childrenInLine: 3,
        layout: { justify: 'none', growChildren: false, growGaps: false, align: 0.25 },
        rule: 'justify-last-line is inert while justify is none — there is nothing to justify',
    },

    // --- justify=fill: the CHILDREN grow, the gaps stay put ---
    {
        justify: 'fill',
        justifyLastLine: false,
        align: 0,
        lastLine: false,
        childrenInLine: 3,
        layout: { justify: 'fill', growChildren: true, growGaps: false, align: 0 },
        rule: 'FILL grows every child and keeps spacing constant (:317-319, :326-341)',
    },
    {
        justify: 'fill',
        justifyLastLine: false,
        align: 1,
        lastLine: false,
        childrenInLine: 3,
        layout: { justify: 'fill', growChildren: true, growGaps: false, align: 0 },
        rule: 'a justified line consumes the leftover, so align is reported as 0 (:716-725 is gated)',
    },
    {
        justify: 'fill',
        justifyLastLine: false,
        align: 0.5,
        lastLine: true,
        childrenInLine: 3,
        layout: { justify: 'none', growChildren: false, growGaps: false, align: 0.5 },
        rule: 'the final line falls back to NONE and to align (:397-400) — the C default',
    },
    {
        justify: 'fill',
        justifyLastLine: true,
        align: 0.5,
        lastLine: true,
        childrenInLine: 3,
        layout: { justify: 'fill', growChildren: true, growGaps: false, align: 0 },
        rule: 'justify-last-line lifts the gate, so the final line fills like any other',
    },
    {
        justify: 'fill',
        justifyLastLine: true,
        align: 0,
        lastLine: true,
        childrenInLine: 1,
        layout: { justify: 'fill', growChildren: true, growGaps: false, align: 0 },
        rule: 'FILL has no single-child special case — one child simply takes the line',
    },

    // --- justify=spread: the GAPS grow, the children keep their size ---
    {
        justify: 'spread',
        justifyLastLine: false,
        align: 0,
        lastLine: false,
        childrenInLine: 3,
        layout: { justify: 'spread', growChildren: false, growGaps: true, align: 0 },
        rule: 'SPREAD keeps allocated_size at minimum_size and widens the gaps (:338-339)',
    },
    {
        justify: 'spread',
        justifyLastLine: false,
        align: 0,
        lastLine: false,
        childrenInLine: 2,
        layout: { justify: 'spread', growChildren: false, growGaps: true, align: 0 },
        rule: 'two children still spread — the guard is n_children > 1',
    },
    {
        justify: 'spread',
        justifyLastLine: false,
        align: 0,
        lastLine: false,
        childrenInLine: 1,
        layout: { justify: 'spread', growChildren: true, growGaps: false, align: 0 },
        rule: 'a LONE child in a spread line is stretched instead (:338, adw-wrap-box.c:349-352)',
    },
    {
        justify: 'spread',
        justifyLastLine: false,
        align: 0,
        lastLine: true,
        childrenInLine: 3,
        layout: { justify: 'none', growChildren: false, growGaps: false, align: 0 },
        rule: 'DEFAULT single-line wrap box: its only line is the last, so spread does nothing',
    },
    {
        justify: 'spread',
        justifyLastLine: false,
        align: 1,
        lastLine: true,
        childrenInLine: 3,
        layout: { justify: 'none', growChildren: false, growGaps: false, align: 1 },
        rule: 'the un-justified final line honours align, which is why the two interact',
    },
    {
        justify: 'spread',
        justifyLastLine: true,
        align: 1,
        lastLine: true,
        childrenInLine: 3,
        layout: { justify: 'spread', growChildren: false, growGaps: true, align: 0 },
        rule: 'justify-last-line spreads the final line and drops align on the floor',
    },
    {
        justify: 'spread',
        justifyLastLine: true,
        align: 0,
        lastLine: true,
        childrenInLine: 1,
        layout: { justify: 'spread', growChildren: true, growGaps: false, align: 0 },
        rule: 'the lone-child stretch survives the last-line gate being lifted',
    },
];

// --- Spacing normalisation ---------------------------------------------------

/** One `child-spacing` / `line-spacing` normalisation expectation. */
export interface WrapBoxSpacingVector {
    /**
     * The value handed to the setter — a string from an HTML attribute or XML
     * layout, a number from a JS property setter. C only ever sees an `int`, so
     * the string rows are the PORTS' own edge: the browser propagated `NaN` into
     * the style where NativeScript coerced it to 0.
     */
    value: number | string | null;
    /** The value the widget stores and lays out with. */
    spacing: number;
    rule: string;
}

/**
 * `adw_wrap_box_set_child_spacing` / `set_line_spacing`
 * (adw-wrap-box.c:587-588, :927-928) — a negative spacing is clamped to 0
 * BEFORE anything else happens, so it never reaches the layout.
 *
 * The property is declared with a minimum of 0 (adw-wrap-box.c:285-287,
 * :393-395), which is why the clamp exists: without it GObject would reject the
 * value and warn.
 */
export const WRAP_BOX_SPACING_VECTORS: ReadonlyArray<WrapBoxSpacingVector> = [
    { value: 0, spacing: 0, rule: 'the default is 0 — no spacing at all, on every renderer' },
    { value: 6, spacing: 6, rule: 'a plain positive value passes through' },
    { value: -1, spacing: 0, rule: 'a negative value is clamped to 0 (adw-wrap-box.c:587-588)' },
    { value: -12, spacing: 0, rule: 'the clamp is a floor, not an absolute value' },
    { value: '12', spacing: 12, rule: 'a numeric string parses (HTML attribute / XML layout)' },
    { value: '-4', spacing: 0, rule: 'a negative numeric string is clamped, not propagated' },
    { value: '', spacing: 0, rule: 'an empty value is the default, not NaN' },
    { value: null, spacing: 0, rule: 'an absent property is the default' },
    { value: 'abc', spacing: 0, rule: 'a non-numeric value is 0 — NaN must never reach a layout' },
    { value: Number.NaN, spacing: 0, rule: 'NaN has no int counterpart in C; the ports agree on 0' },
    { value: Number.POSITIVE_INFINITY, spacing: 0, rule: 'infinity is not an int either' },
];

/** One "does the setter report a change" expectation. */
export interface WrapBoxSpacingNotifyVector {
    /** The spacing the widget already holds. */
    from: number;
    /** The value handed to the setter. */
    value: number | string;
    /** Whether the setter reaches `g_object_notify_by_pspec` at all. */
    notifies: boolean;
    rule: string;
}

/**
 * The early return in `adw_wrap_box_set_child_spacing`
 * (adw-wrap-box.c:592-593, :930-931): the comparison happens AFTER the clamp,
 * so setting `-5` on a box that already holds 0 changes nothing and notifies
 * nobody. The browser port compared raw attribute strings and fired
 * `notify::child-spacing` for a value libadwaita had normalised away.
 */
export const WRAP_BOX_SPACING_NOTIFY_VECTORS: ReadonlyArray<WrapBoxSpacingNotifyVector> = [
    { from: 0, value: 6, notifies: true, rule: 'a real change notifies' },
    { from: 6, value: 6, notifies: false, rule: 'setting the same value is an early return (:592-593)' },
    { from: 0, value: -5, notifies: false, rule: 'clamped to the value already held — no notification' },
    { from: 6, value: -5, notifies: true, rule: 'clamped to 0, which IS a change from 6' },
    { from: 0, value: 'abc', notifies: false, rule: 'garbage normalises to the value already held' },
    { from: 6, value: '', notifies: true, rule: 'clearing the property falls back to the default 0' },
];

// --- The property roster -------------------------------------------------------

/**
 * Every `notify::` an `Adw.WrapBox` emits — the thirteen installed pspecs
 * (adw-wrap-box.c:284-495) plus the overridden `orientation` (:497).
 *
 * The count is the assertion. C notifies on all fourteen; the browser port
 * notified on TWO (`child-spacing`, `line-spacing`) and NativeScript on none, so
 * a consumer binding to anything else watched a signal that could not fire. A
 * roster is the only shape that fails when a property is ADDED without its
 * notification.
 */
export const WRAP_BOX_NOTIFY_PROPERTIES: readonly string[] = [
    'child-spacing',
    'child-spacing-unit',
    'pack-direction',
    'align',
    'justify',
    'justify-last-line',
    'line-spacing',
    'line-spacing-unit',
    'line-homogeneous',
    'natural-line-length',
    'natural-line-length-unit',
    'wrap-reverse',
    'wrap-policy',
    'orientation',
];

// --- wrap-policy ---------------------------------------------------------------

/** One `wrap-policy` → child-shrink expectation. */
export interface WrapBoxPolicyVector {
    /** The authored value. Anything not in the enum leaves the property at its default. */
    value: unknown;
    /** The stored policy. */
    policy: AdwWrapPolicy;
    /** The `flex-shrink` a child gets — `FlexboxLayout.setFlexShrink` on NativeScript. */
    flexShrink: number;
    rule: string;
}

/**
 * `Adw.WrapBox:wrap-policy` (adw-wrap-box.c:476-495).
 *
 * The default is `natural`, the RESTRICTIVE one: a line wraps as soon as the next
 * child would not fit at its natural size, where `minimum` squeezes children down
 * first. Both renderers had neither and inherited their flex container's default
 * — and CSS defaults `flex-shrink` to 1, i.e. to `minimum`.
 */
export const WRAP_BOX_POLICY_VECTORS: ReadonlyArray<WrapBoxPolicyVector> = [
    { value: null, policy: 'natural', flexShrink: 0, rule: 'the default is natural — wrap before shrinking' },
    {
        value: 'natural',
        policy: 'natural',
        flexShrink: 0,
        rule: 'natural forbids the shrink CSS would otherwise allow by default',
    },
    { value: 'minimum', policy: 'minimum', flexShrink: 1, rule: 'minimum squeezes children before wrapping' },
    { value: 'Minimum', policy: 'natural', flexShrink: 0, rule: 'the enum gate is case-sensitive, as GObject is' },
    { value: 'shrink', policy: 'natural', flexShrink: 0, rule: 'an unknown value leaves the property at its default' },
];

// --- Length units --------------------------------------------------------------

/** One length-unit conversion expectation. */
export interface WrapBoxLengthVector {
    /** The property value, in `unit`. */
    value: number;
    /** The authored unit. Anything outside the enum falls back to the `px` default. */
    unit: unknown;
    /** The `gtk-xft-dpi` the renderer reports. */
    dpi: number;
    /** The resolved pixel length. */
    px: number;
    rule: string;
}

/**
 * `adw_length_unit_to_px` as the three wrap-box length properties reach it
 * (adw-wrap-layout.c:554-565, :798-804).
 *
 * The wrap box defaults its units to `px` where the split views default to `sp`
 * (adw-wrap-box.c:300-305) — the same helper, two different defaults, which is
 * why the fallback is the caller's argument and not the helper's.
 */
export const WRAP_BOX_LENGTH_VECTORS: ReadonlyArray<WrapBoxLengthVector> = [
    { value: 12, unit: 'px', dpi: 96, px: 12, rule: 'px is a passthrough at any dpi' },
    {
        value: 12,
        unit: 'px',
        dpi: 144,
        px: 12,
        rule: 'and stays one when the text scale changes — that is the point of px',
    },
    { value: 12, unit: 'sp', dpi: 96, px: 12, rule: 'sp is a passthrough at the default dpi' },
    { value: 12, unit: 'sp', dpi: 144, px: 18, rule: 'sp scales with gtk-xft-dpi — 12 * 144 / 96' },
    { value: 12, unit: 'pt', dpi: 96, px: 16, rule: 'pt is the familiar 4/3 ratio at 96 dpi' },
    { value: 0, unit: 'pt', dpi: 144, px: 0, rule: 'zero converts to zero in every unit' },
    { value: 12, unit: 'em', dpi: 96, px: 12, rule: 'an unknown unit falls back to the wrap box default, px' },
    { value: 12, unit: null, dpi: 96, px: 12, rule: 'an absent unit is the default too' },
    {
        value: -1,
        unit: 'sp',
        dpi: 144,
        px: -1,
        rule: 'the natural-line-length sentinel is NOT converted (adw-wrap-layout.c:562 gates on >= 0)',
    },
];

/** One `natural-line-length` normalisation expectation. */
export interface WrapBoxNaturalLengthVector {
    /** The authored value. */
    value: unknown;
    /** The stored length, `-1` when unset. */
    length: number;
    rule: string;
}

/**
 * `Adw.WrapBox:natural-line-length` — `g_param_spec_int (…, -1, G_MAXINT, -1, …)`
 * (adw-wrap-box.c:438-441).
 *
 * `-1` means UNSET, not "zero length", so it is where everything out of range
 * lands: a GObject setter would have refused those and left the property where it
 * was born.
 */
export const WRAP_BOX_NATURAL_LENGTH_VECTORS: ReadonlyArray<WrapBoxNaturalLengthVector> = [
    { value: null, length: -1, rule: 'absent means unset — the box asks for what its children need' },
    { value: -1, length: -1, rule: 'the sentinel itself' },
    { value: 0, length: 0, rule: 'zero is IN range and is not the sentinel — a box that asks for nothing' },
    { value: 400, length: 400, rule: 'a plain length passes through' },
    { value: '400', length: 400, rule: 'a numeric string parses (HTML attribute / XML layout)' },
    { value: 400.7, length: 400, rule: 'the property is an int, so a fraction truncates' },
    { value: -5, length: -1, rule: 'below the declared minimum lands on unset, not on 0' },
    { value: 'wide', length: -1, rule: 'a non-numeric value is unset — NaN must never reach a layout' },
];

// --- Child order ---------------------------------------------------------------

/** One `insert_child_after` / `reorder_child_after` expectation. */
export interface WrapBoxChildOrderVector {
    /** Which operation is being resolved. */
    op: 'insert-after' | 'reorder-after';
    /** The box's children before the call. */
    children: readonly string[];
    /** The child being placed. */
    child: string;
    /** The sibling to place it after, or `null` for the FIRST position. */
    sibling: string | null;
    /** The children afterwards, or `null` when the call is refused. */
    result: readonly string[] | null;
    rule: string;
}

/**
 * `adw_wrap_box_insert_child_after` (adw-wrap-box.c:1283-1300) and
 * `adw_wrap_box_reorder_child_after` (:1315-1332), both of which delegate to
 * `gtk_widget_insert_after (child, self, sibling)`.
 *
 * The counter-intuitive rule is the NULL sibling: it inserts at the FIRST
 * position, not the last. Reading it as "append" is the obvious misreading and a
 * silent one — the child lands somewhere plausible.
 *
 * The refusals are the C's `g_return_if_fail`s: an insert wants the child
 * unparented, a reorder wants it already a child, the sibling must belong to this
 * box, and `child == sibling` is an explicit early return in both (:1297, :1329).
 */
export const WRAP_BOX_CHILD_ORDER_VECTORS: ReadonlyArray<WrapBoxChildOrderVector> = [
    {
        op: 'insert-after',
        children: ['a', 'b', 'c'],
        child: 'd',
        sibling: 'b',
        result: ['a', 'b', 'd', 'c'],
        rule: 'insert after a middle sibling',
    },
    {
        op: 'insert-after',
        children: ['a', 'b'],
        child: 'd',
        sibling: 'b',
        result: ['a', 'b', 'd'],
        rule: 'after the last sibling is an append',
    },
    {
        op: 'insert-after',
        children: ['a', 'b'],
        child: 'd',
        sibling: null,
        result: ['d', 'a', 'b'],
        rule: 'a NULL sibling PREPENDS — gtk_widget_insert_after inserts at the first position',
    },
    {
        op: 'insert-after',
        children: [],
        child: 'd',
        sibling: null,
        result: ['d'],
        rule: 'into an empty box, where first and last coincide',
    },
    {
        op: 'insert-after',
        children: ['a', 'b'],
        child: 'a',
        sibling: 'b',
        result: null,
        rule: 'refused: the child already has a parent (:1289)',
    },
    {
        op: 'insert-after',
        children: ['a'],
        child: 'd',
        sibling: 'z',
        result: null,
        rule: 'refused: the sibling is not a child of this box (:1293)',
    },
    {
        op: 'reorder-after',
        children: ['a', 'b', 'c'],
        child: 'a',
        sibling: 'c',
        result: ['b', 'c', 'a'],
        rule: 'moving forward removes first, so the target index is read AFTER the removal',
    },
    {
        op: 'reorder-after',
        children: ['a', 'b', 'c'],
        child: 'c',
        sibling: 'a',
        result: ['a', 'c', 'b'],
        rule: 'and moving backward lands directly behind the sibling',
    },
    {
        op: 'reorder-after',
        children: ['a', 'b', 'c'],
        child: 'c',
        sibling: null,
        result: ['c', 'a', 'b'],
        rule: 'a NULL sibling moves the child to the FRONT — the same rule as insert',
    },
    {
        op: 'reorder-after',
        children: ['a', 'b'],
        child: 'a',
        sibling: 'a',
        result: null,
        rule: 'refused: child == sibling is an explicit early return (:1329)',
    },
    {
        op: 'reorder-after',
        children: ['a', 'b'],
        child: 'z',
        sibling: 'a',
        result: null,
        rule: 'refused: reordering something that is not a child',
    },
    {
        op: 'reorder-after',
        children: ['a', 'b', 'c'],
        child: 'b',
        sibling: 'b',
        result: null,
        rule: 'the self-check runs before the membership one, so it refuses rather than no-ops',
    },
];
