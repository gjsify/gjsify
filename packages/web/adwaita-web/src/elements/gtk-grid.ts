// <gtk-grid> — Gtk.Grid: a table of cells, each the size of its own content unless the
// grid is asked to make them equal.
//
// FOUR SCALAR PROPERTIES, and CSS Grid already has every one of them.
//
//   `row-spacing` / `column-spacing`  the gap between two consecutive rows / columns
//       (gtkgrid.c:429-447: an int, minimum 0, default 0 — the same pspec as `Gtk.Box`'s
//       `spacing`, so `normalizeBoxSpacing` is the same reader for both).
//   `row-homogeneous` / `column-homogeneous`  every row the same height / every column the
//       same width (gtkgrid.c:449-470, both default FALSE).
//   `orientation` (GtkOrientable, gtkgrid.c:198-211, :481-484) which way a child with no
//       position of its own is attached: along the columns, or down the rows.
//
// PLACEMENT IS SOURCE ORDER, which is what GtkBuilder itself does: a child written without
// a position is attached at the first free cell ALONG THE ORIENTATION (gtkgrid.c:493-507,
// `find_attach_position`), which searches the CROSS range that starts at 0 and takes the
// maximum position along the orientation one — so the child lands at row 0, column N for a
// horizontal grid, and never wraps. That is `grid-auto-flow: column` here (the implicit
// grid has no rows, so every item takes the single row and opens a new column), and the
// vertical case is the mirror. `gtk_grid_attach()` for a named cell is the imperative route
// and has no markup form here — the gallery trees carry no layout data either, because
// `SharedTreeNode` has no field for it.
//
// WHAT `1fr` IS NOT. GTK sets every line's minimum AND natural to the maximum over all
// lines (gtkgridlayout.c:703-732), so a homogeneous column is as wide as the WIDEST cell
// whatever it holds. A `1fr` track instead takes an equal share of the space the grid is
// given, which is the same answer whenever the grid fills its parent — the shape every
// block here has, and the shape a `Gtk.Grid` in a window has — and a different one for a
// shrink-wrapped grid. For ROWS the two only meet when the grid is given a definite height,
// because an auto-height grid has no free space to share; that is the whole of the
// divergence and it is declared rather than measured away.
//
// A11Y: `role="generic"`, GtkGrid's own accessible role (gtkgrid.c:488).
//
// Reference: refs/gtk/gtk/gtkgrid.c:198-211, :429-488, :493-507
// Reference: refs/gtk/gtk/gtkgridlayout.c:703-732
// Copyright (c) The GTK Team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { normalizeBoxOrientation, normalizeBoxSpacing, type BoxOrientation } from '@gjsify/adwaita-core';

export class GtkGrid extends HTMLElement {
    static get observedAttributes() {
        return ['column-spacing', 'row-spacing', 'column-homogeneous', 'row-homogeneous', 'orientation'];
    }

    /** `Gtk.Grid:column-spacing` — the gap between two consecutive columns. Defaults to 0. */
    get columnSpacing(): number {
        return normalizeBoxSpacing(this.getAttribute('column-spacing'));
    }

    set columnSpacing(value: number) {
        this.setAttribute('column-spacing', String(value));
    }

    /** `Gtk.Grid:row-spacing` — the gap between two consecutive rows. Defaults to 0. */
    get rowSpacing(): number {
        return normalizeBoxSpacing(this.getAttribute('row-spacing'));
    }

    set rowSpacing(value: number) {
        this.setAttribute('row-spacing', String(value));
    }

    /** `Gtk.Grid:column-homogeneous` — whether every column gets the same width. */
    get columnHomogeneous(): boolean {
        return this.hasAttribute('column-homogeneous');
    }

    set columnHomogeneous(value: boolean) {
        this.toggleAttribute('column-homogeneous', !!value);
    }

    /** `Gtk.Grid:row-homogeneous` — whether every row gets the same height. */
    get rowHomogeneous(): boolean {
        return this.hasAttribute('row-homogeneous');
    }

    set rowHomogeneous(value: boolean) {
        this.toggleAttribute('row-homogeneous', !!value);
    }

    /**
     * `GtkOrientable:orientation` — the axis a child with no position of its own is
     * attached along. `horizontal` (the default) appends each one to ROW 0 at the next
     * free column, `vertical` to COLUMN 0 at the next free row.
     */
    get orientation(): BoxOrientation {
        return normalizeBoxOrientation(this.getAttribute('orientation'));
    }

    set orientation(value: BoxOrientation) {
        this.setAttribute('orientation', value);
    }

    connectedCallback() {
        this.setAttribute('role', 'generic');
        this._sync();
    }

    attributeChangedCallback(name: string, old: string | null, value: string | null) {
        this._sync();
        if (!this.isConnected) return;
        const next = this._normalized(name, value);
        if (next === this._normalized(name, old)) return;
        this.dispatchEvent(new CustomEvent(`notify::${name}`, { bubbles: true, detail: { [name]: next } }));
    }

    private _normalized(name: string, raw: string | null): number | boolean | string {
        if (name === 'column-spacing' || name === 'row-spacing') return normalizeBoxSpacing(raw);
        if (name === 'orientation') return normalizeBoxOrientation(raw);
        return raw !== null;
    }

    private _sync(): void {
        // `gap` takes the ROW axis first, which is the reverse of the pair's alphabetical
        // order here; writing the two longhands keeps the mapping to the two properties
        // visible instead of hiding it in one shorthand.
        this.style.rowGap = `${this.rowSpacing}px`;
        this.style.columnGap = `${this.columnSpacing}px`;
        this.style.gridAutoRows = this.rowHomogeneous ? '1fr' : '';
        this.style.gridAutoColumns = this.columnHomogeneous ? '1fr' : '';
        this.style.gridAutoFlow = this.orientation === 'vertical' ? 'row' : 'column';
    }
}

customElements.define('gtk-grid', GtkGrid);
