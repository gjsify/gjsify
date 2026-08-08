// Wrap-box conformance vectors — the narrow portable slice of Adw.WrapBox.
//
// WHY ONLY A SLICE
//
// `Adw.WrapBox` is deliberately NOT lifted into `@gjsify/adwaita-core` (ADR
// 0004). The interesting tier is a line-breaking engine — `count_line_children`
// walking children until the line overflows, then `box_allocate` distributing
// the leftover — and neither renderer can be FED one: CSS flexbox breaks lines
// itself and NativeScript's `WrapLayout` breaks them in native code. A core
// class holding a property bag for properties neither renderer draws is the
// over-abstraction the ADR warns about.
//
// What IS portable is the DECISION the engine makes before it measures anything:
// given `justify`, `justify-last-line`, `align` and whether this is the final
// line, does the leftover space go into the CHILDREN, into the GAPS, or into a
// single offset applied to the whole line? That question is answered identically
// on every renderer, it is answerable without a layout pass, and three of the
// bugs in issue #1048 were wrong answers to it:
//
//   - `align` was bound to `align-items` — the CROSS axis — where C applies it
//     as a MAIN-axis offset, so `align="1"` pushed children DOWN instead of to
//     the end of the line;
//   - `justify="fill"` and `justify="spread"` both rendered as `space-between`,
//     so `fill` grew the gaps where C grows the children;
//   - `justify-last-line` was in `observedAttributes` and read by nothing, so
//     the last line was ALWAYS justified — the exact opposite of the C default.
//
// The second table is the spacing normaliser: C clamps a negative spacing to 0
// and then early-returns when nothing changed, so a negative value neither
// reaches the layout nor emits a notification. The web port did neither.
//
// There is no core IMPLEMENTATION behind these rows on purpose. The browser
// element resolves them with its own three-line gate and maps the answer onto
// `justify-content` / `flex-grow`; the NativeScript port has nowhere to land
// them, because NS `WrapLayout` exposes `orientation`, `itemWidth` and
// `itemHeight` and nothing else — a resolver on that side would be a function
// with no caller. So the SPACING table is driven by both suites and the LINE
// table by the browser one, and the day NS grows a knob it inherits the rows
// rather than a second reading of the C.
//
// Reference: refs/libadwaita/src/adw-wrap-box.c
// Reference: refs/libadwaita/src/adw-wrap-layout.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

// --- Property defaults (adw-wrap-box.c) --------------------------------------

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
export const ADW_WRAP_BOX_DEFAULT_JUSTIFY = 'none';

/** `Adw.WrapBox:justify-last-line` default — `FALSE` (adw-wrap-box.c:379-381). */
export const ADW_WRAP_BOX_DEFAULT_JUSTIFY_LAST_LINE = false;

// --- The justify / align / last-line decision table --------------------------

/** `AdwJustifyMode` — the three values of `Adw.WrapBox:justify`. */
export type WrapBoxJustify = 'none' | 'fill' | 'spread';

/** What a renderer has to do with a line's leftover space. */
export interface WrapBoxLineLayout {
    /**
     * The justify mode that governs THIS line, after the last-line gate. It is
     * the widget's `justify` for every line except the final one, and for the
     * final one only when `justify-last-line` is set
     * (adw-wrap-layout.c:397-400, :705-706).
     */
    justify: WrapBoxJustify;
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

/** One row of the decision table. */
export interface WrapBoxLineVector {
    /** The widget's `justify` property. */
    justify: WrapBoxJustify;
    /** The widget's `justify-last-line` property. */
    justifyLastLine: boolean;
    /** The widget's `align` property, already validated into `[0, 1]`. */
    align: number;
    /**
     * Whether this is the FINAL line — `i == *n_lines - 1`
     * (adw-wrap-layout.c:463-464). Note it is the final line, NOT merely an
     * incomplete one: a wrap box whose children all fit on one line has that
     * line as its last, so by default `justify` does nothing to it at all.
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
 * Two rows are counter-intuitive and are the reason the table exists rather than
 * a sentence in a comment. First, `lastLine` is the FINAL line whether or not it
 * is full, so the single-line case — the common one — is governed by
 * `justify-last-line`, not by `justify`. Second, `spread` with exactly ONE child
 * in the line does not spread anything: `n_children > 1` guards the branch that
 * keeps children at `minimum_size`, so a lone child is STRETCHED instead, which
 * the property documentation states outright (adw-wrap-box.c:349-352).
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
     * The value handed to the setter. A string is what an HTML attribute or an
     * XML layout carries; a number is what a JS property setter gets. C only
     * ever sees an `int`, so the string rows are the PORTS' own edge — they
     * exist because the browser port propagated `NaN` into the style where the
     * NativeScript port coerced it to 0.
     */
    value: number | string | null;
    /** The value the widget stores and lays out with. */
    spacing: number;
    /** The rule this row pins down. */
    rule: string;
}

/**
 * `adw_wrap_box_set_child_spacing` / `set_line_spacing`
 * (adw-wrap-box.c:587-588, :927-928) — a negative spacing is clamped to 0
 * BEFORE anything else happens, so it never reaches the layout.
 *
 * The property is declared with a minimum of 0 (adw-wrap-box.c:285-287,
 * :393-395), which is why the clamp exists at all: without it GObject would
 * reject the value and warn.
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
    /** The rule this row pins down. */
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
