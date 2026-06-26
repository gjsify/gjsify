// AdwSidebar — a Libadwaita-style navigation sidebar for NativeScript.
//
// Renders a REAL NativeScript `ScrollView` wrapping a vertical `StackLayout` of
// tappable navigation rows (a boxed list). Mirrors `Adw.Sidebar`: `setItems()`
// (label list), `selected` index, and a `notify::selected` event. Pairs with the
// split views as the sidebar pane.
//
// FIDELITY: faithful. The sidebar is a real scrollable list of tappable rows with
// a selected-row highlight via the `.active` class — matching `Adw.Sidebar`'s
// boxed-list navigation list. (No icons in this surface; pass a leading glyph in
// the label text if desired, as the other glyph-based widgets do.)
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-sidebar`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_sidebar.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, ScrollView, StackLayout, type EventData } from '@nativescript/core';
import { attachRowPressFeedback } from './row-press.js';

/** Event name emitted when {@link AdwSidebar.selected} changes. Mirrors GObject `notify::selected`. */
export const NOTIFY_SELECTED = 'notify::selected';

/** Payload of the `notify::selected` event. */
export interface NotifySidebarSelectedEventData extends EventData {
    /** The newly-selected item index. */
    selected: number;
    /** The newly-selected item's label. */
    title: string;
}

export class AdwSidebar extends ScrollView {
    /** The vertical list container. */
    protected readonly _list: StackLayout;
    private readonly _rows: GridLayout[] = [];
    private _items: string[] = [];
    private _selected = 0;

    constructor() {
        super();

        this.orientation = 'vertical';
        this.className = 'adw-sidebar';

        const list = new StackLayout();
        list.orientation = 'vertical';
        list.className = 'adw-sidebar-list';
        this.content = list;
        this._list = list;
    }

    /** Set the navigation item labels. Rebuilds the tappable rows. */
    setItems(items: string[]): void {
        for (const row of this._rows) this._list.removeChild(row);
        this._rows.length = 0;
        this._items = Array.isArray(items) ? items : [];

        this._items.forEach((label, index) => {
            const row = new GridLayout();
            row.className = 'adw-sidebar-row';
            row.addColumn(new ItemSpec(1, 'star'));
            row.addRow(new ItemSpec(1, 'auto'));

            const text = new Label();
            text.className = 'adw-sidebar-row-title';
            text.text = label;
            text.textWrap = true;
            GridLayout.setColumn(text, 0);
            row.addChild(text);

            row.addEventListener('tap', () => {
                this.selected = index;
            });
            // Darken the row while held (Adwaita activatable-row `:active`).
            attachRowPressFeedback(row);

            this._list.addChild(row);
            this._rows.push(row);
        });

        if (this._selected >= this._items.length) this._selected = 0;
        this._applySelection();
    }

    private _applySelection(): void {
        this._rows.forEach((row, i) => {
            row.className = i === this._selected ? 'adw-sidebar-row active' : 'adw-sidebar-row';
        });
    }

    /** The navigation item labels. */
    get items(): string[] {
        return this._items;
    }

    set items(value: string[]) {
        this.setItems(value);
    }

    /** The selected item index. Highlights the row + emits `notify::selected`. */
    get selected(): number {
        return this._selected;
    }

    set selected(value: number) {
        const next = Number.isFinite(value) ? value : 0;
        if (next === this._selected || next < 0 || next >= this._items.length) return;
        this._selected = next;
        this._applySelection();
        const data: NotifySidebarSelectedEventData = {
            eventName: NOTIFY_SELECTED,
            object: this,
            selected: next,
            title: this._items[next] ?? '',
        };
        this.notify(data);
    }
}
