// <adw-navigation-view> — A page-based navigation container (the web
// counterpart of Adw.NavigationView). It presents one page at a time and keeps
// a navigation stack controlled with push()/pop()/replace(); the visible page
// fills the view. Only <adw-navigation-page> children are managed.
//
// Pages are declared as <adw-navigation-page> children (each with a `title` and
// optional `tag` attribute). The view snapshots them at connect time. Like
// Adw.NavigationView, a statically-added page is kept around but not shown until
// pushed (the first added page is pushed automatically). push() accepts a page
// element OR an existing page's tag (push-by-tag); a dynamically-pushed page is
// removed from the DOM again once it is popped.
//
// Header Bar integration: mirroring libadwaita, when the visible page is above
// the root the view surfaces an automatic back button at the start of that
// page's header bar (the first <adw-header-bar> found in the page content),
// unless the page sets `no-back-button` (the equivalent of
// AdwHeaderBar:show-back-button = FALSE) or `can-pop` is "false".
//
// Attributes (on <adw-navigation-view>):
//   animate-transitions (boolean, default present — slide animation on push/pop;
//     mirrors Adw.NavigationView:animate-transitions)
// Attributes (on <adw-navigation-page>):
//   title (the page title — shown in the header bar's window title)
//   tag (a unique identifier for push-by-tag)
//   can-pop ("false" disables the back button / popping; mirrors
//     AdwNavigationPage:can-pop)
//   no-back-button (boolean — suppresses the automatic back button only)
// Events (CustomEvent, bubbles):
//   `pushed` (detail = { tag }) after a page is pushed — mirrors
//     AdwNavigationView::pushed.
//   `popped` (detail = { tag }) after a page is popped — mirrors
//     AdwNavigationView::popped.
//   `replaced` after the whole stack is replaced — mirrors
//     AdwNavigationView::replaced.
//   `notify::visible-page` (detail = { tag }) whenever the visible page changes
//     — mirrors the Adw.NavigationView:visible-page property.
// Reference: refs/libadwaita/src/adw-navigation-view.c (AdwNavigationView behaviour)
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/navigationview.md
// Copyright (c) 2022-2023 Purism SPC / GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** A single navigation page. Children of <adw-navigation-view>. */
export class AdwNavigationPage extends HTMLElement {
    static get observedAttributes() {
        return ['title', 'tag', 'can-pop', 'no-back-button'];
    }

    get title(): string {
        return this.getAttribute('title') ?? '';
    }

    set title(value: string) {
        this.setAttribute('title', value);
    }

    get tag(): string | null {
        return this.getAttribute('tag');
    }

    set tag(value: string | null) {
        if (value === null) this.removeAttribute('tag');
        else this.setAttribute('tag', value);
    }

    /** Whether the page can be popped (and thus shows a back button). */
    get canPop(): boolean {
        return this.getAttribute('can-pop') !== 'false';
    }

    set canPop(value: boolean) {
        this.setAttribute('can-pop', value ? 'true' : 'false');
    }
}

export class AdwNavigationView extends HTMLElement {
    private _pagesEl!: HTMLDivElement;
    // Every page known to the view (static + dynamically pushed), in DOM order.
    private _pages: AdwNavigationPage[] = [];
    // The navigation stack — references into _pages, bottom-first.
    private _stack: AdwNavigationPage[] = [];
    // Pages added dynamically via push() (destroyed when popped off).
    private _dynamic = new Set<AdwNavigationPage>();
    // The back button injected into each visible page (so we can remove it).
    private _backButtons = new WeakMap<AdwNavigationPage, HTMLElement>();
    private _initialized = false;

    static get observedAttributes() {
        return ['animate-transitions'];
    }

    /** Whether push/pop transitions are animated. */
    get animateTransitions(): boolean {
        // Absent attribute defaults to true (matches Adw.NavigationView).
        return this.getAttribute('animate-transitions') !== 'false';
    }

    set animateTransitions(value: boolean) {
        this.setAttribute('animate-transitions', value ? 'true' : 'false');
    }

    /** The currently-visible page (top of the stack), or null when empty. */
    get visiblePage(): AdwNavigationPage | null {
        return this._stack.length > 0 ? this._stack[this._stack.length - 1] : null;
    }

    /** The tag of the visible page, or null. */
    get visiblePageTag(): string | null {
        return this.visiblePage?.tag ?? null;
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot the declared <adw-navigation-page> children — they become the
        // statically-added pages. The first one is pushed automatically.
        const pages = Array.from(this.querySelectorAll(':scope > adw-navigation-page')) as AdwNavigationPage[];

        this._pagesEl = document.createElement('div');
        this._pagesEl.className = 'adw-navigation-view-pages';

        this._pages = [];
        this._stack = [];

        for (const page of pages) {
            page.classList.add('adw-navigation-page');
            this._pagesEl.appendChild(page);
            this._pages.push(page);
        }

        this.replaceChildren(this._pagesEl);

        // Auto-push the first added page (Adw.NavigationView behaviour).
        if (this._pages.length > 0) {
            this._stack.push(this._pages[0]);
        }

        this._syncClasses();
        this._render();
    }

    attributeChangedCallback() {
        if (!this._initialized) return;
        // animate-transitions only affects future transitions; just keep the
        // class in sync so CSS can gate the slide animation.
        this._syncClasses();
    }

    /**
     * Add a static page without pushing it (mirrors AdwNavigationView.add). The
     * view keeps a reference; the page becomes reachable via push-by-tag. Named
     * `addPage` rather than `add` to avoid clashing with any DOM method.
     */
    addPage(page: AdwNavigationPage): void {
        if (this._pages.includes(page)) return;
        page.classList.add('adw-navigation-page');
        this._pagesEl.appendChild(page);
        this._pages.push(page);
        this._render();
    }

    /**
     * Remove a static page (mirrors AdwNavigationView.remove). Named `removePage`
     * to avoid overriding HTMLElement.remove() (which takes no arguments).
     */
    removePage(page: AdwNavigationPage): void {
        if (this._stack.includes(page)) return; // can't remove a page on the stack
        const index = this._pages.indexOf(page);
        if (index === -1) return;
        this._pages.splice(index, 1);
        this._dynamic.delete(page);
        if (page.parentNode === this._pagesEl) this._pagesEl.removeChild(page);
        this._render();
    }

    /**
     * Push a page onto the navigation stack (mirrors AdwNavigationView.push).
     * Accepts a page element or, when given a string, the tag of a known page
     * (push-by-tag, mirrors AdwNavigationView.push_by_tag). A page that is not
     * already known is added dynamically and destroyed when it is popped.
     */
    push(pageOrTag: AdwNavigationPage | string): void {
        const page = this._resolvePage(pageOrTag);
        if (!page) {
            console.warn(`[adw-navigation-view] No page found for "${String(pageOrTag)}"`);
            return;
        }
        if (this._stack.includes(page)) {
            console.warn('[adw-navigation-view] Page is already in the navigation stack');
            return;
        }
        if (!this._pages.includes(page)) {
            // A brand-new dynamic page — keep a reference + mark for cleanup.
            page.classList.add('adw-navigation-page');
            this._pagesEl.appendChild(page);
            this._pages.push(page);
            this._dynamic.add(page);
        }
        this._stack.push(page);
        this._render();
        this.dispatchEvent(new CustomEvent('pushed', { bubbles: true, detail: { tag: page.tag } }));
        this.dispatchEvent(new CustomEvent('notify::visible-page', { bubbles: true, detail: { tag: page.tag } }));
    }

    /**
     * Pop the visible page off the stack (mirrors AdwNavigationView.pop).
     * Returns true when a page was popped. A dynamically-pushed page is removed
     * from the DOM. The root page cannot be popped.
     */
    pop(): boolean {
        if (this._stack.length <= 1) return false;
        const visible = this.visiblePage;
        if (visible && !visible.canPop) return false;

        const popped = this._stack.pop() as AdwNavigationPage;
        // Destroy dynamically-pushed pages once they leave the stack.
        if (this._dynamic.has(popped)) {
            this._dynamic.delete(popped);
            const index = this._pages.indexOf(popped);
            if (index !== -1) this._pages.splice(index, 1);
            if (popped.parentNode === this._pagesEl) this._pagesEl.removeChild(popped);
        }
        this._render();
        this.dispatchEvent(new CustomEvent('popped', { bubbles: true, detail: { tag: popped.tag } }));
        const next = this.visiblePage;
        this.dispatchEvent(new CustomEvent('notify::visible-page', { bubbles: true, detail: { tag: next?.tag ?? null } }));
        return true;
    }

    /** Pop every page down to (and including pushing) the given tag's page. */
    popToTag(tag: string): boolean {
        const target = this._pages.find((p) => p.tag === tag);
        if (!target) return false;
        const index = this._stack.indexOf(target);
        if (index === -1 || index === this._stack.length - 1) return false;
        let popped = false;
        while (this._stack.length - 1 > index) {
            if (!this.pop()) break;
            popped = true;
        }
        return popped;
    }

    /**
     * Replace the whole navigation stack with the given pages (mirrors
     * AdwNavigationView.replace). The last page becomes visible.
     */
    replace(pages: Array<AdwNavigationPage | string>): void {
        // Clear the current stack first (without firing popped events — replace
        // is its own signal in libadwaita).
        for (const page of this._stack) {
            if (this._dynamic.has(page)) {
                this._dynamic.delete(page);
                const index = this._pages.indexOf(page);
                if (index !== -1) this._pages.splice(index, 1);
                if (page.parentNode === this._pagesEl) this._pagesEl.removeChild(page);
            }
        }
        this._stack = [];

        for (const entry of pages) {
            const page = this._resolvePage(entry);
            if (!page) continue;
            if (!this._pages.includes(page)) {
                page.classList.add('adw-navigation-page');
                this._pagesEl.appendChild(page);
                this._pages.push(page);
                this._dynamic.add(page);
            }
            this._stack.push(page);
        }

        this._render();
        this.dispatchEvent(new CustomEvent('replaced', { bubbles: true }));
        this.dispatchEvent(
            new CustomEvent('notify::visible-page', { bubbles: true, detail: { tag: this.visiblePageTag } }),
        );
    }

    private _resolvePage(pageOrTag: AdwNavigationPage | string): AdwNavigationPage | null {
        if (typeof pageOrTag === 'string') {
            return this._pages.find((p) => p.tag === pageOrTag) ?? null;
        }
        return pageOrTag;
    }

    private _syncClasses(): void {
        this.classList.toggle('animated', this.animateTransitions);
    }

    private _render(): void {
        const visible = this.visiblePage;

        for (const page of this._pages) {
            const isVisible = page === visible;
            page.classList.toggle('visible-page', isVisible);
            page.hidden = !isVisible;
            // The back button only belongs on the visible page; clean up the
            // others so a stale button never lingers when the stack shrinks.
            if (!isVisible) this._removeBackButton(page);
        }

        if (visible) this._syncBackButton(visible);
    }

    /** Inject (or remove) the automatic back button on the visible page. */
    private _syncBackButton(page: AdwNavigationPage): void {
        // Pop is possible only when there is a page below this one on the stack.
        const poppable = this._stack.indexOf(page) > 0 && page.canPop && !page.hasAttribute('no-back-button');
        if (!poppable) {
            this._removeBackButton(page);
            return;
        }
        if (this._backButtons.has(page)) return;

        // Find the page's header bar's start section. We surface the button into
        // the first <adw-header-bar> inside the page content, the way
        // AdwHeaderBar grows a back button when placed inside an AdwNavigationView.
        const headerBar = page.querySelector('adw-header-bar') as HTMLElement | null;
        if (!headerBar) return;
        const start = (headerBar as { startSection?: HTMLElement | null }).startSection ?? null;
        if (!start) return;

        const back = document.createElement('adw-button');
        back.classList.add('adw-navigation-back-button');
        back.setAttribute('icon', 'go-previous');
        back.setAttribute('flat', '');
        back.setAttribute('tooltip', 'Back');
        back.addEventListener('click', () => this.pop());
        // Place the back button at the very start of the header.
        start.insertBefore(back, start.firstChild);
        this._backButtons.set(page, back);
    }

    private _removeBackButton(page: AdwNavigationPage): void {
        const back = this._backButtons.get(page);
        if (!back) return;
        if (back.parentNode) back.parentNode.removeChild(back);
        this._backButtons.delete(page);
    }
}

customElements.define('adw-navigation-page', AdwNavigationPage);
customElements.define('adw-navigation-view', AdwNavigationView);
