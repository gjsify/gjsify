// <adw-drop-down> — A standalone dropdown selector: the web counterpart of
// Gtk.DropDown. It is a flat Adwaita button showing the current selection (its
// label + a `pan-down` chevron) that opens an Adwaita popover list of options;
// picking one updates the selection. This is the toolbar/inline control twin of
// <adw-combo-row> (which embeds the same idea inside a boxed-list row) — reach
// for this one when you need a bare dropdown, not a row.
//
// Options are `{ value, label }` pairs (or plain strings, where the string is
// both value and label), supplied via the `options` / `items` property or a
// JSON `options` attribute. Optional `enable-search` puts a search entry atop
// the popover for long lists. The popover is dismissed on an outside click or
// Escape and supports arrow-key navigation, Home/End, Enter to pick, and
// type-ahead (typing jumps to the next matching option).
//
// Attributes:
//   options / items — JSON array: `["a","b"]` or `[{"value":"a","label":"A"}]`.
//   selected        — the selected index (number).
//   enable-search   — boolean; show a filtering search entry in the popover.
//   disabled        — boolean; a disabled dropdown does not open.
// Properties (mirroring Gtk.DropDown):
//   options / items — the option list ({ value, label }[]) (get/set).
//   selected        — the selected index (get/set; bounds-guarded).
//   selectedValue   — the selected option's value ('' when empty) (get/set-by-value).
//   selectedItem    — the selected option descriptor (or null).
//   enableSearch    — whether the search entry is shown (get/set).
//   active          — whether the popover is open (get).
// Events:
//   `notify::selected` (CustomEvent, bubbles, detail = { selected }) — the index
//     changed (mirrors the Gtk.DropDown `notify::selected` GObject signal).
//   `change`           (CustomEvent, bubbles, detail = { index, value, label }) —
//     a convenience event carrying the full selection.
// Reference: refs/libadwaita/src/stylesheet/widgets/_menus.scss (popover surface)
// Reference: refs/adwaita-web (adw-combo-row dropdown-arrow mask technique)
// Copyright (c) GNOME contributors (libadwaita) / the GTK team. LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** A dropdown option — `value` is the stable id, `label` the shown text. */
export interface AdwDropDownOption {
    value: string;
    label: string;
}

type RawOption = string | { value?: unknown; label?: unknown };

export class AdwDropDown extends HTMLElement {
    private _buttonEl!: HTMLButtonElement;
    private _labelEl!: HTMLSpanElement;
    private _popoverEl!: HTMLDivElement;
    private _listEl!: HTMLDivElement;
    private _searchEl: HTMLInputElement | null = null;
    private _options: AdwDropDownOption[] = [];
    private _itemButtons: HTMLButtonElement[] = [];
    private _selected = 0;
    private _active = false;
    private _initialized = false;
    private _typeAheadBuffer = '';
    private _typeAheadTimer: ReturnType<typeof setTimeout> | null = null;

    private _onDocumentPointerDown = (event: Event): void => {
        if (!this.contains(event.target as Node)) this._setActive(false);
    };
    private _onDocumentKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            this._setActive(false);
            this._buttonEl.focus();
        }
    };

    static get observedAttributes() {
        return ['options', 'items', 'selected', 'enable-search', 'disabled'];
    }

    /** The options list. Setting it rebuilds the popover and clamps the selection. */
    get options(): AdwDropDownOption[] {
        return this._options;
    }

    set options(value: ReadonlyArray<RawOption>) {
        this._options = normalizeOptions(value);
        if (this._selected >= this._options.length) this._selected = 0;
        if (this._initialized) this._renderAll();
    }

    /** Alias of `options` (Gtk.DropDown's model is often called "items"). */
    get items(): AdwDropDownOption[] {
        return this._options;
    }

    set items(value: ReadonlyArray<RawOption>) {
        this.options = value;
    }

    /** The selected index. Out-of-range values are ignored (Gtk.DropDown:selected). */
    get selected(): number {
        return this._selected;
    }

    set selected(value: number) {
        this._selectIndex(value);
    }

    /** The selected option's value, or '' when empty (Gtk.DropDown:selected-item). */
    get selectedValue(): string {
        return this._options[this._selected]?.value ?? '';
    }

    set selectedValue(value: string) {
        const index = this._options.findIndex((o) => o.value === value);
        if (index >= 0) this._selectIndex(index);
    }

    /** The selected option descriptor, or null when empty. */
    get selectedItem(): AdwDropDownOption | null {
        return this._options[this._selected] ?? null;
    }

    /** Whether the search entry is shown in the popover. */
    get enableSearch(): boolean {
        return this.hasAttribute('enable-search');
    }

    set enableSearch(value: boolean) {
        if (value) this.setAttribute('enable-search', '');
        else this.removeAttribute('enable-search');
    }

    /** Whether the popover is currently open. */
    get active(): boolean {
        return this._active;
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

        const arrow = document.createElement('span');
        arrow.className = 'adw-icon adw-icon--go-down adw-drop-down-arrow';
        arrow.setAttribute('aria-hidden', 'true');

        this._buttonEl.append(this._labelEl, arrow);
        this._buttonEl.addEventListener('click', () => {
            if (this.hasAttribute('disabled')) return;
            this._setActive(!this._active);
        });
        this._buttonEl.addEventListener('keydown', (event) => this._onButtonKeyDown(event));

        this._popoverEl = document.createElement('div');
        this._popoverEl.className = 'adw-drop-down-popover';
        this._popoverEl.setAttribute('role', 'listbox');
        this._popoverEl.hidden = true;
        this._popoverEl.addEventListener('keydown', (event) => this._onPopoverKeyDown(event));

        this._listEl = document.createElement('div');
        this._listEl.className = 'adw-drop-down-list';
        this._popoverEl.appendChild(this._listEl);

        // Seed options from the property (already set) or the JSON attribute.
        if (this._options.length === 0) this._options = this._parseOptionsAttr();
        const attrSelected = Number.parseInt(this.getAttribute('selected') ?? '', 10);
        if (!Number.isNaN(attrSelected) && attrSelected >= 0 && attrSelected < this._options.length) {
            this._selected = attrSelected;
        }

        this.replaceChildren(this._buttonEl, this._popoverEl);
        this._renderAll();
    }

    disconnectedCallback() {
        document.removeEventListener('pointerdown', this._onDocumentPointerDown);
        document.removeEventListener('keydown', this._onDocumentKeyDown, true);
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized || !this._buttonEl) return;
        if (name === 'options' || name === 'items') {
            this._options = this._parseOptionsAttr();
            if (this._selected >= this._options.length) this._selected = 0;
            this._renderAll();
        } else if (name === 'selected') {
            const index = Number.parseInt(value ?? '', 10);
            if (!Number.isNaN(index)) this._selectIndex(index, { fromAttr: true });
        } else if (name === 'enable-search') {
            this._renderPopover();
        } else if (name === 'disabled') {
            this._buttonEl.disabled = this.hasAttribute('disabled');
            if (this.hasAttribute('disabled')) this._setActive(false);
        }
    }

    // ── internals ──────────────────────────────────────────────────────────

    private _parseOptionsAttr(): AdwDropDownOption[] {
        const raw = this.getAttribute('options') ?? this.getAttribute('items');
        if (!raw) return [];
        try {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? normalizeOptions(parsed as RawOption[]) : [];
        } catch {
            return [];
        }
    }

    private _selectIndex(index: number, opts: { fromAttr?: boolean; fromUser?: boolean } = {}): void {
        if (!Number.isFinite(index) || index < 0 || index >= this._options.length) return;
        const changed = index !== this._selected;
        this._selected = index;
        this._updateLabel();
        this._updateSelectedStates();
        // Keep the attribute in sync without re-entering the guarded callback.
        if (!opts.fromAttr && this.getAttribute('selected') !== String(index)) {
            this.setAttribute('selected', String(index));
        }
        if (changed) {
            const option = this._options[index];
            // `notify::selected` mirrors GObject property-notify: it fires on EVERY change,
            // programmatic included.
            this.dispatchEvent(new CustomEvent('notify::selected', { bubbles: true, detail: { selected: index } }));
            // `change` mirrors the DOM <select> contract: it fires ONLY on a user-initiated change.
            // A programmatic `.selected`/`.selectedValue`/`selected`-attribute assignment stays silent
            // (just as native `select.value = x` fires no `change`), so consumers can set the value
            // without guarding against a spurious user-style event.
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

    private _setActive(active: boolean): void {
        if (this._active === active) return;
        if (active && (this._options.length === 0 || this.hasAttribute('disabled'))) return;
        this._active = active;
        this._popoverEl.hidden = !active;
        this.classList.toggle('active', active);
        this._buttonEl.setAttribute('aria-expanded', String(active));
        if (active) {
            this._filter('');
            document.addEventListener('pointerdown', this._onDocumentPointerDown);
            // Capture Escape before it reaches the button/popover handlers.
            document.addEventListener('keydown', this._onDocumentKeyDown, true);
            if (this._searchEl) {
                this._searchEl.value = '';
                this._searchEl.focus();
            } else {
                (this._visibleItems()[this._selected] ?? this._visibleItems()[0])?.focus();
            }
        } else {
            document.removeEventListener('pointerdown', this._onDocumentPointerDown);
            document.removeEventListener('keydown', this._onDocumentKeyDown, true);
        }
    }

    private _onButtonKeyDown(event: KeyboardEvent): void {
        if (this.hasAttribute('disabled')) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            this._setActive(true);
        } else if (event.key.length === 1 && !this._active) {
            // Type-ahead directly on the closed button (Gtk.DropDown behaviour).
            this._typeAhead(event.key);
        }
    }

    private _onPopoverKeyDown(event: KeyboardEvent): void {
        const items = this._visibleItems();
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            items[(current + 1 + items.length) % items.length]?.focus();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            items[(current - 1 + items.length) % items.length]?.focus();
        } else if (event.key === 'Home') {
            event.preventDefault();
            items[0]?.focus();
        } else if (event.key === 'End') {
            event.preventDefault();
            items[items.length - 1]?.focus();
        } else if ((event.key === 'Enter' || event.key === ' ') && current >= 0) {
            event.preventDefault();
            items[current]?.click();
        } else if (!this._searchEl && event.key.length === 1) {
            this._typeAhead(event.key);
        }
    }

    /** Type-ahead: accumulate keys, focus/select the next matching option. */
    private _typeAhead(char: string): void {
        this._typeAheadBuffer += char.toLowerCase();
        if (this._typeAheadTimer) clearTimeout(this._typeAheadTimer);
        this._typeAheadTimer = setTimeout(() => (this._typeAheadBuffer = ''), 800);
        const match = this._options.findIndex((o) => o.label.toLowerCase().startsWith(this._typeAheadBuffer));
        if (match < 0) return;
        if (this._active) this._itemButtons[match]?.focus();
        else this._selectIndex(match, { fromUser: true });
    }

    /** Filter the visible items by a search query (case-insensitive substring). */
    private _filter(query: string): void {
        const q = query.trim().toLowerCase();
        this._itemButtons.forEach((button, index) => {
            const match = q.length === 0 || (this._options[index]?.label.toLowerCase().includes(q) ?? false);
            button.hidden = !match;
        });
    }

    private _visibleItems(): HTMLButtonElement[] {
        return this._itemButtons.filter((b) => !b.hidden);
    }

    private _renderAll(): void {
        this._buttonEl.disabled = this.hasAttribute('disabled');
        this.classList.toggle('disabled', this.hasAttribute('disabled'));
        if (this._selected >= this._options.length) this._selected = 0;
        this._renderPopover();
        this._updateLabel();
    }

    private _updateLabel(): void {
        // The setters (`options`/`selected`) may run before connectedCallback
        // builds the DOM — stay a no-op until the label element exists.
        if (!this._labelEl) return;
        this._labelEl.textContent = this._options[this._selected]?.label ?? '';
    }

    private _updateSelectedStates(): void {
        this._itemButtons.forEach((button, index) => {
            const isSelected = index === this._selected;
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
            // Prepend before the list so it sits atop the options.
            this._popoverEl.insertBefore(this._searchEl, this._listEl);
        } else {
            const existing = this._popoverEl.querySelector('.adw-drop-down-search');
            if (existing) existing.remove();
        }

        for (const [index, option] of this._options.entries()) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'adw-drop-down-item';
            item.setAttribute('role', 'option');
            item.tabIndex = -1;

            const label = document.createElement('span');
            label.className = 'adw-drop-down-item-label';
            label.textContent = option.label;

            // A check icon marks the selected option (Gtk.DropDown's selected row).
            const check = document.createElement('span');
            check.className = 'adw-drop-down-item-check';
            check.setAttribute('aria-hidden', 'true');

            item.append(label, check);
            item.addEventListener('click', () => {
                this._selectIndex(index, { fromUser: true });
                this._setActive(false);
                this._buttonEl.focus();
            });
            this._listEl.appendChild(item);
            this._itemButtons.push(item);
        }

        this._updateSelectedStates();
        if (this._options.length === 0) this._setActive(false);
    }
}

/** Normalise raw options (strings or `{value,label}`) to a stable descriptor list. */
function normalizeOptions(raw: ReadonlyArray<RawOption>): AdwDropDownOption[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
        if (typeof entry === 'string') return { value: entry, label: entry };
        const value = entry.value !== undefined ? String(entry.value) : String(entry.label ?? '');
        const label = entry.label !== undefined ? String(entry.label) : value;
        return { value, label };
    });
}

customElements.define('adw-drop-down', AdwDropDown);
