// Adwaita data-grid behaviour — headless (ADR 0004).
//
// `AdwDataGrid` is the slim ALIGNED grid for genuinely tabular numeric data (an
// accounting BWA / P&L statement, invoice line-items): labels left, amounts
// right-aligned, with the section / subtotal / total emphasis a statement needs.
//
// THIS WIDGET IS OURS, NOT UPSTREAM'S. libadwaita vendors no `adw-data-grid.c`
// and `refs/gtk` is empty in this tree, so there is no C to derive from and no C
// to cite — the module a reader should compare this against is the browser
// element it was lifted out of (`adwaita-web/src/elements/adw-data-grid.ts`) and
// its stylesheet. Do not invent a citation for the layout rules below; the only
// upstream source that reaches this widget is the tabular-numeral rule the cell
// classes carry (see {@link dataGridColumnClasses}).
//
// WHY IT IS IN CORE: the two renderers align their columns by mechanisms with
// nothing in common. The browser declares the tracks once on the table and makes
// every row a CSS `subgrid` spanning them; NativeScript has no subgrid, so its
// port is ONE `GridLayout` whose cells are direct children and whose tracks are
// `ItemSpec`s. What they share is the DERIVATION — which column gets a fixed
// track, which one absorbs the slack, which ones size to content — and that
// derivation is what a second copy would drift on: the first port to grow a
// column property would grow it alone.
//
// So the track rule is emitted as a renderer-NEUTRAL descriptor
// ({@link DataGridTrack}) rather than as a CSS string. The browser maps it to
// `grid-template-columns` with {@link dataGridTrackTemplate}; NativeScript maps
// it to `ItemSpec` values in its own pure sibling. Same seam as
// `splitViewColumns()` in the NativeScript split views: the index/spec decision
// is pure and shared, the platform object is constructed in the widget.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_labels.scss:81-88
//            (`.monospace` / `.numeric { font-variant-numeric: tabular-nums }`)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: the grid itself is a @gjsify/adwaita-* widget, not a port.

/** Horizontal alignment of a column's header + cells. */
export type AdwDataGridAlign = 'start' | 'end' | 'center';

/** Accounting row emphasis. `normal` is the default plain data row. */
export type AdwDataGridRowVariant = 'normal' | 'section' | 'subtotal' | 'total';

/** The four row variants, in the order a statement uses them. */
export const ADW_DATA_GRID_ROW_VARIANTS: ReadonlyArray<AdwDataGridRowVariant> = [
    'normal',
    'section',
    'subtotal',
    'total',
];

/** A column descriptor — what to read (`key`), how to label + align it. */
export interface AdwDataGridColumn {
    /** The row-object key this column renders. */
    key: string;
    /** Header text (defaults to `key`). */
    label?: string;
    /** 'start' | 'end' | 'center'. Defaults to 'start' (or 'end' when numeric). */
    align?: AdwDataGridAlign;
    /** Fixed CSS track size (e.g. '80px', '6rem') — pins the column width. */
    width?: string;
    /** Fractional track weight (→ `<flex>fr`) — lets the column grow. */
    flex?: number;
    /** Render cells in a monospace family (tabular figures apply regardless). */
    monospace?: boolean;
    /** Convenience: right-align + tabular-nums (numeric columns of figures). */
    numeric?: boolean;
}

/** What a cell may hold — pre-formatted strings, or anything stringifiable. */
export type AdwDataGridCellValue = string | number | boolean | AdwDataGridRowVariant | undefined;

/** A row: cell values keyed by column key + optional accounting metadata. */
export interface AdwDataGridRow {
    /** Accounting emphasis. Default 'normal'. */
    variant?: AdwDataGridRowVariant;
    /** Make just this row clickable (overrides the element-level flag). */
    interactive?: boolean;
    /** Cell values keyed by column key (pre-formatted strings, or numbers). */
    [key: string]: AdwDataGridCellValue;
}

/**
 * One column track, in renderer-neutral terms.
 *
 * `fixed` carries the author's CSS length UNPARSED, because the browser can
 * resolve every unit CSS has and no other renderer can: it is the one track kind
 * whose meaning is the stylesheet's. A renderer without a CSS engine parses what
 * it understands and falls back — see the NativeScript sibling for that call.
 */
export type DataGridTrack =
    /** A pinned track: the `width` string exactly as the column declared it. */
    | { kind: 'fixed'; css: string }
    /** A weighted track: `flex` fractions of the leftover space. */
    | { kind: 'flex'; weight: number }
    /** The single slack-absorbing track — see {@link dataGridTracks}. */
    | { kind: 'slack' }
    /** A content-sized track. */
    | { kind: 'auto' };

/** The class every data-grid cell carries, header cells included. */
export const DATA_GRID_CELL_CLASS = 'adw-data-grid-cell';

/** The class every data-grid row carries, the header row included. */
export const DATA_GRID_ROW_CLASS = 'adw-data-grid-row';

const VARIANTS: ReadonlySet<string> = new Set(ADW_DATA_GRID_ROW_VARIANTS);

/**
 * The column tracks derived from the column descriptors.
 *
 * `width` pins a track and `flex` weights one, each on its own column. The
 * interesting rule is the third one and it is GLOBAL, not per column: when
 * NOTHING declares a size anywhere, the FIRST column absorbs the slack and every
 * other column sizes to its content. That is the statement shape — one label
 * column taking whatever is left, trailing figures hugging the right edge — and
 * it is why the emptiest possible column list still produces a usable grid.
 *
 * One declared size anywhere turns the rule off for every column, so a caller
 * pinning a single column does not silently keep an implicit flexible one.
 */
export function dataGridTracks(columns: ReadonlyArray<AdwDataGridColumn>): DataGridTrack[] {
    const anyExplicit = columns.some((c) => c.width !== undefined || c.flex !== undefined);
    return columns.map((column, index): DataGridTrack => {
        if (column.width !== undefined) return { kind: 'fixed', css: column.width };
        if (column.flex !== undefined) return { kind: 'flex', weight: column.flex };
        if (!anyExplicit && index === 0) return { kind: 'slack' };
        return { kind: 'auto' };
    });
}

/**
 * The CSS `grid-template-columns` value for a track list — the browser mapping.
 *
 * The slack track is `minmax(0px, 1fr)` rather than `1fr` so a long cell cannot
 * push the column past its share (`1fr` floors at the content's min-content
 * size); `0px` is spelled with its unit because that is the CSSOM-canonical
 * form, and a bare `0` does not round-trip through `style.gridTemplateColumns`.
 */
export function dataGridTrackTemplate(tracks: ReadonlyArray<DataGridTrack>): string {
    return tracks
        .map((track) => {
            switch (track.kind) {
                case 'fixed':
                    return track.css;
                case 'flex':
                    return `${track.weight}fr`;
                case 'slack':
                    return 'minmax(0px, 1fr)';
                case 'auto':
                    return 'auto';
            }
        })
        .join(' ');
}

/**
 * A column's effective alignment: its own `align`, or `end` when it is numeric.
 *
 * The numeric default is the widget's reason to exist — a column of figures that
 * does not end on a common right edge is a boxed list with extra steps.
 */
export function dataGridColumnAlign(column: AdwDataGridColumn): AdwDataGridAlign {
    return column.align ?? (column.numeric ? 'end' : 'start');
}

/**
 * The classes a column's cells carry: the base cell class, the alignment, and
 * the two typographic opt-ins.
 *
 * `numeric` and `mono` are the libadwaita label classes (_labels.scss:81-88):
 * both set `font-variant-numeric: tabular-nums`, `mono` additionally switching
 * to the monospace family. A renderer whose stylesheet cannot express that
 * feature still gets the alignment, which is the half that survives.
 *
 * `align` is NOT clamped to {@link AdwDataGridAlign} here, so a value outside
 * the union produces a class no stylesheet claims and the cell falls back to the
 * base rule. That is deliberate asymmetry with {@link normalizeDataGridVariant}:
 * a bogus variant would pick an EMPHASIS (a bold total rule where none belongs),
 * a bogus alignment only fails to move text.
 */
export function dataGridColumnClasses(column: AdwDataGridColumn): string[] {
    const classes = [DATA_GRID_CELL_CLASS, `align-${dataGridColumnAlign(column)}`];
    if (column.numeric) classes.push('numeric');
    if (column.monospace) classes.push('mono');
    return classes;
}

/**
 * Coerce a cell value to display text — pre-formatted strings pass through.
 *
 * The grid FORMATS NOTHING: locale currency, thousands separators and decimals
 * are the app's, because only the app knows the locale and the rounding. A
 * number reaching here is a convenience, not a formatting request, so it is
 * stringified as-is. A missing key is empty rather than `undefined`.
 */
export function dataGridCellText(value: AdwDataGridCellValue | null): string {
    if (value === undefined || value === null) return '';
    return String(value);
}

/** Clamp an arbitrary variant to the known set (unknown → 'normal'). */
export function normalizeDataGridVariant(variant: unknown): AdwDataGridRowVariant {
    return typeof variant === 'string' && VARIANTS.has(variant) ? (variant as AdwDataGridRowVariant) : 'normal';
}

/** Normalise raw column descriptors to a stable list (drops malformed entries). */
export function normalizeDataGridColumns(raw: unknown): AdwDataGridColumn[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((c): c is AdwDataGridColumn => typeof c === 'object' && c !== null && 'key' in c)
        .map((c) => ({
            key: String(c.key),
            label: c.label !== undefined ? String(c.label) : undefined,
            align: c.align,
            width: c.width !== undefined ? String(c.width) : undefined,
            flex: typeof c.flex === 'number' ? c.flex : undefined,
            monospace: c.monospace === true,
            numeric: c.numeric === true,
        }));
}

/**
 * Whether a row activates on click/tap.
 *
 * Three conditions, and the order matters. Only a `normal` row can activate at
 * all — a section header, a subtotal and a total are STRUCTURE, and making them
 * tappable would offer a detail view for a computed line that has none. Then the
 * per-row flag wins over the grid-level one in BOTH directions: `false` opts a
 * single row out of a fully interactive grid, `true` opts a single row into an
 * otherwise inert one.
 *
 * `rowFlag` is `unknown` on purpose: it arrives from a JSON attribute, where
 * anything can be under the key, and only the two booleans decide. Any other
 * value defers to the grid, which is what a value the widget cannot read should
 * do.
 */
export function dataGridRowInteractive(
    variant: AdwDataGridRowVariant,
    rowFlag: unknown,
    gridInteractive: boolean,
): boolean {
    return variant === 'normal' && rowFlag !== false && (rowFlag === true || gridInteractive);
}
