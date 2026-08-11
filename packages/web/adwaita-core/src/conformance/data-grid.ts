// Data-grid conformance vectors — the cross-renderer spec for `AdwDataGrid`.
//
// NOT DERIVED FROM C, and cannot be: libadwaita vendors no `adw-data-grid.c`,
// `refs/gtk` is empty in this tree, and the widget is OURS — the web mirror of
// the native `Gtk.Grid` an accounting app fills for a BWA / P&L. The rows are
// derived from the browser element that shipped the behaviour
// (`adwaita-web/src/elements/adw-data-grid.ts`) and its stylesheet
// (`adwaita-web/scss/_data_grid.scss`), per this directory's rule for the absence
// of C: name the thing that decides.
//
// The one genuinely upstream rule here is typographic — `_labels.scss:81-88`
// gives `.numeric` `font-variant-numeric: tabular-nums` and `.monospace` the
// monospace family. It is cited on the class table and nowhere else; the layout
// rules have no upstream and must not be given a borrowed one.
//
// The five derivations live in `@gjsify/adwaita-core` and both renderers call
// them, so there is no second copy to drift. What the rows pin is the half a
// shared function cannot: that the two renderers make the SAME USE of the answer.
// The browser turns a `slack` track into `minmax(0px, 1fr)` and NativeScript into
// `ItemSpec(1, 'star')`; nothing in either type system connects those, so a
// renderer that re-decided which column absorbs the slack would still type-check
// and still pass its own suite.
//
// A trap in the browser mapping, pinned here: the slack track spells `0px` WITH
// its unit. `0` and `0px` are the same length and not the same CSS text —
// `style.gridTemplateColumns` reads back the canonical `minmax(0px, 1fr)`, so a
// template built with a bare `0` fails an equality assertion in the browser and
// nowhere else.
//
// Driven by the core suite against the functions themselves; by the NativeScript
// suite against them plus its own descriptor→`ItemSpec` mapping (its widget cannot
// be imported off-device — `AdwDataGrid extends GridLayout` evaluates the bare
// `@nativescript/core` specifier at module eval); and by the browser's own DOM
// spec, which drives a REAL `<adw-data-grid>` and reads the derived values back
// off the element.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: the grid itself is a @gjsify/adwaita-* widget, not a port.

import type { AdwDataGridAlign, AdwDataGridColumn, AdwDataGridRowVariant, DataGridTrack } from '../data-grid.js';

// --- Column tracks ------------------------------------------------------------

/** One track-derivation expectation. */
export interface DataGridTrackVector {
    /** What the row is about. */
    name: string;
    /** The column descriptors handed to `dataGridTracks`. */
    columns: ReadonlyArray<AdwDataGridColumn>;
    /** The renderer-neutral tracks derived from them. */
    tracks: ReadonlyArray<DataGridTrack>;
    /** The browser mapping — a `grid-template-columns` value. */
    template: string;
    rule: string;
}

/**
 * `dataGridTracks` + `dataGridTrackTemplate`.
 *
 * The rule needing the most rows is the implicit one: with NO `width` and NO
 * `flex` anywhere, the FIRST column absorbs the slack and the rest size to
 * content. It is global, so one declared size anywhere turns it off for every
 * column — the difference between "label column stretches, figures hug the right
 * edge" and "every column hugs its content".
 */
export const DATA_GRID_TRACK_VECTORS: ReadonlyArray<DataGridTrackVector> = [
    {
        name: 'no columns',
        columns: [],
        tracks: [],
        template: '',
        rule: 'an empty column list derives an empty template, not a stray separator',
    },
    {
        name: 'the statement default',
        columns: [{ key: 'position' }, { key: 'total', numeric: true }],
        tracks: [{ kind: 'slack' }, { kind: 'auto' }],
        template: 'minmax(0px, 1fr) auto',
        rule: 'nothing declared anywhere: column 0 absorbs the slack so the figures hug the right edge',
    },
    {
        name: 'a lone column',
        columns: [{ key: 'position' }],
        tracks: [{ kind: 'slack' }],
        template: 'minmax(0px, 1fr)',
        rule: 'the slack rule keys on index 0, so a single column is the slack column',
    },
    {
        name: 'flex and width together',
        columns: [
            { key: 'a', flex: 2 },
            { key: 'b', width: '80px' },
        ],
        tracks: [
            { kind: 'flex', weight: 2 },
            { kind: 'fixed', css: '80px' },
        ],
        template: '2fr 80px',
        rule: 'width pins, flex weights — each on its own column',
    },
    {
        name: 'one explicit size turns the slack rule off',
        columns: [{ key: 'a' }, { key: 'b', width: '80px' }],
        tracks: [{ kind: 'auto' }, { kind: 'fixed', css: '80px' }],
        template: 'auto 80px',
        rule: 'column 0 is content-sized here, NOT slack — pinning one column must not leave an implicit flexible one',
    },
    {
        name: 'width wins over flex on the same column',
        columns: [{ key: 'a', width: '120px', flex: 3 }],
        tracks: [{ kind: 'fixed', css: '120px' }],
        template: '120px',
        rule: 'the two are checked in order; a column declaring both is pinned, not weighted',
    },
    {
        name: 'a non-px unit stays unparsed',
        columns: [{ key: 'a', width: '6rem' }, { key: 'b' }],
        tracks: [{ kind: 'fixed', css: '6rem' }, { kind: 'auto' }],
        template: '6rem auto',
        rule: "the fixed track carries the CSS text verbatim — resolving the unit is the renderer's problem, not the derivation's",
    },
    {
        name: 'a zero weight',
        columns: [
            { key: 'a', flex: 0 },
            { key: 'b', flex: 1 },
        ],
        tracks: [
            { kind: 'flex', weight: 0 },
            { kind: 'flex', weight: 1 },
        ],
        template: '0fr 1fr',
        rule: 'flex 0 is a declared size (it collapses the column), so it counts as explicit and is passed through',
    },
];

// --- Cell classes -------------------------------------------------------------

/** One cell-class expectation. */
export interface DataGridColumnClassVector {
    /** What the row is about. */
    name: string;
    /** The column descriptor. */
    column: AdwDataGridColumn;
    /** The effective alignment. */
    align: string;
    /** The full class list, in order. */
    classes: ReadonlyArray<string>;
    rule: string;
}

/**
 * `dataGridColumnAlign` + `dataGridColumnClasses`.
 *
 * `numeric` and `mono` are libadwaita's own label classes (`_labels.scss:81-88`):
 * `.numeric` is `font-variant-numeric: tabular-nums`, `.monospace` additionally
 * the monospace family. They stack, and `numeric` also moves the default
 * alignment to the right edge.
 *
 * `align` is deliberately unvalidated (the last row): a value outside the union
 * produces a class no stylesheet claims and the cell keeps the base alignment.
 * The variant table below IS validated, a bogus variant picking an emphasis
 * rather than merely failing to move text.
 */
export const DATA_GRID_COLUMN_CLASS_VECTORS: ReadonlyArray<DataGridColumnClassVector> = [
    {
        name: 'a plain column',
        column: { key: 'position' },
        align: 'start',
        classes: ['adw-data-grid-cell', 'align-start'],
        rule: 'the default is start — labels read left',
    },
    {
        name: 'a numeric column',
        column: { key: 'total', numeric: true },
        align: 'end',
        classes: ['adw-data-grid-cell', 'align-end', 'numeric'],
        rule: 'numeric right-aligns AND asks for tabular figures (_labels.scss:86-88)',
    },
    {
        name: 'an explicit align beats the numeric default',
        column: { key: 'total', numeric: true, align: 'start' },
        align: 'start',
        classes: ['adw-data-grid-cell', 'align-start', 'numeric'],
        rule: 'align is the property, numeric only supplies its default',
    },
    {
        name: 'a monospace column',
        column: { key: 'code', monospace: true },
        align: 'start',
        classes: ['adw-data-grid-cell', 'align-start', 'mono'],
        rule: 'monospace does NOT imply right alignment — an account code reads left',
    },
    {
        name: 'numeric and monospace stack',
        column: { key: 'amount', numeric: true, monospace: true },
        align: 'end',
        classes: ['adw-data-grid-cell', 'align-end', 'numeric', 'mono'],
        rule: 'both classes, numeric first — the two are independent opt-ins',
    },
    {
        name: 'centered',
        column: { key: 'flag', align: 'center' },
        align: 'center',
        classes: ['adw-data-grid-cell', 'align-center'],
        rule: 'the third alignment reaches the class list unchanged',
    },
    {
        name: 'an alignment outside the union',
        column: { key: 'x', align: 'middle' as AdwDataGridAlign },
        align: 'middle',
        classes: ['adw-data-grid-cell', 'align-middle'],
        rule: 'NOT clamped: an unknown alignment yields a class no stylesheet claims, so the base rule wins',
    },
];

// --- Row variants -------------------------------------------------------------

/** One variant-normalisation expectation. */
export interface DataGridVariantVector {
    /** The raw `variant` value off the row object. */
    input: unknown;
    /** What it normalises to. */
    variant: AdwDataGridRowVariant;
    rule: string;
}

/**
 * `normalizeDataGridVariant`.
 *
 * Unlike the alignment, this one IS clamped: the variant picks a row's EMPHASIS —
 * a spanning bold section title, a hairline above a subtotal, a double rule above
 * the total — so an unrecognised value falls back to the plain data row rather
 * than to no rule at all.
 */
export const DATA_GRID_VARIANT_VECTORS: ReadonlyArray<DataGridVariantVector> = [
    { input: 'normal', variant: 'normal', rule: 'the explicit default' },
    { input: 'section', variant: 'section', rule: 'a spanning group title' },
    { input: 'subtotal', variant: 'subtotal', rule: 'bold with a hairline rule above' },
    { input: 'total', variant: 'total', rule: 'bold with a stronger rule above' },
    { input: undefined, variant: 'normal', rule: 'absent — the overwhelmingly common case' },
    { input: 'bogus', variant: 'normal', rule: 'an unknown string falls back rather than picking no emphasis' },
    { input: 'Section', variant: 'normal', rule: 'the set is case-sensitive, like every other Adwaita enum spelling' },
    { input: 0, variant: 'normal', rule: 'a non-string is rejected by the typeof guard before the set lookup' },
    { input: null, variant: 'normal', rule: 'null likewise — typeof null is object' },
];

// --- Cell text ----------------------------------------------------------------

/** One cell-text expectation. */
export interface DataGridCellTextVector {
    /** The raw value under the column's key. */
    input: string | number | boolean | undefined | null;
    /** What the cell paints. */
    text: string;
    rule: string;
}

/**
 * `dataGridCellText`.
 *
 * The grid formats NOTHING — a cell value is a pre-formatted string, only the app
 * knowing the locale, currency and rounding. So the rule is only about the two
 * empties, and the rows that matter are `0` and `false`: a truthiness test blanks
 * both, and a blanked `0` in a statement column is a missing figure, not a zero.
 */
export const DATA_GRID_CELL_TEXT_VECTORS: ReadonlyArray<DataGridCellTextVector> = [
    { input: '120.000,00 €', text: '120.000,00 €', rule: 'a pre-formatted string passes through untouched' },
    { input: 3, text: '3', rule: 'a number is stringified, not formatted' },
    { input: 0, text: '0', rule: 'zero is a figure — a truthiness test would blank it' },
    { input: false, text: 'false', rule: 'likewise false: only undefined and null are empty' },
    { input: '', text: '', rule: 'an empty string stays empty' },
    { input: undefined, text: '', rule: 'a missing key paints nothing, not the word undefined' },
    { input: null, text: '', rule: 'null reaches this from JSON and is the other empty' },
];

// --- Interactivity ------------------------------------------------------------

/** One activation expectation. */
export interface DataGridInteractiveVector {
    /** The row's normalised variant. */
    variant: AdwDataGridRowVariant;
    /** The row's own `interactive` value, as it arrives (JSON can hold anything). */
    rowFlag: unknown;
    /** The grid-level `interactive` flag. */
    gridInteractive: boolean;
    /** Whether the row activates. */
    interactive: boolean;
    rule: string;
}

/**
 * `dataGridRowInteractive`.
 *
 * Two independent rules, each with a failure mode worth a row. Only a `normal`
 * row can activate — a header, subtotal and total are structure, and a detail
 * view for a computed line leads nowhere. And the per-row flag overrides the
 * grid-level one in BOTH directions, which a single `||` or `&&` gets wrong.
 */
export const DATA_GRID_INTERACTIVE_VECTORS: ReadonlyArray<DataGridInteractiveVector> = [
    {
        variant: 'normal',
        rowFlag: undefined,
        gridInteractive: false,
        interactive: false,
        rule: 'the default grid is inert — a statement is not a list',
    },
    {
        variant: 'normal',
        rowFlag: undefined,
        gridInteractive: true,
        interactive: true,
        rule: 'the grid-level flag opts every plain data row in',
    },
    {
        variant: 'normal',
        rowFlag: true,
        gridInteractive: false,
        interactive: true,
        rule: 'a row opts ITSELF in without the grid flag',
    },
    {
        variant: 'normal',
        rowFlag: false,
        gridInteractive: true,
        interactive: false,
        rule: 'and opts itself OUT of an interactive grid — the direction a single || loses',
    },
    {
        variant: 'section',
        rowFlag: true,
        gridInteractive: true,
        interactive: false,
        rule: 'a section title spans the columns and has no record behind it',
    },
    {
        variant: 'subtotal',
        rowFlag: true,
        gridInteractive: true,
        interactive: false,
        rule: 'a subtotal is computed from the rows above it',
    },
    {
        variant: 'total',
        rowFlag: true,
        gridInteractive: true,
        interactive: false,
        rule: 'so is the total — the variant gate runs before either flag',
    },
    {
        variant: 'normal',
        rowFlag: 'yes',
        gridInteractive: true,
        interactive: true,
        rule: 'a value that is neither boolean defers to the grid instead of being read as truthy',
    },
    {
        variant: 'normal',
        rowFlag: 'yes',
        gridInteractive: false,
        interactive: false,
        rule: 'the same value with the grid inert — proof it deferred rather than opted in',
    },
];

// --- Column normalisation -----------------------------------------------------

/** One column-normalisation expectation. */
export interface DataGridColumnNormalizeVector {
    /** What the row is about. */
    name: string;
    /** The raw value — a parsed JSON attribute, so genuinely anything. */
    input: unknown;
    /** The normalised descriptors. */
    columns: ReadonlyArray<AdwDataGridColumn>;
    rule: string;
}

/**
 * `normalizeDataGridColumns`.
 *
 * The input is a parsed JSON attribute, so every field must survive a value of
 * the wrong type. Two policies run side by side: an entry WITHOUT a `key` is
 * dropped (nothing to read from a row), and a field of the wrong type is coerced
 * (`key`, `label`, `width`) or discarded (`flex`, `monospace`, `numeric`) rather
 * than taking the whole entry down.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (DATA_GRID_TRACK_VECTORS)
 */
export const DATA_GRID_COLUMN_NORMALIZE_VECTORS: ReadonlyArray<DataGridColumnNormalizeVector> = [
    {
        name: 'not an array',
        input: { key: 'a' },
        columns: [],
        rule: 'a bare object is not a column list — the attribute parsed, the shape did not',
    },
    {
        name: 'undefined',
        input: undefined,
        columns: [],
        rule: 'the no-attribute path lands here too',
    },
    {
        name: 'entries without a key',
        input: [{ label: 'A' }, null, 'b', { key: 'ok' }],
        columns: [
            {
                key: 'ok',
                label: undefined,
                align: undefined,
                width: undefined,
                flex: undefined,
                monospace: false,
                numeric: false,
            },
        ],
        rule: 'no key means nothing to read off a row, so the entry is dropped — malformed neighbours do not take the list down',
    },
    {
        name: 'key and label coerced',
        input: [{ key: 3, label: 0 }],
        columns: [
            {
                key: '3',
                label: '0',
                align: undefined,
                width: undefined,
                flex: undefined,
                monospace: false,
                numeric: false,
            },
        ],
        rule: 'both are stringified, so a numeric key still matches a numeric row key after JSON',
    },
    {
        name: 'a numeric width',
        input: [{ key: 'a', width: 80 }],
        columns: [
            {
                key: 'a',
                label: undefined,
                align: undefined,
                width: '80',
                flex: undefined,
                monospace: false,
                numeric: false,
            },
        ],
        rule: 'width is CSS text, so a number becomes "80" — which is NOT a valid CSS length, and stays the author\'s problem',
    },
    {
        name: 'a non-numeric flex',
        input: [{ key: 'a', flex: '2' }],
        columns: [
            {
                key: 'a',
                label: undefined,
                align: undefined,
                width: undefined,
                flex: undefined,
                monospace: false,
                numeric: false,
            },
        ],
        rule: 'flex is dropped rather than coerced — "2fr" built from a string is one typo away from an invalid template',
    },
    {
        name: 'the two flags are strict',
        input: [{ key: 'a', numeric: 'true', monospace: 1 }],
        columns: [
            {
                key: 'a',
                label: undefined,
                align: undefined,
                width: undefined,
                flex: undefined,
                monospace: false,
                numeric: false,
            },
        ],
        rule: '=== true, so a truthy non-boolean does not silently right-align a text column',
    },
];
