// Portable adjustment conformance vectors — the spec every surface taking a numeric
// range is held to (ADR 0047).
//
// The rows are derived from the GIR type surface (`@girs/gtk-4.0`, `Gtk.Adjustment`: the
// six properties, the two signals, and `set_value`'s "clamped to lie between lower and
// upper … the effective range … goes from lower to upper - page_size"), plus this
// package's own published defaults for what an OMITTED field means. `refs/gtk` is EMPTY in
// this tree, so no C line is cited — `ComboState.hasIndex` records the same limit in place,
// and a citation nobody could have read is worse than none.
//
// WHAT EACH TABLE PINS DOWN, and the defect it exists for:
//
//   AUTHORED    what an author may WRITE and where the value LANDS. One row is one
//               authored range plus one authored value, and the answer is the number the
//               row displays — which is what makes it drivable by a renderer rather than
//               only by the normaliser. The rows that matter are the ones a hand-written
//               port gets wrong: a value authored OUTSIDE the range, a `stepIncrement` of
//               zero (GTK's own default, and a stepper that cannot move), and an `upper`
//               below the `lower`.
//   PARSE       the same, through the JSON `adjustment` ATTRIBUTE — the one door where a
//               typo reaches the widget, so nothing here may throw. It yields the AUTHORED
//               FIELDS and not a whole adjustment, which is what makes attribute order
//               irrelevant: the row for `{"upper":20}` is the one that fails if a door
//               starts answering with a default `value: 0`.
//   SNAP        where a DRAGGED value lands — `snap-to-ticks`' arithmetic, counted from the
//               lower bound. `[1, 10]` step 3 has ticks at 1, 4, 7, 10 and not at 3, 6, 9,
//               which is the off-by-one every implementation of this makes once.
//
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import type { AdwAdjustment, AdwAdjustmentInput } from '../adjustment.js';

/** One authored range + value, and where the value lands. */
export interface AdjustmentAuthoredVector {
    /** What this row pins down. */
    rule: string;
    /** What the author wrote for the range. */
    input: AdwAdjustmentInput;
    /** The whole adjustment it normalises to. */
    adjustment: AdwAdjustment;
}

/** The six fields, spelled once so a row states only what it changes. */
const DEFAULTS: AdwAdjustment = {
    value: 0,
    lower: 0,
    upper: 100,
    stepIncrement: 1,
    pageIncrement: 1,
    pageSize: 0,
};

export const ADJUSTMENT_AUTHORED_VECTORS: ReadonlyArray<AdjustmentAuthoredVector> = [
    {
        rule: "an empty adjustment is 0…100 step 1 — the shared default, not GTK's 0…0 step 0",
        input: {},
        adjustment: DEFAULTS,
    },
    {
        rule: 'the unwritten fields come from that default',
        input: { upper: 10 },
        adjustment: { ...DEFAULTS, upper: 10 },
    },
    {
        rule: 'a value authored ABOVE the range lands on the upper bound',
        input: { lower: 0, upper: 10, value: 99 },
        adjustment: { ...DEFAULTS, upper: 10, value: 10 },
    },
    {
        rule: 'a value authored BELOW the range lands on the lower bound',
        input: { lower: 5, upper: 10, value: 1 },
        adjustment: { ...DEFAULTS, lower: 5, upper: 10, value: 5 },
    },
    {
        rule: "a zero step becomes 1 — GTK's default step is a stepper that cannot move",
        input: { stepIncrement: 0 },
        adjustment: DEFAULTS,
    },
    {
        rule: 'the page increment follows the step until one is authored',
        input: { stepIncrement: 5 },
        adjustment: { ...DEFAULTS, stepIncrement: 5, pageIncrement: 5 },
    },
    {
        rule: 'an upper below the lower collapses the range to a point rather than inverting it',
        input: { lower: 10, upper: 2, value: 7 },
        adjustment: { ...DEFAULTS, lower: 10, upper: 10, value: 10 },
    },
    {
        rule: 'a page size takes its bite out of the top: the value may reach upper - pageSize',
        input: { lower: 0, upper: 100, pageSize: 20, value: 95 },
        adjustment: { ...DEFAULTS, pageSize: 20, value: 80 },
    },
    {
        // Clamping the DEFAULT 0 into this range lands on -50, the maximum, from an author
        // who wrote no value at all. A range excluding zero is where "the default value is
        // 0" and "the default value is the bottom" come apart, and every surface seeding a
        // fresh adjustment goes through this row.
        rule: 'an unwritten value on a range that excludes zero lands at the BOTTOM, not the top',
        input: { lower: -100, upper: -50 },
        adjustment: { ...DEFAULTS, lower: -100, upper: -50, value: -100 },
    },
];

/** One JSON attribute, and the fields it authored. */
export interface AdjustmentParseVector {
    /** What this row pins down. */
    rule: string;
    /** The attribute as written. */
    raw: string | null;
    /** The fields it names — and ONLY those. */
    input: AdwAdjustmentInput;
}

export const ADJUSTMENT_PARSE_VECTORS: ReadonlyArray<AdjustmentParseVector> = [
    { rule: 'reads the fields the JSON names', raw: '{"lower":1,"upper":20}', input: { lower: 1, upper: 20 } },
    {
        rule: 'names no value where the JSON names none, so an authored value survives the write',
        raw: '{"upper":20}',
        input: { upper: 20 },
    },
    { rule: 'drops a key an adjustment does not have', raw: '{"min":1,"upper":20}', input: { upper: 20 } },
    { rule: 'drops a field that is not a number', raw: '{"upper":"20"}', input: {} },
    { rule: 'absent is nothing authored', raw: null, input: {} },
    { rule: 'unparseable is nothing authored, and not a throw', raw: '{lower:1', input: {} },
    { rule: 'well-formed JSON that is not an object is nothing authored', raw: '[1,2]', input: {} },
];

/** One dragged value, and the tick it lands on. */
export interface AdjustmentSnapVector {
    /** What this row pins down. */
    rule: string;
    /** The range being dragged through. */
    input: AdwAdjustmentInput;
    /** Where the drag landed. */
    from: number;
    /** The tick it snaps to. */
    snapped: number;
}

export const ADJUSTMENT_SNAP_VECTORS: ReadonlyArray<AdjustmentSnapVector> = [
    {
        rule: 'ticks are counted from the LOWER bound, not from zero',
        input: { lower: 1, upper: 10, stepIncrement: 3 },
        from: 5,
        snapped: 4,
    },
    {
        rule: 'and it rounds to the nearer of the two',
        input: { lower: 1, upper: 10, stepIncrement: 3 },
        from: 6,
        snapped: 7,
    },
    {
        rule: 'a drag past the top clamps first, so an upper off the grid is not reachable',
        input: { lower: 0, upper: 10, stepIncrement: 3 },
        from: 99,
        snapped: 9,
    },
    {
        rule: 'an upper ON the grid is reachable',
        input: { lower: 0, upper: 9, stepIncrement: 3 },
        from: 99,
        snapped: 9,
    },
    {
        rule: 'a drag below the bottom lands on the lower bound',
        input: { lower: 16, upper: 64, stepIncrement: 4 },
        from: -99,
        snapped: 16,
    },
    {
        rule: 'a value already on a tick does not move',
        input: { lower: 0, upper: 10, stepIncrement: 2 },
        from: 6,
        snapped: 6,
    },
    {
        // The row that says the RESULT is a tick rather than merely inside the range.
        // Clamping the value instead of the tick index answered 10 here — two off the grid
        // `0, 4, 8`, from a function whose whole contract is "the nearest step".
        rule: 'an upper bound off the grid is not reachable, even when the drag ends ON it',
        input: { lower: 0, upper: 10, stepIncrement: 4 },
        from: 10,
        snapped: 8,
    },
    {
        // …and the row that says the opposite half holds too. A DECIMAL step makes an exact
        // tick read as a hair under one in binary floating point — `(0.3 - 0) / 0.1` is
        // 2.9999999999999996 — so a plain floor of the tick index drops a whole step and
        // answers 0.2 for a bound that IS on the grid. Decimals are what an author writes,
        // which makes this the common case rather than the exotic one.
        rule: 'an upper bound ON the grid is reachable, decimal step and all',
        input: { lower: 0, upper: 0.3, stepIncrement: 0.1 },
        from: 0.3,
        snapped: 0.3,
    },
    {
        // The error at the OTHER end: `0 + 2 * 0.1` is 0.2 exactly, but `0 + 3 * 0.1` is
        // 0.30000000000000004 — outside the range it belongs to — so the result is clamped
        // after the tick arithmetic as well as before it.
        rule: 'and a tick below it is exact rather than one step off the accumulated sum',
        input: { lower: 0, upper: 0.3, stepIncrement: 0.1 },
        from: 0.21,
        snapped: 0.2,
    },
];
