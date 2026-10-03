// <gtk-list-view> — a list of rows built from a model and a factory, the web counterpart
// of `Gtk.ListView`.
//
// THE MODEL IS ADR 0046'S, THE SELECTION IS THE WIDGET'S (ADR 0089). GTK's `model`
// property is a `Gtk.SelectionModel` — a `Gio.ListModel` with a selection layered over it
// — and ADR 0046 declined that layering as a portable value, twice. So `model` here is the
// same `AdwListModel` `<gtk-drop-down>` takes, and WHICH selection model would have
// wrapped it is `selection-mode`, an attribute on the widget. `ListViewState` in
// `@gjsify/adwaita-core` owns the rules (ADR 0004): `listViewSelect` is
// `gtk_list_base_select_item` plus the three models' answers, so this element, the grid
// view and the column view cannot drift into three selection behaviours.
//
// THE FACTORY IS A FUNCTION, `AdwListItemFactory<Node>` — `GtkSignalListItemFactory`'s
// setup+bind collapsed into one call, since this port builds a node per item instead of
// recycling. With no factory a GTK list view draws EMPTY rows; the port's default draws
// the item's label (`defaultListItemFactory`), because an empty gallery row is
// indistinguishable from a broken one.
//
// THE MODEL IS SPLICED, NOT REBUILT. `ListViewState` reports WHERE the model changed —
// `Gio.ListModel::items-changed`, one splice per assignment — so a model that gained one
// item inserts ONE row and leaves the others, with their focus and their scroll position,
// standing. Each row asks the list where it IS rather than closing over the index it was
// built at, the defect `<gtk-drop-down>` recorded when its own rebuild became a splice.
//
// Attributes (all GIR property names):
//   model                 — JSON array: `["a"]` or `[{"value":"a","label":"A"}]`.
//   selection-mode        — none | single | multiple; the port's name for which
//                           `Gtk.SelectionModel` wraps the model.
//   show-separators       — boolean; the `.separators` style class GTK sets.
//   single-click-activate — boolean; activate on one click, select on hover.
//   enable-rubberband     — boolean; drag the background to select a run (multiple only).
//   tab-behavior          — all | item | cell; `GtkListTabBehavior`.
//   orientation           — horizontal | vertical, `GtkOrientable`'s.
// Properties: model, factory, selected (number[]), selectionMode, showSeparators,
//   singleClickActivate, enableRubberband, tabBehavior, orientation.
// Events:
//   `activate`          (CustomEvent, bubbles, detail = { position }) — `GtkListView::activate`.
//   `notify::selected`  (CustomEvent, bubbles, detail = { selected }) — every change,
//     programmatic included, the way GObject notifies.
// A11Y: `listbox` with `option` rows while anything is selectable, `list`/`listitem` when
//   `selection-mode` is `none`. GTK declares `LIST`/`LIST_ITEM` unconditionally
//   (gtklistview.c:1013), which in ARIA carries no selection at all — `aria-selected` is
//   not valid on a `listitem` — so announcing a list would hide the widget's whole job.
//   Arrow keys, Home and End come from `attachRovingFocus`, which is also what makes the
//   roving tabindex `tab-behavior: item` hands out navigable.
//
// Reference: refs/gtk/gtk/gtklistview.c:42-149 (the widget, its CSS nodes and its role)
// Reference: refs/gtk/gtk/gtklistfactorywidget.c:405-497 (click, modifiers, hover)
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss:5-45 (listview, row)
// Copyright (c) GNOME contributors (GTK/libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    ListViewState,
    normalizeComboOptions,
    normalizeListSelectionMode,
    parseListModel,
    type AdwComboOption,
    type AdwListItemFactory,
    type AdwListItemsChanged,
    type AdwListModelInput,
    type AdwListSelectionMode,
    type BoxOrientation,
} from '@gjsify/adwaita-core';

import { attachRubberBand, defaultListItemFactory } from '../list-view-dom.js';
import { bindSlottedChildren } from '../slotted-children.js';
import { stringListSlot } from '../string-list-slot.js';

import { attachRovingFocus } from './roving-focus.js';

/** `GtkListTabBehavior`'s nicks — `cell` behaves as `item` outside a cell-based view. */
export type GtkListTabBehavior = 'all' | 'item' | 'cell';

const TAB_BEHAVIORS: ReadonlySet<string> = new Set(['all', 'item', 'cell']);

/** An unknown nick is `all`, the ParamSpec's default (gtklistview.c:965-969). */
export function normalizeListTabBehavior(raw: string | null | undefined): GtkListTabBehavior {
    return raw !== null && raw !== undefined && TAB_BEHAVIORS.has(raw) ? (raw as GtkListTabBehavior) : 'all';
}

export class GtkListView extends HTMLElement {
    protected _listEl!: HTMLDivElement;
    protected _rows: HTMLElement[] = [];
    /** The model + selection machine all three views share (ADR 0004, ADR 0089). */
    protected readonly _state = new ListViewState();
    protected _factory: AdwListItemFactory<Node> = defaultListItemFactory;
    private _initialized = false;

    static get observedAttributes() {
        return [
            'model',
            'selection-mode',
            'show-separators',
            'single-click-activate',
            'enable-rubberband',
            'tab-behavior',
            'orientation',
        ];
    }

    /** The list model (`Gtk.ListView:model`, minus the selection ADR 0046 declined). */
    get model(): AdwComboOption[] {
        return this._state.model;
    }

    set model(value: AdwListModelInput) {
        this._state.setModel(normalizeComboOptions(value));
    }

    /** The per-item renderer — `Gtk.ListView:factory`, as one function. */
    get factory(): AdwListItemFactory<Node> {
        return this._factory;
    }

    set factory(value: AdwListItemFactory<Node> | null) {
        this._factory = typeof value === 'function' ? value : defaultListItemFactory;
        this._renderRows();
    }

    /** The selected positions, ascending. Assigning replaces the selection. */
    get selected(): number[] {
        return this._state.selection;
    }

    set selected(value: Iterable<number> | number | null) {
        const positions = typeof value === 'number' ? [value] : (value ?? []);
        this._state.setSelection(positions);
    }

    get selectionMode(): AdwListSelectionMode {
        return normalizeListSelectionMode(this.getAttribute('selection-mode'));
    }

    set selectionMode(value: AdwListSelectionMode) {
        this.setAttribute('selection-mode', value);
    }

    get showSeparators(): boolean {
        return this.hasAttribute('show-separators');
    }

    set showSeparators(value: boolean) {
        this.toggleAttribute('show-separators', !!value);
    }

    get singleClickActivate(): boolean {
        return this.hasAttribute('single-click-activate');
    }

    set singleClickActivate(value: boolean) {
        this.toggleAttribute('single-click-activate', !!value);
    }

    get enableRubberband(): boolean {
        return this.hasAttribute('enable-rubberband');
    }

    set enableRubberband(value: boolean) {
        this.toggleAttribute('enable-rubberband', !!value);
    }

    get tabBehavior(): GtkListTabBehavior {
        return normalizeListTabBehavior(this.getAttribute('tab-behavior'));
    }

    set tabBehavior(value: GtkListTabBehavior) {
        this.setAttribute('tab-behavior', value);
    }

    /**
     * `GtkOrientable:orientation` — which way the rows run.
     *
     * VERTICAL by default, and NOT through `normalizeBoxOrientation`: that helper is
     * `GtkBox`'s parser and answers the interface default, horizontal. `GtkListBase` sets
     * `priv->orientation = GTK_ORIENTATION_VERTICAL` in its own init
     * (gtklistbase.c:2070), which is why every GTK list view scrolls DOWN out of the box.
     * Taking the shared helper's default here put `.horizontal` on every list view,
     * flowed the rows across, pointed the arrow keys at the wrong axis and stopped the
     * `show-separators` rule matching — one wrong default, three symptoms.
     */
    get orientation(): BoxOrientation {
        return this.getAttribute('orientation') === 'horizontal' ? 'horizontal' : 'vertical';
    }

    set orientation(value: BoxOrientation) {
        this.setAttribute('orientation', value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this.classList.add(this._viewClass, 'view');
        this._listEl = document.createElement('div');
        this._listEl.className = 'adw-list-view-rows';
        this.appendChild(this._listEl);

        // A `<gtk-string-list slot="model">` child is the list a `.blp` authored (ADR 0072),
        // consumed before the attribute seed so an authored model wins over an absent one.
        bindSlottedChildren(this, [stringListSlot((model) => this._state.setModel(model))]).install(this._listEl);

        // Seed BEFORE anything subscribes, so the first render is not driven by a splice.
        if (this._state.count === 0) this._state.setModel(parseListModel(this.getAttribute('model')));
        this._state.setSelectionMode(this.selectionMode);
        this._state.subscribeItems((change) => this._applyItemsChanged(change));
        this._state.subscribeSelection(() => this._onSelectionChanged());

        attachRovingFocus({
            host: this,
            // A FUNCTION, because `orientation` is a live property: the helper is installed
            // once and the axis its arrow keys move along changes with the attribute.
            orientation: () => this.orientation,
            items: () => this._rows,
            select: (row) => this._selectRow(row, {}),
        });
        attachRubberBand({
            host: this,
            surface: this._listEl,
            enabled: () => this.enableRubberband && this._state.selectionMode === 'multiple',
            rows: () => this._rows,
            selectPositions: (positions) => this._state.setSelection(positions, true),
        });

        this._applyAttributes();
        this._renderRows();
    }

    attributeChangedCallback(name?: string) {
        if (!this._initialized) return;
        if (name === 'model') {
            // No render call: the splice subscription owns the DOM half, so the markup door
            // and the property door cannot drift into two update paths.
            this._state.setModel(parseListModel(this.getAttribute('model')));
            return;
        }
        if (name === 'selection-mode') this._state.setSelectionMode(this.selectionMode);
        this._applyAttributes();
        if (name === 'selection-mode' || name === 'tab-behavior') this._renderRows();
    }

    /** The classes and ARIA that follow directly from the attributes. */
    protected _applyAttributes(): void {
        const orientation = this.orientation;
        this.classList.toggle('separators', this.showSeparators);
        this.classList.toggle('horizontal', orientation === 'horizontal');
        const selectable = this._state.selectionMode !== 'none';
        this.setAttribute('role', selectable ? 'listbox' : 'list');
        if (this._state.selectionMode === 'multiple') this.setAttribute('aria-multiselectable', 'true');
        else this.removeAttribute('aria-multiselectable');
    }

    /**
     * The class the HOST wears. GTK names its views by CSS node — `listview`, `gridview`,
     * `columnview` — and the three partials select on the tag, so this is what a consumer
     * or a page rule has to spell; a subclass wearing the base's class would offer one
     * name for two widgets.
     */
    protected get _viewClass(): string {
        return 'adw-list-view';
    }

    /** The CSS node name GTK gives each child — `row` here, `child` in a grid view. */
    protected get _rowClass(): string {
        return 'adw-list-view-row';
    }

    /** Build every row from scratch — the factory changed, or the view did. */
    protected _renderRows(): void {
        if (!this._initialized) return;
        this._listEl.replaceChildren();
        this._rows = [];
        for (let position = 0; position < this._state.count; position++) {
            const row = this._createRow(position);
            if (row === null) continue;
            this._listEl.appendChild(row);
            this._rows.push(row);
        }
        this._syncSelectedStates();
    }

    /** One row: the factory's node inside the element GTK calls `row`. */
    protected _createRow(position: number): HTMLElement | null {
        const context = this._state.itemContext(position);
        if (context === null) return null;
        const row = document.createElement('div');
        row.className = `${this._rowClass} activatable`;
        row.setAttribute('role', this._state.selectionMode === 'none' ? 'listitem' : 'option');
        // `tab-behavior: all` makes every row its own tab stop; `item` and `cell` hand out
        // a roving tabindex, which `attachRovingFocus` is what makes navigable.
        row.tabIndex = this.tabBehavior === 'all' ? 0 : -1;
        row.appendChild(this._factory(context));

        row.addEventListener('click', (event) => {
            this._selectRow(row, { modify: event.ctrlKey || event.metaKey, extend: event.shiftKey });
            if (this.singleClickActivate) this._activateRow(row);
        });
        // A double click activates unless single-click already did
        // (gtklistfactorywidget.c:423-430).
        row.addEventListener('dblclick', () => {
            if (!this.singleClickActivate) this._activateRow(row);
        });
        row.addEventListener('pointerenter', () => {
            // `single-click-activate` also means "select on hover", with no modifiers
            // (gtklistfactorywidget.c:482-496).
            if (this.singleClickActivate) this._selectRow(row, {});
        });
        row.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            if (event.key === ' ') this._selectRow(row, { modify: event.ctrlKey, extend: event.shiftKey });
            else this._activateRow(row);
        });
        return row;
    }

    private _selectRow(row: HTMLElement, step: { modify?: boolean; extend?: boolean }): void {
        const position = this._rows.indexOf(row);
        if (position < 0) return;
        this._state.selectItem(position, step);
    }

    private _activateRow(row: HTMLElement): void {
        const position = this._rows.indexOf(row);
        if (position < 0) return;
        this.dispatchEvent(new CustomEvent('activate', { bubbles: true, detail: { position } }));
    }

    private _onSelectionChanged(): void {
        this._syncSelectedStates();
        this.dispatchEvent(
            new CustomEvent('notify::selected', { bubbles: true, detail: { selected: this._state.selection } }),
        );
    }

    /** The per-row selected state, and the one tab stop a roving tabindex leaves open. */
    protected _syncSelectedStates(): void {
        const selection = new Set(this._state.selection);
        const roving = this.tabBehavior !== 'all';
        const cursor = selection.size > 0 ? Math.min(...selection) : 0;
        this._rows.forEach((row, position) => {
            const isSelected = selection.has(position);
            row.classList.toggle('selected', isSelected);
            if (this._state.selectionMode === 'none') row.removeAttribute('aria-selected');
            else row.setAttribute('aria-selected', String(isSelected));
            if (roving) row.tabIndex = position === cursor ? 0 : -1;
        });
    }

    /**
     * Apply one `items-changed` — remove `removed` rows at `position`, insert `added`
     * fresh ones there, leave every other row standing.
     */
    private _applyItemsChanged(change: AdwListItemsChanged): void {
        if (!this._initialized) return;
        for (const removed of this._rows.splice(change.position, change.removed)) removed.remove();
        const before = this._rows[change.position] ?? null;
        const inserted: HTMLElement[] = [];
        for (let i = 0; i < change.added; i++) {
            const row = this._createRow(change.position + i);
            if (row === null) continue;
            this._listEl.insertBefore(row, before);
            inserted.push(row);
        }
        this._rows.splice(change.position, 0, ...inserted);
        this._syncSelectedStates();
    }
}

customElements.define('gtk-list-view', GtkListView);
