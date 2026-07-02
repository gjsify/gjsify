// <adw-view-stack> — A standalone, named-page CONTENT container: the web
// counterpart of Adw.ViewStack decoupled from any switcher. It holds a set of
// named pages and shows exactly one at a time; a paired <adw-view-switcher-bar>
// (or an adaptive header-bar switcher) binds to it and drives the selection.
// This is the piece the web package lacked — it already had switchers that own
// their own pages (<adw-view-switcher>, <adw-inline-view-switcher>) but no
// standalone stack a separate switcher can drive.
//
// Pages are declared as <adw-view-stack-page> children with `name`, `title` and
// `icon-name` attributes (their own children become the page body), OR added
// imperatively with `add(content, name, title?, icon?)`. The first page added
// is shown automatically.
//
// Attributes:
//   visible-child-name — the name of the page to show. Reading/writing it stays
//     in sync with the `visibleChildName` property so an adaptive layout can
//     drive the stack declaratively (mirrors the Adw.ViewStack GObject prop).
// Properties (mirroring Adw.ViewStack):
//   pages               — readonly page descriptors ({ name, title, icon, element }).
//   visibleChildName    — name of the visible page ('' when empty).
//   visibleChildIndex   — zero-based index of the visible page (bounds-guarded).
//   visibleChild        — the visible page's content element (or null).
// Methods:
//   add(content, name, title?, icon?) — append a page; returns its descriptor.
//   addTitled(content, name, title)   — Adw.ViewStack.add_titled convenience.
// Events:
//   `notify::visible-child` (CustomEvent, bubbles, detail = { index, name, title })
//     when the visible page CHANGES — mirrors Adw.ViewStack's visible-child
//     notify. It does NOT fire for the initial/auto-shown page or on add().
// Reference: refs/libadwaita/src/adw-view-stack.c (AdwViewStack behaviour)
// Reference: packages/nativescript-bridge/adwaita/src/widgets/adw-view-stack.ts (NS twin)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** A page descriptor exposed via `pages` (consumed by a bound switcher bar). */
export interface AdwViewStackPageInfo {
    /** Stable id used by visibleChildName + switcher binding. */
    name: string;
    /** Human-facing title shown by a bound switcher. */
    title: string;
    /** Symbolic icon name (no `-symbolic` suffix), or '' for none. */
    icon: string;
    /** The page's content container (the visibility-toggled node). */
    element: HTMLElement;
}

export class AdwViewStack extends HTMLElement {
    private _pages: AdwViewStackPageInfo[] = [];
    private _visibleIndex = 0;
    private _initialized = false;

    static get observedAttributes() {
        return ['visible-child-name'];
    }

    /** All pages in declaration/add order. A bound switcher reads this. */
    get pages(): readonly AdwViewStackPageInfo[] {
        return this._pages;
    }

    /** Zero-based index of the visible page. Out-of-range/same values no-op. */
    get visibleChildIndex(): number {
        return this._visibleIndex;
    }

    set visibleChildIndex(value: number) {
        if (!Number.isFinite(value) || value < 0 || value >= this._pages.length) return;
        if (value === this._visibleIndex) return;
        this._visibleIndex = value;
        this._apply(true);
    }

    /** Name of the visible page, or '' when the stack is empty. */
    get visibleChildName(): string {
        return this._pages[this._visibleIndex]?.name ?? '';
    }

    set visibleChildName(name: string) {
        const index = this._pages.findIndex((p) => p.name === name);
        if (index >= 0) this.visibleChildIndex = index;
    }

    /** The visible page's content element, or null when empty. */
    get visibleChild(): HTMLElement | null {
        return this._pages[this._visibleIndex]?.element ?? null;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot the declared <adw-view-stack-page> children before we take
        // over the subtree — their name / title / icon-name + child nodes become
        // the pages. Wrapping each page's content lets us toggle exactly one.
        const declared = Array.from(this.querySelectorAll(':scope > adw-view-stack-page')) as HTMLElement[];
        const wrappers = declared.map((pageEl, index) => {
            const name = pageEl.getAttribute('name') ?? `page-${index}`;
            const title = pageEl.getAttribute('title') ?? name;
            const icon = (pageEl.getAttribute('icon-name') ?? '').replace(/-symbolic$/, '');
            const element = document.createElement('div');
            element.className = 'adw-view-stack-child';
            element.dataset.name = name;
            for (const child of Array.from(pageEl.childNodes)) element.appendChild(child);
            return { name, title, icon, element };
        });

        this._pages = wrappers;
        this.replaceChildren(...wrappers.map((p) => p.element));

        // A declared `visible-child-name` selects the initial page; otherwise the
        // first page is auto-visible (matching Adw.ViewStack + the NS twin).
        const initialName = this.getAttribute('visible-child-name');
        const initialIndex = initialName ? this._pages.findIndex((p) => p.name === initialName) : -1;
        this._visibleIndex = initialIndex >= 0 ? initialIndex : 0;
        this._apply(false);
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'visible-child-name' && value !== null && value !== this.visibleChildName) {
            this.visibleChildName = value;
        }
    }

    /**
     * Append a page. The FIRST page added becomes visible automatically; later
     * pages are added hidden. Mirrors Adw.ViewStack.add()/the NS twin's add().
     */
    add(content: HTMLElement, name: string, title?: string, icon?: string): AdwViewStackPageInfo {
        content.classList.add('adw-view-stack-child');
        content.dataset.name = name;
        const page: AdwViewStackPageInfo = {
            name,
            title: title ?? name,
            icon: (icon ?? '').replace(/-symbolic$/, ''),
            element: content,
        };
        this._pages.push(page);
        this.appendChild(content);
        // Keep exactly one page shown without emitting (add is not a user change).
        this._apply(false);
        return page;
    }

    /** Convenience alias mirroring Adw.ViewStack.add_titled() (no icon). */
    addTitled(content: HTMLElement, name: string, title: string): AdwViewStackPageInfo {
        return this.add(content, name, title);
    }

    private _apply(emit: boolean): void {
        this._pages.forEach((page, index) => {
            const isVisible = index === this._visibleIndex;
            page.element.classList.toggle('active-view', isVisible);
            page.element.hidden = !isVisible;
        });
        // Reflect the current selection to the attribute (without re-entering the
        // guarded callback — the value already matches, so it no-ops).
        const current = this.visibleChildName;
        if (current && this.getAttribute('visible-child-name') !== current) {
            this.setAttribute('visible-child-name', current);
        }
        if (emit) {
            const page = this._pages[this._visibleIndex];
            this.dispatchEvent(
                new CustomEvent('notify::visible-child', {
                    bubbles: true,
                    detail: { index: this._visibleIndex, name: page?.name ?? '', title: page?.title ?? '' },
                }),
            );
        }
    }
}

customElements.define('adw-view-stack', AdwViewStack);
