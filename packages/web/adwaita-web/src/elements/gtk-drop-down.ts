// <gtk-drop-down> — A standalone dropdown selector: the web counterpart of
// Gtk.DropDown. It is a flat Adwaita button showing the current selection (its
// label + a `pan-down` chevron) that opens an Adwaita popover list of options;
// picking one updates the selection. This is the toolbar/inline control twin of
// <adw-combo-row> (which embeds the same idea inside a boxed-list row) — reach
// for this one when you need a bare dropdown, not a row.
//
// The model is `{ value, label }` pairs (or plain strings, where the string is
// both value and label), supplied via the `model` property or a JSON `model`
// attribute — `Gtk.DropDown:model`'s own name (ADR 0034 clause 1, ADR 0046), which
// replaced the two spellings `options`/`items`. Optional `enable-search` puts a search entry atop
// the popover for long lists. The popover is dismissed on an outside click or
// Escape and supports arrow-key navigation, Home/End, Enter to pick, and
// type-ahead (typing jumps to the next matching option).
//
// The popover is `<gtk-popover>` and the dismissal/keyboard machine is
// `@gjsify/adwaita-core`'s (ADR 0004). So is the SELECTION: the options list, the
// index↔value mapping, the bounds guards and the programmatic-vs-interactive split are
// {@link ComboState}, the same state machine `<adw-combo-row>` composes — so both
// selectors accept one option vocabulary. What stays here is what is genuinely a
// DROP-DOWN: the search filter and the type-ahead buffer.
//
// The arrow/Home/End wrap arithmetic belongs to the popover, not here: a per-element
// copy is how ArrowUp from an unfocused list lands on the SECOND-TO-LAST option, which
// `enable-search` hits on every open because it focuses the entry.
//
// THE MODEL IS SPLICED, NOT REBUILT (ADR 0046). `ComboState` reports WHERE the model
// changed — `Gio.ListModel::items-changed`, one splice per assignment — so replacing a
// model that gained one item inserts ONE row button and leaves the rest, with their focus
// and their scroll position, alone. It also closed a latent defect the rebuild hid: each
// row's click handler used to close over the index it was built at, so any splice that
// shifted a row would have selected the wrong item. The handler now asks the list where
// the row IS.
//
// Attributes:
//   model           — JSON array: `["a","b"]` or `[{"value":"a","label":"A"}]`.
//   selected        — the selected index (number).
//   enable-search   — boolean; show a filtering search entry in the popover.
//   disabled        — boolean; a disabled dropdown does not open.
// Properties (mirroring Gtk.DropDown):
//   model           — the list model ({ value, label }[]) (get/set).
//   selected        — the selected index (get/set; bounds-guarded).
//   selectedValue   — the selected option's value ('' when empty) (get/set-by-value).
//   selectedItem    — the selected option descriptor (or null).
//   enableSearch    — whether the search entry is shown (get/set).
//   active          — whether the popover is open (get).
// Events:
//   `notify::selected` (CustomEvent, bubbles, detail = { selected }) — the index
//     changed (mirrors the Gtk.DropDown `notify::selected` GObject signal).
//   `change`           (CustomEvent, bubbles, detail = { index, value, label }) —
//     a convenience event carrying the full selection. Fires ONLY on a user
//     pick — `ComboState`'s `interactive` flag is what tells the two apart.
// Reference: refs/libadwaita/src/stylesheet/widgets/_menus.scss (popover surface)
// Reference: refs/adwaita-web (adw-combo-row dropdown-arrow mask technique)
// Copyright (c) GNOME contributors (libadwaita) / the GTK team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

// SIDE-EFFECT import, deliberately separate from the type import below: it is
// what guarantees `gtk-popover` is defined before this module's own
// `customElements.define` can upgrade a server-rendered `<gtk-drop-down>` and
// build one. A combined `import { GtkPopover }` would NOT do it — the binding is
// only ever used in type position here, and this package compiles without
// `verbatimModuleSyntax`, so TypeScript would elide the whole statement and take
// the registration with it.
import './gtk-popover.js';
import type { GtkPopover } from './gtk-popover.js';

import { ComboState, normalizeComboOptions, parseListModel } from '@gjsify/adwaita-core';
import type { AdwComboOption, AdwListItemsChanged, AdwListModelInput } from '@gjsify/adwaita-core';

import { createGtkImage } from './gtk-image.js';

/**
 * A dropdown option — `value` is the stable id, `label` the shown text. An alias of
 * core's {@link AdwComboOption}, since the drop-down and the combo row are the same
 * selection model behind two chromes; still exported so the published name keeps working.
 */
export type GtkDropDownOption = AdwComboOption;

export class GtkDropDown extends HTMLElement {
    private _buttonEl!: HTMLButtonElement;
    private _labelEl!: HTMLSpanElement;
    private _popoverEl!: GtkPopover;
    private _listEl!: HTMLDivElement;
    private _searchEl: HTMLInputElement | null = null;
    private _itemButtons: HTMLButtonElement[] = [];
    /** The headless options list + selectedIndex↔selectedValue machine (ADR 0004). */
    private readonly _state = new ComboState();
    private _initialized = false;
    private _typeAheadBuffer = '';
    private _typeAheadTimer: ReturnType<typeof setTimeout> | null = null;

    static get observedAttributes() {
        return ['model', 'selected', 'enable-search', 'disabled'];
    }

    /** The list model (`Gtk.DropDown:model`). Setting it splices the popover and clamps the selection. */
    get model(): GtkDropDownOption[] {
        return this._state.model;
    }

    set model(value: AdwListModelInput) {
        // `setModel` resets the index to 0 when it no longer fits — the same
        // clamp this element used to spell out.
        this._state.setModel(normalizeComboOptions(value));
    }

    /** The selected index. Out-of-range values are ignored (Gtk.DropDown:selected). */
    get selected(): number {
        return this._state.selectedIndex;
    }

    set selected(value: number) {
        this._selectIndex(value);
    }

    /** The selected option's value, or '' when empty (Gtk.DropDown:selected-item). */
    get selectedValue(): string {
        return this._state.selectedValue;
    }

    set selectedValue(value: string) {
        const index = this._state.model.findIndex((o) => o.value === value);
        if (index >= 0) this._selectIndex(index);
    }

    get selectedItem(): GtkDropDownOption | null {
        return this._state.model[this._state.selectedIndex] ?? null;
    }

    get enableSearch(): boolean {
        return this.hasAttribute('enable-search');
    }

    set enableSearch(value: boolean) {
        if (value) this.setAttribute('enable-search', '');
        else this.removeAttribute('enable-search');
    }

    get active(): boolean {
        return this._popoverEl?.open ?? false;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this.classList.add('adw-drop-down');

        this._buttonEl = document.createElement('button');
        this._buttonEl.type = 'button';
        this._buttonEl.className = 'adw-drop-down-button';
        this._buttonEl.setAttribute('aria-haspopup', 'listbox');
        this._buttonEl.setAttribute('aria-expanded', 'false');

        this._labelEl = document.createElement('span');
        this._labelEl.className = 'adw-drop-down-label';

        this._buttonEl.append(this._labelEl, createGtkImage('go-down', 'adw-drop-down-arrow'));
        this._buttonEl.addEventListener('click', () => {
            if (this.hasAttribute('disabled')) return;
            if (!this._popoverEl.open && this._state.count === 0) return;
            this._popoverEl.open = !this._popoverEl.open;
        });
        this._buttonEl.addEventListener('keydown', (event) => this._onButtonKeyDown(event));

        this._popoverEl = document.createElement('gtk-popover') as GtkPopover;
        this._popoverEl.classList.add('adw-drop-down-popover');
        this._popoverEl.setAttribute('role', 'listbox');
        // A dropdown's popover is a `popover.menu` too — `dropdown { popover.menu { … } }`
        // — even though its rows are ARIA `option`s rather than `menuitem`s. The style
        // class and the role answer different questions, so neither derives the other.
        this._popoverEl.setAttribute('menu', '');

        this._listEl = document.createElement('div');
        this._listEl.className = 'adw-drop-down-list';
        this._popoverEl.appendChild(this._listEl);

        // Seed options BEFORE anything subscribes, so building the initial DOM below is
        // not driven by a change notification.
        if (this._state.count === 0) this._state.setModel(parseListModel(this.getAttribute('model')));
        const attrSelected = Number.parseInt(this.getAttribute('selected') ?? '', 10);
        if (this._state.hasIndex(attrSelected)) this._state.setSelectedIndex(attrSelected);

        // WHERE the model changed. Subscribed before the first render so every later
        // assignment reaches the splice rather than a rebuild.
        this._state.subscribeItems((change) => this._applyItemsChanged(change));

        this.replaceChildren(this._buttonEl, this._popoverEl);
        this._popoverEl.anchor = this._buttonEl;
        this._popoverEl.subscribe((open) => this._onPopoverToggled(open));
        // Type-ahead is the ONE key class the shared popover deliberately leaves to the
        // renderer (`resolvePopoverKey` returns 'none' for printables), so it needs a
        // listener of its own alongside the popover's.
        this._popoverEl.addEventListener('keydown', (event) => this._onPopoverTypeAhead(event));
        this._renderAll();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized || !this._buttonEl) return;
        if (name === 'model') {
            // No render call: the splice subscription does the DOM half, so the markup door
            // and the property door cannot drift into two update paths.
            this._state.setModel(parseListModel(value));
        } else if (name === 'selected') {
            const index = Number.parseInt(value ?? '', 10);
            if (!Number.isNaN(index)) this._selectIndex(index, { fromAttr: true });
        } else if (name === 'enable-search') {
            this._renderPopover();
        } else if (name === 'disabled') {
            this._buttonEl.disabled = this.hasAttribute('disabled');
            if (this.hasAttribute('disabled')) this._popoverEl.popdown();
        }
    }

    private _selectIndex(index: number, opts: { fromAttr?: boolean; fromUser?: boolean } = {}): void {
        // The bounds arithmetic is `ComboState`'s; the POLICY of rejecting an
        // out-of-range set is this element's published `selected` contract, and
        // `<adw-combo-row>` deliberately answers it the other way (`ComboState.hasIndex`).
        if (!this._state.hasIndex(index)) return;
        // Both core setters return "did it change", which is what gates the notify — no
        // second copy of the current index is kept here, so `setModel`' own label
        // re-sync cannot masquerade as one.
        const changed = opts.fromUser ? this._state.select(index) : this._state.setSelectedIndex(index);
        this._updateLabel();
        this._updateSelectedStates();
        // Keep the attribute in sync without re-entering the guarded callback.
        if (!opts.fromAttr && this.getAttribute('selected') !== String(index)) {
            this.setAttribute('selected', String(index));
        }
        if (changed) {
            const option = this._state.model[index];
            // `notify::selected` mirrors GObject property-notify: EVERY change,
            // programmatic included.
            this.dispatchEvent(new CustomEvent('notify::selected', { bubbles: true, detail: { selected: index } }));
            // `change` mirrors the DOM <select> contract: ONLY a user-initiated change. A
            // programmatic assignment stays silent, just as native `select.value = x` fires
            // no `change`, so consumers can set the value without guarding against it.
            if (opts.fromUser) {
                this.dispatchEvent(
                    new CustomEvent('change', {
                        bubbles: true,
                        detail: { index, value: option?.value ?? '', label: option?.label ?? '' },
                    }),
                );
            }
        }
    }

    private _onPopoverToggled(open: boolean): void {
        this.classList.toggle('active', open);
        this._buttonEl.setAttribute('aria-expanded', String(open));
        if (!open) return;
        this._filter('');
        if (this._searchEl) {
            this._searchEl.value = '';
            this._searchEl.focus();
        } else {
            const visible = this._visibleItems();
            (visible[this._state.selectedIndex] ?? visible[0])?.focus();
        }
    }

    private _onButtonKeyDown(event: KeyboardEvent): void {
        if (this.hasAttribute('disabled')) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (this._state.count > 0) this._popoverEl.popup();
        } else if (event.key.length === 1 && !this._popoverEl.open) {
            // Type-ahead directly on the closed button (Gtk.DropDown behaviour).
            this._typeAhead(event.key);
        }
    }

    /** Printable keys inside an OPEN popover, when there is no search entry to type into. */
    private _onPopoverTypeAhead(event: KeyboardEvent): void {
        if (this._searchEl) return;
        if (event.key.length !== 1) return;
        this._typeAhead(event.key);
    }

    private _typeAhead(char: string): void {
        this._typeAheadBuffer += char.toLowerCase();
        if (this._typeAheadTimer) clearTimeout(this._typeAheadTimer);
        this._typeAheadTimer = setTimeout(() => (this._typeAheadBuffer = ''), 800);
        const match = this._state.model.findIndex((o) => o.label.toLowerCase().startsWith(this._typeAheadBuffer));
        if (match < 0) return;
        if (this._popoverEl.open) this._itemButtons[match]?.focus();
        else this._selectIndex(match, { fromUser: true });
    }

    private _filter(query: string): void {
        const q = query.trim().toLowerCase();
        // Hoisted for the reason `_applyItemsChanged` gives: this runs on every keystroke of
        // the search field, over every row.
        const model = this._state.model;
        this._itemButtons.forEach((button, index) => {
            const match = q.length === 0 || (model[index]?.label.toLowerCase().includes(q) ?? false);
            button.hidden = !match;
        });
    }

    private _visibleItems(): HTMLButtonElement[] {
        return this._itemButtons.filter((b) => !b.hidden);
    }

    private _renderAll(): void {
        this._buttonEl.disabled = this.hasAttribute('disabled');
        this.classList.toggle('disabled', this.hasAttribute('disabled'));
        this._renderPopover();
        this._updateLabel();
    }

    private _updateLabel(): void {
        // The setters may run before connectedCallback builds the DOM — a no-op until the
        // label element exists.
        if (!this._labelEl) return;
        this._labelEl.textContent = this._state.selectedLabel;
    }

    private _updateSelectedStates(): void {
        this._itemButtons.forEach((button, index) => {
            const isSelected = index === this._state.selectedIndex;
            button.classList.toggle('selected', isSelected);
            button.setAttribute('aria-selected', String(isSelected));
        });
    }

    private _renderPopover(): void {
        this._listEl.replaceChildren();
        this._itemButtons = [];
        this._searchEl = null;

        if (this.enableSearch) {
            this._searchEl = document.createElement('input');
            this._searchEl.type = 'text';
            this._searchEl.className = 'adw-drop-down-search adw-entry';
            this._searchEl.placeholder = 'Search…';
            this._searchEl.setAttribute('aria-label', 'Search');
            this._searchEl.addEventListener('input', () => this._filter(this._searchEl?.value ?? ''));
            this._popoverEl.insertBefore(this._searchEl, this._listEl);
        } else {
            const existing = this._popoverEl.querySelector('.adw-drop-down-search');
            if (existing) existing.remove();
        }

        for (const option of this._state.model) {
            const item = this._createItem(option);
            this._listEl.appendChild(item);
            this._itemButtons.push(item);
        }

        this._updateSelectedStates();
        if (this._state.count === 0) this._popoverEl.popdown();
    }

    /**
     * One row button.
     *
     * The click handler reads the row's CURRENT position out of `_itemButtons` instead of
     * closing over the index it was built at. Under a full rebuild the two were always
     * equal, which is why the closure survived; under a splice they are not, and a row
     * that shifted by one would have selected its neighbour.
     */
    private _createItem(option: GtkDropDownOption): HTMLButtonElement {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'adw-popover-item adw-drop-down-item';
        item.setAttribute('role', 'option');
        item.tabIndex = -1;

        const label = document.createElement('span');
        label.className = 'adw-drop-down-item-label';
        label.textContent = option.label;

        const check = document.createElement('span');
        check.className = 'adw-drop-down-item-check';
        check.setAttribute('aria-hidden', 'true');

        item.append(label, check);
        item.addEventListener('click', () => {
            const index = this._itemButtons.indexOf(item);
            if (index < 0) return;
            this._selectIndex(index, { fromUser: true });
            this._popoverEl.popdown();
            this._buttonEl.focus();
        });
        return item;
    }

    /**
     * Apply one `items-changed` to the row list — remove `removed` buttons at `position`,
     * insert `added` fresh ones there, leave every other row (and its focus) standing.
     *
     * It owns everything a model replacement has to refresh, so the property door and the
     * attribute door share one update path: the button label, the per-row selected state,
     * and popping the popover down when the model empties under it.
     */
    private _applyItemsChanged(change: AdwListItemsChanged): void {
        if (!this._initialized) return;
        for (const removedButton of this._itemButtons.splice(change.position, change.removed)) {
            removedButton.remove();
        }
        const before = this._itemButtons[change.position] ?? null;
        const inserted: HTMLButtonElement[] = [];
        // Read ONCE: `model` hands back a copy (ADR 0046), so reading it per item would make
        // a splice of n items O(n²) instead of the O(n) the splice is.
        const model = this._state.model;
        for (let i = 0; i < change.added; i++) {
            const option = model[change.position + i];
            if (!option) continue;
            const item = this._createItem(option);
            this._listEl.insertBefore(item, before);
            inserted.push(item);
        }
        this._itemButtons.splice(change.position, 0, ...inserted);

        this._updateSelectedStates();
        this._updateLabel();
        if (this._state.count === 0) this._popoverEl.popdown();
    }
}

customElements.define('gtk-drop-down', GtkDropDown);
