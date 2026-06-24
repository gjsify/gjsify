// <adw-inline-view-switcher> — A compact, toolbar-friendly view switcher (the
// web counterpart of Adw.InlineViewSwitcher). It pairs a toggle-group-style
// switcher bar with a stack of pages: each declared <adw-view-stack-page> child
// (with a `title` and/or `icon-name` attribute plus arbitrary content) becomes a
// toggle in the bar and a panel in the stack, and exactly one page is visible at
// a time. The toggles can show labels, icons, or both via `display-mode`, just
// like the native widget's AdwInlineViewSwitcherDisplayMode.
// Attributes:
//   active (zero-based index of the visible page, default 0)
//   display-mode (labels | icons | both, default both) — what the toggles show
//   flat / round (mirroring the Adw.InlineViewSwitcher `.flat` / `.round` style
//     classes, which it inherits from Adw.ToggleGroup)
// Events:
//   `notify::active` (CustomEvent, bubbles, `detail = { active }`) when the
//     visible page changes — mirrors selecting a page in the paired Adw.ViewStack.
//   `notify::display-mode` (CustomEvent, bubbles, `detail = { displayMode }`)
//     when the display mode changes — mirrors the Adw.InlineViewSwitcher
//     `display-mode` GObject property.
// Reference: refs/libadwaita/src/adw-inline-view-switcher.c (AdwInlineViewSwitcher behaviour)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toggle-group.scss (inline-view-switcher > toggle-group)
// Reference: refs/adwaita-web/adwaita-web/scss/_viewswitcher.scss
// Copyright (c) 2023 Maximiliano Sandoval / 2024 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** The three display modes, mirroring AdwInlineViewSwitcherDisplayMode. */
const DISPLAY_MODES = ['labels', 'icons', 'both'] as const;
type DisplayMode = (typeof DISPLAY_MODES)[number];

/** A single page. Children of <adw-inline-view-switcher>; consumed at connect time. */
export class AdwViewStackPage extends HTMLElement {
    static get observedAttributes() {
        return ['title', 'icon-name'];
    }
}

export class AdwInlineViewSwitcher extends HTMLElement {
    private _groupEl!: HTMLDivElement;
    private _pagesEl!: HTMLDivElement;
    private _toggles: HTMLButtonElement[] = [];
    private _pages: HTMLDivElement[] = [];
    private _active = 0;
    private _displayMode: DisplayMode = 'both';
    private _initialized = false;

    static get observedAttributes() {
        return ['active', 'display-mode', 'flat', 'round'];
    }

    /** Zero-based index of the visible page. */
    get active(): number {
        return this._active;
    }

    set active(value: number) {
        this.setAttribute('active', String(value));
    }

    /** What the toggles display: 'labels', 'icons' or 'both'. */
    get displayMode(): DisplayMode {
        return this._displayMode;
    }

    set displayMode(value: DisplayMode) {
        this.setAttribute('display-mode', value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot the declared <adw-view-stack-page> children before we take
        // over the subtree — their title / icon-name + content become the
        // rendered toggles and panels.
        const pages = Array.from(this.querySelectorAll('adw-view-stack-page')) as AdwViewStackPage[];

        // The switcher bar — a toggle-group of one toggle per page.
        this._groupEl = document.createElement('div');
        this._groupEl.className = 'adw-inline-view-switcher-group';
        this._groupEl.setAttribute('role', 'tablist');

        this._pagesEl = document.createElement('div');
        this._pagesEl.className = 'adw-inline-view-switcher-pages';

        this._toggles = [];
        this._pages = [];

        pages.forEach((page, index) => {
            const title = page.getAttribute('title') ?? '';
            const icon = (page.getAttribute('icon-name') ?? '').replace(/-symbolic$/, '');

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'adw-inline-view-switcher-toggle';
            toggle.setAttribute('role', 'tab');
            // The toggle stores both title + icon; _render() shows the parts the
            // current display mode calls for (mirrors libadwaita rebuilding the
            // toggle child on a display-mode change).
            toggle.dataset.title = title;
            toggle.dataset.icon = icon;

            const iconEl = document.createElement('span');
            iconEl.className = `adw-icon${icon ? ` adw-icon--${icon}` : ''} adw-inline-view-switcher-icon`;
            iconEl.setAttribute('aria-hidden', 'true'); // decorative (mask-image only)
            toggle.appendChild(iconEl);

            const labelEl = document.createElement('span');
            labelEl.className = 'adw-inline-view-switcher-label';
            labelEl.textContent = title;
            toggle.appendChild(labelEl);

            toggle.addEventListener('click', () => this._selectIndex(index));
            this._groupEl.appendChild(toggle);
            this._toggles.push(toggle);

            // The page content area — the declared element's children are moved
            // into a panel that the switcher toggles visible.
            const panel = document.createElement('div');
            panel.className = 'adw-inline-view-switcher-page';
            panel.setAttribute('role', 'tabpanel');
            for (const child of Array.from(page.childNodes)) panel.appendChild(child);
            this._pagesEl.appendChild(panel);
            this._pages.push(panel);
        });

        this.replaceChildren(this._groupEl, this._pagesEl);

        this._active = this._readActiveAttr();
        this._displayMode = this._readDisplayModeAttr();
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'active') {
            const next = this._readActiveAttr();
            if (next !== this._active) {
                this._active = next;
                this._render();
            }
            return;
        }
        if (name === 'display-mode') {
            const next = this._readDisplayModeAttr();
            if (next !== this._displayMode) {
                this._displayMode = next;
                this._render();
            }
            return;
        }
        // flat / round are styling-only.
        this._render();
    }

    private _readActiveAttr(): number {
        const raw = Number.parseInt(this.getAttribute('active') ?? '0', 10);
        if (Number.isNaN(raw)) return 0;
        const max = Math.max(0, this._pages.length - 1);
        return Math.min(Math.max(raw, 0), max);
    }

    private _readDisplayModeAttr(): DisplayMode {
        const raw = this.getAttribute('display-mode') ?? 'both';
        return (DISPLAY_MODES as readonly string[]).includes(raw) ? (raw as DisplayMode) : 'both';
    }

    private _selectIndex(index: number): void {
        if (index === this._active) return;
        this._active = index;
        // Keep the attribute in sync without re-entering via the guarded
        // attributeChangedCallback (value already matches, so it no-ops).
        this.setAttribute('active', String(index));
        this._render();
        this.dispatchEvent(new CustomEvent('notify::active', { bubbles: true, detail: { active: index } }));
    }

    private _render(): void {
        this.classList.toggle('flat', this.hasAttribute('flat'));
        this.classList.toggle('round', this.hasAttribute('round'));

        // The bar carries the active display mode as a class — mirrors
        // libadwaita's inline-view-switcher > toggle-group.{labels,icons,both}.
        for (const mode of DISPLAY_MODES) this._groupEl.classList.toggle(mode, mode === this._displayMode);

        const showIcon = this._displayMode !== 'labels';
        const showLabel = this._displayMode !== 'icons';

        this._toggles.forEach((toggle, index) => {
            const isActive = index === this._active;
            toggle.classList.toggle('active', isActive);
            toggle.setAttribute('aria-selected', String(isActive));
            toggle.tabIndex = isActive ? 0 : -1;

            const iconEl = toggle.querySelector('.adw-inline-view-switcher-icon') as HTMLElement | null;
            const labelEl = toggle.querySelector('.adw-inline-view-switcher-label') as HTMLElement | null;
            const hasIcon = (toggle.dataset.icon ?? '').length > 0;
            const title = toggle.dataset.title ?? '';

            if (iconEl) iconEl.hidden = !showIcon || !hasIcon;
            if (labelEl) labelEl.hidden = !showLabel || title.length === 0;

            // In icons-only mode the toggle has no visible text — surface the
            // title as an accessible name + a hover tooltip (the native widget
            // sets the toggle tooltip to the page title in ICONS mode).
            if (!showLabel && title) {
                toggle.setAttribute('aria-label', title);
                toggle.title = title;
            } else {
                toggle.removeAttribute('aria-label');
                toggle.removeAttribute('title');
            }
        });

        this._pages.forEach((panel, index) => {
            const isActive = index === this._active;
            panel.classList.toggle('active-view', isActive);
            panel.hidden = !isActive;
        });
    }
}

customElements.define('adw-view-stack-page', AdwViewStackPage);
customElements.define('adw-inline-view-switcher', AdwInlineViewSwitcher);
