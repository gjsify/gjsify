// <adw-view-switcher> — An adaptive, tab-style switcher driving a set of named
// pages (the web counterpart of Adw.ViewSwitcher paired with an Adw.ViewStack).
// Pages are declared as <adw-view-switcher-page> children with `name`, `title`
// and `icon-name` attributes; their own children become the page body. The
// switcher renders one toggle button per page (always icon + label) and shows
// exactly one page at a time, exactly like libadwaita's single `viewswitcher`
// CSS node with the `.wide` / `.narrow` policy style classes.
//   - wide:   icon and label side by side (horizontal button layout)
//   - narrow: icon stacked above the label (vertical button layout)
// Attributes:
//   policy — 'wide' | 'narrow' (default 'narrow', matching libadwaita's default).
//   active — zero-based index of the selected page (default 0).
// Events:
//   `notify::visible-child` (CustomEvent, bubbles, detail = { name, index }) when
//     the selected page changes — mirrors Adw.ViewStack's `visible-child-name`.
//   `notify::policy` (CustomEvent, bubbles, detail = { policy }) when the policy
//     changes — mirrors the Adw.ViewSwitcher `policy` GObject property.
// Reference: refs/libadwaita/src/adw-view-switcher.c (AdwViewSwitcher behaviour)
// Reference: refs/libadwaita/src/stylesheet/widgets/_view-switcher.scss
// Reference: refs/adwaita-web/adwaita-web/scss/_viewswitcher.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

type Policy = 'wide' | 'narrow';

interface PageInfo {
    name: string;
    title: string;
    icon: string;
    body: HTMLElement;
    button: HTMLButtonElement;
}

/** A single page. Children of <adw-view-switcher>; consumed at connect time. */
export class AdwViewSwitcherPage extends HTMLElement {
    static get observedAttributes() {
        return ['name', 'title', 'icon-name'];
    }
}

export class AdwViewSwitcher extends HTMLElement {
    private _barEl!: HTMLDivElement;
    private _contentEl!: HTMLDivElement;
    private _pages: PageInfo[] = [];
    private _active = 0;
    private _policy: Policy = 'narrow';
    private _initialized = false;

    static get observedAttributes() {
        return ['policy', 'active'];
    }

    /** The policy controlling the button layout ('wide' | 'narrow'). */
    get policy(): Policy {
        return this._policy;
    }

    set policy(value: Policy) {
        this.setAttribute('policy', value);
    }

    /** Zero-based index of the active page. */
    get active(): number {
        return this._active;
    }

    set active(value: number) {
        this.setAttribute('active', String(value));
    }

    /** The name of the currently visible page, or null when there are none. */
    get visibleChildName(): string | null {
        return this._pages[this._active]?.name ?? null;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot the declared <adw-view-switcher-page> children before we take
        // over the subtree — their name / title / icon-name + their own child
        // nodes become the rendered tabs and page bodies.
        const declaredPages = Array.from(this.querySelectorAll('adw-view-switcher-page')) as AdwViewSwitcherPage[];

        // The single `viewswitcher` node holds the segmented button bar; a sibling
        // content area shows the active page (the web stand-in for the paired
        // Adw.ViewStack the switcher would otherwise drive).
        this._barEl = document.createElement('div');
        this._barEl.className = 'adw-view-switcher-bar';
        this._barEl.setAttribute('role', 'tablist');

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-view-switcher-content';

        this._pages = declaredPages.map((pageEl, index) => {
            const name = pageEl.getAttribute('name') ?? `page-${index}`;
            const title = pageEl.getAttribute('title') ?? '';
            const icon = (pageEl.getAttribute('icon-name') ?? '').replace(/-symbolic$/, '');

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'adw-view-switcher-button';
            button.setAttribute('role', 'tab');

            const iconEl = document.createElement('span');
            iconEl.className = `adw-icon${icon ? ` adw-icon--${icon}` : ''}`;
            iconEl.setAttribute('aria-hidden', 'true'); // decorative (mask-image only)
            iconEl.hidden = icon.length === 0;

            const labelEl = document.createElement('span');
            labelEl.className = 'adw-view-switcher-label';
            labelEl.textContent = title;
            labelEl.hidden = title.length === 0;

            button.append(iconEl, labelEl);
            // An icon-only tab has no visible text — give it an accessible name.
            if (icon && !title) button.setAttribute('aria-label', icon);

            button.addEventListener('click', () => this._selectIndex(index));

            const body = document.createElement('div');
            body.className = 'adw-view-switcher-page';
            body.dataset.name = name;
            for (const child of Array.from(pageEl.childNodes)) body.appendChild(child);

            return { name, title, icon, body, button };
        });

        this._barEl.append(...this._pages.map((p) => p.button));
        this._contentEl.append(...this._pages.map((p) => p.body));
        this.replaceChildren(this._barEl, this._contentEl);

        this._policy = this._readPolicyAttr();
        this._active = this._readActiveAttr();
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'policy') {
            const next = this._readPolicyAttr();
            if (next !== this._policy) {
                this._policy = next;
                this._render();
            }
            return;
        }
        if (name === 'active') {
            const next = this._readActiveAttr();
            if (next !== this._active) {
                this._active = next;
                this._render();
            }
        }
    }

    private _readPolicyAttr(): Policy {
        return this.getAttribute('policy') === 'wide' ? 'wide' : 'narrow';
    }

    private _readActiveAttr(): number {
        const raw = Number.parseInt(this.getAttribute('active') ?? '0', 10);
        if (Number.isNaN(raw)) return 0;
        const max = Math.max(0, this._pages.length - 1);
        return Math.min(Math.max(raw, 0), max);
    }

    private _selectIndex(index: number): void {
        if (index === this._active) return;
        this._active = index;
        // Keep the attribute in sync without re-entering the guarded callback
        // (value already matches, so attributeChangedCallback no-ops).
        this.setAttribute('active', String(index));
        this._render();
        const page = this._pages[index];
        this.dispatchEvent(
            new CustomEvent('notify::visible-child', {
                bubbles: true,
                detail: { name: page?.name ?? null, index },
            }),
        );
    }

    private _render(): void {
        // Single `viewswitcher` node carries the `.wide` / `.narrow` policy class.
        this.classList.toggle('wide', this._policy === 'wide');
        this.classList.toggle('narrow', this._policy === 'narrow');

        this._pages.forEach((page, index) => {
            const isActive = index === this._active;
            page.button.classList.toggle('active', isActive);
            page.button.setAttribute('aria-selected', String(isActive));
            page.button.tabIndex = isActive ? 0 : -1;
            page.body.classList.toggle('active-view', isActive);
        });
    }
}

customElements.define('adw-view-switcher-page', AdwViewSwitcherPage);
customElements.define('adw-view-switcher', AdwViewSwitcher);
