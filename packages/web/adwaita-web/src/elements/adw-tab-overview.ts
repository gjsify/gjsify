// <adw-tab-overview> — A grid of tab thumbnails over an <adw-tab-view>.
// The web counterpart of Adw.TabOverview.
//
// Reference: refs/libadwaita/src/adw-tab-overview.c (AdwTabOverview behaviour)
// Reference: refs/libadwaita/src/stylesheet/widgets/_tab-overview.scss
// Reference: packages/nativescript-bridge/adwaita/src/widgets/adw-tab-overview.ts (NS twin)
//
// This element displays tabs as a grid of thumbnail chips, with a page panel
// below showing the selected page. It uses the headless TabViewState model
// from @gjsify/adwaita-core, shared with the NativeScript twin and specced by
// @gjsify/adwaita-core/conformance. This element is the DOM half only.
//
// The MODEL is HEADLESS, in @gjsify/adwaita-core's TabViewState (ADR 0004),
// shared with the NativeScript twin and specced by @gjsify/adwaita-core/conformance.
// The DOM element implements the grid thumbnail rendering; the model owns page
// state, selection, close, reorder, and pinning.
//
// MODIFICATION: The grid layout and thumbnail rendering are web-specific; the
// underlying model and page lifecycle are identical to <adw-tab-view>.
//
// Copyright (c) 2020-2022 Purism SPC / GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// grid thumbnail layout is web-specific.

import { TabViewState, tabCloseVisible, tabIconState, tabsRevealed } from '@gjsify/adwaita-core';
import type { AdwTabPageSpec, AdwTabPageState, TabViewPagesChange, TabViewSelectionChange } from '@gjsify/adwaita-core';

import { bindSlottedChildren } from '../slotted-children.js';
import { type GtkImage, createGtkImage } from './gtk-image.js';

/** The live `<adw-tab-page>` properties, each mapped onto a state setter. */
const PAGE_ATTRIBUTES = ['title', 'tooltip', 'icon', 'indicator-icon', 'loading', 'needs-attention', 'pinned'];

/** `SPACING`: the slack `scroll_to_tab_full` allows before it scrolls (adw-tab-box.c:24). */
const TAB_SPACING = 5;

/**
 * A single page. Declared as a child of <adw-tab-overview>; the element itself
 * becomes the panel, so its attributes stay live — or added imperatively.
 */
export class AdwTabPage extends HTMLElement {
    static get observedAttributes() {
        return PAGE_ATTRIBUTES;
    }

    connectedCallback(): void {
        // `AdwTabPage:child` is a PROPERTY, so a `.blp`'s `child: …` authors `slot="child"`.
        // The page's children already ARE its panel content, so this only enrols the
        // name, for the reason `adw-clamp.ts` gives for not calling `.install()`.
        bindSlottedChildren(this, [{ name: 'child', into: this }]);
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        // `closest` still finds the view after adoption: the element is moved
        // into the view's page container, not replaced by a wrapper.
        //
        // `instanceof` rather than a cast plus `?.`, because the two failures the
        // `?.` conflated are different: a MISSING ancestor, and an ancestor that is
        // there but is still an ordinary HTMLElement because its own definition has
        // not upgraded it. The cast asserted the second away, and it is the one that
        // happened — `syncDeclaredPage is not a function`, 19 times on
        // `/getting-started/`, once per declared page.
        //
        // Dropping the notification for an un-upgraded view is correct and not
        // merely quiet: such a view has not adopted this page yet, and
        // `_adoptDeclaredPage` reads every attribute in PAGE_ATTRIBUTES straight off
        // the element when it does, so there is nothing to lose and nothing to defer.
        const view = this.closest('adw-tab-overview');
        if (!(view instanceof AdwTabOverview)) return;
        view.syncDeclaredPage(this, name, value);
    }
}

/** The grid of tab thumbnails over an <adw-tab-view>. */
export class AdwTabOverview extends HTMLElement {
    private readonly _state = new TabViewState<HTMLElement>({
        onClosePage: (page) => this._requestClose(page),
    });
    private readonly _gridEl: HTMLDivElement;
    private readonly _pagePanelEl: HTMLDivElement;
    /** Tab chips keyed by page id — the grid is edited in place, never rebuilt. */
    private readonly _tabs = new Map<string, HTMLDivElement>();
    /** Page panels keyed by page id; kept so a DETACHED page's node is still reachable. */
    private readonly _panels = new Map<string, HTMLElement>();
    private readonly _hovered = new Set<string>();
    private _initialized = false;
    private _generatedIds = 0;
    /** Guards the `selected-page` attribute reflection against re-entering the model. */
    private _reflecting = false;

    static get observedAttributes() {
        return ['selected-page', 'enable-new-tab', 'secondary-menu', 'enable-search'];
    }

    constructor() {
        super();
        // Detached nodes only: a custom element constructor may not add children.
        // They are attached in connectedCallback, and pages added BEFORE that
        // land in the detached container and come along with it.
        this._gridEl = document.createElement('div');
        this._gridEl.className = 'adw-tab-overview-grid';
        this._pagePanelEl = document.createElement('div');
        this._pagePanelEl.className = 'adw-tab-overview-page-panel';
        this.attachShadow({ mode: 'open' });
        this.shadowRoot!.appendChild(this._gridEl);
        this.shadowRoot!.appendChild(this._pagePanelEl);
    }

    /** The selected page (`Adw.TabOverview:selected-page`), `null` when the view is empty. */
    get selectedPage(): AdwTabPageState<HTMLElement> | null {
        return this._state.selectedPage;
    }

    set selectedPage(page: AdwTabPageState<HTMLElement> | null) {
        this._state.setSelectedPage(page);
    }

    /** Whether the close affordance is omitted (static tab sets). */
    get enableNewTab(): boolean {
        return this.hasAttribute('enable-new-tab');
    }

    set enableNewTab(value: boolean) {
        if (value) this.setAttribute('enable-new-tab', '');
        else this.removeAttribute('enable-new-tab');
    }

    /** Whether the secondary menu button is shown. */
    get secondaryMenu(): boolean {
        return this.hasAttribute('secondary-menu');
    }

    set secondaryMenu(value: boolean) {
        if (value) this.setAttribute('secondary-menu', '');
        else this.removeAttribute('secondary-menu');
    }

    /** Whether the search bar is shown. */
    get enableSearch(): boolean {
        return this.hasAttribute('enable-search');
    }

    set enableSearch(value: boolean) {
        if (value) this.setAttribute('enable-search', '');
        else this.removeAttribute('enable-search');
    }

    get pages(): readonly AdwTabPageState<HTMLElement>[] {
        return this._state.pages;
    }

    get nPages(): number {
        return this._state.nPages;
    }

    get nPinnedPages(): number {
        return this._state.nPinnedPages;
    }

    /** Id of the selected page, `null` when the view is empty. */
    get selectedId(): string | null {
        return this._state.selectedId;
    }

    /** Index of the selected page, `-1` when the view is empty. */
    get selectedIndex(): number {
        return this._state.selectedIndex;
    }

    /** Content of the selected page, `null` when the view is empty. */
    get selectedContent(): HTMLElement | null {
        return this._state.selectedPage?.content ?? null;
    }

    isClosing(id: string): boolean {
        return this._state.isClosing(id);
    }

    /** `adw_tab_overview_set_selected_page`, which takes the PAGE; an id is accepted too. */
    setSelectedPage(page: AdwTabPageState<HTMLElement> | string | null): boolean {
        return this._state.setSelectedPage(page);
    }

    selectNthPage(n: number): boolean {
        return this._state.selectNthPage(n);
    }

    selectPreviousPage(): boolean {
        return this._state.selectPreviousPage();
    }

    selectNextPage(): boolean {
        return this._state.selectNextPage();
    }

    selectFirstPage(): boolean {
        return this._state.selectFirstPage();
    }

    selectLastPage(): boolean {
        return this._state.selectLastPage();
    }

    /** Ctrl+Tab — the next page, wrapping to the first. */
    cycleNextPage(): boolean {
        return this._state.cycleNextPage();
    }

    /** Ctrl+Shift+Tab — the previous page, wrapping to the last. */
    cyclePreviousPage(): boolean {
        return this._state.cyclePreviousPage();
    }

    /** Add a page opened FROM `parentId`, deriving its position (Adw.TabOverview.add_page). */
    addPage(spec: AdwTabPageSpec<HTMLElement>, parentId: string | null = null): number {
        return this._state.addPage(this._withPanel(spec), parentId);
    }

    insertPage(spec: AdwTabPageSpec<HTMLElement>, position: number): number {
        return this._state.insertPage(this._withPanel(spec), position);
    }

    prependPage(spec: AdwTabPageSpec<HTMLElement>): number {
        return this._state.prependPage(this._withPanel(spec));
    }

    appendPage(spec: AdwTabPageSpec<HTMLElement>): number {
        return this._state.appendPage(this._withPanel(spec));
    }

    insertPinnedPage(spec: AdwTabPageSpec<HTMLElement>, position: number): number {
        return this._state.insertPinnedPage(this._withPanel(spec), position);
    }

    prependPinnedPage(spec: AdwTabPageSpec<HTMLElement>): number {
        return this._state.prependPinnedPage(this._withPanel(spec));
    }

    /** Append a pinned page, re-ordering it in the same step. */
    appendPinnedPage(spec: AdwTabPageSpec<HTMLElement>): number {
        return this._state.appendPinnedPage(this._withPanel(spec));
    }

    /** Pin or unpin a page, re-ordering it in the same step. Returns its new position. */
    setPagePinned(id: string, pinned: boolean): number {
        return this._state.setPagePinned(id, pinned);
    }

    /**
     * Request a close. Dispatches a CANCELABLE `close-page`; calling
     * `preventDefault()` on it holds the page open until the app calls
     * {@link closePageFinish}.
     */
    closePage(id: string): boolean {
        return this._state.closePage(id);
    }

    closePageFinish(id: string, confirm: boolean): boolean {
        return this._state.closePageFinish(id, confirm);
    }

    closeOtherPages(id: string): void {
        this._state.closeOtherPages(id);
    }

    closePagesBefore(id: string): void {
        this._state.closePagesBefore(id);
    }

    closePagesAfter(id: string): void {
        this._state.closePagesAfter(id);
    }

    /** Remove a page unconditionally, running the successor rule first. */
    detachPage(id: string): AdwTabPageState<HTMLElement> | null {
        return this._state.detachPage(id);
    }

    reorderPage(id: string, position: number): boolean {
        return this._state.reorderPage(id, position);
    }

    reorderBackward(id: string): boolean {
        return this._state.reorderBackward(id);
    }

    reorderForward(id: string): boolean {
        return this._state.reorderForward(id);
    }

    reorderFirst(id: string): boolean {
        return this._state.reorderFirst(id);
    }

    reorderLast(id: string): boolean {
        return this._state.reorderLast(id);
    }

    setPageTitle(id: string, title: string | null): boolean {
        return this._state.setPageTitle(id, title);
    }

    setPageTooltip(id: string, tooltip: string | null): boolean {
        return this._state.setPageTooltip(id, tooltip);
    }

    setPageIcon(id: string, icon: string | null): boolean {
        return this._state.setPageIcon(id, icon);
    }

    setPageLoading(id: string, loading: boolean): boolean {
        return this._state.setPageLoading(id, loading);
    }

    setPageNeedsAttention(id: string, needsAttention: boolean): boolean {
        return this._state.setPageNeedsAttention(id, needsAttention);
    }

    /** Every precondition the model refused, as C would have warned about it. */
    get diagnostics(): readonly string[] {
        return this._state.diagnostics;
    }

    /** Adopt declared `<adw-tab-page>` children. */
    private _adoptDeclaredPage(pageEl: AdwTabPage): void {
        // The declared element IS the panel — attributes stay live on it, which
        // is what makes `<adw-tab-page title>` observable at all.
        const spec: AdwTabPageSpec<HTMLElement> = {
            id: pageEl.getAttribute('page-id') ?? this._nextId(),
            title: pageEl.getAttribute('title'),
            tooltip: pageEl.getAttribute('tooltip'),
            icon: pageEl.getAttribute('icon'),
            indicatorIcon: pageEl.getAttribute('indicator-icon'),
            loading: pageEl.hasAttribute('loading'),
            needsAttention: pageEl.hasAttribute('needs-attention'),
            content: pageEl,
        };
        if (pageEl.hasAttribute('pinned')) this.appendPinnedPage(spec);
        else this.appendPage(spec);
    }

    /** Give a spec its panel, so `append({ id })` with no content is legal. */
    private _withPanel(spec: AdwTabPageSpec<HTMLElement>): AdwTabPageSpec<HTMLElement> {
        const content = spec.content ?? document.createElement('adw-tab-page');
        content.classList.add('adw-tab-page');
        content.setAttribute('role', 'tabpanel');
        content.dataset.pageId = spec.id;
        return { ...spec, content };
    }

    /** Monotonic and never reused: an id is the stand-in for a page POINTER. */
    private _nextId(): string {
        this._generatedIds += 1;
        return `tab-${this._generatedIds}`;
    }

    private _onPagesChange(change: TabViewPagesChange): void {
        switch (change.kind) {
            case 'attached': {
                const page = this._state.getPage(change.id);
                if (page) this._insertTab(page, change.position);
                break;
            }
            case 'detached': {
                this._tabs.get(change.id)?.remove();
                this._tabs.delete(change.id);
                this._hovered.delete(change.id);
                // The page is already out of the model, so its node has to come
                // from here rather than from `getPage(id)?.content`.
                this._panels.get(change.id)?.remove();
                this._panels.delete(change.id);
                break;
            }
            case 'reordered':
            case 'pinned': {
                this._moveTab(change.id, change.position);
                this._refreshTab(change.id);
                break;
            }
            case 'updated':
                this._refreshTab(change.id);
                break;
        }
        this._applyBarVisibility();
        this._applyActiveState();
        this.dispatchEvent(
            new CustomEvent(`page-${change.kind}`, {
                bubbles: true,
                detail: { id: change.id, position: change.position, previousPosition: change.previousPosition },
            }),
        );
    }

    private _insertTab(page: AdwTabPageState<HTMLElement>, position: number): void {
        const tab = document.createElement('div');
        tab.className = 'adw-tab-overview-tab';
        tab.dataset.pageId = page.id;

        // Icon.
        const icon = createGtkImage(null, 'adw-tab-overview-thumbnail');
        tab.appendChild(icon);

        // Title.
        const label = document.createElement('span');
        label.className = 'adw-tab-overview-title';
        label.textContent = page.title;
        tab.appendChild(label);

        // Close affordance.
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'adw-tab-overview-close';
        close.tabIndex = -1;
        close.setAttribute('aria-label', 'Close tab');
        close.addEventListener('click', (event) => {
            event.stopPropagation();
            this._state.closePage(page.id);
        });
        tab.appendChild(close);

        tab.addEventListener('click', () => this._state.setSelectedPage(page.id));
        tab.addEventListener('pointerenter', () => {
            this._hovered.add(page.id);
            this._refreshCloseVisibility(page.id);
        });
        tab.addEventListener('pointerleave', () => {
            this._hovered.delete(page.id);
            this._refreshCloseVisibility(page.id);
        });

        this._gridEl.insertBefore(tab, this._gridEl.children[position] ?? null);
        this._tabs.set(page.id, tab);

        const panel = page.content;
        if (panel) {
            this._panels.set(page.id, panel);
            this._pagePanelEl.insertBefore(panel, this._pagePanelEl.children[position] ?? null);
        }
        this._refreshTab(page.id);
    }

    private _moveTab(id: string, position: number): void {
        const tab = this._tabs.get(id);
        if (tab) {
            tab.remove();
            this._gridEl.insertBefore(tab, this._gridEl.children[position] ?? null);
        }
        const panel = this._panels.get(id);
        if (panel) {
            panel.remove();
            this._pagePanelEl.insertBefore(panel, this._pagePanelEl.children[position] ?? null);
        }
    }

    private _refreshTab(id: string): void {
        const page = this._state.getPage(id);
        const tab = this._tabs.get(id);
        if (!page || !tab) return;

        const label = tab.querySelector('.adw-tab-overview-title') as HTMLElement | null;
        if (label) label.textContent = page.title;

        const icons = tabIconState(page, this.getAttribute('default-icon'));
        const icon = tab.querySelector('.adw-tab-overview-thumbnail') as GtkImage | null;
        if (icon) {
            icon.iconName = icons.icon;
            // The two occupy the same slot and are never both visible: C
            // REPLACES the image's contents rather than stacking a second node.
            icon.hidden = !icons.iconVisible || icons.spinner;
        }
        const spinner = tab.querySelector('.adw-tab-overview-spinner') as HTMLElement | null;
        // The spinner is mounted only while it spins, so an idle tab holds no
        // element in the shared rAF ticker.
        if (spinner) spinner.hidden = !(icons.spinner && icons.iconVisible);
        const indicator = tab.querySelector('.adw-tab-overview-indicator') as GtkImage | null;
        if (indicator) {
            indicator.iconName = page.indicatorIcon;
            indicator.hidden = !icons.indicatorVisible;
        }
        this._refreshCloseVisibility(id);
    }

    private _refreshCloseVisibility(id: string): void {
        const page = this._state.getPage(id);
        const tab = this._tabs.get(id);
        if (!page || !tab) return;

        const close = tab.querySelector('.adw-tab-overview-close') as HTMLElement | null;
        if (!close) return;

        const fullyVisible = this._isTabFullyVisible(tab);
        close.hidden = !tabCloseVisible({
            hovering: this._hovered.has(id),
            fullyVisible,
            selected: this._state.selectedId === id,
            dragging: false,
            pinned: page.pinned,
        });
    }

    private _isTabFullyVisible(tab: HTMLElement): boolean {
        const gridRect = this._gridEl.getBoundingClientRect();
        const tabRect = tab.getBoundingClientRect();
        return (
            tabRect.left >= gridRect.left &&
            tabRect.right <= gridRect.right &&
            tabRect.top >= gridRect.top &&
            tabRect.bottom <= gridRect.bottom
        );
    }

    private _onSelectionChange(change: TabViewSelectionChange): void {
        this._applyActiveState();
        this._reflectSelected();
        this.dispatchEvent(
            new CustomEvent('notify::selected-page', {
                bubbles: true,
                detail: {
                    selected: change.selectedIndex,
                    selectedId: change.selectedId,
                    previousId: change.previousId,
                    interactive: change.interactive,
                },
            }),
        );
    }

    private _applyActiveState(): void {
        const selected = this._state.selectedId;
        for (const page of this._state.pages) {
            const isActive = page.id === selected;
            const tab = this._tabs.get(page.id);
            if (tab) {
                tab.classList.toggle('active', isActive);
                tab.setAttribute('aria-selected', String(isActive));
                tab.tabIndex = isActive ? 0 : -1;
            }
            const panel = page.content;
            if (panel) {
                panel.classList.toggle('active-page', isActive);
                panel.hidden = !isActive;
            }
            this._refreshCloseVisibility(page.id);
        }
    }

    /**
     * `selected-page="<page id>"` — the markup half of {@link selectedPage} (ADR 0048).
     *
     * The id is the one `<adw-tab-page page-id>` declares; a page that declares none gets
     * a generated one, which an author cannot predict and therefore cannot select by. That
     * is the same bargain `<adw-view-stack visible-child-name>` already makes for a page
     * with no name, and it is why `page-id` exists.
     */
    private _applySelectedAttribute(value: string): void {
        this._state.setSelectedPage(value);
    }

    /**
     * The `init_shortcuts` keyboard contract for TabOverview (Ctrl+Tab, number keys,
     * Arrow keys). Mirroring the C `init_shortcuts` in adw-tab-overview.c.
     */
    private _onKeyDown(event: KeyboardEvent): void {
        const inGrid = event.target instanceof Node && this._gridEl.contains(event.target);
        let handled = false;

        if (event.ctrlKey && event.key === 'Tab') {
            handled = event.shiftKey ? this._state.cyclePreviousPage() : this._state.cycleNextPage();
        } else if (event.ctrlKey && event.shiftKey && (event.key === 'PageUp' || event.key === 'PageDown')) {
            const id = this._state.selectedId;
            if (id !== null) {
                handled = event.key === 'PageUp' ? this._state.reorderBackward(id) : this._state.reorderForward(id);
            }
        } else if (event.ctrlKey && event.shiftKey && (event.key === 'Home' || event.key === 'End')) {
            const id = this._state.selectedId;
            if (id !== null) {
                handled = event.key === 'Home' ? this._state.reorderFirst(id) : this._state.reorderLast(id);
            }
        } else if (event.ctrlKey && (event.key === 'PageUp' || event.key === 'PageDown')) {
            handled = event.key === 'PageUp' ? this._state.selectPreviousPage() : this._state.selectNextPage();
        } else if (event.ctrlKey && (event.key === 'Home' || event.key === 'End')) {
            const id = this._state.selectedId;
            if (id !== null) {
                handled = event.key === 'Home' ? this._state.selectFirstPage() : this._state.selectLastPage();
            }
        } else if (event.altKey && /^[0-9]$/.test(event.key)) {
            const digit = Number.parseInt(event.key, 10);
            handled = this._state.selectNthPage(digit === 0 ? 9 : digit - 1);
        } else if (inGrid && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            handled = event.key === 'ArrowLeft' ? this._state.selectPreviousPage() : this._state.selectNextPage();
        } else if (inGrid && (event.key === 'Home' || event.key === 'End')) {
            const id = this._state.selectedId;
            if (id !== null) {
                handled = event.key === 'Home' ? this._state.selectFirstPage() : this._state.selectLastPage();
            }
        }

        if (!handled) return;
        event.preventDefault();

        // Roving tabindex: the newly-active tab is the only focusable one, so
        // focus has to travel with it or the next keypress goes nowhere.
        if (inGrid) {
            const id = this._state.selectedId;
            if (id !== null) this._tabs.get(id)?.focus({ preventScroll: true });
        }
    }

    /**
     * The `close-page` seam. A CANCELABLE DOM event is the idiomatic spelling of the C
     * signal's return value: letting it through takes libadwaita's default (`!pinned`),
     * and `preventDefault()` defers the close until the app calls
     * {@link closePageFinish}.
     */
    private _requestClose(page: AdwTabPageState<HTMLElement>): boolean | 'defer' {
        const proceed = this.dispatchEvent(
            new CustomEvent('close-page', {
                bubbles: true,
                cancelable: true,
                detail: { index: this._state.getPagePosition(page.id), id: page.id },
            }),
        );
        return proceed ? !page.pinned : 'defer';
    }

    /** Sync a declared `<adw-tab-page>` attribute change into the model. */
    syncDeclaredPage(pageEl: AdwTabPage, name: string, value: string | null): void {
        const id = pageEl.dataset.pageId;
        if (id === undefined) return;
        switch (name) {
            case 'title':
                this._state.setPageTitle(id, value);
                return;
            case 'tooltip':
                this._state.setPageTooltip(id, value);
                return;
            case 'icon':
                this._state.setPageIcon(id, value);
                return;
            case 'indicator-icon':
                this._state.setPageIndicatorIcon(id, value);
                return;
            case 'loading':
                this._state.setPageLoading(id, value !== null);
                return;
            case 'needs-attention':
                this._state.setPageNeedsAttention(id, value !== null);
                return;
            case 'pinned':
                this._state.setPagePinned(id, value !== null);
                return;
        }
    }

    /** Reflect the selected page as the `selected-page` attribute. */
    private _reflectSelected(): void {
        this._reflecting = true;
        const id = this._state.selectedId;
        if (id === null) this.removeAttribute('selected-page');
        else if (this.getAttribute('selected-page') !== id) this.setAttribute('selected-page', id);
        this._reflecting = false;
    }

    private _applyBarVisibility(): void {
        const revealed = tabsRevealed({
            autohide: false,
            nPages: this._state.nPages,
            nPinnedPages: this._state.nPinnedPages,
            isTransferringPage: false,
        });
        // TabOverview always shows the grid; no auto-hide bar in the overview layout.
        // The page panel visibility is handled via active-state toggling.
    }
}

// The VIEW first, and the order carries weight: `define` upgrades every matching
// element already in the document, immediately. Registering the page first therefore
// upgraded every declared `<adw-tab-page>` while its `<adw-tab-overview>` parent was still
// un-upgraded, and `AdwTabPage.attributeChangedCallback` reaches for that parent.
// Parent before child keeps the window shut; the `instanceof` guard in the callback is
// what holds when something outside this file reopens it — and because the guard makes
// the order UNOBSERVABLE (with it in place, page-first renders identically and every
// test still passes, measured), the order itself is held by
// `scripts/check-adwaita-upgrade-order.mjs` rather than by a spec.
customElements.define('adw-tab-overview', AdwTabOverview);
customElements.define('adw-tab-page', AdwTabPage);