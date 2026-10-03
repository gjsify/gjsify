// <adw-view-switcher-sidebar> — An adaptive sidebar that controls an <adw-view-stack>.
// The web counterpart of Adw.ViewSwitcherSidebar, introduced in libadwaita 1.9.
//
// Reference: refs/libadwaita/src/adw-view-switcher-sidebar.c (AdwViewSwitcherSidebar behaviour)
// Reference: refs/libadwaita/src/stylesheet/widgets/_view-switcher.scss
// Reference: packages/nativescript-bridge/adwaita/src/widgets/view-switcher-sidebar.ts (NS twin)
//
// `AdwViewSwitcherSidebar` is a view switcher implemented using a
// [class@Sidebar], in a similar fashion to [class@Gtk.StackSidebar].
//
// Items have an icon, a label, as well as an unread dot or a badge.
//
// Unlike other switchers, `AdwViewSwitcherSidebar` supports grouping pages into
// sections, using the [property@ViewStackPage:starts-section] and
// [property@ViewStackPage:section-title] properties.
//
// Like [class@Sidebar], `AdwViewSwitcherSidebar` is adaptive and can behave as
// a sidebar or a page, via the [property@ViewSwitcherSidebar:mode] property.
//
// Connect to the [signal@ViewSwitcherSidebar::activated] signal to run code when
// an item has been activated. This can be used to toggle the visible pane when
// used in a split view.
//
// Like `AdwSidebar`, `AdwViewSwitcherSidebar` supports filtering items via the
// [property@ViewSwitcherSidebar:filter] property.
//
// Use [property@ViewSwitcherSidebar:placeholder] to provide an empty state
// widget. It will be shown when all items have been filtered out, or the
// sidebar has no items otherwise.
//
// CSS nodes
// `AdwViewSwitcherSidebar` has a single CSS node with name `view-switcher-sidebar`.
//
// Since: 1.9
//
// Copyright (c) GNOME contributors (libadwaita). LGPL-2.1-or-later.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { createGtkImage } from './gtk-image.js';
import { attachRovingFocus } from './roving-focus.js';

/** A single sidebar item. Consumed at connect time. */
export class AdwViewSwitcherSidebarItem extends HTMLElement {
    static get observedAttributes() {
        return ['name', 'icon-name', 'starts-section', 'section-title', 'visible', 'badge-number', 'needs-attention'];
    }

    connectedCallback(): void {
        // Items are bound to the sidebar at connect time by the parent.
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        // Prop updates are handled by the parent sidebar.
    }
}

/** The adaptive sidebar that controls an Adw.ViewStack. */
export class AdwViewSwitcherSidebar extends HTMLElement {
    /** Track the selected page index. */
    private _selectedIndex = -1;
    /** The page elements declared as children. */
    private _pages: HTMLElement[] = [];
    /** Track the mode: 'sidebar' or 'page'. */
    private _mode: 'sidebar' | 'page' = 'sidebar';
    /** Track filter value. */
    private _filter = '';
    /** Track placeholder element. */
    private _placeholder: HTMLElement | null = null;
    /** The sidebar element. */
    private _sidebarEl: HTMLElement;
    /** The content element. */
    private _contentEl: HTMLElement;
    /** Track initialization state. */
    private _initialized = false;

    static get observedAttributes() {
        return ['mode', 'filter', 'placeholder'];
    }

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._sidebarEl = document.createElement('div'); // TODO: this._sidebar and _sidebarEl = document.createElement('div');
        this._sidebarEl.className = 'adw-view-switcher-sidebar';
        this._sidebarEl.setAttribute('role', 'navigation');
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-view-switcher-sidebar-content';
        this.replaceChildren(this._sidebarEl, this._contentEl);
    }

    get mode(): 'sidebar' | 'page' {
        return this._mode;
    }

    set mode(value: 'sidebar' | 'page') {
        this._mode = value;
        this.setAttribute('mode', value);
        this._renderMode();
    }

    get filter(): string {
        return this._filter;
    }

    set filter(value: string) {
        this._filter = value;
        this._renderFilter();
    }

    get placeholder(): HTMLElement | null {
        return this._placeholder;
    }

    set placeholder(value: HTMLElement | null) {
        this._placeholder = value;
        this._renderPlaceholder();
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Read the mode attribute.
        const modeAttr = this.getAttribute('mode');
        if (modeAttr) this._mode = modeAttr as 'sidebar' | 'page';

        // Build the sidebar from any declared <adw-view-switcher-sidebar-item> children.
        const declared = Array.from(this.querySelectorAll(':scope > adw-view-switcher-sidebar-item')) as HTMLElement[];
        this._pages = declared;

        // Initialize the sidebar with the pages.
        this._renderSidebar();
        this._renderContent();

        this._initialized = true;
    }

    disconnectedCallback() {
        // Clean up.
    }

    /** Get the page element at the given index. */
    getPage(index: number): HTMLElement | null {
        if (index < 0 || index >= this._pages.length) return null;
        return this._pages[index];
    }

    /** Render the sidebar area. */
    private _renderSidebar(): void {
        // Clear existing children.
        this._sidebarEl.innerHTML = '';

        const mode = this._mode;
        const pages = this._pages;

        if (mode === 'sidebar') {
            // Sidebar mode: use Gtk.Sidebar-like layout.
            for (let i = 0; i < pages.length; i++) {
                const page = pages[i] as HTMLElement;
                const item = this._buildSidebarItem(page, i);
                this._sidebarEl.appendChild(item);
            }
        } else {
            // Page mode: use a simple list.
            for (let i = 0; i < pages.length; i++) {
                const page = pages[i] as HTMLElement;
                const item = this._buildPageItem(page, i);
                this._sidebarEl.appendChild(item);
            }
        }
    }

    /** Build a sidebar item with icon, label, and badge. */
    private _buildSidebarItem(page: HTMLElement, index: number): HTMLElement {
        const item = document.createElement('div');
        item.className = 'adw-view-switcher-sidebar-item';
        item.setAttribute('role', 'button');
        item.setAttribute('aria-selected', 'false');
        item.tabIndex = 0;

        // Icon.
        const icon = createGtkImage(null, 'adw-view-switcher-sidebar-icon');
        item.appendChild(icon);

        // Label.
        const label = document.createElement('span');
        label.className = 'adw-view-switcher-sidebar-label';
        label.textContent = page.getAttribute('name') ?? '';
        item.appendChild(label);

        // Badge / indicator for unread count or needs attention.
        const badge = document.createElement('span');
        badge.className = 'adw-view-switcher-sidebar-badge';
        const badgeNumber = page.getAttribute('badge-number') ?? '0';
        badge.textContent = badgeNumber === '0' ? '' : badgeNumber;
        item.appendChild(badge);

        // Section title support.
        const startsSection = page.getAttribute('starts-section');
        if (startsSection) {
            item.classList.add('adw-view-switcher-sidebar-section-start');
            const sectionTitle = document.createElement('span');
            sectionTitle.className = 'adw-view-switcher-sidebar-section-title';
            sectionTitle.textContent = page.getAttribute('section-title') ?? '';
            item.appendChild(sectionTitle);
        }

        // Click handler.
        item.addEventListener('click', () => {
            this._selectedIndex = index;
            this._renderContent();
        });

        // Roving focus.
        item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                this._selectedIndex = index;
                this._renderContent();
            }
        });

        return item;
    }

    /** Build a simple page item. */
    private _buildPageItem(page: HTMLElement, index: number): HTMLElement {
        const item = document.createElement('div');
        item.className = 'adw-view-switcher-sidebar-item';
        item.setAttribute('role', 'button');
        item.setAttribute('aria-selected', 'false');
        item.tabIndex = 0;

        const icon = createGtkImage(null, 'adw-view-switcher-sidebar-icon');
        item.appendChild(icon);

        const label = document.createElement('span');
        label.className = 'adw-view-switcher-sidebar-label';
        label.textContent = page.getAttribute('name') ?? '';
        item.appendChild(label);

        item.addEventListener('click', () => {
            this._selectedIndex = index;
            this._renderContent();
        });

        return item;
    }

    /** Render the content area showing the selected page. */
    private _renderContent(): void {
        this._contentEl.innerHTML = '';

        const selectedIndex = this._selectedIndex;
        const pages = this._pages;

        if (selectedIndex >= 0 && selectedIndex < pages.length) {
            const selectedPage = pages[selectedIndex] as HTMLElement;
            this._contentEl.appendChild(selectedPage);
        }
    }

    private _renderMode(): void {
        // Toggle CSS classes for sidebar vs page mode.
        this._sidebarEl.classList.toggle('sidebar-mode', this._mode === 'sidebar');
        this._sidebarEl.classList.toggle('page-mode', this._mode === 'page');
        this._renderSidebar();
        this._renderContent();
    }

    private _renderFilter(): void {
        const filter = this._filter.toLowerCase();
        const pages = this._pages;

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i] as HTMLElement;
            const name = page.getAttribute('name')?.toLowerCase() ?? '';
            const visible = name.includes(filter);
            page.hidden = !visible;
            // Also update the sidebar item visibility.
            const item = this._sidebarEl.children[i];
            if (item) (item as HTMLElement).hidden = !visible;
        }
    }

    private _renderPlaceholder(): void {
        // Show/hide placeholder widget based on whether there are visible items.
        const visibleCount = this._pages.filter((page, i) => !page.hidden).length;
        if (visibleCount === 0 && this._placeholder) {
            this._contentEl.appendChild(this._placeholder);
        } else if (this._placeholder && !this._contentEl.contains(this._placeholder)) {
            this._contentEl.appendChild(this._placeholder);
        }
    }
}

// The VIEW first: `define` upgrades every matching element already in the document,
// immediately. Registering the sidebar first therefore upgraded every declared
// `<adw-view-switcher-sidebar-item>` while its parent was still un-upgraded.
customElements.define('adw-view-switcher-sidebar', AdwViewSwitcherSidebar);
customElements.define('adw-view-switcher-sidebar-item', AdwViewSwitcherSidebarItem);
