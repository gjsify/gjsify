// Sidebar conformance vectors — the spec both renderers are held to.
//
// Every row is derived from a named function in the libadwaita C source. The
// tables exist because the three implementations answered the SAME question
// three different ways and nothing was in a position to notice: setting
// `selected = 5` on a 3-item sidebar produced "no selection" in libadwaita, `2`
// in `@gjsify/adwaita-web` (it clamped to the last row) and `0` in
// `@gjsify/adwaita-nativescript` (it rejected the write and kept the old value).
//
// A renderer that re-implements any of this instead of driving
// `@gjsify/adwaita-core`'s `SidebarState` fails these the moment it drifts.
//
// Reference: refs/libadwaita/src/adw-sidebar.c
// Reference: refs/libadwaita/src/adw-sidebar-item.c
// Reference: refs/libadwaita/src/adw-sidebar-section.c
// Copyright (c) 2025 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.

import type { AdwSidebarItemSpec, AdwSidebarSectionSpec, SidebarHeaderSpec } from '../sidebar.js';

/** One `clampSidebarSelection` expectation. */
export interface SidebarClampVector {
    /** The index handed to `AdwSidebar:selected`. */
    index: number;
    /** How many items the sidebar has (`n_items`). */
    count: number;
    /** What `selected` reads back as: the index itself, or `-1` for no selection. */
    selected: number;
    /** Why this row exists. */
    rule: string;
}

/**
 * `adw_sidebar_set_selected` (adw-sidebar.c:3028-3029):
 * `if (selected >= self->n_items) selected = GTK_INVALID_LIST_POSITION;`
 *
 * The negative rows are not a TS invention — `selected` is a `guint`, so `-7`
 * arrives as `4294967289`, which is `>= n_items`. The fractional/`NaN` rows are
 * the generalisation to values C cannot express: not a valid position is no
 * position. They are the inputs that used to be wrong — the web port truncated
 * `"1.5"` to row 1 and the NativeScript port stored `1.5` verbatim, highlighting
 * no row while reporting a selection.
 */
export const SIDEBAR_CLAMP_VECTORS: ReadonlyArray<SidebarClampVector> = [
    { index: 0, count: 3, selected: 0, rule: 'the first row is in range' },
    { index: 2, count: 3, selected: 2, rule: 'the last row is in range — in-range values pass through' },
    { index: 3, count: 3, selected: -1, rule: 'one past the end is NO SELECTION, not the last row' },
    { index: 5, count: 3, selected: -1, rule: 'far past the end is NO SELECTION — never clamped to 2' },
    { index: -1, count: 3, selected: -1, rule: 'the sentinel itself: -1 as a guint IS GTK_INVALID_LIST_POSITION' },
    { index: -7, count: 3, selected: -1, rule: 'any negative is 4294967289-ish as a guint, hence >= n_items' },
    { index: 0, count: 0, selected: -1, rule: 'an EMPTY sidebar has no selection — 0 >= 0 (adw-sidebar.c:2862)' },
    { index: 1.5, count: 3, selected: -1, rule: 'a fractional index is not a representable guint position' },
    { index: Number.NaN, count: 3, selected: -1, rule: 'NaN is not a position' },
    { index: Number.POSITIVE_INFINITY, count: 3, selected: -1, rule: 'Infinity is not a position' },
];

/** One `adjustSidebarSelection` expectation — an `items-changed` splice. */
export interface SidebarItemsChangedVector {
    /** `selected` before the splice. */
    selected: number;
    /** `n_items` before the splice. */
    oldCount: number;
    /** `n_items` after the splice. */
    newCount: number;
    /** Flat index the splice starts at. */
    position: number;
    /** How many items were removed. */
    removed: number;
    /** How many items were added. */
    added: number;
    /** `selected` after `items_changed_cb` has run. */
    expected: number;
    /** Why this row exists. */
    rule: string;
}

/**
 * `items_changed_cb` (adw-sidebar.c:2246-2284) — the derivation NEITHER port had.
 *
 * The last row documents libadwaita's unsigned wraparound: with no selection,
 * `selected` is `G_MAXUINT`, so the "splice covers the selection" test can never
 * fire and the shift branch computes `G_MAXUINT + added - removed`, which wraps
 * into range. It is reproduced rather than repaired — a renderer that "fixed" it
 * would stop matching the toolkit it mirrors.
 */
export const SIDEBAR_ITEMS_CHANGED_VECTORS: ReadonlyArray<SidebarItemsChangedVector> = [
    {
        selected: -1,
        oldCount: 0,
        newCount: 2,
        position: 0,
        removed: 0,
        added: 2,
        expected: 0,
        rule: '0 → n auto-selects index 0 (adw-sidebar.c:2270-2273)',
    },
    {
        selected: 3,
        oldCount: 5,
        newCount: 4,
        position: 3,
        removed: 1,
        added: 0,
        expected: -1,
        rule: 'removing the selected item itself clears the selection (adw-sidebar.c:2275-2278)',
    },
    {
        selected: 3,
        oldCount: 5,
        newCount: 4,
        position: 1,
        removed: 1,
        added: 0,
        expected: 2,
        rule: 'a removal above the selection shifts it down by one (adw-sidebar.c:2280-2283)',
    },
    {
        selected: 2,
        oldCount: 5,
        newCount: 7,
        position: 0,
        removed: 0,
        added: 2,
        expected: 4,
        rule: 'an insertion above the selection shifts it up by `added`',
    },
    {
        selected: 2,
        oldCount: 5,
        newCount: 6,
        position: 4,
        removed: 0,
        added: 1,
        expected: 2,
        rule: 'a splice BELOW the selection is a no-op — neither branch applies',
    },
    {
        selected: 0,
        oldCount: 3,
        newCount: 0,
        position: 0,
        removed: 3,
        added: 0,
        expected: -1,
        rule: 'removing everything clears the selection (0 <= 0 && 0 + 3 > 0)',
    },
    {
        selected: 2,
        oldCount: 3,
        newCount: 3,
        position: 2,
        removed: 1,
        added: 1,
        expected: -1,
        rule: 'replacing the selected item in place still clears — the splice covers it',
    },
    {
        selected: -1,
        oldCount: 3,
        newCount: 5,
        position: 0,
        removed: 0,
        added: 2,
        expected: 1,
        rule: 'guint wraparound: G_MAXUINT + 2 == 1, so a selection-less sidebar gains one',
    },
];

/** One flattened-model expectation for a whole section list. */
export interface SidebarModelVector {
    /** Human-readable name, used as the test title. */
    name: string;
    /** The declared sections. */
    sections: ReadonlyArray<AdwSidebarSectionSpec>;
    /** `n_items` — the size of the selection index space. */
    count: number;
    /** `adw_sidebar_section_get_first_index` per section, in declaration order. */
    sectionFirstIndex: ReadonlyArray<number>;
    /** Every rendered row, in render order. */
    flat: ReadonlyArray<{ index: number; sectionIndex: number; sectionItemIndex: number; title: string }>;
    /** The headers that get drawn, in render order. */
    headers: ReadonlyArray<SidebarHeaderSpec>;
    /** Why this row exists. */
    rule: string;
}

/**
 * The flat index space (`items_changed_cb`'s section walk, adw-sidebar.c:2261-2267
 * + `adw_sidebar_item_get_index`, adw-sidebar-item.c:1040) and the header
 * derivation (`set_header_cb`/`create_header`, adw-sidebar.c:1532-1563, :1483-1530).
 *
 * The empty-leading-section rows are the ones the web port got wrong: it keyed
 * `.first` and the hidden-separator case off the DECLARATION index, so an empty
 * or fully-filtered first section drew a stray separator and cost section 1 the
 * flush-to-top padding `.header.first > .heading` prescribes.
 */
export const SIDEBAR_MODEL_VECTORS: ReadonlyArray<SidebarModelVector> = [
    {
        name: 'untitled first section, then a titled and an untitled one',
        sections: [
            { items: [{ title: 'A' }, { title: 'B' }] },
            { title: 'Places', items: [{ title: 'C' }, { title: 'D' }, { title: 'E' }] },
            { items: [{ title: 'F' }] },
        ],
        count: 6,
        sectionFirstIndex: [0, 2, 5],
        flat: [
            { index: 0, sectionIndex: 0, sectionItemIndex: 0, title: 'A' },
            { index: 1, sectionIndex: 0, sectionItemIndex: 1, title: 'B' },
            { index: 2, sectionIndex: 1, sectionItemIndex: 0, title: 'C' },
            { index: 3, sectionIndex: 1, sectionItemIndex: 1, title: 'D' },
            { index: 4, sectionIndex: 1, sectionItemIndex: 2, title: 'E' },
            { index: 5, sectionIndex: 2, sectionItemIndex: 0, title: 'F' },
        ],
        headers: [
            { sectionIndex: 1, kind: 'title', title: 'Places', first: false },
            { sectionIndex: 2, kind: 'separator', title: '', first: false },
        ],
        rule: 'prefix-sum indices; the first section is untitled so its header is suppressed',
    },
    {
        name: 'two titled sections',
        sections: [
            { title: 'Recent', items: [{ title: 'A' }] },
            { title: 'Places', items: [{ title: 'B' }] },
        ],
        count: 2,
        sectionFirstIndex: [0, 1],
        flat: [
            { index: 0, sectionIndex: 0, sectionItemIndex: 0, title: 'A' },
            { index: 1, sectionIndex: 1, sectionItemIndex: 0, title: 'B' },
        ],
        headers: [
            { sectionIndex: 0, kind: 'title', title: 'Recent', first: true },
            { sectionIndex: 1, kind: 'title', title: 'Places', first: false },
        ],
        rule: 'a TITLED first section keeps its header and carries the `.first` class',
    },
    {
        name: 'empty leading section',
        sections: [{ title: 'Empty', items: [] }, { items: [{ title: 'A' }, { title: 'B' }] }],
        count: 2,
        sectionFirstIndex: [0, 0],
        flat: [
            { index: 0, sectionIndex: 1, sectionItemIndex: 0, title: 'A' },
            { index: 1, sectionIndex: 1, sectionItemIndex: 1, title: 'B' },
        ],
        headers: [],
        rule: 'a zero-item section advances the prefix sum by 0 and renders NOTHING — not even a header',
    },
    {
        name: 'empty leading section makes the next one first',
        sections: [
            { title: 'Empty', items: [] },
            { title: '', items: [{ title: 'A' }] },
            { title: 'Places', items: [{ title: 'B' }] },
        ],
        count: 2,
        sectionFirstIndex: [0, 0, 1],
        flat: [
            { index: 0, sectionIndex: 1, sectionItemIndex: 0, title: 'A' },
            { index: 1, sectionIndex: 2, sectionItemIndex: 0, title: 'B' },
        ],
        headers: [{ sectionIndex: 2, kind: 'title', title: 'Places', first: false }],
        rule: 'section 1 owns the first rendered row and is untitled, so IT is the suppressed header',
    },
    {
        name: 'single untitled section',
        sections: [{ items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }],
        count: 3,
        sectionFirstIndex: [0],
        flat: [
            { index: 0, sectionIndex: 0, sectionItemIndex: 0, title: 'A' },
            { index: 1, sectionIndex: 0, sectionItemIndex: 1, title: 'B' },
            { index: 2, sectionIndex: 0, sectionItemIndex: 2, title: 'C' },
        ],
        headers: [],
        rule: 'the flat NativeScript surface — one untitled section, no headers at all',
    },
    {
        name: 'duplicate titles across sections',
        sections: [
            { title: 'Places', items: [{ title: 'Music' }] },
            { title: 'Bookmarks', items: [{ title: 'Music' }] },
        ],
        count: 2,
        sectionFirstIndex: [0, 1],
        flat: [
            { index: 0, sectionIndex: 0, sectionItemIndex: 0, title: 'Music' },
            { index: 1, sectionIndex: 1, sectionItemIndex: 0, title: 'Music' },
        ],
        headers: [
            { sectionIndex: 0, kind: 'title', title: 'Places', first: true },
            { sectionIndex: 1, kind: 'title', title: 'Bookmarks', first: false },
        ],
        rule: 'AdwSidebar is purely positional — a repeated title addresses nothing',
    },
    {
        name: 'markup-looking strings are carried verbatim',
        sections: [{ title: 'A & B', items: [{ title: 'Größe · 日本語 · 🎧', subtitle: 'A & B <b>c</b>' }] }],
        count: 1,
        sectionFirstIndex: [0],
        flat: [{ index: 0, sectionIndex: 0, sectionItemIndex: 0, title: 'Größe · 日本語 · 🎧' }],
        headers: [{ sectionIndex: 0, kind: 'title', title: 'A & B', first: true }],
        rule: 'no markup parsing and no escaping in the model — page mode explicitly disables markup (adw-sidebar.c:1685)',
    },
];

/** One item-label-visibility expectation. */
export interface SidebarItemFlagsVector {
    /** The declared item. */
    item: AdwSidebarItemSpec;
    /** `string_is_not_empty(title)` (adw-sidebar.c:1411-1412). */
    titleVisible: boolean;
    /** `string_is_not_empty(subtitle)` (adw-sidebar.c:1420-1421). */
    subtitleVisible: boolean;
    /** `notify_icon_cb`'s `icon_name && *icon_name` (adw-sidebar.c:1303). */
    iconVisible: boolean;
    /** Why this row exists. */
    rule: string;
}

/**
 * The three `string_is_not_empty` bindings, so renderers stop spelling
 * `x.length === 0` themselves — and so the `'-symbolic'` row pins that icon
 * visibility is decided on the RAW name, before any suffix stripping.
 */
export const SIDEBAR_ITEM_FLAG_VECTORS: ReadonlyArray<SidebarItemFlagsVector> = [
    {
        item: { title: 'Music', subtitle: '', iconName: 'folder-music-symbolic' },
        titleVisible: true,
        subtitleVisible: false,
        iconVisible: true,
        rule: 'an empty subtitle hides its label, a set title and icon show',
    },
    {
        item: { title: '', subtitle: '', iconName: '' },
        titleVisible: false,
        subtitleVisible: false,
        iconVisible: false,
        rule: 'all three empty — every label hidden',
    },
    {
        item: { title: 'Inbox' },
        titleVisible: true,
        subtitleVisible: false,
        iconVisible: false,
        rule: 'absent and empty are the same thing (adw-sidebar-item.c:419 defaults to "")',
    },
    {
        item: { title: 'Inbox', subtitle: '3 unread', iconName: 'mail-unread-symbolic' },
        titleVisible: true,
        subtitleVisible: true,
        iconVisible: true,
        rule: 'the fully populated row',
    },
    {
        item: { title: 'Odd', iconName: '-symbolic' },
        titleVisible: true,
        subtitleVisible: false,
        iconVisible: true,
        rule: 'the RAW icon name decides visibility — stripping "-symbolic" must not blank it',
    },
    {
        item: { title: ' ', subtitle: ' ' },
        titleVisible: true,
        subtitleVisible: true,
        iconVisible: false,
        rule: 'a single space is NOT empty — the C test is `*str`, not a trim',
    },
];

/** One activation (row click) expectation. */
export interface SidebarActivationVector {
    /** Human-readable name, used as the test title. */
    name: string;
    /** The declared sections. */
    sections: ReadonlyArray<AdwSidebarSectionSpec>;
    /** The selection to establish before clicking, applied through `setSelected`. */
    initialSelected: number;
    /** The flat index that is clicked. */
    activate: number;
    /** Whether a row was actually activated — the `activated` signal. */
    activated: boolean;
    /** Whether `notify::selected` fired. */
    selectionChanged: boolean;
    /** `selected` afterwards. */
    selected: number;
    /** Why this row exists. */
    rule: string;
}

/**
 * The selection/activation split: `row-selected` fires only on a real change,
 * `row-activated` fires on EVERY click (adw-sidebar.c:1585-1612), and page mode
 * does the same thing in one callback (`boxed_row_activated_cb`, :1662-1674).
 *
 * The re-click row is the one that matters: it is the documented way to reveal
 * the content pane of a split view (adw-sidebar.c:73-75), and the NativeScript
 * port could not express it at all — its setter early-returned on an unchanged
 * index and it emitted no activation signal.
 */
export const SIDEBAR_ACTIVATION_VECTORS: ReadonlyArray<SidebarActivationVector> = [
    {
        name: 'clicking another row selects and activates it',
        sections: [{ items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }],
        initialSelected: 0,
        activate: 2,
        activated: true,
        selectionChanged: true,
        selected: 2,
        rule: 'row-selected then row-activated',
    },
    {
        name: 're-clicking the selected row activates without notifying',
        sections: [{ items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }],
        initialSelected: 2,
        activate: 2,
        activated: true,
        selectionChanged: false,
        selected: 2,
        rule: 'the activated signal is unconditional; set_selected early-returns on the same index',
    },
    {
        name: 'clicking a row that does not exist does nothing',
        sections: [{ items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }],
        initialSelected: 0,
        activate: 9,
        activated: false,
        selectionChanged: false,
        selected: 0,
        rule: 'both callbacks run off an existing GtkListBoxRow — there is none at index 9',
    },
    {
        name: 'a disabled row cannot be activated',
        sections: [{ items: [{ title: 'A' }, { title: 'B', enabled: false }, { title: 'C' }] }],
        initialSelected: 0,
        activate: 1,
        activated: false,
        selectionChanged: false,
        selected: 0,
        rule: '`enabled` is bound to `row:sensitive` (adw-sidebar.c:1383) — an insensitive row emits nothing',
    },
    {
        name: 'a hidden row cannot be activated',
        sections: [{ items: [{ title: 'A' }, { title: 'B', visible: false }, { title: 'C' }] }],
        initialSelected: 0,
        activate: 1,
        activated: false,
        selectionChanged: false,
        selected: 0,
        rule: '`visible` is bound to `row:visible` (adw-sidebar.c:1382) — there is nothing to click',
    },
    {
        name: 'activation crosses sections by flat index',
        sections: [
            { title: 'Places', items: [{ title: 'Music' }] },
            { title: 'Bookmarks', items: [{ title: 'Music' }] },
        ],
        initialSelected: 0,
        activate: 1,
        activated: true,
        selectionChanged: true,
        selected: 1,
        rule: 'the second Music is index 1 — sections do not restart the index',
    },
];

/** One filter / empty-state expectation. */
export interface SidebarFilterVector {
    /** Human-readable name, used as the test title. */
    name: string;
    /** The declared sections. */
    sections: ReadonlyArray<AdwSidebarSectionSpec>;
    /** Item titles the filter keeps; the suites build `(item) => keepTitles.includes(item.title)`. */
    keepTitles: ReadonlyArray<string>;
    /** `n_items` — UNCHANGED by the filter, because the selection counts the unfiltered model. */
    count: number;
    /** Flat indices of the rows that survive the filter, in render order. */
    visibleIndices: ReadonlyArray<number>;
    /** The headers that get drawn once the filter is applied. */
    headers: ReadonlyArray<SidebarHeaderSpec>;
    /** The `.empty` / placeholder state — computed from the FILTERED count. */
    isEmpty: boolean;
    /** Why this row exists. */
    rule: string;
}

/**
 * `adw_sidebar_set_filter` (adw-sidebar.c:3127-3139) feeds a `GtkFilterListModel`
 * that only the row list and the placeholder see; the selection index space stays
 * on the unfiltered `items_model` (adw-sidebar.c:2866 vs :2177-2180), and
 * `update_placeholder` counts the filtered one (adw-sidebar.c:1828, :1839-1842).
 *
 * Neither port had a filter or a placeholder at all.
 */
export const SIDEBAR_FILTER_VECTORS: ReadonlyArray<SidebarFilterVector> = [
    {
        name: 'filtering keeps the unfiltered index space',
        sections: [{ items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] }],
        keepTitles: ['C'],
        count: 3,
        visibleIndices: [2],
        headers: [],
        isEmpty: false,
        rule: 'C keeps flat index 2 even though it is the only rendered row',
    },
    {
        name: 'a filter that matches nothing is the empty state',
        sections: [{ items: [{ title: 'A' }] }],
        keepTitles: [],
        count: 1,
        visibleIndices: [],
        headers: [],
        isEmpty: true,
        rule: 'the `.empty` class / placeholder keys off the FILTERED count, which is 0',
    },
    {
        name: 'filtering out a whole section re-attributes `.first`',
        sections: [
            { title: 'Recent', items: [{ title: 'A' }] },
            { title: 'Places', items: [{ title: 'B' }] },
        ],
        keepTitles: ['B'],
        count: 2,
        visibleIndices: [1],
        headers: [{ sectionIndex: 1, kind: 'title', title: 'Places', first: true }],
        isEmpty: false,
        rule: 'Recent renders no row so it emits no header; Places owns the first row and takes `.first`',
    },
    {
        name: 'a filter can move the suppression onto a later section',
        sections: [
            { title: 'Recent', items: [{ title: 'A' }] },
            { items: [{ title: 'B' }] },
            { title: 'Tags', items: [{ title: 'C' }] },
        ],
        keepTitles: ['B', 'C'],
        count: 3,
        visibleIndices: [1, 2],
        headers: [{ sectionIndex: 2, kind: 'title', title: 'Tags', first: false }],
        isEmpty: false,
        rule: 'Recent is filtered away, so the UNTITLED section 1 becomes first — and a first untitled header is invisible',
    },
    {
        name: 'an empty sidebar is empty',
        sections: [],
        keepTitles: [],
        count: 0,
        visibleIndices: [],
        headers: [],
        isEmpty: true,
        rule: 'no sections, no items, no selection (adw-sidebar.c:2862)',
    },
];

/** One mode expectation. */
export interface SidebarModeVector {
    /** The mode being set. */
    mode: 'sidebar' | 'page';
    /** Whether the selection is PAINTED in that mode. */
    selectionVisible: boolean;
    /** Why this row exists. */
    rule: string;
}

/**
 * `adw_sidebar_set_mode` (adw-sidebar.c:2960-2981) never touches `selected`:
 * "In this mode, the selection is invisible and only tracked to determine the
 * initially selected item once switched back to sidebar mode" (adw-sidebar.c:2948-2951).
 *
 * The web port painted its `.selected` highlight in BOTH modes; page mode builds
 * plain `AdwActionRow`s in a boxed list (`create_boxed_row`, adw-sidebar.c:1676)
 * and shows no selected row at all.
 */
export const SIDEBAR_MODE_VECTORS: ReadonlyArray<SidebarModeVector> = [
    { mode: 'sidebar', selectionVisible: true, rule: 'the default mode (adw-sidebar.c:2860) paints the selection' },
    { mode: 'page', selectionVisible: false, rule: 'page mode tracks the selection but never paints it' },
];
