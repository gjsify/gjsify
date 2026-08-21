// Tab-view conformance vectors — the spec all three implementations are held to.
//
// `Adw.TabView` is a state machine, so most rows here are small SCRIPTS rather
// than input/output pairs: a page list, a sequence of operations, and the exact
// sequence of notifications those produce. The core suite replays a row against
// `TabViewState`; the browser suite replays it against a mounted
// `<adw-tab-view>`; the NativeScript suite replays it against the state the real
// `AdwTabView` widget delegates to.
//
// Most rows are a NEW assertion rather than a pinned port behaviour: the two-phase
// `close-page` confirm, the pinned partition, the parent-aware successor, the reorder
// clamps and the keyboard model existed in neither renderer. The rows that ARE a
// comparison say so — those are the regression pins.
//
// Reference: refs/libadwaita/src/adw-tab-view.c
// Reference: refs/libadwaita/src/adw-tab-bar.c
// Reference: refs/libadwaita/src/adw-tab.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** A page as a vector declares it. */
export interface TabViewVectorPage {
    /** The page id — the platform-neutral stand-in for the `AdwTabPage` pointer. */
    id: string;
    /** Tab label; omitted means `''`. */
    title?: string;
    /** Whether the page is seeded into the pinned prefix. */
    pinned?: boolean;
    /** Id of the page this one was opened from (`AdwTabPage:parent`). */
    parentId?: string;
}

/** One operation a vector applies after its pages are seeded. */
export type TabViewVectorOp =
    | { readonly kind: 'select'; readonly id: string | null }
    | { readonly kind: 'selectNth'; readonly n: number }
    | { readonly kind: 'selectPrevious' }
    | { readonly kind: 'selectNext' }
    | { readonly kind: 'selectFirst' }
    | { readonly kind: 'selectLast' }
    | { readonly kind: 'cycleNext' }
    | { readonly kind: 'cyclePrevious' }
    | { readonly kind: 'addPage'; readonly page: TabViewVectorPage; readonly parentId: string | null }
    | { readonly kind: 'insertPage'; readonly page: TabViewVectorPage; readonly position: number }
    | { readonly kind: 'prependPage'; readonly page: TabViewVectorPage }
    | { readonly kind: 'appendPage'; readonly page: TabViewVectorPage }
    | { readonly kind: 'insertPinnedPage'; readonly page: TabViewVectorPage; readonly position: number }
    | { readonly kind: 'prependPinnedPage'; readonly page: TabViewVectorPage }
    | { readonly kind: 'appendPinnedPage'; readonly page: TabViewVectorPage }
    | { readonly kind: 'setPinned'; readonly id: string; readonly pinned: boolean }
    | { readonly kind: 'closePage'; readonly id: string }
    | { readonly kind: 'closePageFinish'; readonly id: string; readonly confirm: boolean }
    | { readonly kind: 'closeOtherPages'; readonly id: string }
    | { readonly kind: 'closePagesBefore'; readonly id: string }
    | { readonly kind: 'closePagesAfter'; readonly id: string }
    | { readonly kind: 'detach'; readonly id: string }
    | { readonly kind: 'reorder'; readonly id: string; readonly position: number }
    | { readonly kind: 'reorderBackward'; readonly id: string }
    | { readonly kind: 'reorderForward'; readonly id: string }
    | { readonly kind: 'reorderFirst'; readonly id: string }
    | { readonly kind: 'reorderLast'; readonly id: string }
    | { readonly kind: 'setTitle'; readonly id: string; readonly title: string | null };

/** One expected selection notification, in the order it is emitted. */
export interface TabViewVectorSelection {
    /** Id of the newly-selected page, `null` when the view emptied. */
    selectedId: string | null;
    /** Its index, `-1` when the view emptied. */
    selectedIndex: number;
    /** The previously-selected id, `null` when there was none. */
    previousId: string | null;
    /** `true` only for an explicit selection; every model-driven pick is `false`. */
    interactive: boolean;
}

/** One expected page-list notification. */
export interface TabViewVectorPagesChange {
    kind: 'attached' | 'detached' | 'reordered' | 'pinned' | 'updated';
    id: string;
    position: number;
    /** Its index before the change, `-1` for `'attached'`. */
    previousPosition: number;
}

/**
 * How the `close-page` handler behaves for the whole row.
 *
 * `'default'` reproduces libadwaita's own default handler, `close_page_cb`'s
 * `close_page_finish (self, page, !adw_tab_page_get_pinned (page))`; the suites wrap it
 * in a RECORDER so the close-attempt order is observable, and the core suite also
 * replays the row with NO handler to prove the built-in default agrees. `'defer'` holds
 * every page in the closing state so `closePageFinish` decides.
 */
export type TabViewVectorHandler = 'default' | 'defer';

/** One end-to-end tab-view expectation. */
export interface TabViewVector {
    rule: string;
    derivedFrom: string;
    /** The pages, seeded in this order (pinned ones via appendPinnedPage, parented ones via addPage). */
    pages: readonly TabViewVectorPage[];
    /** How close requests are answered. Defaults to `'default'`. */
    handler?: TabViewVectorHandler;
    /** Selection changes emitted WHILE the pages are seeded (the auto-select), in order. */
    setupChanges: readonly TabViewVectorSelection[];
    ops: readonly TabViewVectorOp[];
    /**
     * Return value of each op, in order — `null` for the ops that return nothing.
     * Asserted by the core and NativeScript suites; the browser suite drives the
     * same operations through element methods and asserts the DOM instead.
     */
    opResults: readonly (boolean | number | null)[];
    /** Selection changes emitted BY the ops, in order. */
    changes: readonly TabViewVectorSelection[];
    /** Page-list changes emitted by the ops, in order. Asserted only when present. */
    pagesChanges?: readonly TabViewVectorPagesChange[];
    /** Ids the close handler was asked about, in order. Asserted only when present. */
    closeAttempts?: readonly string[];
    /** Final page order. */
    order: readonly string[];
    nPinnedPages: number;
    /** Final selected id, `null` for none. */
    selectedId: string | null;
    /** Final selected index, `-1` for none. */
    selectedIndex: number;
    /** Ids still awaiting a `closePageFinish`. Asserted only when present. */
    closing?: readonly string[];
    /** Expected `diagnostics` (C's `g_return_if_fail` texts), when the row exercises them. */
    diagnostics?: readonly string[];
}

// The four-page pinned fixture the navigation and reorder rows share: two pinned
// tabs then two ordinary ones, i.e. n_pinned_pages == 2 and n_pages == 4.
const PINNED_FIXTURE: readonly TabViewVectorPage[] = [
    { id: 'P0', pinned: true },
    { id: 'P1', pinned: true },
    { id: 'A' },
    { id: 'B' },
];

/** The first page seeded is auto-selected, and that auto-select notifies. */
const AUTO_SELECT = (id: string): readonly TabViewVectorSelection[] => [
    { selectedId: id, selectedIndex: 0, previousId: null, interactive: false },
];

/**
 * `Adw.TabView`'s selection, close protocol, partition and ordering, end to end.
 *
 * Read the `rule` of a row before changing it: most encode behaviour neither renderer had,
 * and several encode behaviour a port had backwards.
 */
export const TAB_VIEW_VECTORS: ReadonlyArray<TabViewVector> = [
    {
        rule: 'closing the selected page selects the NEXT one and removes it — web removed nothing at all, so every close was permanently denied',
        derivedFrom:
            'close_page_cb confirms a non-pinned page (adw-tab-view.c:1990-1991); select_previous_page falls through to adw_tab_view_select_next_page (:1893) which succeeds at pos 1 < n_pages-1 (:3753); detach_page removes at :1915',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [
            { kind: 'select', id: 'B' },
            { kind: 'closePage', id: 'B' },
        ],
        opResults: [true, true],
        changes: [
            { selectedId: 'B', selectedIndex: 1, previousId: 'A', interactive: true },
            { selectedId: 'C', selectedIndex: 2, previousId: 'B', interactive: false },
        ],
        pagesChanges: [{ kind: 'detached', id: 'B', position: 1, previousPosition: 1 }],
        order: ['A', 'C'],
        nPinnedPages: 0,
        selectedId: 'C',
        selectedIndex: 1,
    },
    {
        rule: 'closing the LAST page falls back to the previous one',
        derivedFrom:
            'select_next_page returns FALSE at pos >= n_pages-1 (adw-tab-view.c:3753), so select_previous_page runs (:1896, :3723)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [
            { kind: 'select', id: 'C' },
            { kind: 'closePage', id: 'C' },
        ],
        opResults: [true, true],
        changes: [
            { selectedId: 'C', selectedIndex: 2, previousId: 'A', interactive: true },
            { selectedId: 'B', selectedIndex: 1, previousId: 'C', interactive: false },
        ],
        order: ['A', 'B'],
        nPinnedPages: 0,
        selectedId: 'B',
        selectedIndex: 1,
    },
    {
        rule: 'closing a page BEFORE the selection keeps the same page selected, shifts its index down, and emits NOTHING',
        derivedFrom:
            'select_previous_page early-returns because page != selected_page (adw-tab-view.c:1864-1865), so set_selected_page and its notify (:1854) are never reached',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [
            { kind: 'select', id: 'C' },
            { kind: 'closePage', id: 'A' },
        ],
        opResults: [true, true],
        changes: [{ selectedId: 'C', selectedIndex: 2, previousId: 'A', interactive: true }],
        order: ['B', 'C'],
        nPinnedPages: 0,
        selectedId: 'C',
        selectedIndex: 1,
    },
    {
        rule: 'closing the ONLY page empties the view: no selection, index -1 — both ports reported index 0 for a page-less view, and NS refused the close outright',
        derivedFrom:
            'detach_page: `if (self->n_pages == 1) set_selected_page (self, NULL, !in_dispose);` (adw-tab-view.c:1912-1913)',
        pages: [{ id: 'A' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'closePage', id: 'A' }],
        opResults: [true],
        changes: [{ selectedId: null, selectedIndex: -1, previousId: 'A', interactive: false }],
        pagesChanges: [{ kind: 'detached', id: 'A', position: 0, previousPosition: 0 }],
        order: [],
        nPinnedPages: 0,
        selectedId: null,
        selectedIndex: -1,
    },
    {
        rule: 'a page opened from a parent falls back to the SIBLING opened before it, not to the next page',
        derivedFrom:
            'select_previous_page: parent is set and pos > 0, prev is a descendant of the parent -> select prev (adw-tab-view.c:1869-1878)',
        pages: [{ id: 'P' }, { id: 'C1', parentId: 'P' }, { id: 'C2', parentId: 'P' }],
        setupChanges: AUTO_SELECT('P'),
        ops: [
            { kind: 'select', id: 'C2' },
            { kind: 'closePage', id: 'C2' },
        ],
        opResults: [true, true],
        changes: [
            { selectedId: 'C2', selectedIndex: 2, previousId: 'P', interactive: true },
            { selectedId: 'C1', selectedIndex: 1, previousId: 'C2', interactive: false },
        ],
        order: ['P', 'C1'],
        nPinnedPages: 0,
        selectedId: 'C1',
        selectedIndex: 1,
    },
    {
        rule: 'closing a tab you opened from another tab lands back on the OPENER, not on the next tab — the rule both ports lack entirely',
        derivedFrom:
            'is_descendant_of returns TRUE for page == parent because the while-loop exits immediately (adw-tab-view.c:1735-1742), so prev == parent hits the descendant branch (:1874-1877) instead of falling through to select_next_page',
        pages: [{ id: 'P' }, { id: 'X', parentId: 'P' }, { id: 'Y' }],
        setupChanges: AUTO_SELECT('P'),
        ops: [
            { kind: 'select', id: 'X' },
            { kind: 'closePage', id: 'X' },
        ],
        opResults: [true, true],
        changes: [
            { selectedId: 'X', selectedIndex: 1, previousId: 'P', interactive: true },
            { selectedId: 'P', selectedIndex: 0, previousId: 'X', interactive: false },
        ],
        order: ['P', 'Y'],
        nPinnedPages: 0,
        selectedId: 'P',
        selectedIndex: 0,
    },
    {
        rule: 'with a PINNED parent the previous page is a different pinned tab, so the parent is selected directly',
        derivedFrom:
            'prev is not a descendant of the parent, but prev.pinned && parent.pinned holds -> select the parent (adw-tab-view.c:1880-1890). A page opened from a pinned parent is placed after the LAST pinned page, which is why the previous page need not be the parent.',
        pages: [
            { id: 'P0', pinned: true },
            { id: 'P1', pinned: true },
            { id: 'X', parentId: 'P0' },
        ],
        setupChanges: AUTO_SELECT('P0'),
        ops: [
            { kind: 'select', id: 'X' },
            { kind: 'closePage', id: 'X' },
        ],
        opResults: [true, true],
        changes: [
            { selectedId: 'X', selectedIndex: 2, previousId: 'P0', interactive: true },
            { selectedId: 'P0', selectedIndex: 0, previousId: 'X', interactive: false },
        ],
        order: ['P0', 'P1'],
        nPinnedPages: 2,
        selectedId: 'P0',
        selectedIndex: 0,
    },
    {
        rule: 'a PINNED page is denied by the default handler: nothing is removed and the page is no longer closing',
        derivedFrom:
            'close_page_cb calls close_page_finish with `!adw_tab_page_get_pinned (page)` (adw-tab-view.c:1990-1991); close_page_finish clears the flag then returns on !confirm (:4428-4431)',
        pages: [{ id: 'A', pinned: true }, { id: 'B' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'closePage', id: 'A' }],
        opResults: [true],
        changes: [],
        closeAttempts: ['A'],
        order: ['A', 'B'],
        nPinnedPages: 1,
        selectedId: 'A',
        selectedIndex: 0,
        closing: [],
    },

    {
        rule: 'a deferred close is re-entrant-safe: the second request is ignored and the handler does NOT run again — the seam that lets an app show "save before closing?"',
        derivedFrom:
            '`if (page->closing) return;` (adw-tab-view.c:4396-4397); close_page_finish clears the flag and returns without detaching when confirm is FALSE (:4428-4431)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        handler: 'defer',
        setupChanges: AUTO_SELECT('A'),
        ops: [
            { kind: 'closePage', id: 'B' },
            { kind: 'closePage', id: 'B' },
            { kind: 'closePageFinish', id: 'B', confirm: false },
        ],
        opResults: [true, false, false],
        changes: [],
        closeAttempts: ['B'],
        order: ['A', 'B', 'C'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
        closing: [],
    },
    {
        rule: 'a deferred close that is later CONFIRMED detaches the page, successor rule and all',
        derivedFrom: 'close_page_finish with confirm TRUE calls detach_page (adw-tab-view.c:4436)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        handler: 'defer',
        setupChanges: AUTO_SELECT('A'),
        ops: [
            { kind: 'select', id: 'B' },
            { kind: 'closePage', id: 'B' },
            { kind: 'closePageFinish', id: 'B', confirm: true },
        ],
        opResults: [true, true, true],
        changes: [
            { selectedId: 'B', selectedIndex: 1, previousId: 'A', interactive: true },
            { selectedId: 'C', selectedIndex: 2, previousId: 'B', interactive: false },
        ],
        closeAttempts: ['B'],
        order: ['A', 'C'],
        nPinnedPages: 0,
        selectedId: 'C',
        selectedIndex: 1,
        closing: [],
    },

    {
        rule: 'closePagesAfter walks DESCENDING — the order is part of the spec, because each confirmed close shifts every later index',
        derivedFrom: '`for (i = self->n_pages - 1; i > pos; i--)` (adw-tab-view.c:4511)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'closePagesAfter', id: 'B' }],
        opResults: [null],
        changes: [],
        closeAttempts: ['D', 'C'],
        order: ['A', 'B'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
    },
    {
        rule: 'closePagesBefore walks DESCENDING too',
        derivedFrom: '`for (i = pos - 1; i >= 0; i--)` (adw-tab-view.c:4485)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [
            { kind: 'select', id: 'D' },
            { kind: 'closePagesBefore', id: 'C' },
        ],
        opResults: [true, null],
        changes: [{ selectedId: 'D', selectedIndex: 3, previousId: 'A', interactive: true }],
        closeAttempts: ['B', 'A'],
        order: ['C', 'D'],
        nPinnedPages: 0,
        selectedId: 'D',
        selectedIndex: 1,
    },
    {
        rule: 'closeOtherPages skips the kept page and leaves the selection on it throughout',
        derivedFrom:
            '`for (i = self->n_pages - 1; i >= 0; i--)` with `if (p == page) continue;` (adw-tab-view.c:4456-4462)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [
            { kind: 'select', id: 'B' },
            { kind: 'closeOtherPages', id: 'B' },
        ],
        opResults: [true, null],
        changes: [{ selectedId: 'B', selectedIndex: 1, previousId: 'A', interactive: true }],
        closeAttempts: ['C', 'A'],
        order: ['B'],
        nPinnedPages: 0,
        selectedId: 'B',
        selectedIndex: 0,
    },

    {
        rule: 'pinning moves the page to the end of the pinned prefix and grows the prefix',
        derivedFrom:
            'old_pos 2 removed, new_pos = n_pinned_pages = 1, insert at 1, n_pinned = new_pos + 1 = 2 (adw-tab-view.c:4062-4077)',
        pages: [{ id: 'A', pinned: true }, { id: 'B' }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'setPinned', id: 'C', pinned: true }],
        opResults: [1],
        changes: [],
        pagesChanges: [{ kind: 'pinned', id: 'C', position: 1, previousPosition: 2 }],
        order: ['A', 'C', 'B'],
        nPinnedPages: 2,
        selectedId: 'A',
        selectedIndex: 0,
    },
    {
        rule: 'unpinning moves the page to just BEFORE the other non-pinned pages',
        derivedFrom:
            'old_pos 0 removed, new_pos = 2 - 1 = 1, insert at 1, n_pinned = new_pos + 0 = 1 (adw-tab-view.c:4066-4077)',
        pages: [{ id: 'A', pinned: true }, { id: 'B', pinned: true }, { id: 'C' }, { id: 'D' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'setPinned', id: 'A', pinned: false }],
        opResults: [1],
        changes: [],
        pagesChanges: [{ kind: 'pinned', id: 'A', position: 1, previousPosition: 0 }],
        order: ['B', 'A', 'C', 'D'],
        nPinnedPages: 1,
        selectedId: 'A',
        selectedIndex: 1,
    },
    {
        rule: 'unpinning the LAST pinned page changes the count without moving anything — new_pos lands exactly where the page already was',
        derivedFrom:
            'old_pos 1 removed -> [A,C]; new_pos = 2 - 1 = 1; insert at 1 -> [A,B,C]; n_pinned = 1 (adw-tab-view.c:4066-4077)',
        pages: [{ id: 'A', pinned: true }, { id: 'B', pinned: true }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'setPinned', id: 'B', pinned: false }],
        opResults: [1],
        changes: [],
        pagesChanges: [{ kind: 'pinned', id: 'B', position: 1, previousPosition: 1 }],
        order: ['A', 'B', 'C'],
        nPinnedPages: 1,
        selectedId: 'A',
        selectedIndex: 0,
    },
    {
        rule: 'pinning an already-pinned page is a no-op that emits nothing',
        derivedFrom: '`if (adw_tab_page_get_pinned (page) == pinned) return;` (adw-tab-view.c:4059-4060)',
        pages: [{ id: 'A', pinned: true }, { id: 'B' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'setPinned', id: 'A', pinned: true }],
        opResults: [-1],
        changes: [],
        pagesChanges: [],
        order: ['A', 'B'],
        nPinnedPages: 1,
        selectedId: 'A',
        selectedIndex: 0,
    },

    {
        rule: 'addPage inserts after the parent AND after every consecutive descendant of it, so links opened from one tab keep their order',
        derivedFrom:
            'position starts at pos(P) = 0, then the do/while advances past every consecutive descendant of P and stops at X (adw-tab-view.c:4208-4217)',
        pages: [{ id: 'P' }, { id: 'C1', parentId: 'P' }, { id: 'C2', parentId: 'P' }, { id: 'X' }],
        setupChanges: AUTO_SELECT('P'),
        ops: [{ kind: 'addPage', page: { id: 'N' }, parentId: 'P' }],
        opResults: [3],
        changes: [],
        pagesChanges: [{ kind: 'attached', id: 'N', position: 3, previousPosition: -1 }],
        order: ['P', 'C1', 'C2', 'N', 'X'],
        nPinnedPages: 0,
        selectedId: 'P',
        selectedIndex: 0,
    },
    {
        rule: 'a PINNED parent inserts after the last pinned page, and the new page is itself NOT pinned',
        derivedFrom:
            'a pinned parent sets position = n_pinned_pages - 1 = 1 and the loop increments to 2 (adw-tab-view.c:4205-4217); create_and_insert_page is called with pinned = FALSE (:4222)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'addPage', page: { id: 'N' }, parentId: 'P0' }],
        opResults: [2],
        changes: [],
        order: ['P0', 'P1', 'N', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'P0',
        selectedIndex: 0,
    },
    {
        rule: 'a null parent appends',
        derivedFrom: '`position = self->n_pages;` for a NULL parent (adw-tab-view.c:4219)',
        pages: [{ id: 'A' }, { id: 'B' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'addPage', page: { id: 'N' }, parentId: null }],
        opResults: [2],
        changes: [],
        order: ['A', 'B', 'N'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
    },
    {
        rule: 'the FIRST page added auto-selects and notifies; the second does not — and the attach is heard before the selection, so a renderer has built the tab by then',
        derivedFrom:
            "insert_page auto-selects only when there is no selection: `if (!self->selected_page) set_selected_page (self, page, FALSE);` (adw-tab-view.c:1953-1954), inside the freeze/thaw that follows attach_page's page-attached signal (:1748-1778)",
        pages: [],
        setupChanges: [],
        ops: [
            { kind: 'appendPage', page: { id: 'A' } },
            { kind: 'appendPage', page: { id: 'B' } },
        ],
        opResults: [0, 1],
        changes: [{ selectedId: 'A', selectedIndex: 0, previousId: null, interactive: false }],
        pagesChanges: [
            { kind: 'attached', id: 'A', position: 0, previousPosition: -1 },
            { kind: 'attached', id: 'B', position: 1, previousPosition: -1 },
        ],
        order: ['A', 'B'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
    },
    {
        rule: 'a non-pinned insert BEFORE a pinned page is refused outright, not clamped',
        derivedFrom: '`g_return_val_if_fail (position >= self->n_pinned_pages, NULL)` (adw-tab-view.c:4246)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'insertPage', page: { id: 'N' }, position: 1 }],
        opResults: [-1],
        changes: [],
        pagesChanges: [],
        order: ['P0', 'P1', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'P0',
        selectedIndex: 0,
        diagnostics: ["adw_tab_view_insert: assertion 'position >= self->n_pinned_pages' failed"],
    },
    {
        rule: 'a pinned insert AFTER a non-pinned page is refused outright',
        derivedFrom: '`g_return_val_if_fail (position <= self->n_pinned_pages, NULL)` (adw-tab-view.c:4313)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'insertPinnedPage', page: { id: 'N' }, position: 3 }],
        opResults: [-1],
        changes: [],
        order: ['P0', 'P1', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'P0',
        selectedIndex: 0,
        diagnostics: ["adw_tab_view_insert_pinned: assertion 'position <= self->n_pinned_pages' failed"],
    },
    {
        rule: 'prepend inserts at the pinned boundary and shifts the selection with its page',
        derivedFrom: '`create_and_insert_page (self, child, NULL, self->n_pinned_pages, FALSE)` (adw-tab-view.c:4268)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [
            { kind: 'select', id: 'A' },
            { kind: 'prependPage', page: { id: 'N' } },
        ],
        opResults: [true, 2],
        changes: [{ selectedId: 'A', selectedIndex: 2, previousId: 'P0', interactive: true }],
        order: ['P0', 'P1', 'N', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'A',
        selectedIndex: 3,
    },
    {
        rule: 'appendPinnedPage grows the pinned prefix and pushes the non-pinned pages back',
        derivedFrom: '`create_and_insert_page (self, child, NULL, self->n_pinned_pages, TRUE)` (adw-tab-view.c:4356)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'appendPinnedPage', page: { id: 'P2' } }],
        opResults: [2],
        changes: [],
        order: ['P0', 'P1', 'P2', 'A', 'B'],
        nPinnedPages: 3,
        selectedId: 'P0',
        selectedIndex: 0,
    },

    {
        rule: 'selectFirst from the FIRST non-pinned tab hops the partition boundary into pinned territory',
        derivedFrom:
            'pos = n_pinned_pages = 2 gives A itself, and since !pinned it falls back to nth(0) (adw-tab-view.c:3776-3782)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'select', id: 'A' }, { kind: 'selectFirst' }],
        opResults: [true, true],
        changes: [
            { selectedId: 'A', selectedIndex: 2, previousId: 'P0', interactive: true },
            { selectedId: 'P0', selectedIndex: 0, previousId: 'A', interactive: true },
        ],
        order: ['P0', 'P1', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'P0',
        selectedIndex: 0,
    },
    {
        rule: 'selectFirst from a later non-pinned tab stops at the first NON-pinned one, not at index 0',
        derivedFrom:
            'pos = n_pinned_pages = 2 gives A, which is not the selected page, so no fallback (adw-tab-view.c:3776-3781)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'select', id: 'B' }, { kind: 'selectFirst' }],
        opResults: [true, true],
        changes: [
            { selectedId: 'B', selectedIndex: 3, previousId: 'P0', interactive: true },
            { selectedId: 'A', selectedIndex: 2, previousId: 'B', interactive: true },
        ],
        order: ['P0', 'P1', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'A',
        selectedIndex: 2,
    },
    {
        rule: 'selectFirst on the first PINNED tab does nothing — the hop only exists in the non-pinned direction',
        derivedFrom:
            'pinned -> pos = 0 -> page == selected_page and the !pinned fallback does not apply (adw-tab-view.c:3776, :3784-3785)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'selectFirst' }],
        opResults: [false],
        changes: [],
        order: ['P0', 'P1', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'P0',
        selectedIndex: 0,
    },
    {
        rule: 'selectLast from the LAST pinned tab hops to the last non-pinned one',
        derivedFrom:
            'pinned -> pos = n_pinned_pages - 1 = 1 gives P1 itself, and since pinned it falls back to nth(n_pages - 1) (adw-tab-view.c:3805-3811)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'select', id: 'P1' }, { kind: 'selectLast' }],
        opResults: [true, true],
        changes: [
            { selectedId: 'P1', selectedIndex: 1, previousId: 'P0', interactive: true },
            { selectedId: 'B', selectedIndex: 3, previousId: 'P1', interactive: true },
        ],
        order: ['P0', 'P1', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'B',
        selectedIndex: 3,
    },
    {
        rule: 'selectLast on the last non-pinned tab does nothing',
        derivedFrom:
            '!pinned -> pos = n_pages - 1 = 3 gives B, no fallback for non-pinned, page == selected (adw-tab-view.c:3805, :3813-3814)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'select', id: 'B' }, { kind: 'selectLast' }],
        opResults: [true, false],
        changes: [{ selectedId: 'B', selectedIndex: 3, previousId: 'P0', interactive: true }],
        order: ['P0', 'P1', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'B',
        selectedIndex: 3,
    },
    {
        rule: 'selectNext STOPS at the last page — it does not wrap',
        derivedFrom: '`if (pos >= self->n_pages - 1) return FALSE;` (adw-tab-view.c:3753-3754)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'select', id: 'C' }, { kind: 'selectNext' }],
        opResults: [true, false],
        changes: [{ selectedId: 'C', selectedIndex: 2, previousId: 'A', interactive: true }],
        order: ['A', 'B', 'C'],
        nPinnedPages: 0,
        selectedId: 'C',
        selectedIndex: 2,
    },
    {
        rule: 'Ctrl+Tab WRAPS where selectNext stops',
        derivedFrom:
            'select_page_cb forward branch: on select_next failure with last == FALSE it selects nth(0) (adw-tab-view.c:2035-2041)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'select', id: 'C' }, { kind: 'cycleNext' }],
        opResults: [true, true],
        changes: [
            { selectedId: 'C', selectedIndex: 2, previousId: 'A', interactive: true },
            { selectedId: 'A', selectedIndex: 0, previousId: 'C', interactive: true },
        ],
        order: ['A', 'B', 'C'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
    },
    {
        rule: 'Ctrl+Shift+Tab wraps backwards to the last page',
        derivedFrom:
            'select_page_cb backward branch: on select_previous failure with last == FALSE it selects nth(n_pages - 1) (adw-tab-view.c:2022-2028)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'cyclePrevious' }],
        opResults: [true],
        changes: [{ selectedId: 'C', selectedIndex: 2, previousId: 'A', interactive: true }],
        order: ['A', 'B', 'C'],
        nPinnedPages: 0,
        selectedId: 'C',
        selectedIndex: 2,
    },
    {
        rule: 'Ctrl+Tab on a single-page view does nothing and rings nothing — the shortcut propagates to whatever contains the view',
        derivedFrom: '`if (self->n_pages <= 1) return GDK_EVENT_PROPAGATE;` (adw-tab-view.c:2008)',
        pages: [{ id: 'A' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'cycleNext' }, { kind: 'cyclePrevious' }],
        opResults: [false, false],
        changes: [],
        order: ['A'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
    },
    {
        rule: 'Alt+0 maps to page index 9 and is ignored on a shorter view',
        derivedFrom:
            '`if (n_page >= self->n_pages) return GDK_EVENT_PROPAGATE;` with Alt+0 mapped to n_page 9 (adw-tab-view.c:2145, :2149-2150)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'selectNth', n: 9 }],
        opResults: [false],
        changes: [],
        order: ['A', 'B', 'C'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
    },
    {
        rule: 'Alt+1 on the already-selected page changes nothing and notifies nothing',
        derivedFrom:
            '`if (adw_tab_view_get_selected_page (self) == page) return GDK_EVENT_PROPAGATE;` (adw-tab-view.c:2158-2159)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'selectNth', n: 0 }],
        opResults: [false],
        changes: [],
        order: ['A', 'B', 'C'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
    },
    {
        rule: 'REGRESSION PIN — a negative and a FRACTIONAL index are both refused. NS stored 1.7, so no page index matched it, every page collapsed and a notify still fired with selected: 1.7',
        derivedFrom:
            'adw_tab_view_get_nth_page takes an `int` and asserts `position >= 0` / `position < n_pages` (adw-tab-view.c:4126-4134); no fractional and no clamping path exists anywhere in the file',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [
            { kind: 'selectNth', n: -1 },
            { kind: 'selectNth', n: 1.7 },
            { kind: 'selectNth', n: 99 },
        ],
        opResults: [false, false, false],
        changes: [],
        order: ['A', 'B', 'C'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
    },
    {
        rule: 'selection is keyed by IDENTITY, so two tabs with the same title are still distinguishable',
        derivedFrom:
            'libadwaita keys selection by AdwTabPage pointer, never by title (adw_tab_view_set_selected_page, adw-tab-view.c:3682-3695); the string id is the platform-neutral stand-in',
        pages: [
            { id: 'page-1', title: 'Untitled' },
            { id: 'page-2', title: 'Untitled' },
        ],
        setupChanges: AUTO_SELECT('page-1'),
        ops: [{ kind: 'select', id: 'page-2' }],
        opResults: [true],
        changes: [{ selectedId: 'page-2', selectedIndex: 1, previousId: 'page-1', interactive: true }],
        order: ['page-1', 'page-2'],
        nPinnedPages: 0,
        selectedId: 'page-2',
        selectedIndex: 1,
    },
    {
        rule: 'selecting an unknown id leaves the selection alone and records the precondition C asserts',
        derivedFrom: '`g_return_if_fail (page_belongs_to_this_view (self, selected_page))` (adw-tab-view.c:3689)',
        pages: [{ id: 'A' }, { id: 'B' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'select', id: 'does-not-exist' }],
        opResults: [false],
        changes: [],
        order: ['A', 'B'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
        diagnostics: [
            "adw_tab_view_set_selected_page: assertion 'page_belongs_to_this_view (self, selected_page)' failed",
        ],
    },
    {
        rule: 'selecting null is legal ONLY while the view is empty',
        derivedFrom:
            'the n_pages > 0 branch requires a real page; only the else branch accepts NULL (adw-tab-view.c:3687-3693)',
        pages: [{ id: 'A' }, { id: 'B' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'select', id: null }],
        opResults: [false],
        changes: [],
        order: ['A', 'B'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
        diagnostics: ["adw_tab_view_set_selected_page: assertion 'ADW_IS_TAB_PAGE (selected_page)' failed"],
    },

    {
        rule: 'the first NON-pinned tab cannot be dragged backwards into pinned territory',
        derivedFrom:
            'first = n_pinned_pages = 2, pos = 2, `if (pos <= first) return FALSE;` (adw-tab-view.c:4597-4600)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'reorderBackward', id: 'A' }],
        opResults: [false],
        changes: [],
        pagesChanges: [],
        order: ['P0', 'P1', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'P0',
        selectedIndex: 0,
    },
    {
        rule: 'the last PINNED tab cannot be dragged forwards out of the pinned prefix',
        derivedFrom:
            'last = n_pinned_pages - 1 = 1, pos = 1, `if (pos >= last) return FALSE;` (adw-tab-view.c:4628-4631)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'reorderForward', id: 'P1' }],
        opResults: [false],
        changes: [],
        order: ['P0', 'P1', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'P0',
        selectedIndex: 0,
    },
    {
        rule: 'reorderFirst on a page already first in its partition returns false rather than moving it into the other partition',
        derivedFrom:
            "reorder_first targets pos = n_pinned_pages = 2, which equals A's position, and reorder_page returns FALSE when original_pos == position (adw-tab-view.c:4657, :4552-4553)",
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'reorderFirst', id: 'A' }],
        opResults: [false],
        changes: [],
        order: ['P0', 'P1', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'P0',
        selectedIndex: 0,
    },
    {
        rule: 'reorderLast on a pinned page stops at the END OF THE PINNED PREFIX, and the selection follows the page it is on',
        derivedFrom:
            'pinned -> pos = n_pinned_pages - 1 = 1 (adw-tab-view.c:4683), then reorder_page moves it (:4557-4558)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'reorderLast', id: 'P0' }],
        opResults: [true],
        changes: [],
        pagesChanges: [{ kind: 'reordered', id: 'P0', position: 1, previousPosition: 0 }],
        order: ['P1', 'P0', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'P0',
        selectedIndex: 1,
    },
    {
        rule: 'reorderPage moves a page and emits a reordered change — and notifies NO selection change, because the selected page never changed',
        derivedFrom:
            'remove at original_pos then insert at position, then emit page-reordered (adw-tab-view.c:4553-4561)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'reorder', id: 'A', position: 2 }],
        opResults: [true],
        changes: [],
        pagesChanges: [{ kind: 'reordered', id: 'A', position: 2, previousPosition: 0 }],
        order: ['B', 'C', 'A'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 2,
    },
    {
        rule: 'reordering a non-pinned page into the pinned prefix is refused',
        derivedFrom:
            'non-pinned branch: `g_return_val_if_fail (position >= self->n_pinned_pages, FALSE)` (adw-tab-view.c:4546)',
        pages: PINNED_FIXTURE,
        setupChanges: AUTO_SELECT('P0'),
        ops: [{ kind: 'reorder', id: 'A', position: 1 }],
        opResults: [false],
        changes: [],
        order: ['P0', 'P1', 'A', 'B'],
        nPinnedPages: 2,
        selectedId: 'P0',
        selectedIndex: 0,
        diagnostics: ["adw_tab_view_reorder_page: assertion 'position >= self->n_pinned_pages' failed"],
    },

    {
        rule: 'detaching a parent re-points its children at the GRANDparent, so the successor rule keeps working for them',
        derivedFrom:
            'page_parent_notify_cb re-parents to the grandparent when the parent page is finalized (adw-tab-view.c:293-303); detach_page drops the last reference (:1915, :1938)',
        pages: [{ id: 'G' }, { id: 'P', parentId: 'G' }, { id: 'C', parentId: 'P' }, { id: 'Z' }],
        setupChanges: AUTO_SELECT('G'),
        ops: [
            { kind: 'detach', id: 'P' },
            { kind: 'select', id: 'C' },
            { kind: 'closePage', id: 'C' },
        ],
        opResults: [true, true, true],
        changes: [
            { selectedId: 'C', selectedIndex: 1, previousId: 'G', interactive: true },
            // The discriminating step: with the re-parent C's parent is G and the
            // previous page IS G, so the descendant branch selects it. With a
            // DANGLING parent id both parent branches miss and the next/previous
            // fallback would select Z instead.
            { selectedId: 'G', selectedIndex: 0, previousId: 'C', interactive: false },
        ],
        order: ['G', 'Z'],
        nPinnedPages: 0,
        selectedId: 'G',
        selectedIndex: 0,
    },
    {
        rule: 'a page title is LIVE: setting it emits an updated change, and null coerces to the empty string',
        derivedFrom:
            '`g_set_str (&self->title, title ? title : "")` then notify::title (adw-tab-view.c:3021-3024), which AdwTab connects to in order to re-render the label (adw-tab.c:930-931)',
        pages: [
            { id: 'A', title: 'One' },
            { id: 'B', title: 'Two' },
        ],
        setupChanges: AUTO_SELECT('A'),
        ops: [
            { kind: 'setTitle', id: 'B', title: 'Renamed' },
            { kind: 'setTitle', id: 'B', title: 'Renamed' },
            { kind: 'setTitle', id: 'B', title: null },
        ],
        opResults: [true, false, true],
        changes: [],
        pagesChanges: [
            { kind: 'updated', id: 'B', position: 1, previousPosition: 1 },
            { kind: 'updated', id: 'B', position: 1, previousPosition: 1 },
        ],
        order: ['A', 'B'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
    },
    {
        rule: 'a duplicate page id is refused — two pages sharing an id would be two pages sharing an AdwTabPage pointer',
        derivedFrom:
            'every lookup in adw-tab-view.c compares AdwTabPage POINTERS (get_page_position, :4160-4165), a relation the string id stands in for; C cannot reach a duplicate, so refusing is the only unambiguous reading',
        pages: [{ id: 'A' }, { id: 'B' }],
        setupChanges: AUTO_SELECT('A'),
        ops: [{ kind: 'appendPage', page: { id: 'A' } }],
        opResults: [-1],
        changes: [],
        pagesChanges: [],
        order: ['A', 'B'],
        nPinnedPages: 0,
        selectedId: 'A',
        selectedIndex: 0,
        diagnostics: ["adw_tab_view_insert: assertion 'page id 'A' is unique' failed"],
    },
];

/**
 * The surface a vector driver needs.
 *
 * Deliberately STRUCTURAL and named exactly as `TabViewState` names things, so all
 * three suites hand their subject straight to {@link applyTabViewOp} with no
 * translation layer. A renderer that cannot be passed here has stopped being a
 * thin adapter, which is the thing these vectors exist to catch.
 */
export interface TabViewVectorTarget {
    /** The ordered pages — only the three fields a vector reads. */
    readonly pages: readonly { readonly id: string; readonly title: string; readonly pinned: boolean }[];
    readonly nPinnedPages: number;
    /** Selected page id, `null` when the view is empty. */
    readonly selectedId: string | null;
    /** Selected index, `-1` when the view is empty. */
    readonly selectedIndex: number;
    /** Whether a close request for `id` is awaiting confirmation. */
    isClosing(id: string): boolean;
    setSelectedPage(id: string | null): boolean;
    selectNthPage(n: number): boolean;
    selectPreviousPage(): boolean;
    selectNextPage(): boolean;
    selectFirstPage(): boolean;
    selectLastPage(): boolean;
    cycleNextPage(): boolean;
    cyclePreviousPage(): boolean;
    addPage(spec: { id: string; title?: string | null }, parentId: string | null): number;
    insertPage(spec: { id: string; title?: string | null }, position: number): number;
    prependPage(spec: { id: string; title?: string | null }): number;
    appendPage(spec: { id: string; title?: string | null }): number;
    insertPinnedPage(spec: { id: string; title?: string | null }, position: number): number;
    prependPinnedPage(spec: { id: string; title?: string | null }): number;
    appendPinnedPage(spec: { id: string; title?: string | null }): number;
    setPagePinned(id: string, pinned: boolean): number;
    closePage(id: string): boolean;
    closePageFinish(id: string, confirm: boolean): boolean;
    closeOtherPages(id: string): void;
    closePagesBefore(id: string): void;
    closePagesAfter(id: string): void;
    detachPage(id: string): unknown;
    reorderPage(id: string, position: number): boolean;
    reorderBackward(id: string): boolean;
    reorderForward(id: string): boolean;
    reorderFirst(id: string): boolean;
    reorderLast(id: string): boolean;
    setPageTitle(id: string, title: string | null): boolean;
}

/**
 * Seed a vector's pages, choosing the insertion call each page's declaration implies: a
 * pinned page through `appendPinnedPage` (so the pinned prefix builds up in declaration
 * order), a parented one through `addPage` (so the position is DERIVED, which is itself
 * under test), everything else through `appendPage`.
 *
 * Every vector's declared order is also the order this produces, asserted right after
 * seeding — which turns the fixtures into a test of `adw_tab_view_add_page`'s position
 * derivation.
 */
export function seedTabViewPages(target: TabViewVectorTarget, pages: readonly TabViewVectorPage[]): void {
    for (const page of pages) {
        const spec = { id: page.id, title: page.title };
        if (page.parentId !== undefined) target.addPage(spec, page.parentId);
        else if (page.pinned) target.appendPinnedPage(spec);
        else target.appendPage(spec);
    }
}

/**
 * Apply one vector operation, returning what it returned — `null` for the ops
 * that return nothing, so a vector's `opResults` stays a flat, comparable list.
 */
export function applyTabViewOp(target: TabViewVectorTarget, op: TabViewVectorOp): boolean | number | null {
    switch (op.kind) {
        case 'select':
            return target.setSelectedPage(op.id);
        case 'selectNth':
            return target.selectNthPage(op.n);
        case 'selectPrevious':
            return target.selectPreviousPage();
        case 'selectNext':
            return target.selectNextPage();
        case 'selectFirst':
            return target.selectFirstPage();
        case 'selectLast':
            return target.selectLastPage();
        case 'cycleNext':
            return target.cycleNextPage();
        case 'cyclePrevious':
            return target.cyclePreviousPage();
        case 'addPage':
            return target.addPage({ id: op.page.id, title: op.page.title }, op.parentId);
        case 'insertPage':
            return target.insertPage({ id: op.page.id, title: op.page.title }, op.position);
        case 'prependPage':
            return target.prependPage({ id: op.page.id, title: op.page.title });
        case 'appendPage':
            return target.appendPage({ id: op.page.id, title: op.page.title });
        case 'insertPinnedPage':
            return target.insertPinnedPage({ id: op.page.id, title: op.page.title }, op.position);
        case 'prependPinnedPage':
            return target.prependPinnedPage({ id: op.page.id, title: op.page.title });
        case 'appendPinnedPage':
            return target.appendPinnedPage({ id: op.page.id, title: op.page.title });
        case 'setPinned':
            return target.setPagePinned(op.id, op.pinned);
        case 'closePage':
            return target.closePage(op.id);
        case 'closePageFinish':
            return target.closePageFinish(op.id, op.confirm);
        case 'closeOtherPages':
            target.closeOtherPages(op.id);
            return null;
        case 'closePagesBefore':
            target.closePagesBefore(op.id);
            return null;
        case 'closePagesAfter':
            target.closePagesAfter(op.id);
            return null;
        case 'detach':
            return target.detachPage(op.id) !== null;
        case 'reorder':
            return target.reorderPage(op.id, op.position);
        case 'reorderBackward':
            return target.reorderBackward(op.id);
        case 'reorderForward':
            return target.reorderForward(op.id);
        case 'reorderFirst':
            return target.reorderFirst(op.id);
        case 'reorderLast':
            return target.reorderLast(op.id);
        case 'setTitle':
            return target.setPageTitle(op.id, op.title);
    }
}

/** The page ids in order — what every vector's `order` is compared against. */
export function tabViewOrder(target: TabViewVectorTarget): string[] {
    return target.pages.map((page) => page.id);
}

/** Which of a vector's pages are still awaiting a `closePageFinish`, in page order. */
export function tabViewClosing(target: TabViewVectorTarget): string[] {
    return target.pages.filter((page) => target.isClosing(page.id)).map((page) => page.id);
}

/** One `successorAfterClose` expectation — the close-successor kernel on its own. */
export interface TabSuccessorVector {
    rule: string;
    /** The C lines it is derived from. */
    derivedFrom: string;
    pages: readonly TabViewVectorPage[];
    closingId: string;
    selectedId: string | null;
    /** Who ends up selected — `null` when the view empties. */
    successorId: string | null;
}

/**
 * `select_previous_page` with no view around it.
 *
 * These are the same rules the end-to-end rows exercise, stated as pure inputs
 * so a failure names the RULE rather than the script that reached it.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (TAB_VIEW_VECTORS)
 */
export const TAB_SUCCESSOR_VECTORS: ReadonlyArray<TabSuccessorVector> = [
    {
        rule: 'closing a page that is not selected moves nothing',
        derivedFrom: '`if (page != self->selected_page) return;` (adw-tab-view.c:1864-1865)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        closingId: 'A',
        selectedId: 'C',
        successorId: 'C',
    },
    {
        rule: 'a parentless page falls to the NEXT page',
        derivedFrom: '`if (adw_tab_view_select_next_page (self)) return;` (adw-tab-view.c:1893-1894)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        closingId: 'B',
        selectedId: 'B',
        successorId: 'C',
    },
    {
        rule: 'the last page falls to the previous one',
        derivedFrom: 'select_next_page fails, so adw_tab_view_select_previous_page runs (adw-tab-view.c:1896)',
        pages: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        closingId: 'C',
        selectedId: 'C',
        successorId: 'B',
    },
    {
        rule: 'the only page leaves nothing selected',
        derivedFrom:
            'neither select_next_page nor select_previous_page can move; detach_page then sets NULL (adw-tab-view.c:1912-1913)',
        pages: [{ id: 'A' }],
        closingId: 'A',
        selectedId: 'A',
        successorId: null,
    },
    {
        rule: 'a page IS its own descendant, so "the previous page is the opener" selects the opener',
        derivedFrom:
            'is_descendant_of exits the while-loop immediately for page == parent (adw-tab-view.c:1735-1742), reached from :1874',
        pages: [{ id: 'P' }, { id: 'X', parentId: 'P' }, { id: 'Y' }],
        closingId: 'X',
        selectedId: 'X',
        successorId: 'P',
    },
    {
        rule: 'a sibling opened from the same parent wins over the next page',
        derivedFrom: 'is_descendant_of (prev_page, parent) with prev_page.parent == parent (adw-tab-view.c:1874-1877)',
        pages: [{ id: 'P' }, { id: 'C1', parentId: 'P' }, { id: 'C2', parentId: 'P' }, { id: 'Z' }],
        closingId: 'C2',
        selectedId: 'C2',
        successorId: 'C1',
    },
    {
        rule: 'an INDIRECT descendant counts — the walk follows the whole parent chain',
        derivedFrom:
            '`while (page && page != parent) page = adw_tab_page_get_parent (page);` (adw-tab-view.c:1738-1739)',
        pages: [{ id: 'P' }, { id: 'C1', parentId: 'P' }, { id: 'G1', parentId: 'C1' }, { id: 'C2', parentId: 'P' }],
        closingId: 'C2',
        selectedId: 'C2',
        successorId: 'G1',
    },
    {
        rule: 'when the previous page is a DIFFERENT pinned tab, the pinned parent is selected instead',
        derivedFrom:
            '`if (adw_tab_page_get_pinned (prev_page) && adw_tab_page_get_pinned (parent))` (adw-tab-view.c:1885-1890)',
        pages: [
            { id: 'P0', pinned: true },
            { id: 'P1', pinned: true },
            { id: 'X', parentId: 'P0' },
        ],
        closingId: 'X',
        selectedId: 'X',
        successorId: 'P0',
    },
    {
        rule: 'an unrelated previous page with a NON-pinned parent falls through to the ordinary next/previous rule',
        derivedFrom: 'neither the descendant branch nor the both-pinned branch fires, so :1893-1896 decides',
        pages: [{ id: 'P' }, { id: 'U' }, { id: 'X', parentId: 'P' }, { id: 'Z' }],
        closingId: 'X',
        selectedId: 'X',
        successorId: 'Z',
    },
    {
        rule: 'a page with a parent that is FIRST in the list skips the parent rules entirely (pos > 0 fails)',
        derivedFrom: '`if (parent && pos > 0)` (adw-tab-view.c:1867)',
        pages: [{ id: 'X', parentId: 'P' }, { id: 'Y' }],
        closingId: 'X',
        selectedId: 'X',
        successorId: 'Y',
    },
];

/** One `isDescendantOfPage` expectation. */
export interface TabDescendantVector {
    rule: string;
    pages: readonly TabViewVectorPage[];
    pageId: string | null;
    parentId: string;
    descendant: boolean;
}

/**
 * `is_descendant_of`.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (TAB_VIEW_VECTORS)
 */
export const TAB_DESCENDANT_VECTORS: ReadonlyArray<TabDescendantVector> = [
    {
        rule: 'a page IS its own descendant — the loop condition fails before the first step',
        pages: [{ id: 'P' }],
        pageId: 'P',
        parentId: 'P',
        descendant: true,
    },
    {
        rule: 'a direct child is a descendant',
        pages: [{ id: 'P' }, { id: 'C', parentId: 'P' }],
        pageId: 'C',
        parentId: 'P',
        descendant: true,
    },
    {
        rule: 'an indirect child is a descendant',
        pages: [{ id: 'P' }, { id: 'C', parentId: 'P' }, { id: 'G', parentId: 'C' }],
        pageId: 'G',
        parentId: 'P',
        descendant: true,
    },
    {
        rule: 'an unrelated page is not',
        pages: [{ id: 'P' }, { id: 'U' }],
        pageId: 'U',
        parentId: 'P',
        descendant: false,
    },
    {
        rule: 'the relation is not symmetric — the parent is not a descendant of its child',
        pages: [{ id: 'P' }, { id: 'C', parentId: 'P' }],
        pageId: 'P',
        parentId: 'C',
        descendant: false,
    },
    {
        rule: 'a null page reaches nothing',
        pages: [{ id: 'P' }],
        pageId: null,
        parentId: 'P',
        descendant: false,
    },
];

/** One `tabsRevealed` expectation. */
export interface TabsRevealedVector {
    /** `AdwTabBar:autohide`. */
    autohide: boolean;
    /** `adw_tab_view_get_n_pages`. */
    nPages: number;
    /** `adw_tab_view_get_n_pinned_pages`. */
    nPinnedPages: number;
    /** `adw_tab_view_get_is_transferring_page`. */
    isTransferringPage: boolean;
    revealed: boolean;
    rule: string;
}

/**
 * `update_autohide_cb`, verbatim:
 * `!autohide || n_tabs > 1 || n_pinned_tabs >= 1 || is_transferring_page`.
 */
export const TABS_REVEALED_VECTORS: ReadonlyArray<TabsRevealedVector> = [
    {
        autohide: true,
        nPages: 1,
        nPinnedPages: 0,
        isTransferringPage: false,
        revealed: false,
        rule: 'a lone ordinary tab hides the bar',
    },
    {
        autohide: true,
        nPages: 2,
        nPinnedPages: 0,
        isTransferringPage: false,
        revealed: true,
        rule: 'two tabs keep it up',
    },
    {
        autohide: true,
        nPages: 1,
        nPinnedPages: 1,
        isTransferringPage: false,
        revealed: true,
        rule: 'a single PINNED tab keeps the bar revealed — the clause missing from the web port',
    },
    {
        autohide: true,
        nPages: 0,
        nPinnedPages: 0,
        isTransferringPage: true,
        revealed: true,
        rule: 'a tab transfer in flight keeps the bar up so there is somewhere to drop',
    },
    {
        autohide: true,
        nPages: 0,
        nPinnedPages: 0,
        isTransferringPage: false,
        revealed: false,
        rule: 'an empty view with autohide hides the bar',
    },
    {
        autohide: false,
        nPages: 0,
        nPinnedPages: 0,
        isTransferringPage: false,
        revealed: true,
        rule: 'autohide off short-circuits to revealed, even with no pages at all',
    },
];

/** One `tabCloseVisible` expectation. */
export interface TabCloseVisibleVector {
    hovering: boolean;
    /** The tab is not clipped by the bar's scroll region. */
    fullyVisible: boolean;
    selected: boolean;
    dragging: boolean;
    pinned: boolean;
    visible: boolean;
    rule: string;
}

/**
 * `update_state`'s `show_close` plus the pinned gate applied at
 * construction. Each port shipped a different single term of
 * this — web showed it always, NS only on the selected tab.
 */
export const TAB_CLOSE_VISIBLE_VECTORS: ReadonlyArray<TabCloseVisibleVector> = [
    {
        hovering: false,
        fullyVisible: true,
        selected: true,
        dragging: false,
        pinned: false,
        visible: true,
        rule: 'the selected tab always shows it',
    },
    {
        hovering: true,
        fullyVisible: true,
        selected: false,
        dragging: false,
        pinned: false,
        visible: true,
        rule: 'a fully-visible hovered tab shows it',
    },
    {
        hovering: true,
        fullyVisible: false,
        selected: false,
        dragging: false,
        pinned: false,
        visible: false,
        rule: 'a hovered but partially scrolled-out tab does NOT',
    },
    {
        hovering: false,
        fullyVisible: true,
        selected: false,
        dragging: true,
        pinned: false,
        visible: true,
        rule: 'a dragged tab shows it even unhovered',
    },
    {
        hovering: false,
        fullyVisible: true,
        selected: false,
        dragging: false,
        pinned: false,
        visible: false,
        rule: 'an idle background tab shows nothing',
    },
    {
        hovering: true,
        fullyVisible: true,
        selected: true,
        dragging: true,
        pinned: true,
        visible: false,
        rule: 'a PINNED tab never shows a close button, whatever else is true',
    },
];

/** One `tabTooltip` expectation. */
export interface TabTooltipVector {
    /** `AdwTabPage:tooltip`. */
    tooltip: string;
    /** `AdwTabPage:title`. */
    title: string;
    text: string;
    /** Whether that text is Pango markup rather than plain text. */
    markup: boolean;
    rule: string;
}

/**
 * `update_tooltip`: a non-empty tooltip wins and is set as
 * MARKUP; an empty one falls back to the title, set as TEXT.
 *
 * CORE-ONLY: GAP, not a reason. Both renderers consume the derivation — the
 * browser sets `tab.title = tabTooltip(page)` (`elements/adw-tab-view.ts`),
 * NativeScript re-exports it as `tabTooltipText` (`widgets/tab-view-state.ts`) —
 * and neither is held to these rows. Both surfaces are readable from their own
 * suites, so wiring them is a loop, not new capability. Tracked in #1072
 */
export const TAB_TOOLTIP_VECTORS: ReadonlyArray<TabTooltipVector> = [
    {
        tooltip: '',
        title: 'Rechnungen 2026 – Übersicht 日本語',
        text: 'Rechnungen 2026 – Übersicht 日本語',
        markup: false,
        rule: 'the title fallback is plain text and non-ASCII survives byte for byte',
    },
    {
        tooltip: '<b>build failed</b>',
        title: 'main.c',
        text: '<b>build failed</b>',
        markup: true,
        rule: 'a non-empty tooltip wins and is MARKUP — a renderer must not push it through an HTML sink',
    },
    {
        tooltip: '',
        title: '',
        text: '',
        markup: false,
        rule: 'no tooltip and no title is the empty string, not undefined',
    },
    {
        tooltip: ' ',
        title: 'main.c',
        text: ' ',
        markup: true,
        rule: 'only the EMPTY string falls back — g_strcmp0 (tooltip, "") is the whole test, so a space is a tooltip',
    },
];

/** One `tabIconState` expectation. */
export interface TabIconStateVector {
    /** `AdwTabPage:icon`. */
    icon: string | null;
    /** `AdwTabPage:indicator-icon`. */
    indicatorIcon: string | null;
    /** `AdwTabPage:loading`. */
    loading: boolean;
    /** `AdwTabPage:pinned`. */
    pinned: boolean;
    /** `AdwTabView:default-icon`. */
    defaultIcon: string | null;
    /** The icon actually painted, `null` for none. */
    resolvedIcon: string | null;
    spinner: boolean;
    iconVisible: boolean;
    indicatorVisible: boolean;
    rule: string;
}

/** `update_icons`. */
export const TAB_ICON_STATE_VECTORS: ReadonlyArray<TabIconStateVector> = [
    {
        icon: 'text-x-generic',
        indicatorIcon: null,
        loading: true,
        pinned: false,
        defaultIcon: 'application-x-executable',
        resolvedIcon: 'text-x-generic',
        spinner: true,
        iconVisible: true,
        indicatorVisible: false,
        rule: 'loading draws a spinner in the slot WITHOUT dropping the icon name',
    },
    {
        icon: null,
        indicatorIcon: null,
        loading: false,
        pinned: true,
        defaultIcon: 'application-x-executable',
        resolvedIcon: 'application-x-executable',
        spinner: false,
        iconVisible: true,
        indicatorVisible: false,
        rule: 'a pinned page with no icon falls back to the view default-icon',
    },
    {
        icon: null,
        indicatorIcon: null,
        loading: false,
        pinned: false,
        defaultIcon: 'application-x-executable',
        resolvedIcon: null,
        spinner: false,
        iconVisible: false,
        indicatorVisible: false,
        rule: 'the default-icon fallback is PINNED-only — an ordinary tab with no icon shows none',
    },
    {
        icon: 'text-x-generic',
        indicatorIcon: 'media-record',
        loading: false,
        pinned: true,
        defaultIcon: 'application-x-executable',
        resolvedIcon: 'text-x-generic',
        spinner: false,
        iconVisible: false,
        indicatorVisible: true,
        rule: 'on a pinned tab the indicator REPLACES the icon — a pinned tab is a single-glyph chip',
    },
    {
        icon: 'text-x-generic',
        indicatorIcon: 'media-record',
        loading: false,
        pinned: false,
        defaultIcon: null,
        resolvedIcon: 'text-x-generic',
        spinner: false,
        iconVisible: true,
        indicatorVisible: true,
        rule: 'an ordinary tab shows icon AND indicator side by side',
    },
    {
        icon: null,
        indicatorIcon: null,
        loading: true,
        pinned: true,
        defaultIcon: 'application-x-executable',
        resolvedIcon: null,
        spinner: true,
        iconVisible: true,
        indicatorVisible: false,
        rule: 'a LOADING pinned page does not pick up the default icon — only the !loading branch assigns it',
    },
];

/** One page-descriptor normalization expectation. */
export interface TabPageDescriptorVector {
    rule: string;
    derivedFrom: string;
    spec: {
        id: string;
        title?: string | null;
        tooltip?: string | null;
        icon?: string | null;
        indicatorIcon?: string | null;
        loading?: boolean;
        needsAttention?: boolean;
    };
    title: string;
    /** Resolved `tooltip`. */
    tooltip: string;
    icon: string | null;
    /** Resolved `indicatorIcon`. */
    indicatorIcon: string | null;
    /** Resolved `loading`. */
    loading: boolean;
    /** Resolved `needsAttention`. */
    needsAttention: boolean;
}

/**
 * What a declared page resolves to.
 *
 * The `null → ''` coercions are `g_set_str (&self->title, title ? title : "")`
 * and its tooltip twin. The icon fields do NOT
 * coerce: "no icon" is a state `tabIconState` branches on, so `null` has to
 * survive.
 *
 * CORE-ONLY: GAP — a descriptor normaliser neither element routes its page input through. Tracked in #1072
 */
export const TAB_PAGE_DESCRIPTOR_VECTORS: ReadonlyArray<TabPageDescriptorVector> = [
    {
        rule: 'an omitted title is the empty string, never undefined — NS rendered the literal text "undefined" for a page without one',
        derivedFrom: 'adw_tab_page_set_title, adw-tab-view.c:3021',
        spec: { id: 'a' },
        title: '',
        tooltip: '',
        icon: null,
        indicatorIcon: null,
        loading: false,
        needsAttention: false,
    },
    {
        rule: 'an explicit null title coerces to the empty string too',
        derivedFrom: '`title ? title : ""` (adw-tab-view.c:3021)',
        spec: { id: 'a', title: null },
        title: '',
        tooltip: '',
        icon: null,
        indicatorIcon: null,
        loading: false,
        needsAttention: false,
    },
    {
        rule: 'a non-ASCII title is stored byte for byte, with no normalization',
        derivedFrom: 'g_set_str copies the UTF-8 string verbatim (adw-tab-view.c:3021)',
        spec: { id: 'a', title: 'Übersicht 日本語' },
        title: 'Übersicht 日本語',
        tooltip: '',
        icon: null,
        indicatorIcon: null,
        loading: false,
        needsAttention: false,
    },
    {
        rule: 'an absent icon stays NULL — unlike a view-stack icon name, which resolves to the empty string',
        derivedFrom: 'PAGE_PROP_ICON is a GIcon, and update_icons branches on `gicon != NULL` (adw-tab.c:194)',
        spec: { id: 'a', icon: null, indicatorIcon: null },
        title: '',
        tooltip: '',
        icon: null,
        indicatorIcon: null,
        loading: false,
        needsAttention: false,
    },
    {
        rule: 'every declared field survives',
        derivedFrom:
            'adw_tab_page_set_{title,tooltip,icon,indicator_icon,loading,needs_attention} (adw-tab-view.c:3016-3352)',
        spec: {
            id: 'a',
            title: 'main.c',
            tooltip: '<b>build failed</b>',
            icon: 'text-x-generic',
            indicatorIcon: 'media-record',
            loading: true,
            needsAttention: true,
        },
        title: 'main.c',
        tooltip: '<b>build failed</b>',
        icon: 'text-x-generic',
        indicatorIcon: 'media-record',
        loading: true,
        needsAttention: true,
    },
];
