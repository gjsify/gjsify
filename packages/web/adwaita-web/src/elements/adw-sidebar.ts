// <adw-sidebar> — A selectable navigation sidebar (the web counterpart of
// Adw.Sidebar). It holds <adw-sidebar-section> groups, each of which holds
// <adw-sidebar-item> children (icon + title + optional subtitle). Zero or one
// item is selected at a time; clicking an item selects it and activates it. In
// `sidebar` mode it renders as a flat navigation list (the AdwSidebar
// `navigation-sidebar`); in `page` mode it renders as boxed lists with a
// chevron arrow on each row (the AdwPreferencesPage look the native widget
// switches to when collapsed).
// Sub-elements (declared as children, consumed at connect time — mirrors
// adw-tab-page in adw-tab-view):
//   <adw-sidebar-section title="…"> — a titled group of items. An untitled
//     section renders a separator before its rows (first section: nothing),
//     mirroring AdwSidebar's stack header (title vs separator child).
//   <adw-sidebar-item title="…" subtitle="…" icon-name="…"> — one row.
// Attributes (on <adw-sidebar>):
//   mode (sidebar | page, default sidebar) — mirrors Adw.Sidebar:mode.
//   selected (zero-based flat item index, default 0; -1 = no selection,
//     mirroring Gtk.INVALID_LIST_POSITION) — mirrors Adw.Sidebar:selected.
// Events:
//   `notify::selected` (CustomEvent, bubbles, `detail = { selected }`) when the
//     selected index changes — mirrors the Adw.Sidebar:selected property.
//   `activated` (CustomEvent, bubbles, `detail = { index }`) when an item is
//     activated (clicked) — mirrors the Adw.Sidebar::activated signal.
// Reference: refs/libadwaita/src/adw-sidebar.c (AdwSidebar behaviour)
// Reference: refs/libadwaita/src/adw-sidebar-item.h (AdwSidebarItem properties)
// Reference: refs/libadwaita/src/stylesheet/widgets/_sidebars.scss (.navigation-sidebar, sidebar)
// Copyright (c) 2025 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** Index meaning "no selection" — the web mirror of Gtk.INVALID_LIST_POSITION. */
const NO_SELECTION = -1;

/** GTK symbolic name (e.g. "folder-symbolic") → adwaita-web icon class. */
function iconClass(gtkName: string): string {
    const name = gtkName.replace(/-symbolic$/, '');
    return name ? `adw-icon adw-icon--${name}` : 'adw-icon';
}

/** A single sidebar item. Child of <adw-sidebar-section>; consumed at connect time. */
export class AdwSidebarItem extends HTMLElement {
    static get observedAttributes() {
        return ['title', 'subtitle', 'icon-name'];
    }
}

/** A titled group of items. Child of <adw-sidebar>; consumed at connect time. */
export class AdwSidebarSection extends HTMLElement {
    static get observedAttributes() {
        return ['title'];
    }
}

export class AdwSidebar extends HTMLElement {
    private _listEl!: HTMLDivElement;
    private _rows: HTMLButtonElement[] = [];
    private _selected = 0;
    private _mode: 'sidebar' | 'page' = 'sidebar';
    private _initialized = false;

    static get observedAttributes() {
        return ['mode', 'selected'];
    }

    /** Zero-based flat index of the selected item, or -1 for no selection. */
    get selected(): number {
        return this._selected;
    }

    set selected(value: number) {
        this.setAttribute('selected', String(value));
    }

    /** 'sidebar' (flat navigation list) or 'page' (boxed lists). */
    get mode(): 'sidebar' | 'page' {
        return this._mode;
    }

    set mode(value: 'sidebar' | 'page') {
        this.setAttribute('mode', value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot the declared <adw-sidebar-section> children before we take
        // over the subtree — their title + <adw-sidebar-item> descendants become
        // the rendered sections and rows.
        const sections = Array.from(this.querySelectorAll('adw-sidebar-section')) as AdwSidebarSection[];

        this._listEl = document.createElement('div');
        this._listEl.className = 'adw-sidebar-list';
        this._listEl.setAttribute('role', 'listbox');

        this._rows = [];

        sections.forEach((section, sectionIndex) => {
            const title = section.getAttribute('title') ?? '';
            const items = Array.from(section.querySelectorAll('adw-sidebar-item')) as AdwSidebarItem[];

            // The section header — a heading when titled, an empty separator
            // otherwise (mirrors AdwSidebar's header stack: "title" vs
            // "separator" child). The very first section never draws a leading
            // separator (matches the `.header.first` rule).
            const header = document.createElement('div');
            header.className = 'adw-sidebar-section-header';
            if (title) {
                header.classList.add('has-title');
                const heading = document.createElement('span');
                heading.className = 'adw-sidebar-section-heading';
                heading.textContent = title;
                header.appendChild(heading);
                if (sectionIndex === 0) header.classList.add('first');
            } else {
                header.classList.add('separator');
                if (sectionIndex === 0) header.hidden = true;
            }
            this._listEl.appendChild(header);

            const sectionEl = document.createElement('div');
            sectionEl.className = 'adw-sidebar-section';

            items.forEach((item) => {
                const flatIndex = this._rows.length;
                const itemTitle = item.getAttribute('title') ?? '';
                const subtitle = item.getAttribute('subtitle') ?? '';
                const icon = item.getAttribute('icon-name') ?? '';

                const row = document.createElement('button');
                row.type = 'button';
                row.className = 'adw-sidebar-item';
                row.setAttribute('role', 'option');

                const iconEl = document.createElement('span');
                iconEl.className = `${iconClass(icon)} adw-sidebar-item-icon`;
                iconEl.setAttribute('aria-hidden', 'true'); // decorative (mask-image only)
                iconEl.hidden = icon.length === 0;
                row.appendChild(iconEl);

                const textEl = document.createElement('span');
                textEl.className = 'adw-sidebar-item-text';

                const titleEl = document.createElement('span');
                titleEl.className = 'adw-sidebar-item-title';
                titleEl.textContent = itemTitle;
                titleEl.hidden = itemTitle.length === 0;
                textEl.appendChild(titleEl);

                const subtitleEl = document.createElement('span');
                subtitleEl.className = 'adw-sidebar-item-subtitle';
                subtitleEl.textContent = subtitle;
                subtitleEl.hidden = subtitle.length === 0;
                textEl.appendChild(subtitleEl);

                row.appendChild(textEl);

                // Page mode adds a trailing chevron on every row, the way the
                // boxed-list AdwActionRow carries a `go-next-symbolic` arrow.
                const arrowEl = document.createElement('span');
                arrowEl.className = 'adw-icon adw-icon--go-next adw-sidebar-item-arrow';
                arrowEl.setAttribute('aria-hidden', 'true');
                row.appendChild(arrowEl);

                row.addEventListener('click', () => this._activateIndex(flatIndex));
                sectionEl.appendChild(row);
                this._rows.push(row);
            });

            this._listEl.appendChild(sectionEl);
        });

        this.replaceChildren(this._listEl);

        this._mode = this._readModeAttr();
        this._selected = this._readSelectedAttr();
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'selected') {
            const next = this._readSelectedAttr();
            if (next !== this._selected) {
                this._selected = next;
                this._render();
            }
            return;
        }
        if (name === 'mode') {
            const next = this._readModeAttr();
            if (next !== this._mode) {
                this._mode = next;
                this._render();
            }
        }
    }

    private _readModeAttr(): 'sidebar' | 'page' {
        return this.getAttribute('mode') === 'page' ? 'page' : 'sidebar';
    }

    private _readSelectedAttr(): number {
        const raw = Number.parseInt(this.getAttribute('selected') ?? '0', 10);
        if (Number.isNaN(raw)) return 0;
        if (raw < 0) return NO_SELECTION;
        const max = Math.max(0, this._rows.length - 1);
        return Math.min(raw, max);
    }

    /** Click handler — selects the row (if changed) and always emits `activated`. */
    private _activateIndex(index: number): void {
        if (index !== this._selected) {
            this._selected = index;
            // Keep the attribute in sync without re-entering via the guarded
            // attributeChangedCallback (value already matches, so it no-ops).
            this.setAttribute('selected', String(index));
            this._render();
            this.dispatchEvent(new CustomEvent('notify::selected', { bubbles: true, detail: { selected: index } }));
        }
        this.dispatchEvent(new CustomEvent('activated', { bubbles: true, detail: { index } }));
    }

    private _render(): void {
        this.classList.toggle('page', this._mode === 'page');
        this.classList.toggle('mode-sidebar', this._mode === 'sidebar');

        this._rows.forEach((row, index) => {
            const isSelected = index === this._selected;
            row.classList.toggle('selected', isSelected);
            row.setAttribute('aria-selected', String(isSelected));
            row.tabIndex = isSelected || (this._selected === NO_SELECTION && index === 0) ? 0 : -1;
        });
    }
}

customElements.define('adw-sidebar-item', AdwSidebarItem);
customElements.define('adw-sidebar-section', AdwSidebarSection);
customElements.define('adw-sidebar', AdwSidebar);
