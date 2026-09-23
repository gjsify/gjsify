// <gtk-action-bar> — GTK's bottom bar: widgets packed from the start, from the end, and
// one in the centre.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1): `Gtk.ActionBar` is GTK's,
// and libadwaita only styles it (`actionbar > revealer > box` in `_toolbars.scss`).
//
// THE PLACEMENT IS GtkBuildable's (gtkactionbar.c:220): `[start]` packs from the start,
// `[end]` packs from the end, `[center]` is the centre widget, and a child with no type
// packs from the start. There is no `center-widget` slot: GTK has `set_center_widget` but
// no property of that name, and `Gtk.Builder` refuses a `.blp` that writes one. Packing
// from the end is `gtk_box_insert_child_after (end_box, child, NULL)` — a PREPEND — so the
// first `[end]` child sits nearest the edge and each later one lands in front of it,
// exactly as `adw_header_bar_pack_end` does.
//
// `revealed` defaults to TRUE, as `GtkActionBar:revealed` does: only `revealed="false"`
// hides the bar.
//
// Reference: refs/gtk/gtk/gtkactionbar.c (the buildable child types, pack_start/pack_end)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toolbars.scss (GtkActionBar)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { bindSlottedChildren } from '../slotted-children.js';

export class GtkActionBar extends HTMLElement {
    private _initialized = false;
    private _startEl: HTMLDivElement | null = null;
    private _centerEl: HTMLDivElement | null = null;
    private _endEl: HTMLDivElement | null = null;

    static get observedAttributes() {
        return ['revealed'];
    }

    /** `GtkActionBar:revealed` — whether the bar shows its contents. */
    get revealed(): boolean {
        return this.getAttribute('revealed') !== 'false';
    }

    set revealed(value: boolean) {
        this.setAttribute('revealed', value ? 'true' : 'false');
    }

    /** The start box — what `pack_start` appends to. */
    get startSection(): HTMLDivElement | null {
        return this._startEl;
    }

    /** The centre — what `gtk_action_bar_set_center_widget` sets. */
    get centerSection(): HTMLDivElement | null {
        return this._centerEl;
    }

    /** The end box — what `pack_end` prepends to. */
    get endSection(): HTMLDivElement | null {
        return this._endEl;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._startEl = document.createElement('div');
        this._startEl.className = 'adw-action-bar-start';
        this._centerEl = document.createElement('div');
        this._centerEl.className = 'adw-action-bar-center';
        this._endEl = document.createElement('div');
        this._endEl.className = 'adw-action-bar-end';
        const endEl = this._endEl;

        bindSlottedChildren(this, [
            { name: 'start', into: this._startEl },
            { name: 'center', into: this._centerEl },
            { name: 'end', consume: (node) => endEl.prepend(node) },
            // An untyped child packs from the start (gtkactionbar.c:233).
            { into: this._startEl },
        ]).install(this._startEl, this._centerEl, this._endEl);

        this._renderRevealed();
    }

    attributeChangedCallback() {
        if (this._initialized) this._renderRevealed();
    }

    private _renderRevealed(): void {
        this.hidden = !this.revealed;
    }
}

customElements.define('gtk-action-bar', GtkActionBar);
