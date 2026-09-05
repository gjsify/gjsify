// AdwSidebar — a Libadwaita-style navigation sidebar for NativeScript.
//
// Renders a REAL NativeScript `ScrollView` wrapping a vertical `StackLayout` of
// tappable navigation rows (a boxed list). Mirrors `Adw.Sidebar`: sections of
// items, a `selected` index, a `notify::selected` event and an `activated`
// event. Pairs with the split views as the sidebar pane.
//
// FIDELITY: faithful behaviour, reduced surface. The selection state machine is
// `SidebarState` from `@gjsify/adwaita-core` (ADR 0004), so this bridge now
// answers the same questions the browser renderer and libadwaita do — including
// the three it used to get wrong: an out-of-range write clears the selection
// instead of being ignored, a fractional index is not a position, and re-tapping
// the already-selected row emits `activated`, which is the documented way to
// reveal a split view's content pane (adw-sidebar.c:73-75) and was impossible
// here before. Rows are a title label only: per-item subtitles/icons and drawn
// section headers need theme classes this surface does not have yet, so the
// model carries them and the rendering does not.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-sidebar`.
// Reference: refs/libadwaita/src/adw-sidebar.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_sidebars.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, ScrollView, StackLayout, type EventData } from '@nativescript/core';
import { attachRowPressFeedback } from './row-press.js';
import { SidebarState, sidebarRowClassName, sidebarSectionsFromLabels } from './sidebar-model.js';
import type { AdwSidebarItemSpec, AdwSidebarSectionSpec, SidebarItemFilter } from './sidebar-model.js';
import { xmlNumber } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

/** Event name emitted when {@link AdwSidebar.selected} changes. Mirrors GObject `notify::selected`. */
export const NOTIFY_SELECTED = 'notify::selected';

/**
 * Event name emitted on EVERY row tap, including a re-tap of the selected row.
 * Mirrors the `AdwSidebar::activated` signal (adw-sidebar.c:1601-1612).
 */
export const ACTIVATED = 'activated';

/** Payload of the `notify::selected` event. */
export interface NotifySidebarSelectedEventData extends EventData {
    /** The newly-selected item index, or -1 for no selection. */
    selected: number;
    /** The newly-selected item's label (`''` when nothing is selected). */
    title: string;
    /** The index the selection moved away from. */
    previous: number;
    /** True for a row tap; false for a programmatic set or a model change. */
    interactive: boolean;
}

/** Payload of the `activated` event. */
export interface SidebarActivatedEventData extends EventData {
    /** Flat index of the activated item. */
    index: number;
    /** The activated item's label. */
    title: string;
}

export class AdwSidebar extends ScrollView {
    /** The vertical list container. */
    protected readonly _list: StackLayout;
    private readonly _state = new SidebarState();
    private readonly _rows: { view: GridLayout; index: number }[] = [];

    constructor(props?: ConstructProps<AdwSidebar>) {
        super();

        this.orientation = 'vertical';
        this.className = 'adw-sidebar';

        const list = new StackLayout();
        list.orientation = 'vertical';
        list.className = 'adw-sidebar-list';
        this.content = list;
        this._list = list;

        // One notification path for every selection change — programmatic ones
        // included, as `g_object_notify_by_pspec (PROP_SELECTED)` does
        // (adw-sidebar.c:3068). The old setter notified only from itself, so a
        // model change that moved the selection was silent.
        this._state.subscribe((change) => {
            this._applySelection();
            const data: NotifySidebarSelectedEventData = {
                eventName: NOTIFY_SELECTED,
                object: this,
                selected: change.selected,
                title: change.item?.title ?? '',
                previous: change.previous,
                interactive: change.interactive,
            };
            this.notify(data);
        });

        applyConstructProps(this, props);
    }

    /** Set the navigation item labels — one untitled section. Rebuilds the tappable rows. */
    setItems(items: string[]): void {
        this.setSections(sidebarSectionsFromLabels(Array.isArray(items) ? items : []));
    }

    /** Set the full section model (titles, subtitles, icons, per-item `visible`/`enabled`). */
    setSections(sections: readonly AdwSidebarSectionSpec[]): void {
        this._state.setSections(sections);
        this._rebuild();
    }

    private _rebuild(): void {
        for (const row of this._rows) this._list.removeChild(row.view);
        this._rows.length = 0;

        for (const flat of this._state.visibleItems) {
            const row = new GridLayout();
            row.className = 'adw-sidebar-row';
            row.addColumn(new ItemSpec(1, 'star'));
            row.addRow(new ItemSpec(1, 'auto'));

            const text = new Label();
            text.className = 'adw-sidebar-row-title';
            text.text = flat.item.title;
            text.textWrap = true;
            GridLayout.setColumn(text, 0);
            row.addChild(text);

            // `visible` / `enabled` are bound to the row's `visible` / `sensitive`
            // (adw-sidebar.c:1382-1383): the row still exists and still owns its
            // flat index, it just does not show or respond. NS has no `:disabled`
            // pseudo-class in its CSS subset, so the insensitive shade is set
            // inline at `--disabled-opacity: 50%` (stylesheet/_colors.scss:320).
            if (flat.item.visible === false) row.visibility = 'collapse';
            if (flat.item.enabled === false) row.opacity = 0.5;

            row.addEventListener('tap', () => this._activate(flat.index));
            // Darken the row while held (Adwaita activatable-row `:active`).
            attachRowPressFeedback(row);

            this._list.addChild(row);
            this._rows.push({ view: row, index: flat.index });
        }

        this._applySelection();
    }

    /** Tap handler — the core applies the selection, then `activated` fires. */
    private _activate(index: number): void {
        if (!this._state.activate(index).activated) return;

        const data: SidebarActivatedEventData = {
            eventName: ACTIVATED,
            object: this,
            index,
            title: this._state.itemAt(index)?.title ?? '',
        };
        this.notify(data);
    }

    private _applySelection(): void {
        const selected = this._state.selected;
        const selectionVisible = this._state.selectionVisible;

        for (const row of this._rows) {
            row.view.className = sidebarRowClassName(row.index === selected, selectionVisible);
        }
    }

    /** The navigation item labels, in flat index order. */
    get items(): string[] {
        return this._state.items.map((flat) => flat.item.title);
    }

    set items(value: string[]) {
        this.setItems(value);
    }

    /** The section model. */
    get sections(): readonly AdwSidebarSectionSpec[] {
        return this._state.sections;
    }

    set sections(value: readonly AdwSidebarSectionSpec[]) {
        this.setSections(value);
    }

    /**
     * The selected item index, or -1 for no selection. Writing an index that is
     * not a valid position — out of range, negative, fractional — clears the
     * selection rather than being ignored (adw-sidebar.c:3028-3029).
     */
    get selected(): number {
        return this._state.selected;
    }

    set selected(raw: number | string) {
        const value = xmlNumber(raw, this.selected);
        this._state.setSelected(value);
    }

    /** The selected item, or undefined — `adw_sidebar_get_selected_item`. */
    get selectedItem(): AdwSidebarItemSpec | undefined {
        return this._state.selectedItem;
    }

    /**
     * `Adw.Sidebar:mode`. Only the BEHAVIOURAL half is implemented here: page
     * mode stops painting the selection (adw-sidebar.c:2948-2951). The boxed-list
     * look it also switches to needs theme classes this surface does not have.
     */
    get mode(): 'sidebar' | 'page' {
        return this._state.mode;
    }

    set mode(value: 'sidebar' | 'page') {
        if (this._state.setMode(value)) this._applySelection();
    }

    /** `Adw.Sidebar:filter` — decides which rows render, never the selection index space. */
    get filter(): SidebarItemFilter | null {
        return this._state.filter;
    }

    set filter(value: SidebarItemFilter | null) {
        this._state.setFilter(value);
        this._rebuild();
    }

    /** Whether the FILTERED row list is empty — the `.empty` / placeholder state. */
    get isEmpty(): boolean {
        return this._state.isEmpty;
    }
}
