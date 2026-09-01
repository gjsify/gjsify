// <adw-navigation-view> — A page-based navigation container (the web
// counterpart of Adw.NavigationView). It presents one page at a time and keeps
// a navigation stack controlled with push()/pop()/replace(); the visible page
// fills the view. Only <adw-navigation-page> children are managed.
//
// The stack machine itself is NOT here: it lives in `@gjsify/adwaita-core`'s
// `NavigationViewState` (ADR 0004), ported from the C and shared with the
// NativeScript renderer, which used to carry its own near-identical copy. This
// element is the DOM half — mount/unmount pages, toggle `hidden`, grow the
// automatic back button, translate stack changes into CustomEvents, and route
// Escape / Alt+Left into the core's shortcut handlers.
//
// The vectors this element is held to are in `navigation-view.spec.ts`.
//
// Pages are declared as <adw-navigation-page> children (each with a `title` and
// optional `tag` attribute). The view snapshots them at connect time. Like
// Adw.NavigationView, a statically-added page is kept around but not shown until
// pushed, and adding a page while the stack is EMPTY pushes it automatically.
// push() accepts a page element OR an existing page's tag (push-by-tag); a
// dynamically-pushed page is removed from the DOM again once it is popped.
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
//   pop-on-escape ("false" disables Escape-to-pop; mirrors
//     Adw.NavigationView:pop-on-escape, which defaults to TRUE)
// Attributes (on <adw-navigation-page>):
//   title (the page title — shown in the header bar's window title, and used as
//     the NEXT page's back-button tooltip)
//   tag (a unique identifier for push-by-tag; a duplicate is rejected)
//   can-pop ("false" disables the back button and the keyboard shortcuts;
//     mirrors AdwNavigationPage:can-pop — it does NOT disable pop())
//   no-back-button (boolean — suppresses the automatic back button only)
// Events (CustomEvent, bubbles, detail = { page, tag }):
//   `pushed` after a page is pushed — mirrors AdwNavigationView::pushed.
//   `popped` after a page is popped, once per popped page, top-first — mirrors
//     AdwNavigationView::popped.
//   `replaced` (detail page/tag null) after the whole stack is replaced —
//     mirrors AdwNavigationView::replaced.
//   `notify::visible-page` whenever the visible page changes — mirrors the
//     Adw.NavigationView:visible-page property.
// Reference: refs/libadwaita/src/adw-navigation-view.c (AdwNavigationView behaviour)
// Reference: refs/libadwaita/src/adw-back-button.c (the back button derivation)
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/navigationview.md
// Copyright (c) 2022-2023 Purism SPC / GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import { BACK_BUTTON_FALLBACK_TOOLTIP, NavigationViewState, describeNavigationDiagnostic } from '@gjsify/adwaita-core';
import type { AdwNavigationPageProps, NavigationDiagnostic, NavigationStackChange } from '@gjsify/adwaita-core';

/** The page properties the core owns, read off the element's attributes. */
function readPageProps(page: AdwNavigationPage): AdwNavigationPageProps {
    return { tag: page.tag, title: page.title, canPop: page.canPop };
}

/** A single navigation page. Children of <adw-navigation-view>. */
export class AdwNavigationPage extends HTMLElement {
    /** Set while the owning view writes an attribute back, so the sync cannot recurse. */
    private _syncing = false;

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

    /** Whether the page can be popped by a shortcut or the back button. */
    get canPop(): boolean {
        return this.getAttribute('can-pop') !== 'false';
    }

    set canPop(value: boolean) {
        this.setAttribute('can-pop', value ? 'true' : 'false');
    }

    attributeChangedCallback(name: string, previous: string | null): void {
        if (this._syncing) return;
        // The attributes are the authoring surface, but the view's tag index and
        // back-button derivation read the CORE's copy — so a runtime change has to
        // be pushed into it. Without this the back button only ever reflected the
        // `can-pop` value it had at the last stack mutation.
        //
        // `instanceof` rather than a cast plus `?.`: the two failures the `?.`
        // conflated are different. A MISSING ancestor is one; an ancestor that IS
        // there but is still an ordinary HTMLElement, because its own definition has
        // not upgraded it yet, is the other, and the cast asserted it away. Measured
        // on `dist/test.browser.mjs` against declared markup parsed before the module
        // loaded: `syncPageProperty is not a function`, once per observed attribute
        // per declared page. Dropping the notification for an un-upgraded view loses
        // nothing — such a view has not registered this page, `syncPageProperty`
        // already returns on `!isRegistered`, and `connectedCallback` reads the
        // properties back out of the element through `readPageProps`.
        const view = this.closest('adw-navigation-view');
        if (!(view instanceof AdwNavigationView)) return;
        view.syncPageProperty(this, name, previous);
    }

    revertAttribute(name: string, value: string | null): void {
        this._syncing = true;
        if (value === null) this.removeAttribute(name);
        else this.setAttribute(name, value);
        this._syncing = false;
    }
}

export class AdwNavigationView extends HTMLElement {
    private _pagesEl!: HTMLDivElement;
    // The back button injected into each visible page (so we can remove it).
    private readonly _backButtons = new WeakMap<AdwNavigationPage, HTMLElement>();
    private _initialized = false;

    private readonly _diagnose = (diagnostic: NavigationDiagnostic): void => {
        console.warn(`[adw-navigation-view] ${describeNavigationDiagnostic(diagnostic)}`);
    };

    // The whole stack machine. Declared AFTER `_diagnose` — class fields run in
    // declaration order, so the sink has to exist first.
    private readonly _state = new NavigationViewState<AdwNavigationPage>({ onDiagnostic: this._diagnose });

    static get observedAttributes() {
        return ['animate-transitions', 'pop-on-escape'];
    }

    get animateTransitions(): boolean {
        // Absent attribute defaults to true (matches Adw.NavigationView).
        return this.getAttribute('animate-transitions') !== 'false';
    }

    set animateTransitions(value: boolean) {
        this.setAttribute('animate-transitions', value ? 'true' : 'false');
    }

    /** Whether pressing Escape pops the visible page (Adw.NavigationView:pop-on-escape). */
    get popOnEscape(): boolean {
        return this.getAttribute('pop-on-escape') !== 'false';
    }

    set popOnEscape(value: boolean) {
        this.setAttribute('pop-on-escape', value ? 'true' : 'false');
    }

    get visiblePage(): AdwNavigationPage | null {
        return this._state.visiblePage;
    }

    get visiblePageTag(): string | null {
        return this._state.visiblePageTag;
    }

    get depth(): number {
        return this._state.depth;
    }

    /** The navigation stack, bottom-first (Adw.NavigationView:navigation-stack). */
    get navigationStack(): readonly AdwNavigationPage[] {
        return this._state.stack;
    }

    get pages(): readonly AdwNavigationPage[] {
        return this._state.pages;
    }

    /** Whether the automatic back button is shown (AdwBackButton's visibility rule). */
    get canGoBack(): boolean {
        return this._state.canGoBack();
    }

    /** The back button's tooltip — the previous page's title, or null when there is no button. */
    get backButtonTooltip(): string | null {
        return this._state.backButtonTooltip();
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Snapshot the declared <adw-navigation-page> children — they become the
        // statically-added pages. Moving them into the stack wrapper BEFORE they
        // are registered keeps their DOM order and avoids a detach/attach flash.
        const declared = Array.from(this.querySelectorAll(':scope > adw-navigation-page')) as AdwNavigationPage[];

        this._pagesEl = document.createElement('div');
        this._pagesEl.className = 'adw-navigation-view-pages';
        for (const page of declared) {
            page.classList.add('adw-navigation-page');
            this._pagesEl.appendChild(page);
        }
        this.replaceChildren(this._pagesEl);

        this._state.subscribe((change) => this._onChange(change));
        this._state.setAnimateTransitions(this.animateTransitions);
        this._state.setPopOnEscape(this.popOnEscape);
        this.addEventListener('keydown', this._onKeyDown);

        // `add_page` auto-pushes into an EMPTY stack, so the first declared page becomes
        // visible — and it does so through `push_to_stack`, which is why the `pushed` /
        // `notify::visible-page` events fire for it.
        for (const page of declared) this._state.add(page, readPageProps(page));
        // A declared page the core REJECTED (a duplicate tag) is not one of ours:
        // it must leave the DOM, or it would sit in the stack wrapper unmanaged and
        // therefore permanently visible.
        for (const page of declared) {
            if (!this._state.isRegistered(page)) this._detach(page);
        }

        this._syncClasses();
        this._render();
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'pop-on-escape') {
            this._state.setPopOnEscape(this.popOnEscape);
            return;
        }
        this._state.setAnimateTransitions(this.animateTransitions);
        this._syncClasses();
    }

    /**
     * Push a page property change into the core. Called by
     * {@link AdwNavigationPage.attributeChangedCallback}; a rename the core rejects
     * (the tag is taken) is rolled back, because the attribute must not disagree
     * with the tag index `push-by-tag` resolves against.
     */
    syncPageProperty(page: AdwNavigationPage, name: string, previous: string | null): void {
        if (!this._state.isRegistered(page)) return;
        if (name === 'tag') {
            this._state.setTag(page, page.tag);
            if (this._state.tagOf(page) !== page.tag) page.revertAttribute('tag', previous);
        } else if (name === 'title') {
            this._state.setTitle(page, page.title);
        } else if (name === 'can-pop') {
            this._state.setCanPop(page, page.canPop);
        }
        this._render();
    }

    /**
     * Add a static page without pushing it (mirrors AdwNavigationView.add). The
     * view keeps a reference; the page becomes reachable via push-by-tag. Named
     * `addPage` rather than `add` to avoid clashing with any DOM method.
     */
    addPage(page: AdwNavigationPage): boolean {
        const added = this._state.add(page, readPageProps(page));
        this._render();
        return added;
    }

    /**
     * Remove a page (mirrors AdwNavigationView.remove). A page that is on the
     * stack is removed once it is POPPED, not now. Named `removePage` to avoid
     * overriding HTMLElement.remove() (which takes no arguments).
     */
    removePage(page: AdwNavigationPage): boolean {
        const removed = this._state.remove(page);
        if (removed && !this._state.isRegistered(page)) this._detach(page);
        this._render();
        return removed;
    }

    /**
     * Push a page onto the navigation stack (mirrors AdwNavigationView.push).
     * Accepts a page element or, when given a string, the tag of a known page
     * (push-by-tag). A page that is not already known is added dynamically and
     * destroyed when it is popped.
     */
    push(pageOrTag: AdwNavigationPage | string): boolean {
        if (typeof pageOrTag === 'string') return this.pushByTag(pageOrTag);
        const pushed = this._state.push(pageOrTag, readPageProps(pageOrTag));
        this._render();
        return pushed;
    }

    /** Push the page carrying `tag` (mirrors AdwNavigationView.push_by_tag). */
    pushByTag(tag: string): boolean {
        const pushed = this._state.pushByTag(tag);
        this._render();
        return pushed;
    }

    /**
     * Pop the visible page off the stack (mirrors AdwNavigationView.pop).
     * Returns true when a page was popped. The root page cannot be popped.
     * `can-pop` does NOT gate this — it gates the shortcuts and the back button.
     */
    pop(): boolean {
        const popped = this._state.pop();
        this._render();
        return popped;
    }

    /** Pop until `page` is visible, in ONE transition (mirrors AdwNavigationView.pop_to_page). */
    popToPage(page: AdwNavigationPage): boolean {
        const popped = this._state.popToPage(page);
        this._render();
        return popped;
    }

    /** Pop until the page carrying `tag` is visible (mirrors AdwNavigationView.pop_to_tag). */
    popToTag(tag: string): boolean {
        const popped = this._state.popToTag(tag);
        this._render();
        return popped;
    }

    /**
     * Replace the whole navigation stack (mirrors AdwNavigationView.replace). The
     * last page becomes visible; the transition is never animated.
     *
     * String entries are resolved BEFORE anything is mutated, as `replace_with_tags`
     * does: resolving late loses a dynamically-pushed page and blanks the view.
     */
    replace(pages: ReadonlyArray<AdwNavigationPage | string | null>): void {
        const resolved = pages.map((entry) => {
            if (typeof entry !== 'string') return entry ?? null;
            const page = this._state.findPage(entry);
            if (page === null) this._diagnose({ code: 'tag-not-found', tag: entry });
            return page;
        });
        this._state.replace(resolved, readPageProps);
        this._render();
    }

    /** Replace the stack with the pages carrying `tags` (mirrors AdwNavigationView.replace_with_tags). */
    replaceWithTags(tags: readonly string[]): void {
        this._state.replaceWithTags(tags);
        this._render();
    }

    /** The page with this tag, or null (mirrors AdwNavigationView.find_page). */
    findPage(tag: string): AdwNavigationPage | null {
        return this._state.findPage(tag);
    }

    /** The page popping `page` would reveal (mirrors AdwNavigationView.get_previous_page). */
    getPreviousPage(page: AdwNavigationPage): AdwNavigationPage | null {
        return this._state.getPreviousPage(page);
    }

    private _onChange(change: NavigationStackChange<AdwNavigationPage>): void {
        for (const page of change.removed) this._detach(page);
        // The slide is a CSS animation on the incoming page, so there is no JS
        // transition to wait for: settle the deferred destroy at once, exactly as
        // adw_animation_skip does in the C when `animate` is FALSE.
        for (const page of this._state.finishTransition()) this._detach(page);
        this._render();

        if (change.reason === 'add' || change.reason === 'push') {
            this._dispatch('pushed', change.visiblePage);
        } else if (change.reason === 'pop') {
            for (const page of change.popped) this._dispatch('popped', page);
        } else {
            this._dispatch('replaced', null);
        }
        if (change.previousVisiblePage !== change.visiblePage) {
            this._dispatch('notify::visible-page', change.visiblePage);
        }
    }

    private _dispatch(type: string, page: AdwNavigationPage | null): void {
        this.dispatchEvent(new CustomEvent(type, { bubbles: true, detail: { page, tag: page?.tag ?? null } }));
    }

    private readonly _onKeyDown = (event: KeyboardEvent): void => {
        if (event.defaultPrevented) return;
        let result: 'stop' | 'propagate';
        if (event.key === 'Escape') {
            result = this._state.popFromEscape();
        } else if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            // `back_forward_shortcut_cb` swaps the arrows under RTL; only the BACK
            // direction is handled, since forward needs ::get-next-page.
            const back = getComputedStyle(this).direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
            if (event.key !== back) return;
            result = this._state.popFromShortcut();
        } else {
            return;
        }
        if (result === 'stop') {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    private _syncClasses(): void {
        this.classList.toggle('animated', this.animateTransitions);
    }

    private _render(): void {
        const visible = this._state.visiblePage;

        for (const page of this._state.pages) {
            this._attach(page);
            const isVisible = page === visible;
            page.classList.toggle('visible-page', isVisible);
            page.hidden = !isVisible;
            // The back button only belongs on the visible page; clean up the
            // others so a stale button never lingers when the stack shrinks.
            if (!isVisible) this._removeBackButton(page);
        }

        if (visible) this._syncBackButton(visible);
    }

    private _attach(page: AdwNavigationPage): void {
        if (page.parentNode === this._pagesEl) return;
        page.classList.add('adw-navigation-page');
        this._pagesEl.appendChild(page);
    }

    private _detach(page: AdwNavigationPage): void {
        this._removeBackButton(page);
        page.classList.remove('visible-page');
        if (page.parentNode === this._pagesEl) this._pagesEl.removeChild(page);
    }

    private _syncBackButton(page: AdwNavigationPage): void {
        if (!this._state.canGoBack() || page.hasAttribute('no-back-button')) {
            this._removeBackButton(page);
            return;
        }

        // The tooltip is the title of the page the button REVEALS, so it can change while
        // the button itself stays put (`AdwBackButton`'s `query_tooltip`).
        const tooltip = this._state.backButtonTooltip() ?? BACK_BUTTON_FALLBACK_TOOLTIP;
        const existing = this._backButtons.get(page);
        if (existing) {
            existing.setAttribute('tooltip', tooltip);
            return;
        }

        // The button goes into the first <adw-header-bar> inside the page content, the
        // way AdwHeaderBar grows one when placed inside an AdwNavigationView.
        const headerBar = page.querySelector('adw-header-bar') as HTMLElement | null;
        if (!headerBar) return;
        const start = (headerBar as { startSection?: HTMLElement | null }).startSection ?? null;
        if (!start) return;

        const back = document.createElement('gtk-button');
        back.classList.add('adw-navigation-back-button');
        back.setAttribute('icon', 'go-previous');
        back.setAttribute('flat', '');
        back.setAttribute('tooltip', tooltip);
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

// The VIEW first, and the order carries weight: `define` upgrades every matching
// element already in the document, immediately, so these two calls are a sequence and
// not a pair. Registering the page first upgraded every declared
// `<adw-navigation-page>` while its `<adw-navigation-view>` parent was still an
// ordinary HTMLElement, and `AdwNavigationPage.attributeChangedCallback` reaches for
// that parent. Parent before child keeps the window shut; the `instanceof` guard in
// the callback is what holds when something outside this file reopens it.
// `scripts/check-adwaita-upgrade-order.mjs` holds the order itself.
customElements.define('adw-navigation-view', AdwNavigationView);
customElements.define('adw-navigation-page', AdwNavigationPage);
