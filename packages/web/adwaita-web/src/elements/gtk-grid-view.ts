// <gtk-grid-view> — the same model and factory as `<gtk-list-view>`, reflowed into
// columns: the web counterpart of `Gtk.GridView`.
//
// `GtkGridView` IS a `GtkListBase`, exactly as `GtkListView` is — same model, same
// factory, same selection function, same rubberband — and the only thing it adds is HOW
// MANY COLUMNS fit. So this element extends `<gtk-list-view>` and adds that one
// derivation, rather than restating a second copy of the item machinery. GTK's own CSS
// node names say the same thing from the other side: a list view's children are `row`,
// a grid view's are `child`, and nothing else in the node tree differs.
//
// THE COLUMN COUNT IS MEASURED, NOT GUESSED. `gridViewColumns` in `@gjsify/adwaita-core`
// is `gtk_grid_view_compute_n_columns` (gtkgridview.c:619-641) — integer division of the
// available size by the item size, both sides carrying the spacing, then
// `CLAMP (n, min-columns, max-columns)`. A `ResizeObserver` feeds it the view's own width
// and the first child's, which is the browser's equivalent of the size negotiation GTK
// runs; the result is written as `repeat(n, 1fr)` so the tracks stay equal, as GTK's do.
//
// A pure CSS `repeat(auto-fill, minmax(…))` was the alternative and was rejected: it
// cannot express `max-columns` at all (the cap is on the COUNT, not on a width), and
// `min-columns` only by a container width an author would have to compute — so the
// property pair GTK documents would have become two properties the port silently drops.
//
// Attributes: model, selection-mode, single-click-activate, enable-rubberband,
//   tab-behavior, orientation (all `<gtk-list-view>`'s), plus `min-columns` and
//   `max-columns`, which are `GtkGridView`'s own.
// Properties: everything `<gtk-list-view>` publishes, plus minColumns / maxColumns.
// Events: `activate`, `notify::selected` — the base element's.
// A11Y: `listbox` / `option`, inherited. GTK declares `GRID`/`GRID_CELL`
//   (gtkgridview.c:88-91), and the ARIA `grid` pattern needs a `row` layer between the
//   two that this widget has no concept of — its items are addressed by POSITION, never
//   by row and column — so announcing a grid would promise a navigation that is not there.
//
// Reference: refs/gtk/gtk/gtkgridview.c:44-92 (the widget, its CSS nodes and its role)
// Reference: refs/gtk/gtk/gtkgridview.c:619-641, 1147-1167 (the count and its two bounds)
// Reference: refs/libadwaita/src/stylesheet/widgets/_views.scss:52-91 (gridview > child)
// Copyright (c) GNOME contributors (GTK/libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { ADW_GRID_VIEW_MAX_COLUMNS, ADW_GRID_VIEW_MIN_COLUMNS, gridViewColumns } from '@gjsify/adwaita-core';

import { GtkListView } from './gtk-list-view.js';

/** The gap between cells — what `_grid_view.scss` sets, and the answer with no stylesheet. */
const GRID_SPACING = 6;

/** What `_grid_view.scss` floors a cell at, and the answer with no stylesheet. */
const GRID_ITEM_MIN_WIDTH = 120;

/**
 * A computed length in px, or `fallback` where CSS answered a keyword.
 *
 * Both lengths this element reads have a keyword for "unset" — `min-width: auto` on a grid
 * item, `column-gap: normal` — and both are numbers the stylesheet owns, so the fallback is
 * only reached when no stylesheet is loaded at all. A declared `0px` is NOT a fallback: the
 * column arithmetic has its own answer for a zero-sized item and must get to give it.
 */
function cssPixels(value: string, fallback: number): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export class GtkGridView extends GtkListView {
    private _observer: ResizeObserver | null = null;

    static get observedAttributes() {
        return [
            'model',
            'selection-mode',
            'single-click-activate',
            'enable-rubberband',
            'tab-behavior',
            'orientation',
            'min-columns',
            'max-columns',
        ];
    }

    /** `GtkGridView:min-columns` — at least one, as the ParamSpec's range says. */
    get minColumns(): number {
        return this._columnBound('min-columns', ADW_GRID_VIEW_MIN_COLUMNS);
    }

    set minColumns(value: number) {
        this.setAttribute('min-columns', String(value));
    }

    /** `GtkGridView:max-columns` — `DEFAULT_MAX_COLUMNS` is 7 (gtkgridview.c:42). */
    get maxColumns(): number {
        return this._columnBound('max-columns', ADW_GRID_VIEW_MAX_COLUMNS);
    }

    set maxColumns(value: number) {
        this.setAttribute('max-columns', String(value));
    }

    connectedCallback() {
        super.connectedCallback();
        if (this._observer !== null) return;
        // The view's width AND the first cell's: the count is a ratio of the two, and a
        // factory that lays out late changes the second without changing the first.
        this._observer = new ResizeObserver(() => this._applyColumns());
        this._observer.observe(this);
        this._applyColumns();
    }

    disconnectedCallback() {
        // Cleanup beside creation: an observer outliving its element keeps the whole
        // subtree alive and keeps measuring a box nothing draws.
        this._observer?.disconnect();
        this._observer = null;
    }

    attributeChangedCallback(name?: string) {
        super.attributeChangedCallback(name);
        this._applyColumns();
    }

    protected override get _viewClass(): string {
        return 'adw-grid-view';
    }

    protected override get _rowClass(): string {
        // `gridview > child`, where a list view has `listview > row`.
        return 'adw-grid-view-child';
    }

    protected override _renderRows(): void {
        super._renderRows();
        this._applyColumns();
    }

    /** An attribute that is not a positive integer is the property's default, not NaN. */
    private _columnBound(attribute: string, fallback: number): number {
        const parsed = Number.parseInt(this.getAttribute(attribute) ?? '', 10);
        return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
    }

    /**
     * Measure, count, and write the tracks.
     *
     * THE ITEM SIZE IS THE CELL'S `min-width`, NOT ITS RENDERED WIDTH, and the difference
     * is the whole reason this is three lines rather than one. The tracks are written as
     * `1fr`, so a rendered cell is as wide as the count made it: feeding that back in
     * would measure the answer and converge on whatever the first frame happened to do.
     * `min-width` is a fact about the CONTENT instead, declared by the stylesheet and
     * overridable per cell — and it is the branch GTK itself takes under
     * `GTK_SCROLL_MINIMUM` (gtkgridview.c:628-630). The natural-size branch needs a
     * measurement a browser can only take by first undoing the layout the answer feeds.
     *
     * The gap is read the same way, off the container's own `column-gap`, so the two
     * numbers the arithmetic takes come from ONE place — the stylesheet — and an author
     * who widens the gap does not get a column count computed against the old one.
     *
     * An empty view keeps the tracks it had: there is nothing to measure, and no cell for
     * the answer to be wrong about.
     */
    private _applyColumns(): void {
        const first = this._rows[0];
        if (first === undefined) return;
        const itemSize = cssPixels(globalThis.getComputedStyle(first).minWidth, GRID_ITEM_MIN_WIDTH);
        const spacing = cssPixels(globalThis.getComputedStyle(this._listEl).columnGap, GRID_SPACING);
        const forSize = Math.round(this.getBoundingClientRect().width);
        const columns = gridViewColumns(forSize, itemSize, spacing, this.minColumns, this.maxColumns);
        this._listEl.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    }
}

customElements.define('gtk-grid-view', GtkGridView);
