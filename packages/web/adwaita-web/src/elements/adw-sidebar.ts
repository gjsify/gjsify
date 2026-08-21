// <adw-sidebar> — A selectable navigation sidebar (the web counterpart of
// Adw.Sidebar). It holds <adw-sidebar-section> groups, each of which holds
// <adw-sidebar-item> children (icon + title + optional subtitle). Zero or one
// item is selected at a time; clicking an item selects it and activates it. In
// `sidebar` mode it renders as a flat navigation list (the AdwSidebar
// `navigation-sidebar`); in `page` mode it renders as boxed lists with a
// chevron arrow on each row (the AdwPreferencesPage look the native widget
// switches to when collapsed).
//
// The BEHAVIOUR — the flat index space, the out-of-range rule, which section headers
// render, the selection-vs-activation split, the filter and the empty state — is
// HEADLESS and lives in `@gjsify/adwaita-core` (ADR 0004) as {@link SidebarState}; this
// element only builds DOM for it and re-emits its changes as events, pinned to the C
// source by the shared vectors in `@gjsify/adwaita-core/conformance` (see
// `src/adw-sidebar.spec.ts`). Three rules a hand-written copy gets wrong: an
// out-of-range `selected` DROPS the selection rather than clamping to the last row,
// section headers are keyed off the rows that actually RENDER and not the declaration
// index, and the row list stays live after the first connect.
//
// Sub-elements (declared as children, consumed at connect time — mirrors
// adw-tab-page in adw-tab-view):
//   <adw-sidebar-section title="…"> — a titled group of items. An untitled
//     section renders a separator before its rows (first section: nothing),
//     mirroring AdwSidebar's stack header (title vs separator child).
//   <adw-sidebar-item title="…" subtitle="…" icon-name="…" disabled hidden> —
//     one row. `disabled` is AdwSidebarItem:enabled=false (bound to the row's
//     `sensitive`), `hidden` is AdwSidebarItem:visible=false.
// Attributes (on <adw-sidebar>):
//   mode (sidebar | page, default sidebar) — mirrors Adw.Sidebar:mode.
//   selected (zero-based flat item index; anything that is not a valid position
//     — out of range, negative, fractional, unparseable — means NO selection,
//     mirroring Gtk.INVALID_LIST_POSITION) — mirrors Adw.Sidebar:selected.
// Properties: `sections` (the spec list), `filter` (Adw.Sidebar:filter).
// Events:
//   `notify::selected` (CustomEvent, bubbles,
//     `detail = { selected, previous, interactive }`) on EVERY selection change,
//     programmatic ones included — mirrors g_object_notify_by_pspec (PROP_SELECTED).
//   `activated` (CustomEvent, bubbles, `detail = { index }`) on every click of a
//     row, including a re-click of the selected one — mirrors AdwSidebar::activated,
//     the documented way to reveal a split view's content pane.
// Reference: refs/libadwaita/src/adw-sidebar.c (AdwSidebar behaviour)
// Reference: refs/libadwaita/src/adw-sidebar-item.h (AdwSidebarItem properties)
// Reference: refs/libadwaita/src/stylesheet/widgets/_sidebars.scss (.navigation-sidebar, sidebar)
// Copyright (c) 2025 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// icon nodes are <adw-icon>.

import {
    ADW_SIDEBAR_NO_SELECTION,
    SidebarState,
    type AdwSidebarItemSpec,
    type AdwSidebarSectionSpec,
    type SidebarFlatItem,
    type SidebarHeaderSpec,
    type SidebarItemFilter,
    type SidebarSelectionChange,
} from '@gjsify/adwaita-core';

import { createAdwIcon } from './adw-icon.js';
import { attachRovingFocus } from './roving-focus.js';

// The sidebar consumes its declared children and drops them from the tree, so a later
// `setAttribute` on one cannot find its sidebar with `closest()`. These keep the link —
// the web stand-in for the `g_object_bind_property` / `notify::icon-name` bindings that
// keep a live AdwSidebarItem's labels in sync.
const itemBindings = new WeakMap<AdwSidebarItem, { sidebar: AdwSidebar; spec: AdwSidebarItemSpec }>();
const sectionBindings = new WeakMap<AdwSidebarSection, { sidebar: AdwSidebar; spec: AdwSidebarSectionSpec }>();

/** A single sidebar item. Child of <adw-sidebar-section>; consumed at connect time. */
export class AdwSidebarItem extends HTMLElement {
    static get observedAttributes() {
        return ['title', 'subtitle', 'icon-name', 'disabled', 'hidden'];
    }

    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null) {
        const binding = itemBindings.get(this);
        if (!binding) return;

        const value = newValue ?? '';
        if (name === 'title') binding.spec.title = value;
        else if (name === 'subtitle') binding.spec.subtitle = value;
        else if (name === 'icon-name') binding.spec.iconName = value;
        else if (name === 'disabled') binding.spec.enabled = newValue === null;
        else if (name === 'hidden') binding.spec.visible = newValue === null;

        binding.sidebar.refresh();
    }
}

/** A titled group of items. Child of <adw-sidebar>; consumed at connect time. */
export class AdwSidebarSection extends HTMLElement {
    static get observedAttributes() {
        return ['title'];
    }

    attributeChangedCallback(_name: string, _oldValue: string | null, newValue: string | null) {
        const binding = sectionBindings.get(this);
        if (!binding) return;

        binding.spec.title = newValue ?? '';
        binding.sidebar.refresh();
    }
}

export class AdwSidebar extends HTMLElement {
    private readonly _state = new SidebarState();
    private _listEl!: HTMLDivElement;
    private _rows: { el: HTMLButtonElement; index: number }[] = [];
    private _initialized = false;
    /** Guards the `selected` attribute write we make ourselves from re-entering. */
    private _reflecting = false;

    static get observedAttributes() {
        return ['mode', 'selected'];
    }

    get selected(): number {
        return this._state.selected;
    }

    set selected(value: number) {
        this.setAttribute('selected', String(value));
    }

    /** The selected item's spec, or undefined — Adw.Sidebar:selected-item. */
    get selectedItem(): AdwSidebarItemSpec | undefined {
        return this._state.selectedItem;
    }

    get mode(): 'sidebar' | 'page' {
        return this._state.mode;
    }

    set mode(value: 'sidebar' | 'page') {
        this.setAttribute('mode', value);
    }

    /** The section/item model. Assigning replaces it, the way adw_sidebar_remove_all + append would. */
    get sections(): readonly AdwSidebarSectionSpec[] {
        return this._state.sections;
    }

    set sections(value: readonly AdwSidebarSectionSpec[]) {
        this._state.setSections(value);
        this._rebuild();
    }

    /** Adw.Sidebar:filter — decides which rows render, never the selection index space. */
    get filter(): SidebarItemFilter | null {
        return this._state.filter;
    }

    set filter(value: SidebarItemFilter | null) {
        this._state.setFilter(value);
        this._rebuild();
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._listEl = document.createElement('div');
        this._listEl.className = 'adw-sidebar-list';
        this._listEl.setAttribute('role', 'listbox');
        // What makes the roving tabindex in `_applySelection` navigable: without it the
        // unselected rows are reachable by no key at all. `setSelected` and NOT
        // `_activate`: an arrow key is `GtkListBox`'s `row-selected`, and firing
        // `activated` on every press would navigate a split view on each keystroke.
        // Enter and Space still activate — the row IS a <button>.
        attachRovingFocus({
            host: this,
            orientation: 'vertical',
            items: () => this._rows.filter((row) => !row.el.hidden && !row.el.disabled).map((row) => row.el),
            select: (item) => {
                const row = this._rows.find((candidate) => candidate.el === item);
                return row !== undefined && this._state.setSelected(row.index);
            },
        });

        // Seed the model BEFORE subscribing: connecting is not a change anyone
        // asked to hear about, and `setSections` runs the 0 → n auto-select.
        this._state.setSections(this._readDeclaredSections());
        this._state.setMode(this._readModeAttr());
        // A declared `selected` wins over that auto-select. libadwaita lets the
        // auto-select clobber a builder-set property (items arrive after properties, and
        // `items_changed_cb` then selects 0); for a declarative element the authored
        // attribute has to survive its own children.
        if (this.hasAttribute('selected')) this._state.setSelected(this._readSelectedAttr());

        this._state.subscribe((change) => this._onSelectionChanged(change));

        this.replaceChildren(this._listEl);
        this._applyMode();
        this._rebuild();
        this._reflectSelected();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized || this._reflecting) return;

        if (name === 'selected') {
            this._state.setSelected(this._readSelectedAttr());
            // Normalise even when nothing moved, so `selected="5"` on a 3-item sidebar
            // does not keep claiming 5 while the property reads -1.
            this._reflectSelected();
            return;
        }
        if (name === 'mode' && this._state.setMode(this._readModeAttr())) {
            this._applyMode();
            this._applySelection();
        }
    }

    /**
     * Re-derive after a declared `<adw-sidebar-item>` / `<adw-sidebar-section>` attribute
     * changed. The item model keeps its shape, so the selection cannot move — exactly
     * like the GObject property bindings this stands in for.
     */
    refresh(): void {
        if (!this._initialized) return;
        this._state.refresh();
        this._rebuild();
    }

    private _readDeclaredSections(): AdwSidebarSectionSpec[] {
        const sections: AdwSidebarSectionSpec[] = [];

        for (const sectionEl of Array.from(this.querySelectorAll('adw-sidebar-section')) as AdwSidebarSection[]) {
            const items: AdwSidebarItemSpec[] = [];

            for (const itemEl of Array.from(sectionEl.querySelectorAll('adw-sidebar-item')) as AdwSidebarItem[]) {
                const item: AdwSidebarItemSpec = {
                    title: itemEl.getAttribute('title') ?? '',
                    subtitle: itemEl.getAttribute('subtitle') ?? '',
                    iconName: itemEl.getAttribute('icon-name') ?? '',
                    enabled: !itemEl.hasAttribute('disabled'),
                    visible: !itemEl.hasAttribute('hidden'),
                };
                itemBindings.set(itemEl, { sidebar: this, spec: item });
                items.push(item);
            }

            const section: AdwSidebarSectionSpec = { title: sectionEl.getAttribute('title') ?? '', items };
            sectionBindings.set(sectionEl, { sidebar: this, spec: section });
            sections.push(section);
        }

        return sections;
    }

    private _readModeAttr(): 'sidebar' | 'page' {
        return this.getAttribute('mode') === 'page' ? 'page' : 'sidebar';
    }

    /**
     * `parseFloat`, not `parseInt`: the core rejects a fractional position, and
     * truncating `"1.5"` to row 1 here would hide that from it. An unparseable value is
     * NaN, which the core turns into "no selection".
     */
    private _readSelectedAttr(): number {
        return Number.parseFloat(this.getAttribute('selected') ?? '');
    }

    private _reflectSelected(): void {
        this._reflecting = true;
        this.setAttribute('selected', String(this._state.selected));
        this._reflecting = false;
    }

    private _onSelectionChanged(change: SidebarSelectionChange): void {
        this._reflectSelected();
        this._applySelection();
        this.dispatchEvent(
            new CustomEvent('notify::selected', {
                bubbles: true,
                detail: { selected: change.selected, previous: change.previous, interactive: change.interactive },
            }),
        );
    }

    private _activate(index: number): void {
        if (!this._state.activate(index).activated) return;
        this.dispatchEvent(new CustomEvent('activated', { bubbles: true, detail: { index } }));
    }

    private _rebuild(): void {
        const headers = new Map<number, SidebarHeaderSpec>();
        for (const header of this._state.headers) headers.set(header.sectionIndex, header);

        // Consecutive rendered rows of one section share a header and a container.
        const groups: { sectionIndex: number; items: SidebarFlatItem[] }[] = [];
        for (const flat of this._state.visibleItems) {
            const last = groups[groups.length - 1];
            if (last && last.sectionIndex === flat.sectionIndex) last.items.push(flat);
            else groups.push({ sectionIndex: flat.sectionIndex, items: [flat] });
        }

        this._rows = [];
        const children: HTMLElement[] = [];

        for (const group of groups) {
            const header = headers.get(group.sectionIndex);
            if (header) children.push(this._createHeader(header));

            const sectionEl = document.createElement('div');
            sectionEl.className = 'adw-sidebar-section';
            for (const flat of group.items) {
                const row = this._createRow(flat);
                sectionEl.appendChild(row);
                this._rows.push({ el: row, index: flat.index });
            }
            children.push(sectionEl);
        }

        this._listEl.replaceChildren(...children);
        this.classList.toggle('empty', this._state.isEmpty);
        this._applySelection();
    }

    private _createHeader(header: SidebarHeaderSpec): HTMLDivElement {
        const el = document.createElement('div');
        el.className = 'adw-sidebar-section-header';

        if (header.kind === 'title') {
            el.classList.add('has-title');
            const heading = document.createElement('span');
            heading.className = 'adw-sidebar-section-heading';
            heading.textContent = header.title;
            el.appendChild(heading);
        } else {
            el.classList.add('separator');
        }
        if (header.first) el.classList.add('first');

        return el;
    }

    private _createRow(flat: SidebarFlatItem): HTMLButtonElement {
        const item = flat.item;

        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'adw-sidebar-item';
        row.setAttribute('role', 'option');
        // `visible` / `enabled` are bound to the row's `visible` / `sensitive` in
        // `create_row`: the row still EXISTS and still owns its flat index, it just does
        // not show or respond.
        row.hidden = item.visible === false;
        row.disabled = item.enabled === false;

        const iconEl = createAdwIcon(item.iconName ?? null, 'adw-sidebar-item-icon');
        iconEl.hidden = !flat.iconVisible;
        row.appendChild(iconEl);

        const textEl = document.createElement('span');
        textEl.className = 'adw-sidebar-item-text';

        const titleEl = document.createElement('span');
        titleEl.className = 'adw-sidebar-item-title';
        titleEl.textContent = item.title;
        titleEl.hidden = !flat.titleVisible;
        textEl.appendChild(titleEl);

        const subtitleEl = document.createElement('span');
        subtitleEl.className = 'adw-sidebar-item-subtitle';
        subtitleEl.textContent = item.subtitle ?? '';
        subtitleEl.hidden = !flat.subtitleVisible;
        textEl.appendChild(subtitleEl);

        row.appendChild(textEl);

        // Page mode adds a trailing chevron on every row, the way the boxed-list
        // AdwActionRow carries a `go-next-symbolic` arrow.
        row.appendChild(createAdwIcon('go-next', 'adw-sidebar-item-arrow'));

        row.addEventListener('click', () => this._activate(flat.index));

        return row;
    }

    private _applyMode(): void {
        const page = this._state.mode === 'page';
        this.classList.toggle('page', page);
        this.classList.toggle('mode-sidebar', !page);
    }

    private _applySelection(): void {
        const selected = this._state.selected;
        // Page mode tracks the selection but never paints it: its rows are plain
        // boxed-list AdwActionRows with no selected state.
        const paint = this._state.selectionVisible;

        this._rows.forEach((row, position) => {
            const isSelected = row.index === selected;
            row.el.classList.toggle('selected', isSelected && paint);
            row.el.setAttribute('aria-selected', String(isSelected));
            row.el.tabIndex = isSelected || (selected === ADW_SIDEBAR_NO_SELECTION && position === 0) ? 0 : -1;
        });
    }
}

customElements.define('adw-sidebar-item', AdwSidebarItem);
customElements.define('adw-sidebar-section', AdwSidebarSection);
customElements.define('adw-sidebar', AdwSidebar);
