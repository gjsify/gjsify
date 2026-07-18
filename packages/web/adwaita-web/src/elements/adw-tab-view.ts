// <adw-tab-view> — A dynamic tabbed container with a tab bar header (the web
// counterpart of Adw.TabView + Adw.TabBar). One page is shown at a time; the
// tab bar renders one chip per page (title + close affordance) over a
// headerbar-colored strip, with the selected chip raised onto the view
// background. Pages are declared as <adw-tab-page> children (each with a
// `title` attribute and arbitrary content); the view snapshots them at connect
// time, builds the bar, and toggles the active page's visibility.
// Attributes:
//   selected (zero-based index of the visible page, default 0)
//   autohide (boolean — hide the tab bar when only one page remains, mirroring
//     the Adw.TabBar `autohide` property)
//   expand-tabs (boolean — tabs stretch to fill the bar evenly, mirroring the
//     Adw.TabBar `expand-tabs` property)
//   no-close (boolean — render no close affordance; web-specific escape hatch
//     for static tab sets such as documentation command tabs)
// Events:
//   `notify::selected-page` (CustomEvent, bubbles, `detail = { selected }`) when
//     the visible page changes — mirrors the Adw.TabView `selected-page` property.
//   `close-page` (CustomEvent, bubbles, `detail = { index }`) when a page's close
//     affordance is activated — mirrors the Adw.TabView `close-page` signal.
// Reference: refs/libadwaita/src/adw-tab-view.c (AdwTabView behaviour)
// Reference: refs/libadwaita/src/adw-tab-bar.c (AdwTabBar autohide)
// Reference: refs/libadwaita/src/stylesheet/widgets/_tab-view.scss
// Reference: refs/adwaita-web/adwaita-web/scss/_tabs.scss
// Copyright (c) 2020-2022 Purism SPC / GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** A single page. Children of <adw-tab-view>; consumed at connect time. */
export class AdwTabPage extends HTMLElement {
    static get observedAttributes() {
        return ['title'];
    }
}

export class AdwTabView extends HTMLElement {
    private _barEl!: HTMLDivElement;
    private _pagesEl!: HTMLDivElement;
    private _tabs: HTMLButtonElement[] = [];
    private _pages: HTMLDivElement[] = [];
    private _selected = 0;
    private _initialized = false;

    static get observedAttributes() {
        return ['selected', 'autohide', 'expand-tabs', 'no-close'];
    }

    /** Zero-based index of the visible page. */
    get selected(): number {
        return this._selected;
    }

    set selected(value: number) {
        this.setAttribute('selected', String(value));
    }

    /** Whether the tab bar hides itself when only one page remains. */
    get autohide(): boolean {
        return this.hasAttribute('autohide');
    }

    set autohide(value: boolean) {
        if (value) this.setAttribute('autohide', '');
        else this.removeAttribute('autohide');
    }

    /** Whether tabs stretch to fill the bar evenly (Adw.TabBar `expand-tabs`). */
    get expandTabs(): boolean {
        return this.hasAttribute('expand-tabs');
    }

    set expandTabs(value: boolean) {
        if (value) this.setAttribute('expand-tabs', '');
        else this.removeAttribute('expand-tabs');
    }

    /** Whether the close affordance is omitted (static tab sets). */
    get noClose(): boolean {
        return this.hasAttribute('no-close');
    }

    set noClose(value: boolean) {
        if (value) this.setAttribute('no-close', '');
        else this.removeAttribute('no-close');
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot the declared <adw-tab-page> children before we take over the
        // subtree — their title attribute + content become the rendered pages.
        const pages = Array.from(this.querySelectorAll('adw-tab-page')) as AdwTabPage[];

        // The tab bar (headerbar-colored strip of chips), built first so it sits
        // above the pages.
        this._barEl = document.createElement('div');
        this._barEl.className = 'adw-tab-bar';
        this._barEl.setAttribute('role', 'tablist');

        const tabBox = document.createElement('div');
        tabBox.className = 'adw-tab-box';
        this._barEl.appendChild(tabBox);

        this._pagesEl = document.createElement('div');
        this._pagesEl.className = 'adw-tab-view-pages';

        this._tabs = [];
        this._pages = [];

        pages.forEach((page, index) => {
            const title = page.getAttribute('title') ?? '';

            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'adw-tab';
            tab.setAttribute('role', 'tab');

            const label = document.createElement('span');
            label.className = 'adw-tab-title';
            label.textContent = title;
            tab.appendChild(label);

            // Close affordance — a small flat button drawn with a CSS "×" glyph
            // (no symbolic close icon ships in @gjsify/adwaita-icons).
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'adw-tab-close';
            close.setAttribute('aria-label', 'Close tab');
            close.addEventListener('click', (event) => {
                event.stopPropagation();
                this.dispatchEvent(new CustomEvent('close-page', { bubbles: true, detail: { index } }));
            });
            tab.appendChild(close);

            tab.addEventListener('click', () => this._selectIndex(index));
            tabBox.appendChild(tab);
            this._tabs.push(tab);

            // The page content area — the declared element's children are moved
            // into a panel that the view toggles visible.
            const panel = document.createElement('div');
            panel.className = 'adw-tab-page';
            panel.setAttribute('role', 'tabpanel');
            for (const child of Array.from(page.childNodes)) panel.appendChild(child);
            this._pagesEl.appendChild(panel);
            this._pages.push(panel);
        });

        this.replaceChildren(this._barEl, this._pagesEl);

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
        // autohide is styling/visibility-only.
        this._render();
    }

    private _readSelectedAttr(): number {
        const raw = Number.parseInt(this.getAttribute('selected') ?? '0', 10);
        if (Number.isNaN(raw)) return 0;
        const max = Math.max(0, this._pages.length - 1);
        return Math.min(Math.max(raw, 0), max);
    }

    private _selectIndex(index: number): void {
        if (index === this._selected) return;
        this._selected = index;
        // Keep the attribute in sync without re-entering via the guarded
        // attributeChangedCallback (value already matches, so it no-ops).
        this.setAttribute('selected', String(index));
        this._render();
        this.dispatchEvent(new CustomEvent('notify::selected-page', { bubbles: true, detail: { selected: index } }));
    }

    private _render(): void {
        // Autohide: collapse the bar when only one page (or none) remains.
        const hidden = this.autohide && this._pages.length <= 1;
        this._barEl.hidden = hidden;
        this._barEl.classList.toggle('single-tab', this._pages.length <= 1);

        this._tabs.forEach((tab, index) => {
            const isActive = index === this._selected;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
            tab.tabIndex = isActive ? 0 : -1;
        });

        this._pages.forEach((panel, index) => {
            const isActive = index === this._selected;
            panel.classList.toggle('active-page', isActive);
            panel.hidden = !isActive;
        });
    }
}

customElements.define('adw-tab-page', AdwTabPage);
customElements.define('adw-tab-view', AdwTabView);
