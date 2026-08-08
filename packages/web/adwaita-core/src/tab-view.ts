// Headless `Adw.TabView` state machine (ADR 0004 — headless Adwaita core).
//
// `Adw.TabView` is the most stateful widget in libadwaita and almost none of it
// is rendering: an ordered page list with a PINNED PREFIX, a selected page, a
// parent-aware close-successor rule, insertion positions derived from the
// parent, partition-clamped reordering, wrap-around keyboard cycling, and a
// two-phase close/confirm protocol with a re-entrancy guard. All of it is pure.
//
// Unlike the avatar or view-stack lifts, this is NOT an abstraction over two
// existing implementations — it is the implementation. Neither renderer had any
// of it: `@gjsify/adwaita-web` emitted `close-page` and removed nothing (so every
// close was permanently denied), and `@gjsify/adwaita-nativescript` removed the
// page immediately with no signal, no confirm seam, and a bail-out on the last
// tab where libadwaita empties the view. What the two DID share was a 30-line
// "show only page[i], mark button[i] active" projection plus an index guard, and
// those two copies had already drifted: on a shrink web clamped to the last page
// and NS reset to 0, and NS accepted a FRACTIONAL index (`Number.isFinite`),
// stored it, and blanked the whole widget while still notifying.
//
// This module composes {@link ViewStackState} rather than restating it. That
// class already owns the primitive both families need — an ordered page list,
// one selection, the integer/range/idempotence guards, selection-follows-the-
// page across a removal, and the subscribe/emit seam — and re-declaring it here
// would have replaced two copies of the projection loop with three. What
// `TabViewState` adds on top is everything the pinned partition, the parent
// linkage and the close protocol imply.
//
// NAMING: the six insertion methods are `appendPage` / `prependPage` /
// `insertPage` (plus their `…PinnedPage` twins) rather than C's bare
// `adw_tab_view_append` / `_prepend` / `_insert`. `append` and `prepend` are
// `ParentNode` methods, so an `<adw-tab-view>` custom element CANNOT implement
// them — and the whole point here is that both renderers end up with the same
// surface, which the conformance vectors then drive directly, with no adapter.
//
// SCOPE: thumbnails, paintables, drag-and-drop and the tab overview
// (`AdwTabPaintable`, `page_should_be_visible`, `adw_tab_view_create_window`,
// `transfer_page`) are genuinely compositor work and are NOT lifted. In
// particular `page_should_be_visible` is an overview-thumbnail predicate, not
// the general "which page is showing" rule. The keyboard SHORTCUT TABLE is not
// lifted either — the key names are per-platform (`KeyboardEvent.key` on the
// web, nothing at all on NativeScript) — but every action it triggers is:
// `cycleNextPage`, `selectNthPage`, `reorderBackward` and the rest.
//
// Reference: refs/libadwaita/src/adw-tab-view.c (AdwTabView, AdwTabPage)
// Reference: refs/libadwaita/src/adw-tab-bar.c (AdwTabBar autohide)
// Reference: refs/libadwaita/src/adw-tab.c (AdwTab close button, tooltip, icons)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { ViewStackState } from './view-stack.js';
import type { AdwViewStackPageInfo } from './view-stack.js';

/**
 * Input shape for a tab page.
 *
 * Every optional field takes `null` as "absent" because that is what
 * `getAttribute` returns. `title` and `tooltip` coerce `null` to `''` exactly as
 * `adw_tab_page_set_title`/`set_tooltip` do (`g_set_str (&self->title, title ?
 * title : "")`, adw-tab-view.c:3021, :3064); `icon` and `indicatorIcon` stay
 * `null`, because "no icon" is a state `tabIconState` branches on.
 *
 * There is deliberately no `pinned` and no `parentId` here: a page's pinned
 * state may only change through {@link TabViewState.setPagePinned}, which has to
 * re-order at the same time (adw-tab-view.c:4059-4078), and the parent is an
 * argument of {@link TabViewState.addPage}, mirroring
 * `adw_tab_view_add_page (self, child, parent)`.
 */
export interface AdwTabPageSpec<T = unknown> {
    /**
     * Stable identity of the page. libadwaita keys everything by the `AdwTabPage`
     * POINTER — never by title — so a string id is the platform-neutral stand-in,
     * and two pages sharing an id would be two pages sharing a pointer. Ids are
     * therefore unique per view; a duplicate is refused, not silently accepted.
     */
    id: string;
    /** Tab label. `null`/absent is `''`, never `undefined`. */
    title?: string | null;
    /** Tooltip; falls back to the title when empty ({@link tabTooltip}). */
    tooltip?: string | null;
    /** GTK icon name shown in the tab, or `null` for none. */
    icon?: string | null;
    /** Icon shown in the indicator slot (`AdwTabPage:indicator-icon`), or `null`. */
    indicatorIcon?: string | null;
    /** Whether the tab draws a spinner instead of its icon (`AdwTabPage:loading`). */
    loading?: boolean;
    /** Whether the tab draws the attention dot (`AdwTabPage:needs-attention`). */
    needsAttention?: boolean;
    /** The renderer's page node — an `HTMLElement` on web, a NativeScript `View` on NS. */
    content?: T;
}

/**
 * A resolved page, as a renderer reads it.
 *
 * Fully readonly: the C setters all notify, so a renderer that mutates a record
 * in place would repaint nothing. Every field has a
 * `TabViewState.setPage<Field>` counterpart which emits an `'updated'` change.
 */
export interface AdwTabPageState<T = unknown> {
    /** Stable identity — the stand-in for the `AdwTabPage` pointer. */
    readonly id: string;
    /** Tab label, already coerced from `null` to `''`. */
    readonly title: string;
    /** Tooltip, already coerced from `null` to `''`. Empty means "use the title". */
    readonly tooltip: string;
    /** GTK icon name, or `null` when the page has none. */
    readonly icon: string | null;
    /** Indicator icon name, or `null`. */
    readonly indicatorIcon: string | null;
    /** Whether a spinner replaces the icon. */
    readonly loading: boolean;
    /** Whether the attention indicator is drawn. */
    readonly needsAttention: boolean;
    /** Whether the page sits in the pinned prefix — see {@link TabViewState.setPagePinned}. */
    readonly pinned: boolean;
    /** Id of the page this one was opened from, or `null`. Drives the close successor. */
    readonly parentId: string | null;
    /** Whether a {@link TabViewState.closePage} is awaiting {@link TabViewState.closePageFinish}. */
    readonly closing: boolean;
    /** The renderer's page node, `undefined` for a headless page. */
    readonly content: T | undefined;
}

/** Internal, mutable twin of {@link AdwTabPageState}. */
interface PageRecord<T> {
    id: string;
    title: string;
    tooltip: string;
    icon: string | null;
    indicatorIcon: string | null;
    loading: boolean;
    needsAttention: boolean;
    pinned: boolean;
    parentId: string | null;
    closing: boolean;
    content: T | undefined;
}

/**
 * The `close-page` seam — the one place the widget asks the application a
 * question, in the same shape as `AdwToastQueueHandlers`.
 *
 * Return `true` to confirm the close, `false` to deny it, or `'defer'` to hold
 * the page in the closing state until {@link TabViewState.closePageFinish} is
 * called — which is how an app shows a "save before closing?" dialog. With no
 * handler installed the default is `!page.pinned`, i.e. `close_page_cb`'s
 * `adw_tab_view_close_page_finish (self, page, !adw_tab_page_get_pinned (page))`
 * (adw-tab-view.c:1987-1993).
 */
export interface TabViewHandlers<T = unknown> {
    /** Decide the fate of a close request. */
    onClosePage?: (page: AdwTabPageState<T>) => boolean | 'defer';
}

/**
 * Payload of a selection change — the `notify::selected-page` half.
 *
 * Deliberately four plain fields and no live model object: this escapes into
 * consumer code as a DOM `CustomEvent.detail` / a NativeScript event, and handing
 * out the record would let a listener mutate the view's own page.
 */
export interface TabViewSelectionChange {
    /** Id of the newly-selected page, `null` when the view is empty. */
    selectedId: string | null;
    /** Its index, `-1` when the view is empty (`detach_page`, adw-tab-view.c:1912-1913). */
    selectedIndex: number;
    /** Id of the page that was selected before, `null` when there was none. */
    previousId: string | null;
    /**
     * `true` for an explicit selection (a tab click, a keyboard shortcut, a
     * {@link TabViewState.setSelectedPage} call); `false` for one the model made
     * on its own — the auto-select of the first page and the close successor.
     *
     * libadwaita notifies identically on both (`set_selected_page`,
     * adw-tab-view.c:1854); the flag exists so a bound tab bar can tell a user
     * pick from a model-driven one, exactly as `ViewStackState` tags its own.
     */
    interactive: boolean;
}

/** Subscriber for {@link TabViewState} selection changes. */
export type TabViewSelectionListener = (change: TabViewSelectionChange) => void;

/**
 * What happened to the page LIST — the `page-attached` / `page-detached` /
 * `page-reordered` signals (adw-tab-view.c:1778, :1932, :4561) plus the two the
 * C expresses as per-page `notify::` instead of a view signal.
 *
 * `'pinned'` is `adw_tab_view_set_page_pinned`'s combined flip-and-re-order
 * (:4059-4078); `'updated'` stands in for `notify::title` / `::tooltip` /
 * `::icon` / `::loading` / `::indicator-icon` / `::needs-attention`, which
 * `AdwTab` connects to in order to re-render one tab live (adw-tab.c:930-931).
 */
export type TabViewPagesChangeKind = 'attached' | 'detached' | 'reordered' | 'pinned' | 'updated';

/**
 * One page-list change. A renderer subscribes to this to insert, remove or move
 * exactly ONE tab instead of rebuilding the bar — which is what both ports did
 * (web built the bar once at connect and never again; NS tore down and rebuilt
 * every button on every close).
 */
export interface TabViewPagesChange {
    /** Which kind of change this is. */
    kind: TabViewPagesChangeKind;
    /** The page it happened to. */
    id: string;
    /** Its index AFTER the change; for `'detached'`, the index it was removed from. */
    position: number;
    /** Its index BEFORE the change; `-1` for `'attached'`. */
    previousPosition: number;
}

/** Subscriber for {@link TabViewState} page-list changes. */
export type TabViewPagesListener = (change: TabViewPagesChange) => void;

/** What a tab draws in its icon and indicator slots — the result of {@link tabIconState}. */
export interface TabIconState {
    /** The icon name to paint, or `null` when there is none to paint. */
    icon: string | null;
    /** Whether a spinner replaces the icon image. */
    spinner: boolean;
    /** Whether the icon slot is shown at all. */
    iconVisible: boolean;
    /** Whether the indicator slot is shown at all. */
    indicatorVisible: boolean;
}

/**
 * `Adw.TabBar:autohide` defaults to TRUE (adw-tab-bar.c:606-607, and
 * `self->autohide = TRUE` in init, :781).
 *
 * Named so a renderer whose spelling cannot express it — an HTML boolean
 * attribute is absent-means-false, so `<adw-tab-view autohide>` inverts the
 * platform default — is making a DELIBERATE, citable decision rather than a
 * silent one.
 */
export const DEFAULT_TAB_AUTOHIDE = true;

/**
 * Whether `Adw.TabBar` shows its tabs: `!autohide || nPages > 1 ||
 * nPinnedPages >= 1 || isTransferringPage` (`update_autohide_cb`,
 * adw-tab-bar.c:142-164).
 *
 * The `nPinnedPages >= 1` clause is the one that surprises — a single PINNED tab
 * keeps the bar up — and it is missing from the web port, which only ever
 * compared the page count. The `isTransferringPage` clause keeps the bar up
 * while a drag is in flight so there is somewhere to drop.
 */
export function tabsRevealed(state: {
    /** `AdwTabBar:autohide`. */
    autohide: boolean;
    /** `adw_tab_view_get_n_pages`. */
    nPages: number;
    /** `adw_tab_view_get_n_pinned_pages`. */
    nPinnedPages: number;
    /** `adw_tab_view_get_is_transferring_page` — a drag-n-drop tab transfer is running. */
    isTransferringPage: boolean;
}): boolean {
    if (!state.autohide) return true;
    return state.nPages > 1 || state.nPinnedPages >= 1 || state.isTransferringPage;
}

/**
 * Whether a tab shows its close button: `!pinned && ((hovering && fullyVisible)
 * || selected || dragging)`.
 *
 * The three-term half is `update_state` (adw-tab.c:124); the `!pinned` gate is
 * applied once at construction, where a pinned tab hides both its title and its
 * close button outright (adw-tab.c:645-650). Each port shipped a different
 * SINGLE term of this: web showed the button unconditionally, NS only on the
 * selected tab. The `fullyVisible` conjunct is why a hovered tab that is half
 * scrolled out of the bar shows nothing.
 */
export function tabCloseVisible(state: {
    /** Pointer is over the tab. */
    hovering: boolean;
    /** The tab is not clipped by the bar's scroll region. */
    fullyVisible: boolean;
    /** The tab is the selected one. */
    selected: boolean;
    /** The tab is being dragged. */
    dragging: boolean;
    /** The tab is pinned. */
    pinned: boolean;
}): boolean {
    if (state.pinned) return false;
    return (state.hovering && state.fullyVisible) || state.selected || state.dragging;
}

/**
 * The tooltip a tab shows: its own `tooltip` when non-empty, otherwise the page
 * title (`update_tooltip`, adw-tab.c:137-146; identical in
 * adw-tab-thumbnail.c). Neither port had tooltips at all.
 */
export function tabTooltip(page: Pick<AdwTabPageState, 'tooltip' | 'title'>): string {
    return page.tooltip === '' ? page.title : page.tooltip;
}

/**
 * Whether {@link tabTooltip}'s result is Pango MARKUP rather than plain text.
 *
 * C branches on exactly this: a non-empty `tooltip` goes through
 * `gtk_widget_set_tooltip_markup`, the title fallback through
 * `gtk_widget_set_tooltip_text` (adw-tab.c:141-146). The distinction is not
 * cosmetic — a renderer that pushed a marked-up tooltip through an HTML sink
 * would be executing page-supplied markup, and one that escaped the title would
 * show the escapes.
 */
export function tabTooltipIsMarkup(page: Pick<AdwTabPageState, 'tooltip'>): boolean {
    return page.tooltip !== '';
}

/**
 * What a tab paints in its icon + indicator slots (`update_icons`,
 * adw-tab.c:171-198).
 *
 * Three rules, in the order C applies them: `loading` wins and installs a
 * spinner WITHOUT replacing the icon name (so the icon reappears when loading
 * ends); a PINNED page with no icon of its own falls back to the view's
 * `default-icon`; and the icon slot is shown iff there is something to show AND
 * the page is either not pinned or has no indicator — on a pinned tab the
 * indicator REPLACES the icon, because a pinned tab is a single-glyph chip.
 *
 * Neither port models loading, indicators or a default icon; this is the
 * derivation they need before they can.
 */
export function tabIconState<T>(
    page: Pick<AdwTabPageState<T>, 'icon' | 'indicatorIcon' | 'loading' | 'pinned'>,
    defaultIcon: string | null,
): TabIconState {
    const indicator = page.indicatorIcon;
    let icon = page.icon;
    // The `else if (!loading)` branch is the ONLY one that reassigns the icon, so
    // a loading pinned page does not silently pick up the default icon.
    if (!page.loading && page.pinned && icon === null) icon = defaultIcon;

    return {
        icon,
        spinner: page.loading,
        iconVisible: (icon !== null || page.loading) && (!page.pinned || indicator === null),
        indicatorVisible: indicator !== null,
    };
}

/**
 * Whether `pageId` is `parentId` or a (possibly indirect) descendant of it —
 * `is_descendant_of` (adw-tab-view.c:1735-1742).
 *
 * The loop is `while (page && page != parent) page = parent_of (page);` and it
 * therefore returns TRUE for `page == parent` WITHOUT taking a step. That
 * non-obvious identity case is what makes "close a tab you opened from another
 * tab" land back on the opener: when the previous page IS the parent, the
 * descendant branch fires and selects it instead of falling through to the next
 * page.
 */
export function isDescendantOfPage<T>(
    pages: readonly AdwTabPageState<T>[],
    pageId: string | null,
    parentId: string,
): boolean {
    let current = pageId;
    // Parent links are only ever set to an already-existing page at creation and
    // re-pointed at a GRANDparent on detach, so the chain is acyclic by
    // construction and needs no visited set.
    while (current !== null && current !== parentId) {
        current = pages.find((page) => page.id === current)?.parentId ?? null;
    }
    return current === parentId;
}

/**
 * Which page ends up selected once `closingId` is removed — the pure kernel of
 * `select_previous_page` (adw-tab-view.c:1857-1897), extracted so the rule is
 * testable without a live view.
 *
 * Ranked, and the ranking is the point:
 *  1. the closing page is not the selected one → nothing moves (the C returns at
 *     :1864-1865, so `set_selected_page` is never called and NOTHING notifies);
 *  2. it has a parent and is not first, and the PREVIOUS page is a descendant of
 *     that parent → the previous page (:1869-1878) — a page is its own
 *     descendant, so "the previous page IS the opener" hits this branch;
 *  3. same, but the previous page and the parent are BOTH pinned → the parent
 *     (:1885-1890), because a page opened from a pinned parent is placed after
 *     the LAST pinned page rather than directly after its parent;
 *  4. otherwise the next page, else the previous page (:1893-1896);
 *  5. neither exists → `null`, i.e. the view empties.
 *
 * Returns `selectedId` unchanged in case 1, so the caller can compare and skip
 * the notification. Takes no `nPinnedPages`: the two pinned tests read
 * `page.pinned` off the records, and a parameter nothing reads is worse than a
 * signature that does not have it.
 */
export function successorAfterClose<T>(
    pages: readonly AdwTabPageState<T>[],
    closingId: string,
    selectedId: string | null,
): string | null {
    if (closingId !== selectedId) return selectedId;

    const position = pages.findIndex((page) => page.id === closingId);
    if (position < 0) return selectedId;

    const parentId = pages[position]!.parentId;
    if (parentId !== null && position > 0) {
        const previous = pages[position - 1]!;
        if (isDescendantOfPage(pages, previous.id, parentId)) return previous.id;

        const parent = pages.find((page) => page.id === parentId);
        if (parent && previous.pinned && parent.pinned) return parent.id;
    }

    if (position < pages.length - 1) return pages[position + 1]!.id;
    if (position > 0) return pages[position - 1]!.id;
    return null;
}

/** C's `g_return_if_fail` texts, recorded rather than printed. */
function assertionDiagnostic(fn: string, condition: string): string {
    return `${fn}: assertion '${condition}' failed`;
}

/**
 * The `Adw.TabView` model: an ordered page list with a pinned prefix, a selected
 * page, and the close protocol — with the C guard, ordering and successor rules
 * applied once for every renderer.
 *
 * `T` is the renderer's page-content type; the machine never looks inside it.
 * Nothing here renders, reads a global or holds a timer, so an instance is a
 * plain value a test can drive step by step.
 */
export class TabViewState<T = unknown> {
    /**
     * The ordered list + the selection, composed rather than restated —
     * `ViewStackState` already owns the index guards, the
     * selection-follows-the-page bookkeeping and the fan-out. Its `name` is this
     * view's page id and its `content` is the tab record; its `title`/`icon` are
     * never read here, because a tab's title is mutable and a second copy of it
     * would be a second truth.
     */
    private readonly _stack = new ViewStackState<PageRecord<T>>();
    private readonly _handlers: TabViewHandlers<T>;
    private readonly _selectionListeners = new Set<TabViewSelectionListener>();
    private readonly _pagesListeners = new Set<TabViewPagesListener>();
    private readonly _diagnostics: string[] = [];
    private _selectedId: string | null = null;
    /** Set while an insert runs — see {@link _deferredSelection}. */
    private _deferSelection = false;
    /**
     * A selection change parked until the `'attached'` change has gone out.
     *
     * This is C's `g_object_freeze_notify` / `thaw_notify` around `insert_page`
     * (adw-tab-view.c:1947-1961), not a scheduling trick: `attach_page` emits
     * `page-attached` as a SIGNAL (immediate) and the auto-select's
     * `notify::selected-page` only lands at thaw, so a renderer is guaranteed to
     * have built the tab before it is told to mark it selected.
     */
    private _deferredSelection: TabViewSelectionChange | null = null;
    private _pagesSource: readonly AdwViewStackPageInfo<PageRecord<T>>[] | null = null;
    private _pagesView: readonly AdwTabPageState<T>[] | null = null;

    constructor(handlers: TabViewHandlers<T> = {}) {
        this._handlers = handlers;
        this._stack.subscribe((change) => {
            const previousId = this._selectedId;
            const selectedId = change.page?.content?.id ?? null;
            this._selectedId = selectedId;
            const payload: TabViewSelectionChange = {
                selectedId,
                selectedIndex: change.index,
                previousId,
                interactive: change.interactive,
            };
            if (this._deferSelection) this._deferredSelection = payload;
            else this._emitSelection(payload);
        });
    }

    // --- Observables -------------------------------------------------------

    /** Subscribe to selection changes. Returns an unsubscribe function. */
    subscribe(listener: TabViewSelectionListener): () => void {
        this._selectionListeners.add(listener);
        return () => {
            this._selectionListeners.delete(listener);
        };
    }

    /**
     * Subscribe to page-list changes. Returns an unsubscribe function.
     *
     * Kept separate from {@link subscribe} because libadwaita keeps them separate
     * too — `props[PROP_SELECTED_PAGE]` versus the `AdwTabPages` list model — and
     * a renderer needs them at different granularities.
     */
    subscribePages(listener: TabViewPagesListener): () => void {
        this._pagesListeners.add(listener);
        return () => {
            this._pagesListeners.delete(listener);
        };
    }

    private _emitSelection(change: TabViewSelectionChange): void {
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live
        for (const listener of [...this._selectionListeners]) listener(change);
    }

    private _emitPages(change: TabViewPagesChange): void {
        // oxlint-disable-next-line unicorn/no-useless-spread -- see _emitSelection
        for (const listener of [...this._pagesListeners]) listener(change);
    }

    private _flushDeferredSelection(): void {
        const change = this._deferredSelection;
        if (!change) return;
        this._deferredSelection = null;
        this._emitSelection(change);
    }

    // --- The model ---------------------------------------------------------

    /**
     * Every page in order — a frozen projection, so a renderer cannot reorder the
     * model by writing to the array it was handed.
     *
     * Cached against the inner list's identity rather than an invalidation flag:
     * `ViewStackState` drops its own cached projection on exactly the structural
     * changes that matter, so there is no second bookkeeping to forget to update.
     */
    get pages(): readonly AdwTabPageState<T>[] {
        const source = this._stack.pages;
        if (this._pagesSource !== source || this._pagesView === null) {
            this._pagesSource = source;
            this._pagesView = Object.freeze(source.map((page) => page.content!));
        }
        return this._pagesView;
    }

    /** Number of pages — `adw_tab_view_get_n_pages` (adw-tab-view.c:3610). */
    get nPages(): number {
        return this._stack.count;
    }

    /**
     * Number of pinned pages — `adw_tab_view_get_n_pinned_pages`
     * (adw-tab-view.c:3628).
     *
     * DERIVED from the prefix invariant instead of bookkept as C's
     * `set_n_pinned_pages` counter is (:1696-1706). The invariant "the pinned
     * pages are exactly `[0, nPinnedPages)`" is what every insert, reorder and
     * first/last hop depends on; deriving the count makes it machine-true rather
     * than something four mutators must each remember to keep true.
     */
    get nPinnedPages(): number {
        const firstUnpinned = this.pages.findIndex((page) => !page.pinned);
        return firstUnpinned < 0 ? this.pages.length : firstUnpinned;
    }

    /**
     * The page at `position`, or `null`.
     *
     * Refuses a non-integer, negative or out-of-range position instead of
     * clamping: `adw_tab_view_get_nth_page` takes an `int` and asserts
     * `position >= 0` / `position < n_pages` (adw-tab-view.c:4126-4134), and no
     * clamping path exists anywhere in the file. This single guard is what the
     * NativeScript port lacked when a fractional index blanked the widget.
     */
    getNthPage(position: number): AdwTabPageState<T> | null {
        if (!Number.isInteger(position)) return null;
        if (position < 0 || position >= this.nPages) return null;
        return this.pages[position]!;
    }

    /** Index of the page with `id`, `-1` when absent — `adw_tab_view_get_page_position` (:4152). */
    getPagePosition(id: string): number {
        return this._stack.indexOfName(id);
    }

    /** The page with `id`, or `null`. */
    getPage(id: string): AdwTabPageState<T> | null {
        return this._recordOf(id);
    }

    /** Whether `id` is waiting for a {@link closePageFinish} (`page->closing`, :4396-4399). */
    isClosing(id: string): boolean {
        return this._recordOf(id)?.closing ?? false;
    }

    /**
     * Every diagnostic C would have printed as a `g_return_if_fail` warning, in
     * order — an unknown page id, a duplicate id, an insert or reorder outside
     * its partition. Kept as data so a test can assert on the class instead of on
     * stderr, exactly as `ViewStackState.diagnostics` does.
     */
    get diagnostics(): readonly string[] {
        return this._diagnostics;
    }

    // --- Selection ---------------------------------------------------------

    /** Id of the selected page, `null` when the view is empty. */
    get selectedId(): string | null {
        return this._stack.visiblePage?.content?.id ?? null;
    }

    /** Index of the selected page, `-1` when the view is empty. */
    get selectedIndex(): number {
        return this._stack.visibleIndex;
    }

    /** The selected page, or `null`. */
    get selectedPage(): AdwTabPageState<T> | null {
        return this._stack.visiblePage?.content ?? null;
    }

    /**
     * Select a page by id. Returns whether the selection changed.
     *
     * An unknown id is refused, and `null` is accepted only while the view is
     * empty — `adw_tab_view_set_selected_page` asserts `ADW_IS_TAB_PAGE` +
     * `page_belongs_to_this_view` when `n_pages > 0` and `selected_page == NULL`
     * otherwise (adw-tab-view.c:3686-3693).
     *
     * `interactive` defaults to `true` because this IS the explicit call, the
     * same convention `ViewStackState.setVisibleIndex` uses; the model-driven
     * paths (the first-page auto-select and the close successor) pass `false`.
     */
    setSelectedPage(id: string | null, interactive = true): boolean {
        if (id === null) {
            if (this.nPages > 0) {
                this._diagnostics.push(
                    assertionDiagnostic('adw_tab_view_set_selected_page', 'ADW_IS_TAB_PAGE (selected_page)'),
                );
            }
            return false;
        }
        const position = this.getPagePosition(id);
        if (position < 0) {
            this._diagnostics.push(
                assertionDiagnostic(
                    'adw_tab_view_set_selected_page',
                    'page_belongs_to_this_view (self, selected_page)',
                ),
            );
            return false;
        }
        return this._stack.setVisibleIndex(position, interactive);
    }

    /**
     * Select the page at `n` — the Alt+1…Alt+9 / Alt+0 path (`select_nth_page_cb`,
     * adw-tab-view.c:2136-2163; Alt+0 is `n = 9`, since pages count from 0).
     *
     * Pure delegation to the composed selection primitive, which already refuses
     * a non-integer, a negative, an out-of-range and the already-selected index
     * and emits nothing for any of them (adw-tab-view.c:2145, :2158-2159). That
     * is the whole reason this family builds ON `ViewStackState` instead of
     * beside it.
     */
    selectNthPage(n: number): boolean {
        return this._stack.setVisibleIndex(n, true);
    }

    /**
     * Select the page before the selected one; `false` when it is already first
     * (`adw_tab_view_select_previous_page`, adw-tab-view.c:3708-3730). Does NOT
     * wrap — {@link cyclePreviousPage} is the wrapping variant.
     */
    selectPreviousPage(): boolean {
        const position = this.selectedIndex;
        if (position <= 0) return false;
        return this._stack.setVisibleIndex(position - 1, true);
    }

    /**
     * Select the page after the selected one; `false` when it is already last
     * (`adw_tab_view_select_next_page`, adw-tab-view.c:3741-3763). Does NOT wrap.
     */
    selectNextPage(): boolean {
        const position = this.selectedIndex;
        if (position < 0 || position >= this.nPages - 1) return false;
        return this._stack.setVisibleIndex(position + 1, true);
    }

    /**
     * Select the first page in the selected page's own partition, hopping the
     * partition boundary once (`adw_tab_view_select_first_page`,
     * adw-tab-view.c:3764-3789).
     *
     * From a non-pinned page it goes to index `nPinnedPages` — the first
     * NON-pinned tab — and only when that is already the selected page does it
     * fall through to index 0, i.e. into pinned territory. From a pinned page
     * there is no fallback, so Ctrl+Home on the first pinned tab does nothing.
     */
    selectFirstPage(): boolean {
        const selected = this.selectedPage;
        if (!selected) return false;

        const pinned = selected.pinned;
        let page = this.getNthPage(pinned ? 0 : this.nPinnedPages);
        if (page === selected && !pinned) page = this.getNthPage(0);
        if (!page || page === selected) return false;
        return this.setSelectedPage(page.id);
    }

    /**
     * Select the last page in the selected page's own partition, hopping the
     * boundary once (`adw_tab_view_select_last_page`, adw-tab-view.c:3793-3818):
     * from the LAST pinned tab it continues to the last non-pinned one.
     */
    selectLastPage(): boolean {
        const selected = this.selectedPage;
        if (!selected) return false;

        const pinned = selected.pinned;
        let page = this.getNthPage((pinned ? this.nPinnedPages : this.nPages) - 1);
        if (page === selected && pinned) page = this.getNthPage(this.nPages - 1);
        if (!page || page === selected) return false;
        return this.setSelectedPage(page.id);
    }

    /**
     * Ctrl+Tab: the next page, WRAPPING to the first (`select_page_cb`'s forward
     * branch, adw-tab-view.c:2030-2041).
     *
     * Returns `false` outright on a view of one page or fewer — the shortcut
     * PROPAGATES there rather than ringing the error bell (:2008), which is how
     * Ctrl+Tab keeps working for whatever contains the tab view.
     */
    cycleNextPage(): boolean {
        if (!this.selectedPage || this.nPages <= 1) return false;
        if (this.selectNextPage()) return true;
        return this._stack.setVisibleIndex(0, true);
    }

    /**
     * Ctrl+Shift+Tab: the previous page, WRAPPING to the last
     * (`select_page_cb`'s backward branch, adw-tab-view.c:2017-2028).
     *
     * Ctrl+Home / Ctrl+End take the `last` branch of the same callback and map to
     * {@link selectFirstPage} / {@link selectLastPage}, which deliberately do NOT
     * wrap.
     */
    cyclePreviousPage(): boolean {
        if (!this.selectedPage || this.nPages <= 1) return false;
        if (this.selectPreviousPage()) return true;
        return this._stack.setVisibleIndex(this.nPages - 1, true);
    }

    // --- Insertion ---------------------------------------------------------

    /**
     * Add a page opened FROM `parentId`, deriving its position instead of taking
     * one (`adw_tab_view_add_page`, adw-tab-view.c:4188-4223). Returns the
     * position used, or `-1` when the page was refused.
     *
     * Three rules: a `null` parent appends; a PINNED parent inserts after the last
     * pinned page (a pinned tab has no room for its children beside it); and a
     * non-pinned parent inserts after the parent AND after every consecutive
     * descendant of it, so opening three links from one tab keeps them in the
     * order they were opened rather than reversing them.
     *
     * The new page is never itself pinned — `create_and_insert_page` is called
     * with `pinned = FALSE` even for a pinned parent (:4222).
     */
    addPage(spec: AdwTabPageSpec<T>, parentId: string | null = null): number {
        if (parentId === null) return this._insert(spec, this.nPages, false, null);

        const parentPosition = this.getPagePosition(parentId);
        if (parentPosition < 0) {
            this._diagnostics.push(
                assertionDiagnostic('adw_tab_view_add_page', 'page_belongs_to_this_view (self, parent)'),
            );
            return -1;
        }

        const parent = this.pages[parentPosition]!;
        let position = parent.pinned ? this.nPinnedPages - 1 : parentPosition;
        // `do { position++; if (position >= n_pages) break; } while (is_descendant_of (nth (position), parent));`
        do {
            position++;
            if (position >= this.nPages) break;
        } while (isDescendantOfPage(this.pages, this.pages[position]!.id, parentId));

        return this._insert(spec, position, false, parentId);
    }

    /**
     * Insert a NON-pinned page at `position`, which must be in
     * `[nPinnedPages, nPages]` — inserting before a pinned page is a programmer
     * error C refuses outright (`adw_tab_view_insert`, adw-tab-view.c:4246-4247).
     * Returns the position, or `-1` when refused.
     */
    insertPage(spec: AdwTabPageSpec<T>, position: number): number {
        if (!Number.isInteger(position) || position < this.nPinnedPages) {
            this._diagnostics.push(assertionDiagnostic('adw_tab_view_insert', 'position >= self->n_pinned_pages'));
            return -1;
        }
        if (position > this.nPages) {
            this._diagnostics.push(assertionDiagnostic('adw_tab_view_insert', 'position <= self->n_pages'));
            return -1;
        }
        return this._insert(spec, position, false, null);
    }

    /** Insert as the FIRST non-pinned page (`adw_tab_view_prepend`, adw-tab-view.c:4262). */
    prependPage(spec: AdwTabPageSpec<T>): number {
        return this._insert(spec, this.nPinnedPages, false, null);
    }

    /** Insert as the LAST non-pinned page (`adw_tab_view_append`, adw-tab-view.c:4284). */
    appendPage(spec: AdwTabPageSpec<T>): number {
        return this._insert(spec, this.nPages, false, null);
    }

    /**
     * Insert a PINNED page at `position`, which must be in `[0, nPinnedPages]` —
     * a pinned page after a non-pinned one is refused
     * (`adw_tab_view_insert_pinned`, adw-tab-view.c:4312-4313).
     * Returns the position, or `-1` when refused.
     */
    insertPinnedPage(spec: AdwTabPageSpec<T>, position: number): number {
        if (!Number.isInteger(position) || position < 0) {
            this._diagnostics.push(assertionDiagnostic('adw_tab_view_insert_pinned', 'position >= 0'));
            return -1;
        }
        if (position > this.nPinnedPages) {
            this._diagnostics.push(
                assertionDiagnostic('adw_tab_view_insert_pinned', 'position <= self->n_pinned_pages'),
            );
            return -1;
        }
        return this._insert(spec, position, true, null);
    }

    /** Insert as the FIRST pinned page (`adw_tab_view_prepend_pinned`, adw-tab-view.c:4331). */
    prependPinnedPage(spec: AdwTabPageSpec<T>): number {
        return this._insert(spec, 0, true, null);
    }

    /** Insert as the LAST pinned page (`adw_tab_view_append_pinned`, adw-tab-view.c:4353). */
    appendPinnedPage(spec: AdwTabPageSpec<T>): number {
        return this._insert(spec, this.nPinnedPages, true, null);
    }

    private _insert(spec: AdwTabPageSpec<T>, position: number, pinned: boolean, parentId: string | null): number {
        if (this.getPagePosition(spec.id) >= 0) {
            // Two pages sharing an id would be two pages sharing an AdwTabPage
            // pointer — a state C cannot reach, so it has no rule for it. Refusing
            // is the only reading that keeps every id-keyed lookup unambiguous.
            this._diagnostics.push(assertionDiagnostic('adw_tab_view_insert', `page id '${spec.id}' is unique`));
            return -1;
        }

        const record: PageRecord<T> = {
            id: spec.id,
            title: spec.title ?? '',
            tooltip: spec.tooltip ?? '',
            icon: spec.icon ?? null,
            indicatorIcon: spec.indicatorIcon ?? null,
            loading: spec.loading ?? false,
            needsAttention: spec.needsAttention ?? false,
            pinned,
            parentId,
            closing: false,
            content: spec.content,
        };

        // freeze_notify: the auto-select must not be heard before the tab exists.
        this._deferSelection = true;
        this._stack.insertPage({ name: record.id, content: record }, position);
        this._deferSelection = false;

        this._emitPages({ kind: 'attached', id: record.id, position, previousPosition: -1 });
        this._flushDeferredSelection();
        return position;
    }

    // --- Pinning -----------------------------------------------------------

    /**
     * Pin or unpin a page AND re-order it in the same step, returning its new
     * position — or `-1` when it is already in that state
     * (`adw_tab_view_set_page_pinned`, adw-tab-view.c:4047-4086).
     *
     * Pinning moves the page to index `nPinnedPages`; unpinning moves it to
     * `nPinnedPages - 1`. Both are computed from the count BEFORE the flip, and
     * both are indices into the list WITHOUT the moved page — which is why
     * unpinning the SECOND of two pinned pages returns 1 and moves nothing while
     * still changing the pinned count.
     *
     * This is the single derivation neither port has and the one most likely to
     * be got wrong by hand.
     */
    setPagePinned(id: string, pinned: boolean): number {
        const position = this.getPagePosition(id);
        if (position < 0) {
            this._diagnostics.push(
                assertionDiagnostic('adw_tab_view_set_page_pinned', 'page_belongs_to_this_view (self, page)'),
            );
            return -1;
        }

        const record = this._recordAt(position);
        const next = !!pinned;
        if (record.pinned === next) return -1;

        const newPosition = next ? this.nPinnedPages : this.nPinnedPages - 1;
        record.pinned = next;
        if (position !== newPosition) this._stack.movePage(position, newPosition);

        this._emitPages({ kind: 'pinned', id, position: newPosition, previousPosition: position });
        return newPosition;
    }

    // --- Closing -----------------------------------------------------------

    /**
     * Request that `id` be closed, opening the two-phase protocol: the page is
     * marked closing, the handler runs, and the close is then confirmed, denied
     * or left deferred (`adw_tab_view_close_page`, adw-tab-view.c:4386-4400).
     *
     * Returns whether the request was STARTED — `false` means it was ignored
     * because the id is unknown or the page is already awaiting a
     * {@link closePageFinish}. That re-entrancy guard (`if (page->closing)
     * return;`, :4396-4397) is what stops a second click on the close button from
     * running a save dialog twice.
     *
     * With no handler installed a non-pinned page is closed and a PINNED page is
     * denied and stays — `close_page_cb` (:1986-1993).
     */
    closePage(id: string): boolean {
        const record = this._recordOf(id);
        if (!record) {
            this._diagnostics.push(
                assertionDiagnostic('adw_tab_view_close_page', 'page_belongs_to_this_view (self, page)'),
            );
            return false;
        }
        if (record.closing) return false;

        record.closing = true;
        const verdict = this._handlers.onClosePage ? this._handlers.onClosePage(record) : !record.pinned;
        if (verdict !== 'defer') this.closePageFinish(id, verdict);
        return true;
    }

    /**
     * Complete a {@link closePage}. Returns whether the page was detached.
     *
     * `confirm: false` clears the closing flag and leaves the page exactly where
     * it was, so `closePage` can be called for it again; `confirm: true` detaches
     * it (`adw_tab_view_close_page_finish`, adw-tab-view.c:4419-4437). Calling it
     * for a page that is not closing is refused, as C's
     * `g_return_if_fail (page->closing)` is (:4426).
     *
     * Neither renderer had this seam, which is why an app could not show a
     * "save before closing?" dialog on either.
     */
    closePageFinish(id: string, confirm: boolean): boolean {
        const record = this._recordOf(id);
        if (!record) {
            this._diagnostics.push(
                assertionDiagnostic('adw_tab_view_close_page_finish', 'page_belongs_to_this_view (self, page)'),
            );
            return false;
        }
        if (!record.closing) {
            this._diagnostics.push(assertionDiagnostic('adw_tab_view_close_page_finish', 'page->closing'));
            return false;
        }

        record.closing = false;
        if (!confirm) return false;
        return this.detachPage(id) !== null;
    }

    /**
     * Remove a page unconditionally, running the successor rule FIRST. Returns
     * the removed page, or `null` when the id is unknown.
     *
     * The order is load-bearing: `detach_page` calls `select_previous_page` at
     * adw-tab-view.c:1906 and only removes at :1915, so the successor is chosen
     * while the closing page is still in the list. Choosing it afterwards gives
     * different answers for every parent-aware case, because "the previous page"
     * is no longer the same page.
     *
     * Closing the LAST page empties the view: the selection becomes `null` at
     * index `-1` and that DOES notify (:1912-1913) — both ports reported index 0
     * for a page-less view.
     *
     * DEVIATIONS, both deliberate: the empty-view notification is emitted AFTER
     * the removal rather than before it, so a listener reading `pages` and
     * `selectedIndex` during the callback sees one consistent state; and pages
     * parented to the removed one are re-pointed at its own parent, which C gets
     * for free from `page_parent_notify_cb` (:293-303) when the detached page is
     * finalized — without it a dangling parent id would quietly disable the
     * successor rule for every child.
     */
    detachPage(id: string): AdwTabPageState<T> | null {
        const position = this.getPagePosition(id);
        if (position < 0) {
            this._diagnostics.push(
                assertionDiagnostic('adw_tab_view_detach_page', 'page_belongs_to_this_view (self, page)'),
            );
            return null;
        }

        const record = this._recordAt(position);
        const successor = successorAfterClose(this.pages, id, this.selectedId);
        if (successor !== null && successor !== this.selectedId) this.setSelectedPage(successor, false);

        // Only reachable when the closing page is selected and has no successor,
        // i.e. it is the only page left.
        const emptiesTheView = this.selectedId === id;

        this._stack.removePage(id);
        for (const page of this._records()) {
            if (page.parentId === id) page.parentId = record.parentId;
        }

        if (emptiesTheView) {
            this._selectedId = null;
            this._emitSelection({ selectedId: null, selectedIndex: -1, previousId: id, interactive: false });
        }
        this._emitPages({ kind: 'detached', id, position, previousPosition: position });
        return record;
    }

    /**
     * Request a close for every page except `id`
     * (`adw_tab_view_close_other_pages`, adw-tab-view.c:4444-4463).
     *
     * The walk is DESCENDING, and that is part of the spec rather than an
     * implementation detail: each confirmed close shifts every later index, so an
     * ascending walk would skip pages. The ids are snapshotted first, so a
     * handler that adds a page mid-batch cannot make the batch visit it.
     */
    closeOtherPages(id: string): void {
        const position = this.getPagePosition(id);
        if (position < 0) {
            this._diagnostics.push(
                assertionDiagnostic('adw_tab_view_close_other_pages', 'page_belongs_to_this_view (self, page)'),
            );
            return;
        }
        const ids = this.pages.map((page) => page.id);
        for (let index = ids.length - 1; index >= 0; index--) {
            if (index === position) continue;
            this.closePage(ids[index]!);
        }
    }

    /** Request a close for every page before `id`, descending (adw-tab-view.c:4485). */
    closePagesBefore(id: string): void {
        const position = this.getPagePosition(id);
        if (position < 0) {
            this._diagnostics.push(
                assertionDiagnostic('adw_tab_view_close_pages_before', 'page_belongs_to_this_view (self, page)'),
            );
            return;
        }
        const ids = this.pages.map((page) => page.id);
        for (let index = position - 1; index >= 0; index--) this.closePage(ids[index]!);
    }

    /** Request a close for every page after `id`, descending (adw-tab-view.c:4511). */
    closePagesAfter(id: string): void {
        const position = this.getPagePosition(id);
        if (position < 0) {
            this._diagnostics.push(
                assertionDiagnostic('adw_tab_view_close_pages_after', 'page_belongs_to_this_view (self, page)'),
            );
            return;
        }
        const ids = this.pages.map((page) => page.id);
        for (let index = ids.length - 1; index > position; index--) this.closePage(ids[index]!);
    }

    // --- Reordering --------------------------------------------------------

    /**
     * Move a page to `position` WITHIN ITS OWN PARTITION. Returns whether it
     * moved (`adw_tab_view_reorder_page`, adw-tab-view.c:4526-4569).
     *
     * A pinned page may only land in `[0, nPinnedPages)` and a non-pinned one in
     * `[nPinnedPages, nPages)`; anything else is the programmer error C refuses
     * (:4542-4548). An unchanged position returns `false` without emitting
     * (:4552-4553) — which is what makes `reorderFirst` on the first non-pinned
     * tab a no-op rather than a drag into pinned territory.
     */
    reorderPage(id: string, position: number): boolean {
        const original = this.getPagePosition(id);
        if (original < 0) {
            this._diagnostics.push(
                assertionDiagnostic('adw_tab_view_reorder_page', 'page_belongs_to_this_view (self, page)'),
            );
            return false;
        }

        const pinned = this.pages[original]!.pinned;
        const lowerBound = pinned ? 0 : this.nPinnedPages;
        const upperBound = pinned ? this.nPinnedPages : this.nPages;
        if (!Number.isInteger(position) || position < lowerBound || position >= upperBound) {
            this._diagnostics.push(
                assertionDiagnostic(
                    'adw_tab_view_reorder_page',
                    pinned ? 'position < self->n_pinned_pages' : 'position >= self->n_pinned_pages',
                ),
            );
            return false;
        }
        if (original === position) return false;

        this._stack.movePage(original, position);
        this._emitPages({ kind: 'reordered', id, position, previousPosition: original });
        return true;
    }

    /**
     * Move a page one slot earlier, stopping at its partition's first index
     * (`adw_tab_view_reorder_backward`, adw-tab-view.c:4586-4604) — so the first
     * NON-pinned tab cannot be dragged into pinned territory.
     */
    reorderBackward(id: string): boolean {
        const position = this.getPagePosition(id);
        if (position < 0) return this._reorderMissing(id);

        const first = this.pages[position]!.pinned ? 0 : this.nPinnedPages;
        if (position <= first) return false;
        return this.reorderPage(id, position - 1);
    }

    /**
     * Move a page one slot later, stopping at its partition's last index
     * (`adw_tab_view_reorder_forward`, adw-tab-view.c:4617-4635).
     */
    reorderForward(id: string): boolean {
        const position = this.getPagePosition(id);
        if (position < 0) return this._reorderMissing(id);

        const last = (this.pages[position]!.pinned ? this.nPinnedPages : this.nPages) - 1;
        if (position >= last) return false;
        return this.reorderPage(id, position + 1);
    }

    /** Move a page to the first slot of its partition (adw-tab-view.c:4646-4661). */
    reorderFirst(id: string): boolean {
        const position = this.getPagePosition(id);
        if (position < 0) return this._reorderMissing(id);
        return this.reorderPage(id, this.pages[position]!.pinned ? 0 : this.nPinnedPages);
    }

    /** Move a page to the last slot of its partition (adw-tab-view.c:4672-4687). */
    reorderLast(id: string): boolean {
        const position = this.getPagePosition(id);
        if (position < 0) return this._reorderMissing(id);
        return this.reorderPage(id, (this.pages[position]!.pinned ? this.nPinnedPages : this.nPages) - 1);
    }

    private _reorderMissing(id: string): boolean {
        this._diagnostics.push(
            assertionDiagnostic('adw_tab_view_reorder_page', `page_belongs_to_this_view (self, '${id}')`),
        );
        return false;
    }

    // --- Per-page properties ----------------------------------------------

    /**
     * Set a page's title; `null` becomes `''`, matching
     * `g_set_str (&self->title, title ? title : "")` (adw-tab-view.c:3021).
     * Returns whether it changed.
     *
     * The whole reason this exists: `AdwTab` connects to `notify::title` and
     * re-renders the label live (adw-tab.c:930-931), while both ports snapshotted
     * the title once — the web one even declaring `observedAttributes = ['title']`
     * with no `attributeChangedCallback` behind it.
     */
    setPageTitle(id: string, title: string | null): boolean {
        return this._update(id, (record) => {
            const next = title ?? '';
            if (record.title === next) return false;
            record.title = next;
            return true;
        });
    }

    /** Set a page's tooltip; `null` becomes `''` (adw-tab-view.c:3064). */
    setPageTooltip(id: string, tooltip: string | null): boolean {
        return this._update(id, (record) => {
            const next = tooltip ?? '';
            if (record.tooltip === next) return false;
            record.tooltip = next;
            return true;
        });
    }

    /** Set a page's icon name, `null` for none (`adw_tab_page_set_icon`, adw-tab-view.c:3101). */
    setPageIcon(id: string, icon: string | null): boolean {
        return this._update(id, (record) => {
            if (record.icon === icon) return false;
            record.icon = icon;
            return true;
        });
    }

    /** Set a page's indicator icon, `null` for none (adw-tab-view.c:3198). */
    setPageIndicatorIcon(id: string, icon: string | null): boolean {
        return this._update(id, (record) => {
            if (record.indicatorIcon === icon) return false;
            record.indicatorIcon = icon;
            return true;
        });
    }

    /** Set whether the tab draws a spinner (`adw_tab_page_set_loading`, adw-tab-view.c:3143). */
    setPageLoading(id: string, loading: boolean): boolean {
        return this._update(id, (record) => {
            const next = !!loading;
            if (record.loading === next) return false;
            record.loading = next;
            return true;
        });
    }

    /** Set the attention indicator (`adw_tab_page_set_needs_attention`, adw-tab-view.c:3333). */
    setPageNeedsAttention(id: string, needsAttention: boolean): boolean {
        return this._update(id, (record) => {
            const next = !!needsAttention;
            if (record.needsAttention === next) return false;
            record.needsAttention = next;
            return true;
        });
    }

    private _update(id: string, mutate: (record: PageRecord<T>) => boolean): boolean {
        const position = this.getPagePosition(id);
        if (position < 0) {
            this._diagnostics.push(assertionDiagnostic('adw_tab_page_set_property', 'ADW_IS_TAB_PAGE (self)'));
            return false;
        }
        if (!mutate(this._recordAt(position))) return false;
        this._emitPages({ kind: 'updated', id, position, previousPosition: position });
        return true;
    }

    // --- Internals ---------------------------------------------------------

    /** The mutable records, in order — the same objects {@link pages} exposes readonly. */
    private _records(): PageRecord<T>[] {
        return this._stack.pages.map((page) => page.content!);
    }

    private _recordAt(position: number): PageRecord<T> {
        return this._stack.pages[position]!.content!;
    }

    private _recordOf(id: string): PageRecord<T> | null {
        const position = this.getPagePosition(id);
        return position < 0 ? null : this._recordAt(position);
    }
}
