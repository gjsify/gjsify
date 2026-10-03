// <adw-tab-overview> — the grid of tab THUMBNAILS that covers an `<adw-tab-view>`
// (the web counterpart of Adw.TabOverview). Closed, it is just the view: the
// overview is a second surface stacked on top of the `child`, and `open` decides
// which one you see.
//
// The DOM is adw-tab-overview.ui, node for node: an `AdwBin` (`child_bin`) holding
// the child, and an `AdwToolbarView` (`.overview`) over it with an `AdwHeaderBar`,
// a `GtkSearchBar`, and a `GtkOverlay` content holding a scrolled pair of
// `AdwTabGrid`s — `pinned_grid` and `grid` — plus the two empty-state `AdwStatusPage`s
// and the new-tab button.
//
// THE RULES THAT ARE C AND NOT MARKUP:
//
//   · `notify_n_pages_cb` (:951-971): the title is `dngettext ("%u Tab", "%u Tabs",
//     n_pages)` — a PLURAL, so 1 reads "1 Tab" and 0 reads "0 Tabs" — and `''` when
//     there is no view at all.
//   · `update_header_bar` (:816-826): the header bar is hidden unless search is
//     enabled OR a secondary menu is set OR one of the two title-button sides is.
//   · `empty_changed_cb` (:805-814): EMPTY is both grids empty, and WHICH empty state
//     shows is the search: "No Open Tabs" with it off, "No Tabs Found" with it on.
//   · `search_changed_cb` / `stop_search_cb` (:846-880): the terms go to BOTH grids
//     and `search-active` is simply "the entry is non-empty", never a mode flag.
//   · `search_activated_cb` (:884-893) and `adw_tab_overview_focus` (:1343-1405):
//     Enter in the search entry, and Down out of the search button or the entry, go to
//     the FIRST row of `pinned_grid` and only then to `grid`'s; Down out of the
//     secondary-menu button goes to the LAST row instead.
//   · `activated_cb` in the grid (adw-tab-grid.c:3005-3006): activating a thumbnail
//     selects the page and CLOSES the overview. Middle-click closes the page instead,
//     and the close button defers to an idle so the click is not eaten mid-animation.
//   · `update_new_tab_button` (:828-832): the new-tab button hides while searching.
//   · `new_tab_clicked_cb` (:911-926): select the new page, close, focus its child.
//
// NOT PORTED, and why it is not "unverifiable":
//   · THUMBNAIL REORDERING BY DRAG. `AdwTabGrid`'s reordering is `GtkDropTarget` +
//     `GtkDragSource` compositor work on a `GdkPaintable`, and it is refused outright
//     while searching (adw-tab-grid.c:1526, :2206). This port moves pages through
//     `Adw.TabView`'s reorder API instead, the same way the tab bar does.
//   · THE EXTRA DROP TARGET (`setup_extra_drop_target`, :1749). It is a GDK drag
//     protocol over foreign content; a browser has no equivalent, so `extra-drag-preload`
//     and `extra-drag-preferred-action` are read-only reports that never change here.
//   · THE OPEN ANIMATION. `AdwTabOverview` interpolates between the view's bounds and
//     the selected thumbnail's (:1077-1210) with a `GdkPaintable` snapshot of the page
//     as the transition picture. The browser has no way to paint a widget into a
//     texture, so the portrait area of a thumbnail stands in with the page's own
//     icon and title, and opening is a CSS transition on the same surface.
//
// `view` is a widget REFERENCE (`Adw.TabView`), so the attribute is the element id
// `<adw-tab-button view>` also takes, while `view`/`setView` take the element.
// `secondary-menu` is a `GMenuModel`: the property takes the portable model and the
// attribute takes its JSON, which is `<gtk-menu-button menu-model>`'s own spelling.
//
// A11Y: the overview is a `role="grid"` of `role="gridcell"` thumbnails under a
// header bar, and the pinned grid is a second grid — C's `AdwTabGrid` is a
// `GtkWidget` with `GTK_ORIENTATION_HORIZONTAL` and one focusable cell at a time.
//
// KNOWN_GAPS: none — `view`, `child` and `secondary-menu` are widget-typed and not
// attributes; the seven scalar properties below are all observed.
//
// Reference: refs/libadwaita/src/adw-tab-overview.c (title, empty states, search,
//   actions, focus, new tab)
// Reference: refs/libadwaita/src/adw-tab-overview.ui (the template this DOM copies)
// Reference: refs/libadwaita/src/adw-tab-grid.c (activated, search filters, reorder gate)
// Reference: refs/libadwaita/src/adw-tab-thumbnail.c (close/unpin/indicator, tooltip)
// Reference: refs/libadwaita/src/stylesheet/widgets/_tab-view.scss:187-300 (tabthumbnail,
//   taboverview > .overview)
// Reference: refs/gtk/gtk/gtkstringfilter.c:70-138 (the search predicate)
// Copyright (c) 2021-2022 Purism SPC / GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the icon,
// indicator and portrait nodes are <gtk-image> and the grids are <div role="grid">.

import { tabSearchMatches, tabTooltip, type AdwMenuInput, type AdwMenuModel } from '@gjsify/adwaita-core';
import { normalizeMenuModel } from '@gjsify/adwaita-core';
import { assertMenuRenderable, ADW_MENU_SURFACE_WEB } from '@gjsify/adwaita-core';

import type { AdwTabView, AdwTabViewPage } from './adw-tab-view.js';
import { createGtkImage, type GtkImage } from './gtk-image.js';

/** The thumbnail nodes of one page, kept so a re-render edits them in place. */
interface Thumbnail {
    root: HTMLDivElement;
    label: HTMLSpanElement;
    icon: HTMLElement;
    /** The `<adw-spinner>` that has replaced the icon, or null — they share one slot. */
    spinner: HTMLElement | null;
    picture: HTMLDivElement;
    portrait: HTMLSpanElement;
    closeBtn: HTMLButtonElement;
    unpinIcon: HTMLElement;
    indicatorBtn: HTMLButtonElement;
    indicatorIcon: HTMLElement;
    attention: HTMLDivElement;
}

export class AdwTabOverview extends HTMLElement {
    private _childEl!: HTMLDivElement;
    private _overviewEl!: HTMLDivElement;
    private _headerEl!: HTMLDivElement;
    private _startButtonsEl!: HTMLDivElement;
    private _endButtonsEl!: HTMLDivElement;
    private _titleEl!: HTMLElement;
    private _searchBtn!: HTMLButtonElement;
    private _searchEntry!: HTMLInputElement;
    private _searchClamp!: HTMLDivElement;
    private _searchBar!: HTMLDivElement;
    private _menuBtn!: HTMLElement;
    private _gridEl!: HTMLDivElement;
    private _pinnedGridEl!: HTMLDivElement;
    private _emptyState!: HTMLElement;
    private _searchEmptyState!: HTMLElement;
    private _newTabBtn!: HTMLButtonElement;
    private readonly _thumbs = new Map<string, Thumbnail>();

    private _view: AdwTabView | null = null;
    private _model: AdwMenuModel = [];
    private _searchActive = false;
    private _initialized = false;
    /** The last visibility actually painted, so `notify::open` fires on a real change. */
    private _appliedOpen = false;
    /** Guards the `open` attribute we write ourselves from re-entering `setOpen`. */
    private _reflecting = false;

    static get observedAttributes() {
        return [
            'view',
            'open',
            'inverted',
            'enable-search',
            'enable-new-tab',
            'secondary-menu',
            'show-start-title-buttons',
            'show-end-title-buttons',
            'extra-drag-preload',
        ];
    }

    // --- Adw.TabOverview properties ------------------------------------------

    /** `Adw.TabOverview:view` — the tab view the overview controls. */
    get view(): AdwTabView | null {
        return this._view;
    }

    set view(value: AdwTabView | string | null) {
        this.setView(value === null ? null : typeof value === 'string' ? this._resolveView(value) : value);
    }

    /**
     * `adw_tab_overview_set_view`: rebind the view's five signals, then repopulate.
     * The view must be INSIDE the overview (adw-tab-overview.c:1090-1093 refuses
     * otherwise), which the element enforces by looking the view up among its own
     * children when the reference is not a live element.
     */
    setView(view: AdwTabView | null): void {
        if (this._view === view) return;
        this._unbindView();
        this._view = view;
        this._bindView();
        if (this._initialized) this._syncAll();
        this.dispatchEvent(new CustomEvent('notify::view', { bubbles: true, detail: { view } }));
    }

    /**
     * `Adw.TabOverview:child` — the widget the overview covers. Declared children are
     * it: there is one slot in the template and it holds whatever the author wrote.
     */
    get child(): HTMLElement | null {
        return this._childEl.firstElementChild as HTMLElement | null;
    }

    /** `Adw.TabOverview:open` — whether the overview is showing. */
    get open(): boolean {
        return this.hasAttribute('open');
    }

    set open(value: boolean) {
        this.setOpen(value);
    }

    /**
     * Whether the thumbnails use the INVERTED layout: the close/unpin button at the
     * START and the indicator at the END, rather than the other way round
     * (adw-tab-overview.c:1626-1634).
     */
    get inverted(): boolean {
        return this.hasAttribute('inverted');
    }

    set inverted(value: boolean) {
        this.toggleAttribute('inverted', value);
    }

    /**
     * `Adw.TabOverview:enable-search`, TRUE upstream — and so `="false"` is the off
     * switch, absent meaning on. The same MODIFICATION `<adw-carousel>` makes for
     * `allow-scroll-wheel`: an HTML boolean attribute can only mean TRUE.
     */
    get enableSearch(): boolean {
        return this.getAttribute('enable-search') !== 'false';
    }

    set enableSearch(value: boolean) {
        this.setAttribute('enable-search', String(value));
    }

    /** `Adw.TabOverview:search-active` — read-only upstream, and read-only here. */
    get searchActive(): boolean {
        return this._searchActive;
    }

    /** `Adw.TabOverview:enable-new-tab`. */
    get enableNewTab(): boolean {
        return this.hasAttribute('enable-new-tab');
    }

    set enableNewTab(value: boolean) {
        this.toggleAttribute('enable-new-tab', value);
    }

    /** `Adw.TabOverview:secondary-menu` — the portal menu of extra actions. */
    get secondaryMenu(): AdwMenuModel {
        return this._model;
    }

    set secondaryMenu(value: AdwMenuInput) {
        const model = normalizeMenuModel(value);
        // The property setter is a CALL, so a `custom` item throws here where the caller
        // can catch it — `<gtk-menu-button>`'s own rule, which keeps the two doors honest.
        assertMenuRenderable(model, ADW_MENU_SURFACE_WEB);
        this._model = model;
        this._applyMenu();
    }

    /** `Adw.TabOverview:show-start-title-buttons`, TRUE upstream, so `="false"` turns it off. */
    get showStartTitleButtons(): boolean {
        return this.getAttribute('show-start-title-buttons') !== 'false';
    }

    set showStartTitleButtons(value: boolean) {
        this.setAttribute('show-start-title-buttons', String(value));
    }

    /** `Adw.TabOverview:show-end-title-buttons`, TRUE upstream, so `="false"` turns it off. */
    get showEndTitleButtons(): boolean {
        return this.getAttribute('show-end-title-buttons') !== 'false';
    }

    set showEndTitleButtons(value: boolean) {
        this.setAttribute('show-end-title-buttons', String(value));
    }

    /**
     * `Adw.TabOverview:extra-drag-preload`. Stored and reported; it gates the GDK drag
     * protocol this port does not have (see the header).
     */
    get extraDragPreload(): boolean {
        return this.hasAttribute('extra-drag-preload');
    }

    set extraDragPreload(value: boolean) {
        this.toggleAttribute('extra-drag-preload', value);
    }

    /** `Adw.TabOverview:extra-drag-preferred-action` — always 0 here, for the same reason. */
    get extraDragPreferredAction(): number {
        return 0;
    }

    // --- The C actions -------------------------------------------------------

    /**
     * The `overview.open` action (`overview_open_cb`, adw-tab-overview.c:1517-1521),
     * with `update_actions`' enabled rule: closed AND holding a view (:816-826).
     */
    activateOverviewOpen(): boolean {
        if (this.open || this._view === null) return false;
        this.setOpen(true);
        return true;
    }

    /**
     * The `overview.close` action (`overview_close_cb`, :1523-1527): open, holding a
     * view, and holding at least one page — an empty overview has nothing to close to.
     */
    activateOverviewClose(): boolean {
        if (!this.open || this._view === null || this._view.nPages === 0) return false;
        this.setOpen(false);
        return true;
    }

    // --- Lifecycle -----------------------------------------------------------

    connectedCallback() {
        if (this._initialized) {
            // Re-entering the document: `disconnectedCallback` dropped the listeners.
            this._bindView();
            this._syncAll();
            return;
        }
        this._initialized = true;

        this._childEl = document.createElement('div');
        this._childEl.className = 'adw-tab-overview-child';
        this._overviewEl = document.createElement('div');
        this._overviewEl.className = 'overview adw-tab-overview-toolbar';

        this._headerEl = document.createElement('div');
        this._headerEl.className = 'adw-header-bar overview-header-bar';
        this._startButtonsEl = document.createElement('div');
        this._startButtonsEl.className = 'overview-title-buttons start';
        this._endButtonsEl = document.createElement('div');
        this._endButtonsEl.className = 'overview-title-buttons end';

        this._searchBtn = document.createElement('button');
        this._searchBtn.type = 'button';
        this._searchBtn.className = 'adw-button image-button search-button';
        this._searchBtn.title = 'Search Tabs';
        this._searchBtn.appendChild(createGtkImage('system-search', 'search-button-icon'));

        this._titleEl = document.createElement('div');
        this._titleEl.className = 'adw-window-title numeric overview-title';

        this._menuBtn = document.createElement('gtk-menu-button');
        this._menuBtn.setAttribute('icon-name', 'view-more');
        this._menuBtn.className = 'secondary-menu-button';
        this._menuBtn.hidden = true;

        this._headerEl.append(this._startButtonsEl, this._searchBtn, this._titleEl, this._endButtonsEl, this._menuBtn);

        // `AdwClamp > GtkSearchEntry`, wrapped in the `GtkSearchBar` whose revealer is
        // `search-mode-enabled` — bound to the search button in the template (:42).
        this._searchBar = document.createElement('div');
        this._searchBar.className = 'adw-search-bar overview-search-bar';
        this._searchClamp = document.createElement('div');
        this._searchClamp.className = 'adw-clamp overview-search-clamp';
        this._searchEntry = document.createElement('input');
        this._searchEntry.type = 'search';
        this._searchEntry.className = 'adw-entry overview-search-entry';
        this._searchEntry.placeholder = 'Search tabs';
        this._searchEntry.setAttribute('aria-label', 'Search tabs');
        this._searchClamp.appendChild(this._searchEntry);
        this._searchBar.appendChild(this._searchClamp);

        const content = document.createElement('div');
        content.className = 'adw-tab-overview-content';

        const scroll = document.createElement('div');
        scroll.className = 'adw-tab-overview-scroll';
        this._pinnedGridEl = this._createGrid('adw-tab-grid pinned-grid', 'Pinned tabs');
        this._gridEl = this._createGrid('adw-tab-grid', 'Open tabs');
        scroll.append(this._pinnedGridEl, this._gridEl);

        this._emptyState = document.createElement('adw-status-page');
        this._emptyState.className = 'overview-empty-state';
        this._emptyState.setAttribute('icon', 'view-grid');
        this._emptyState.setAttribute('title', 'No Open Tabs');
        this._emptyState.hidden = true;

        this._searchEmptyState = document.createElement('adw-status-page');
        this._searchEmptyState.className = 'overview-search-empty-state';
        this._searchEmptyState.setAttribute('icon', 'system-search');
        this._searchEmptyState.setAttribute('title', 'No Tabs Found');
        this._searchEmptyState.setAttribute('description', 'Try a different search');
        this._searchEmptyState.hidden = true;

        this._newTabBtn = document.createElement('button');
        this._newTabBtn.type = 'button';
        this._newTabBtn.className = 'adw-button pill suggested-action new-tab-button';
        this._newTabBtn.append(createGtkImage('list-add', 'new-tab-button-icon'), document.createTextNode('New Tab'));

        content.append(scroll, this._emptyState, this._searchEmptyState, this._newTabBtn);
        this._overviewEl.append(this._headerEl, this._searchBar, content);

        // The declared children become the `child`; the overview is built around them.
        const declared = Array.from(this.children) as HTMLElement[];
        this.replaceChildren(this._childEl, this._overviewEl);
        for (const el of declared) this._childEl.appendChild(el);

        // `key-capture-widget` is the overview itself (adw-tab-overview.ui:43), which is
        // where a printable key goes when the entry has focus.
        this._searchEntry.addEventListener('input', () => this._onSearchChanged());
        this._searchEntry.addEventListener('keydown', (event) => this._onSearchKeyDown(event));
        this._searchBtn.addEventListener('click', () => this._toggleSearchMode());
        this._newTabBtn.addEventListener('click', () => this._requestCreateTab());
        this.addEventListener('keydown', (event) => this._onKeyDown(event));

        // `set_view`'s own connection order: the header bar, then the view.
        const declaredView = this.getAttribute('view');
        this.setView(declaredView === null ? this._findView() : this._resolveView(declaredView));
        if (declaredView !== null) this.removeAttribute('view');

        const declaredMenu = this.getAttribute('secondary-menu');
        if (declaredMenu !== null) {
            this.secondaryMenu = JSON.parse(declaredMenu) as AdwMenuInput;
            this.removeAttribute('secondary-menu');
        }

        this._applyOpen();
        this._syncAll();
    }

    disconnectedCallback() {
        this._unbindView();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        switch (name) {
            case 'view':
                this.setView(value === null ? this._findView() : this._resolveView(value));
                return;
            case 'open':
                if (!this._reflecting) this._applyOpen();
                return;
            case 'secondary-menu': {
                if (value === null) return;
                // An attribute is MARKUP: a `custom` item here is reported, not thrown
                // (adw-sidebar/`gtk-menu-button`'s rule for the same two doors).
                try {
                    this.secondaryMenu = JSON.parse(value) as AdwMenuInput;
                } catch (error) {
                    console.error(`<adw-tab-overview secondary-menu> is not valid JSON: ${String(error)}`);
                }
                return;
            }
            case 'enable-new-tab':
                this._applyNewTabButton();
                return;
            case 'inverted':
                // The overview's `inverted` reaches each thumbnail through
                // `adw_tab_thumbnail_set_inverted`, so the grid re-renders here.
                this._syncGrids();
                return;
            case 'enable-search':
            case 'show-start-title-buttons':
            case 'show-end-title-buttons':
                this._applyHeaderBar();
                return;
        }
        // `inverted` and `extra-drag-preload` are read by the stylesheet and reported.
    }

    // --- View wiring ---------------------------------------------------------

    private _resolveView(ref: string): AdwTabView | null {
        return (document.getElementById(ref) as AdwTabView | null) ?? this._findView();
    }

    /** The `AdwTabView` among our own children — the only place the C allows one. */
    private _findView(): AdwTabView | null {
        return this.querySelector('adw-tab-view') as AdwTabView | null;
    }

    /**
     * `set_view`'s five connections (adw-tab-overview.c:1140-1209), read off the view's
     * own events: the page list's attach/detach/reorder, each page's `pinned` change,
     * the selection, and the page COUNT (which the title and the actions are derived
     * from). The pinned page change arrives as `page-updated` / `page-pinned`.
     */
    private _bindView(): void {
        this._unbindView();
        for (const type of VIEW_EVENTS) this._view?.addEventListener(type, this._onViewChange);
    }

    private _unbindView(): void {
        for (const type of VIEW_EVENTS) this._view?.removeEventListener(type, this._onViewChange);
    }

    private _onViewChange = (): void => {
        this._syncAll();
    };

    // --- Derivation ----------------------------------------------------------

    private _syncAll(): void {
        this._applyTitle();
        this._syncGrids();
        this._applyEmptyStates();
        this._applyNewTabButton();
        this._applyHeaderBar();
    }

    /**
     * `notify_n_pages_cb`: `dngettext ("%u Tab", "%u Tabs", n_pages)` — the count is
     * the number of pages, and the singular is only for exactly one. No view means an
     * EMPTY title, which is the C's own branch before the format string (:955-958).
     */
    private _applyTitle(): void {
        const view = this._view;
        this._titleEl.textContent = view === null ? '' : view.nPages === 1 ? '1 Tab' : `${view.nPages} Tabs`;
    }

    /**
     * The two grids, split the way `populate_sidebar`-shaped code splits them: pinned
     * pages in `pinned_grid` in view order, the rest in `grid`, each filtered by the
     * current search terms. Thumbnails are edited in place; a page that left either
     * grid loses its node.
     */
    private _syncGrids(): void {
        const view = this._view;
        const terms = this._searchActive ? this._searchEntry.value : '';
        const seen = new Set<string>();
        const pinned: HTMLElement[] = [];
        const rest: HTMLElement[] = [];

        if (view !== null) {
            for (const page of view.pages) {
                const matches = tabSearchMatches(page, terms);
                if (!matches) {
                    this._thumbs.get(page.id)?.root.remove();
                    this._thumbs.delete(page.id);
                    continue;
                }
                seen.add(page.id);
                const thumb = this._thumbFor(page.id);
                this._refreshThumb(thumb, page);
                (page.pinned ? pinned : rest).push(thumb.root);
            }
        }
        for (const [id, thumb] of this._thumbs) {
            if (seen.has(id)) continue;
            thumb.root.remove();
            this._thumbs.delete(id);
        }

        this._pinnedGridEl.replaceChildren(...pinned);
        this._gridEl.replaceChildren(...rest);
        this._pinnedGridEl.hidden = pinned.length === 0;
    }

    /**
     * `empty_changed_cb`: EMPTY is BOTH grids empty, and which of the two status pages
     * shows is the search — `empty_state` when it is off, `search_empty_state` when on.
     */
    private _applyEmptyStates(): void {
        const empty = this._pinnedGridEl.childElementCount === 0 && this._gridEl.childElementCount === 0;
        this._emptyState.hidden = !(empty && !this._searchActive);
        this._searchEmptyState.hidden = !(empty && this._searchActive);
    }

    /** `update_new_tab_button`: the button hides while the search is running. */
    private _applyNewTabButton(): void {
        this._newTabBtn.hidden = !(this.enableNewTab && !this._searchActive);
    }

    /**
     * `update_header_bar`: the bar shows when search is on, or a secondary menu is set,
     * or either side wants its title buttons. The two sides are drawn as the slots C
     * puts the window buttons in — this renderer has no window chrome to move, so the
     * slot is where an application puts its own controls.
     */
    private _applyHeaderBar(): void {
        const hasMenu = this._model.length > 0;
        this._headerEl.hidden = !(
            this.enableSearch ||
            hasMenu ||
            this.showStartTitleButtons ||
            this.showEndTitleButtons
        );
        this._startButtonsEl.hidden = !this.showStartTitleButtons;
        this._endButtonsEl.hidden = !this.showEndTitleButtons;
        this._searchBtn.hidden = !this.enableSearch;
        this._searchBar.hidden = !this.enableSearch || !this._searchMode;
        this._menuBtn.hidden = !hasMenu;
    }

    private _applyMenu(): void {
        const view = this._menuBtn as HTMLElement & { menuModel?: AdwMenuModel };
        if (this._model.length > 0) view.menuModel = this._model;
        this._applyHeaderBar();
    }

    /** `set_open` + `set_overview_visible` (:916-939): one visibility, two surfaces. */
    private _applyOpen(): void {
        const open = this.open;
        this._overviewEl.hidden = !open;
        this._childEl.classList.toggle('background', open);
        // `can_target` / `can_focus` on the bin while the overview is up — the browser's
        // `inert`, which is the same statement in CSS.
        this._childEl.inert = open;

        if (open === this._appliedOpen) return;
        this._appliedOpen = open;

        this._reflecting = true;
        if (open) {
            if (!this.hasAttribute('open')) this.setAttribute('open', '');
        } else if (this.hasAttribute('open')) {
            // `open_animation_done_cb` (:1042-1067) turns the search bar off on CLOSE,
            // not on open, so a reopened overview starts from an empty entry.
            this._searchMode = false;
            this._setSearchActive(false);
            this._searchEntry.value = '';
            this.removeAttribute('open');
        }
        this._reflecting = false;
        this.dispatchEvent(new CustomEvent('notify::open', { bubbles: true, detail: { open } }));
    }

    /** `adw_tab_overview_set_open`, the setter the actions and the grid both call. */
    setOpen(open: boolean): void {
        if (this.open === open) return;
        // The ATTRIBUTE is the state, and `_applyOpen` reads it — so the write comes
        // first, and `_reflecting` keeps the resulting reaction from applying it twice.
        this._reflecting = true;
        this.toggleAttribute('open', open);
        this._reflecting = false;
        this._applyOpen();
        if (open) this._syncAll();
    }

    // --- Search --------------------------------------------------------------

    private _searchMode = false;

    /** The template's `search-mode-enabled` binding: the search BUTTON's own state. */
    private _toggleSearchMode(): void {
        this._searchMode = !this._searchMode;
        this._searchBar.hidden = !this.enableSearch || !this._searchMode;
        if (this._searchMode) this._searchEntry.focus();
        else this._stopSearch();
    }

    /**
     * `search_changed_cb`: the terms go to BOTH grids and `search-active` is just
     * "the entry is non-empty" — there is no separate mode to keep in step, which is why
     * `stop_search_cb` has to clear the entry itself before reporting FALSE.
     */
    private _onSearchChanged(): void {
        this._setSearchActive(this._searchEntry.value !== '');
        this._syncGrids();
        this._applyEmptyStates();
        this._applyNewTabButton();
    }

    private _stopSearch(): void {
        this._searchEntry.value = '';
        this._setSearchActive(false);
        this._syncGrids();
        this._applyEmptyStates();
        this._applyNewTabButton();
    }

    /** `set_search_active` (:838-852): assign, re-derive, and notify only on a change. */
    private _setSearchActive(active: boolean): void {
        if (active === this._searchActive) return;
        this._searchActive = active;
        this.dispatchEvent(
            new CustomEvent('notify::search-active', { bubbles: true, detail: { searchActive: active } }),
        );
    }

    /**
     * `search_activated_cb` (:884-893): Enter in the entry moves into the grid, and it
     * is the PINNED grid first, because it sits above `grid` in the scrolled window.
     */
    private _onSearchKeyDown(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            this._stopSearch();
            this._searchMode = false;
            this._searchBar.hidden = !this.enableSearch || !this._searchMode;
            return;
        }
        if (event.key !== 'Enter') return;
        if (!this._searchActive) return;
        if (this._focusFirstRow(this._pinnedGridEl) || this._focusFirstRow(this._gridEl)) event.preventDefault();
    }

    /**
     * `adw_tab_overview_focus` (:1343-1405), the parts the DOM can honour: the search
     * button and the entry go DOWN into the first row, the secondary-menu button goes
     * down to the LAST row, and the new-tab button goes UP to the last row of `grid`
     * first. GTK's focus is a widget returning TRUE for a direction; a browser moves the
     * focus itself, so this only names the destination.
     */
    private _onKeyDown(event: KeyboardEvent): void {
        if (!this.open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
        const target = event.target;
        if (!(target instanceof Node)) return;

        if (event.key === 'ArrowDown') {
            if (this._searchBar.contains(target) || this._searchBtn.contains(target)) {
                if (this._focusFirstRow(this._pinnedGridEl) || this._focusFirstRow(this._gridEl))
                    event.preventDefault();
                return;
            }
            if (this._menuBtn.contains(target)) {
                if (this._focusLastRow(this._pinnedGridEl) || this._focusLastRow(this._gridEl)) event.preventDefault();
                return;
            }
            // Out of the last grid and on to the new-tab button, and out of the pinned
            // grid when the ordinary grid is empty (adw-tab-overview.c:1387-1398).
            if (this._newTabBtn.contains(target)) return;
            if (
                (this._gridEl.contains(target) || this._pinnedGridEl.contains(target)) &&
                this._newTabBtn.hidden === false
            ) {
                event.preventDefault();
                this._newTabBtn.focus();
            }
            return;
        }
        if (this._newTabBtn.contains(target)) {
            if (this._focusLastRow(this._gridEl) || this._focusLastRow(this._pinnedGridEl)) event.preventDefault();
        }
    }

    private _focusFirstRow(grid: HTMLElement): boolean {
        const first = grid.querySelector<HTMLElement>('.adw-tab-thumbnail');
        if (first === null) return false;
        first.focus();
        return true;
    }

    private _focusLastRow(grid: HTMLElement): boolean {
        const rows = grid.querySelectorAll<HTMLElement>('.adw-tab-thumbnail');
        const last = rows[rows.length - 1];
        if (last === undefined) return false;
        last.focus();
        return true;
    }

    // --- New tab -------------------------------------------------------------

    /**
     * `create_tab` (:895-909) and `new_tab_clicked_cb` (:911-926).
     *
     * `create-tab`'s handler RETURNS a page, which a DOM event cannot do: `detail.page`
     * is the return slot, and a listener fills it (usually by appending to the view).
     * Nothing filled is C's `g_critical ("AdwTabOverview::create-tab handler must not
     * return NULL")`, reported on `console.error` because the click cannot be abandoned.
     */
    private _requestCreateTab(): void {
        const view = this._view;
        if (view === null) return;
        const detail: { page: AdwTabViewPage | null } = { page: null };
        this.dispatchEvent(new CustomEvent('create-tab', { bubbles: true, detail }));
        if (detail.page === null) {
            console.error('<adw-tab-overview>: the create-tab handler must not leave `detail.page` unset.');
            return;
        }
        view.setSelectedPage(detail.page.id);
        this.setOpen(false);
        detail.page.content?.focus?.();
    }

    // --- Thumbnails ----------------------------------------------------------

    private _createGrid(className: string, label: string): HTMLDivElement {
        const grid = document.createElement('div');
        grid.className = className;
        grid.setAttribute('role', 'grid');
        grid.setAttribute('aria-label', label);
        return grid;
    }

    /**
     * adw-tab-thumbnail.ui, node for node: the `.thumbnail` overlay over a `.card`
     * overlay holding the PICTURE, the close button, the unpin icon and the indicator
     * button, with the attention dot over that and the icon/title box underneath.
     */
    private _thumbFor(id: string): Thumbnail {
        const existing = this._thumbs.get(id);
        if (existing !== undefined) return existing;

        const root = document.createElement('div');
        root.className = 'adw-tab-thumbnail';
        root.dataset.pageId = id;
        root.setAttribute('role', 'gridcell');
        root.tabIndex = -1;

        const contents = document.createElement('div');
        contents.className = 'contents';

        const thumbnail = document.createElement('div');
        thumbnail.className = 'thumbnail';

        const card = document.createElement('div');
        card.className = 'card';

        // The PICTURE. GTK paints the page into a `GdkPaintable`
        // (`adw_tab_page_get_paintable`, adw-tab-thumbnail.c:620) — see the header for
        // why the browser cannot, and what stands in: the page's own icon and title.
        const picture = document.createElement('div');
        picture.className = 'picture';
        const portrait = document.createElement('span');
        portrait.className = 'picture-portrait';
        picture.appendChild(portrait);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'tab-close-button adw-button image-button';
        closeBtn.title = 'Close Tab';
        closeBtn.setAttribute('aria-label', 'Close Tab');
        closeBtn.tabIndex = -1;
        closeBtn.appendChild(createGtkImage('window-close', 'tab-close-icon'));

        // `adw-tab-unpin-symbolic` is a libadwaita-BUNDLED glyph (refs/libadwaita/src/icons/),
        // in neither the icon theme nor @gjsify/adwaita-icons — the same case the
        // <adw-entry-row> pencil is. The canonical name stays in `data-icon-name` and
        // the shape is drawn in CSS, so the substitution is legible in the DOM. It is a
        // real `<button>`, because `unpin_clicked_cb` is a clicked handler (:183-193).
        const unpinIcon = document.createElement('button');
        unpinIcon.type = 'button';
        unpinIcon.className = 'tab-unpin-icon';
        unpinIcon.tabIndex = -1;
        unpinIcon.title = 'Unpin Tab';
        unpinIcon.setAttribute('aria-label', 'Unpin Tab');
        unpinIcon.dataset.iconName = 'adw-tab-unpin-symbolic';

        const indicatorBtn = document.createElement('button');
        indicatorBtn.type = 'button';
        indicatorBtn.className = 'tab-indicator adw-button image-button';
        indicatorBtn.tabIndex = -1;
        const indicatorIcon = createGtkImage(null, 'tab-indicator-icon');
        indicatorBtn.appendChild(indicatorIcon);

        card.append(picture, closeBtn, unpinIcon, indicatorBtn);

        const attention = document.createElement('div');
        attention.className = 'needs-attention';
        const gizmo = document.createElement('div');
        gizmo.className = 'gizmo';
        attention.appendChild(gizmo);
        thumbnail.append(card, attention);

        const iconTitleBox = document.createElement('div');
        iconTitleBox.className = 'icon-title-box';
        const icon = createGtkImage(null, 'tab-icon');
        const label = document.createElement('span');
        label.className = 'tab-label';
        iconTitleBox.append(icon, label);

        contents.append(thumbnail, iconTitleBox);
        root.appendChild(contents);

        // `activated_cb` (adw-tab-grid.c:3005-3006): select the page, close the overview.
        root.addEventListener('click', () => {
            const view = this._view;
            if (view === null) return;
            view.setSelectedPage(id);
            this.setOpen(false);
        });
        // Middle click closes the page instead — the same line, one branch above.
        root.addEventListener('auxclick', (event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            this._view?.closePage(id);
        });
        closeBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            this._view?.closePage(id);
        });
        // `unpin_idle_cb` (:176-180): the page goes back to the ordinary grid, which is
        // a page-order change, not a selection.
        unpinIcon.addEventListener('click', (event) => {
            event.stopPropagation();
            this._view?.setPagePinned(id, false);
        });
        indicatorBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            this._view?.dispatchEvent(new CustomEvent('indicator-activated', { bubbles: true, detail: { id } }));
        });

        const thumb: Thumbnail = {
            root,
            label,
            icon,
            spinner: null,
            picture,
            portrait,
            closeBtn,
            unpinIcon,
            indicatorBtn,
            indicatorIcon,
            attention,
        };
        this._thumbs.set(id, thumb);
        return thumb;
    }

    /**
     * `update_tooltip`, `update_icon`, `update_indicator`, `update_loading` and the
     * needs-attention revealer, in that order (adw-tab-thumbnail.c:82-152).
     */
    private _refreshThumb(
        thumb: Thumbnail,
        page: {
            id: string;
            title: string;
            tooltip: string;
            icon: string | null;
            indicatorIcon: string | null;
            loading: boolean;
            needsAttention: boolean;
            pinned: boolean;
        },
    ): void {
        // `update_tooltip`: a non-empty tooltip wins, otherwise the title. Markup is NOT
        // interpreted here either — the DOM `title` attribute is a text sink.
        thumb.root.title = tabTooltip(page);
        thumb.root.setAttribute('aria-label', tabTooltip(page));

        // `update_icon`: the spinner REPLACES the icon's paintable while loading, and
        // the icon is visible iff there is an icon or a spinner. C SWAPS the paintable
        // rather than stacking a second node, and this does too — with a real
        // `<adw-spinner>`, the same paintable `Adw.Spinner` draws, so a CSS copy of
        // the ring would inherit every spinner defect independently.
        thumb.icon.hidden = page.icon === null && !page.loading;
        thumb.root.classList.toggle('loading', page.loading);
        if (page.loading && thumb.spinner === null) {
            const spinner = document.createElement('adw-spinner');
            spinner.className = 'tab-spinner';
            spinner.setAttribute('size', String(PAGE_ICON_SPINNER_SIZE));
            thumb.icon.replaceWith(spinner);
            thumb.spinner = spinner;
        } else if (!page.loading && thumb.spinner !== null) {
            thumb.spinner.replaceWith(thumb.icon);
            thumb.spinner = null;
        }

        // `update_indicator`: visible iff there is an indicator icon, and it takes the
        // page's `indicator-tooltip`.
        thumb.indicatorBtn.hidden = page.indicatorIcon === null;
        (thumb.indicatorIcon as GtkImage).iconName = page.indicatorIcon;

        thumb.attention.hidden = !page.needsAttention;

        // `inverted` is a property of the OVERVIEW (adw-tab-overview.c:1626-1634) and
        // reaches each thumbnail through `adw_tab_thumbnail_set_inverted`; the class is
        // what puts the close button and the indicator at the other end.
        thumb.root.classList.toggle('inverted', this.inverted);
        // A PINNED page gets the unpin glyph where an ordinary page gets the close button.
        thumb.closeBtn.hidden = page.pinned;
        thumb.unpinIcon.hidden = !page.pinned;

        thumb.label.textContent = page.title;
        thumb.portrait.textContent = page.title;

        const selected = this._view?.selectedId === page.id;
        thumb.root.classList.toggle('selected', selected);
        thumb.root.setAttribute('aria-selected', String(selected));
    }
}

/** `PAGE_ICON_SIZE`: the 16px `AdwSpinnerPaintable` an icon slot gets (adw-tab.c:74). */
const PAGE_ICON_SPINNER_SIZE = '16';

/** `set_view`'s five signals, in the names the view dispatches them under. */
const VIEW_EVENTS = [
    'page-attached',
    'page-detached',
    'page-reordered',
    'page-pinned',
    'page-updated',
    'notify::selected-page',
] as const;

customElements.define('adw-tab-overview', AdwTabOverview);
