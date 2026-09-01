// <adw-tab-view> — A dynamic tabbed container with a tab bar header (the web
// counterpart of Adw.TabView + Adw.TabBar). One page is shown at a time; the tab
// bar renders one chip per page (title + close affordance) over a
// headerbar-colored strip, with the selected chip raised onto the view
// background.
//
// The MODEL is HEADLESS, in `@gjsify/adwaita-core`'s {@link TabViewState}
// (ADR 0004), shared with the NativeScript twin and specced by
// `@gjsify/adwaita-core/conformance`. This element is the DOM half only.
//
// The C rules that are not visible in the DOM code:
//   - closing defaults to closing a non-pinned page and DENYING a pinned one
//     (`close_page_cb`).
//   - an out-of-range `selected` is IGNORED, not clamped, and every path notifies,
//     property sets included.
//   - the bar stays up for a single PINNED tab.
//   - the close affordance follows `tabCloseVisible` (three terms plus a pinned
//     gate), and titles/tooltips/icons/loading stay live.
//
// Pages are declared as <adw-tab-page> children — the element itself becomes the
// panel, so its attributes stay live — or added imperatively. The roving tabindex
// must keep moving: under `role=tablist` a frozen one leaves every inactive tab
// keyboard-unreachable.
//
// MODIFICATION: Adw.TabBar defaults `autohide` TRUE (`DEFAULT_TAB_AUTOHIDE`); an
// HTML boolean attribute cannot express a TRUE default, so `autohide` is opt-in
// here. `no-close` is web-specific, for static tab sets such as documentation
// command tabs.
//
// Events (all CustomEvent, all bubbling): `notify::selected-page`
// (`{ selected, selectedId, previousId, interactive }`); `close-page`
// (`{ index, id }`), CANCELABLE and one per close ATTEMPT, where
// `preventDefault()` holds the page open until `closePageFinish(id, confirm)`;
// and `page-attached` / `page-detached` / `page-reordered` / `page-pinned` /
// `page-updated` (`{ id, position, previousPosition }`), one per page-list change
// so a bound tab bar can move ONE chip instead of rebuilding.
//
// Reference: refs/libadwaita/src/adw-tab-view.c (AdwTabView behaviour)
// Reference: refs/libadwaita/src/adw-tab-bar.c (AdwTabBar autohide)
// Reference: refs/libadwaita/src/adw-tab.c (AdwTab chip)
// Reference: refs/libadwaita/src/stylesheet/widgets/_tab-view.scss
// Reference: refs/adwaita-web/adwaita-web/scss/_tabs.scss
// Reference: packages/nativescript-bridge/adwaita/src/widgets/adw-tab-view.ts (NS twin)
// Copyright (c) 2020-2022 Purism SPC / GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the
// tab icon + indicator nodes are <gtk-image>.

import { TabViewState, tabCloseVisible, tabIconState, tabTooltip, tabsRevealed } from '@gjsify/adwaita-core';
import type { AdwTabPageSpec, AdwTabPageState, TabViewPagesChange, TabViewSelectionChange } from '@gjsify/adwaita-core';

import { type GtkImage, createGtkImage } from './gtk-image.js';

export type AdwTabViewPage = AdwTabPageState<HTMLElement>;

export type AdwTabViewPageSpec = AdwTabPageSpec<HTMLElement>;

/** The live `<adw-tab-page>` properties, each mapped onto a state setter. */
const PAGE_ATTRIBUTES = ['title', 'tooltip', 'icon', 'indicator-icon', 'loading', 'needs-attention', 'pinned'];

/** `SPACING`: the slack `scroll_to_tab_full` allows before it scrolls (adw-tab-box.c:24). */
const TAB_SPACING = 5;

/**
 * A single page. Declared as a child of <adw-tab-view>; the element itself becomes the
 * page panel, so its attributes keep driving the tab after connect — a renderer that
 * moves the children out and discards the element leaves `observedAttributes` with
 * nothing to act on.
 */
export class AdwTabPage extends HTMLElement {
    static get observedAttributes() {
        return PAGE_ATTRIBUTES;
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
        const view = this.closest('adw-tab-view');
        if (!(view instanceof AdwTabView)) return;
        view.syncDeclaredPage(this, name, value);
    }
}

export class AdwTabView extends HTMLElement {
    private readonly _state = new TabViewState<HTMLElement>({
        onClosePage: (page) => this._requestClose(page),
    });
    private readonly _barEl: HTMLDivElement;
    private readonly _tabBoxEl: HTMLDivElement;
    private readonly _pagesEl: HTMLDivElement;
    /** Tab chips keyed by page id — the bar is edited in place, never rebuilt. */
    private readonly _tabs = new Map<string, HTMLButtonElement>();
    /** Page panels keyed by page id; kept so a DETACHED page's node is still reachable. */
    private readonly _panels = new Map<string, HTMLElement>();
    private readonly _hovered = new Set<string>();
    private _initialized = false;
    private _generatedIds = 0;
    /** Guards the `selected` attribute reflection against re-entering the model. */
    private _reflecting = false;

    static get observedAttributes() {
        return ['selected', 'autohide', 'expand-tabs', 'no-close'];
    }

    constructor() {
        super();
        // Detached nodes only: a custom element constructor may not add children.
        // They are attached in connectedCallback, and pages added BEFORE that
        // land in the detached container and come along with it.
        this._barEl = document.createElement('div');
        this._barEl.className = 'adw-tab-bar';
        this._barEl.setAttribute('role', 'tablist');
        this._tabBoxEl = document.createElement('div');
        this._tabBoxEl.className = 'adw-tab-box';
        this._barEl.appendChild(this._tabBoxEl);
        this._pagesEl = document.createElement('div');
        this._pagesEl.className = 'adw-tab-view-pages';

        this._state.subscribePages((change) => this._onPagesChange(change));
        this._state.subscribe((change) => this._onSelectionChange(change));
    }

    /** Zero-based index of the visible page, `-1` when the view is empty. */
    get selected(): number {
        return this._state.selectedIndex;
    }

    set selected(value: number) {
        this._state.selectNthPage(value);
    }

    /**
     * Whether the tab bar hides itself when it has nothing to show —
     * `tabsRevealed`, which keeps the bar up for a single PINNED tab.
     */
    get autohide(): boolean {
        return this.hasAttribute('autohide');
    }

    set autohide(value: boolean) {
        if (value) this.setAttribute('autohide', '');
        else this.removeAttribute('autohide');
    }

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

        // Read the declared selection BEFORE adopting anything: the auto-select
        // of the first page reflects its own index into this very attribute.
        const declaredSelection = this.getAttribute('selected');

        // Snapshot the declared pages, then take over the subtree. The elements
        // themselves become the panels, so they must survive replaceChildren.
        const declared = Array.from(this.querySelectorAll(':scope > adw-tab-page')) as AdwTabPage[];
        this.replaceChildren(this._barEl, this._pagesEl);
        for (const pageEl of declared) this._adoptDeclaredPage(pageEl);

        if (declaredSelection !== null) this._applySelectedAttribute(declaredSelection);
        this._applyBarVisibility();
        this._reflectSelected();

        this.addEventListener('keydown', (event) => this._onKeyDown(event));
    }

    attributeChangedCallback(name: string, _old: string | null, _value: string | null) {
        if (!this._initialized) return;
        if (name === 'selected') {
            // The LIVE attribute, not the value captured when the reaction was
            // queued: reflection writes this attribute, and a custom-element
            // reaction can run after a later write has already superseded it.
            if (this._reflecting) return;
            const current = this.getAttribute('selected');
            if (current !== null) this._applySelectedAttribute(current);
            return;
        }
        // autohide gates the bar; expand-tabs and no-close are styling only.
        this._applyBarVisibility();
    }

    /**
     * Push a live `<adw-tab-page>` attribute change into the model. Called by
     * {@link AdwTabPage.attributeChangedCallback}; not part of the public API.
     */
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

    // --- Model surface (thin delegations to TabViewState) --------------------

    get pages(): readonly AdwTabViewPage[] {
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

    get selectedContent(): HTMLElement | null {
        return this._state.selectedPage?.content ?? null;
    }

    isClosing(id: string): boolean {
        return this._state.isClosing(id);
    }

    setSelectedPage(id: string | null): boolean {
        return this._state.setSelectedPage(id);
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

    /** Add a page opened FROM `parentId`, deriving its position (Adw.TabView.add_page). */
    addPage(spec: AdwTabViewPageSpec, parentId: string | null = null): number {
        return this._state.addPage(this._withPanel(spec), parentId);
    }

    insertPage(spec: AdwTabViewPageSpec, position: number): number {
        return this._state.insertPage(this._withPanel(spec), position);
    }

    prependPage(spec: AdwTabViewPageSpec): number {
        return this._state.prependPage(this._withPanel(spec));
    }

    appendPage(spec: AdwTabViewPageSpec): number {
        return this._state.appendPage(this._withPanel(spec));
    }

    insertPinnedPage(spec: AdwTabViewPageSpec, position: number): number {
        return this._state.insertPinnedPage(this._withPanel(spec), position);
    }

    prependPinnedPage(spec: AdwTabViewPageSpec): number {
        return this._state.prependPinnedPage(this._withPanel(spec));
    }

    appendPinnedPage(spec: AdwTabViewPageSpec): number {
        return this._state.appendPinnedPage(this._withPanel(spec));
    }

    /** Pin or unpin a page, re-ordering it in the same step. Returns its new position. */
    setPagePinned(id: string, pinned: boolean): number {
        return this._state.setPagePinned(id, pinned);
    }

    /**
     * Request a close. Dispatches a CANCELABLE `close-page`; calling
     * `preventDefault()` on it holds the page open until {@link closePageFinish}.
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
    detachPage(id: string): AdwTabViewPage | null {
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

    private _adoptDeclaredPage(pageEl: AdwTabPage): void {
        // The declared element IS the panel — attributes stay live on it, which
        // is what makes `<adw-tab-page title>` observable at all.
        const spec: AdwTabViewPageSpec = {
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
    private _withPanel(spec: AdwTabViewPageSpec): AdwTabViewPageSpec {
        const content = spec.content ?? document.createElement('adw-tab-page');
        content.classList.add('adw-tab-page');
        content.setAttribute('role', 'tabpanel');
        content.dataset.pageId = spec.id;
        return { ...spec, content };
    }

    private _nextId(): string {
        // Monotonic and never reused: an id is the stand-in for a page POINTER,
        // so recycling one would silently alias a closed tab to a new one.
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

    private _insertTab(page: AdwTabViewPage, position: number): void {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'adw-tab';
        tab.setAttribute('role', 'tab');
        tab.dataset.pageId = page.id;

        // Decorative mask-image nodes — <gtk-image> carries the convention, including the
        // `-symbolic` strip, which is ours and not C's: there the name reaches
        // `GtkImage` untouched.
        const icon = createGtkImage(null, 'adw-tab-icon');
        tab.appendChild(icon);

        // `AdwTabPage:loading` swaps the icon image for an `AdwSpinnerPaintable` — the
        // SAME paintable `Adw.Spinner` uses (`update_icons`). So this is a real
        // `<adw-spinner>` in the icon's slot, not a ring drawn again in CSS: a CSS copy
        // inherits every spinner defect independently.
        const spinner = document.createElement('adw-spinner');
        spinner.className = 'adw-tab-spinner';
        spinner.setAttribute('size', '16');
        spinner.hidden = true;
        tab.appendChild(spinner);

        const label = document.createElement('span');
        label.className = 'adw-tab-title';
        tab.appendChild(label);

        tab.appendChild(createGtkImage(null, 'adw-tab-indicator'));

        // Close affordance — a small flat button drawn with a CSS "×" glyph. NOT because
        // the glyph is unavailable: `window-close` is in the ICONS map and has a mask class
        // (the comment that used to stand here said otherwise, and was read by two more
        // widgets). It is a SIZING difference — upstream's close button is 24px around a
        // 16px symbolic (adw-tab.ui:77), this strip's chip budgets 18px, and a 16px-grid
        // symbolic scaled into it is a design change, not a rename.
        // `can-focus=False` in C, so it stays out of the tab order here too.
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'adw-tab-close';
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

        this._tabBoxEl.insertBefore(tab, this._tabBoxEl.children[position] ?? null);
        this._tabs.set(page.id, tab);

        const panel = page.content;
        if (panel) {
            this._panels.set(page.id, panel);
            this._pagesEl.insertBefore(panel, this._pagesEl.children[position] ?? null);
        }
        this._refreshTab(page.id);
    }

    private _moveTab(id: string, position: number): void {
        const tab = this._tabs.get(id);
        if (tab) {
            tab.remove();
            this._tabBoxEl.insertBefore(tab, this._tabBoxEl.children[position] ?? null);
        }
        const panel = this._panels.get(id);
        if (panel) {
            panel.remove();
            this._pagesEl.insertBefore(panel, this._pagesEl.children[position] ?? null);
        }
    }

    private _refreshTab(id: string): void {
        const page = this._state.getPage(id);
        const tab = this._tabs.get(id);
        if (!page || !tab) return;

        const label = tab.querySelector('.adw-tab-title') as HTMLElement | null;
        if (label) label.textContent = page.title;
        // The tooltip is Pango MARKUP when the page sets one of its own. The DOM `title`
        // attribute is a TEXT sink, so the markup is shown verbatim rather than pushed
        // through an HTML sink — interpreting it would execute page-supplied markup.
        tab.title = tabTooltip(page);
        tab.classList.toggle('pinned', page.pinned);
        tab.classList.toggle('needs-attention', page.needsAttention);
        tab.classList.toggle('closing', page.closing);

        const icons = tabIconState(page, this.getAttribute('default-icon'));
        const icon = tab.querySelector('.adw-tab-icon') as GtkImage | null;
        if (icon) {
            icon.iconName = icons.icon;
            // The two occupy the same slot and are never both visible: C
            // REPLACES the image's contents rather than stacking a second node.
            icon.hidden = !icons.iconVisible || icons.spinner;
        }
        const spinner = tab.querySelector('.adw-tab-spinner') as HTMLElement | null;
        // The spinner is mounted only while it spins, so an idle tab holds no
        // element in the shared rAF ticker.
        if (spinner) spinner.hidden = !(icons.spinner && icons.iconVisible);
        const indicator = tab.querySelector('.adw-tab-indicator') as GtkImage | null;
        if (indicator) {
            indicator.iconName = page.indicatorIcon;
            indicator.hidden = !icons.indicatorVisible;
        }
        this._refreshCloseVisibility(id);
    }

    /**
     * `get_tab_position` in the BAR's scroll space: how far the chip sits from the
     * strip's scroll origin, the one coordinate both `scroll_to_tab_full` and
     * `update_visible` compare against the adjustment.
     *
     * Never `offsetLeft`. Nothing in this widget is positioned, so a chip's offsetParent
     * is whichever positioned ancestor the HOST page happens to have; a tab view that
     * merely sits indented then measured every chip against the wrong origin and
     * reported all of them clipped.
     */
    private _tabPosition(tab: HTMLElement): number {
        return tab.getBoundingClientRect().left - this._barEl.getBoundingClientRect().left + this._barEl.scrollLeft;
    }

    /**
     * `tabCloseVisible`, with its pinned gate. `dragging` is constantly false — tab
     * drag-and-drop is compositor work and is not modelled — and `fullyVisible` is
     * measured against the bar's scroll window, which is what the C term means for a
     * horizontally scrolled bar.
     */
    private _refreshCloseVisibility(id: string): void {
        const page = this._state.getPage(id);
        const tab = this._tabs.get(id);
        if (!page || !tab) return;
        const close = tab.querySelector('.adw-tab-close') as HTMLElement | null;
        if (!close) return;

        const barLeft = this._barEl.scrollLeft;
        const pos = this._tabPosition(tab);
        // `update_visible` (adw-tab-box.c:769-797). C also demands SPACING of slack on
        // both sides; that term is deliberately NOT transplanted, because it is not
        // slack there either: the allocation loop starts the first tab at `pos = SPACING`
        // and puts SPACING between tabs (:3270-3286), so `pos - SPACING >= value` is
        // exactly "flush against the leading edge". This strip has no such gaps, so the
        // same term would report the first chip clipped and hide its close button.
        const fullyVisible = pos >= barLeft && pos + tab.offsetWidth <= barLeft + this._barEl.clientWidth;
        close.hidden = !tabCloseVisible({
            hovering: this._hovered.has(id),
            fullyVisible,
            selected: this._state.selectedId === id,
            dragging: false,
            pinned: page.pinned,
        });
    }

    private _onSelectionChange(change: TabViewSelectionChange): void {
        this._applyActiveState();
        this._scrollSelectedTabIntoBar();
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
     * `scroll_to_tab_full` (adw-tab-box.c:928-961), called on every selection the way
     * `select_page` calls it (:1728): bring the selected chip inside the BAR's own
     * scroll window, padded by half of whichever is smaller, the chip or the leftover.
     *
     * The bar is the only thing C ever scrolls for a tab: `scroll_to_tab_full` writes
     * `self->adjustment`, the strip's own adjustment, and nothing else. The DOM has no
     * such narrow API: `focus()` and `scrollIntoView()` both walk EVERY scrollable
     * ancestor up to the window. So this moves `scrollLeft` by hand, and the focus call
     * below passes `preventScroll`.
     */
    private _scrollSelectedTabIntoBar(): void {
        const id = this._state.selectedId;
        const tab = id === null ? undefined : this._tabs.get(id);
        if (!tab) return;
        const pageSize = this._barEl.clientWidth;
        const width = tab.offsetWidth;
        // Unmeasured (detached, or still inside connectedCallback): nothing to scroll to.
        if (pageSize <= 0 || width <= 0) return;

        const value = this._barEl.scrollLeft;
        const pos = this._tabPosition(tab);
        const padding = Math.min(width, pageSize - width) / 2;
        if (pos - TAB_SPACING < value) this._barEl.scrollLeft = pos - padding;
        else if (pos + width + TAB_SPACING > value + pageSize)
            this._barEl.scrollLeft = pos + width + padding - pageSize;
    }

    private _applyBarVisibility(): void {
        const revealed = tabsRevealed({
            autohide: this.autohide,
            nPages: this._state.nPages,
            nPinnedPages: this._state.nPinnedPages,
            // Tab transfer between views is drag-and-drop, i.e. compositor work,
            // and is not modelled here.
            isTransferringPage: false,
        });
        this._barEl.hidden = !revealed;
        this._barEl.classList.toggle('single-tab', this._state.nPages <= 1);
    }

    private _reflectSelected(): void {
        this._reflecting = true;
        const index = this._state.selectedIndex;
        if (index < 0) this.removeAttribute('selected');
        else if (this.getAttribute('selected') !== String(index)) this.setAttribute('selected', String(index));
        this._reflecting = false;
    }

    private _applySelectedAttribute(value: string): void {
        const index = Number.parseInt(value, 10);
        // An unparseable value is IGNORED rather than treated as 0, and an out-of-range
        // one is refused rather than clamped: libadwaita refuses both, so
        // `selected="oops"` must not select the first page nor `selected="99"` the last.
        if (Number.isNaN(index)) return;
        this._state.selectNthPage(index);
    }

    /**
     * The `Adw.TabView` shortcut table (`init_shortcuts`), plus the ArrowLeft/ArrowRight
     * movement `role=tablist` promises. Ctrl+Tab WRAPS and Ctrl+Page-Up/Down does not —
     * the same `last` flag that separates them in `select_page_cb`. Alt+0 is page index
     * 9, because pages count from 0.
     */
    private _onKeyDown(event: KeyboardEvent): void {
        const inBar = event.target instanceof Node && this._barEl.contains(event.target);
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
            handled = event.key === 'Home' ? this._state.selectFirstPage() : this._state.selectLastPage();
        } else if (event.altKey && /^[0-9]$/.test(event.key)) {
            const digit = Number.parseInt(event.key, 10);
            handled = this._state.selectNthPage(digit === 0 ? 9 : digit - 1);
        } else if (inBar && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            handled = event.key === 'ArrowLeft' ? this._state.selectPreviousPage() : this._state.selectNextPage();
        } else if (inBar && (event.key === 'Home' || event.key === 'End')) {
            handled = event.key === 'Home' ? this._state.selectFirstPage() : this._state.selectLastPage();
        }

        if (!handled) return;
        event.preventDefault();
        // Roving tabindex: the newly-active tab is the only focusable one, so
        // focus has to travel with it or the next keypress goes nowhere.
        //
        // `preventScroll` because a bare `focus()` scrolls every scrollable ancestor
        // up to and including the WINDOW, while C only ever moves the tab strip
        // (`scroll_to_tab_full` writes `self->adjustment`, adw-tab-box.c:928-961).
        // Measured in a long documentation page: one ArrowRight took the window from
        // y=1800 to y=8367, i.e. switching a tab yanked the whole document to the widget.
        // `_scrollSelectedTabIntoBar` (already run by the selection change) is the
        // strip-local scroll that is supposed to happen instead.
        if (inBar) {
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
    private _requestClose(page: AdwTabViewPage): boolean | 'defer' {
        const proceed = this.dispatchEvent(
            new CustomEvent('close-page', {
                bubbles: true,
                cancelable: true,
                detail: { index: this._state.getPagePosition(page.id), id: page.id },
            }),
        );
        return proceed ? !page.pinned : 'defer';
    }
}

// The VIEW first, and the order carries weight: `define` upgrades every matching
// element already in the document, immediately. Registering the page first therefore
// upgraded every declared `<adw-tab-page>` while its `<adw-tab-view>` parent was still
// un-upgraded, and `AdwTabPage.attributeChangedCallback` reaches for that parent.
// Parent before child keeps the window shut; the `instanceof` guard in the callback is
// what holds when something outside this file reopens it — and because the guard makes
// the order UNOBSERVABLE (with it in place, page-first renders identically and every
// test still passes, measured), the order itself is held by
// `scripts/check-adwaita-upgrade-order.mjs` rather than by a spec.
customElements.define('adw-tab-view', AdwTabView);
customElements.define('adw-tab-page', AdwTabPage);
