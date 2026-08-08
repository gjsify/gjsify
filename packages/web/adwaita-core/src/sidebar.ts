// Adwaita sidebar behaviour — headless (ADR 0004).
//
// `Adw.Sidebar` is a list of `AdwSidebarSection`s of `AdwSidebarItem`s with zero
// or one selected item. Almost nothing about that is rendering: the flat item
// index space, the out-of-range rule, how a selection survives (or does not
// survive) an insert/remove, which section headers actually get drawn, and the
// selection-vs-activation split are all pure derivations off the C source. They
// are lifted here so every renderer answers them the same way.
//
// The lift is also a bug fix. The single most basic question — "what is
// `selected` after you set it to 5 on a 3-item sidebar?" — had THREE different
// answers: libadwaita said "no selection", `@gjsify/adwaita-web` clamped to the
// last row (2), and `@gjsify/adwaita-nativescript` silently ignored the write
// and kept 0. Nothing compared them, so nothing failed. The vectors in
// `conformance/sidebar.ts` are that comparison.
//
// This module is PLATFORM-NEUTRAL: it renders nothing, reads no global, and
// starts no timer. {@link SidebarState} exposes the same per-instance
// subscribe/emit seam as `ComboState`/`ToggleGroupState` in `rows.ts`, and tags
// every change with `interactive` — true only for {@link SidebarState.activate}
// (a row click), false for programmatic re-derivations — so a renderer knows
// when to re-emit `notify::selected` and when to only repaint.
//
// Reference: refs/libadwaita/src/adw-sidebar.c
//   (adw_sidebar_init, adw_sidebar_set_selected, items_changed_cb, create_header,
//    set_header_cb, row_selected_cb, row_activated_cb, boxed_row_activated_cb,
//    update_placeholder, adw_sidebar_insert, adw_sidebar_remove_all)
// Reference: refs/libadwaita/src/adw-sidebar-item.c (adw_sidebar_item_get_index)
// Reference: refs/libadwaita/src/adw-sidebar-section.c (get/set_first_index)
// Copyright (c) 2025 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.

import { stringIsNotEmpty } from './glib.js';

/**
 * The "no item is selected" index — the TS mirror of `GTK_INVALID_LIST_POSITION`
 * (`adw_sidebar_init`, adw-sidebar.c:2862).
 *
 * libadwaita spells it `G_MAXUINT` because `AdwSidebar:selected` is a `guint`;
 * `-1` is the idiomatic TS sentinel and, being `G_MAXUINT` mod 2^32, it makes
 * {@link adjustSidebarSelection}'s arithmetic agree with the C code bit for bit.
 */
export const ADW_SIDEBAR_NO_SELECTION = -1;

/**
 * How a sidebar looks and behaves — `AdwSidebarMode` (adw-sidebar.h).
 *
 * `'sidebar'` is a flat navigation list with a persistent, VISIBLE selection;
 * `'page'` is a page of boxed lists where "the selection is invisible and only
 * tracked to determine the initially selected item once switched back"
 * (adw-sidebar.c:2948-2951). The tracked index is identical in both.
 */
export type AdwSidebarMode = 'sidebar' | 'page';

/** One selectable row — the value half of `AdwSidebarItem`. */
export interface AdwSidebarItemSpec {
    /** Row title. Defaults to `''` in libadwaita (adw-sidebar-item.c:419). */
    title: string;
    /** Optional second line. Absent and `''` are the same thing. */
    subtitle?: string;
    /** Symbolic icon name, e.g. `'folder-symbolic'`. Absent means no icon. */
    iconName?: string;
    /** Whether the row is rendered at all — bound to `row:visible` (adw-sidebar.c:1382). Default true. */
    visible?: boolean;
    /** Whether the row can be activated — bound to `row:sensitive` (adw-sidebar.c:1383). Default true. */
    enabled?: boolean;
}

/**
 * A titled group of rows — the value half of `AdwSidebarSection`.
 *
 * An absent or empty title selects the `'separator'` header instead of the
 * `'title'` one (`update_header_page_cb`, adw-sidebar.c:1449-1455).
 */
export interface AdwSidebarSectionSpec {
    /** Group heading. Absent/empty renders a separator instead. */
    title?: string;
    /** The group's rows, in order. */
    items: readonly AdwSidebarItemSpec[];
}

/** One entry of the flattened item model. */
export interface SidebarFlatItem {
    /**
     * The flat index `adw_sidebar_item_get_index` returns — the section's first
     * index plus the local one (adw-sidebar-item.c:1040). It stays in the
     * UNFILTERED space even when the item came out of a filtered walk, because
     * libadwaita keeps the selection on `items_model` and the row list on
     * `filtered_items` (adw-sidebar.c:2866, :2177-2180).
     */
    index: number;
    /** Index of the owning section. */
    sectionIndex: number;
    /** Index of the item WITHIN its section (`adw_sidebar_item_get_section_index`). */
    sectionItemIndex: number;
    /** The item as declared — same object identity, so `selectedItem === spec` holds. */
    item: AdwSidebarItemSpec;
    /** `string_is_not_empty(title)` — the title label's visibility (adw-sidebar.c:1411-1412). */
    titleVisible: boolean;
    /** `string_is_not_empty(subtitle)` (adw-sidebar.c:1420-1421). */
    subtitleVisible: boolean;
    /** `notify_icon_cb`'s `icon_name && *icon_name` (adw-sidebar.c:1303). */
    iconVisible: boolean;
}

/** The header libadwaita draws above one RENDERED section. */
export interface SidebarHeaderSpec {
    /** Index of the section this header belongs to. */
    sectionIndex: number;
    /** Which page of the header stack shows — `'title'` or `'separator'` (adw-sidebar.c:1449-1455). */
    kind: 'title' | 'separator';
    /** The section title (`''` for a separator header). */
    title: string;
    /** True only for the section owning the FIRST rendered row — the `.first` class (adw-sidebar.c:1526). */
    first: boolean;
}

/** Payload of a `notify::selected` re-emit. */
export interface SidebarSelectionChange {
    /** The new selected index, or {@link ADW_SIDEBAR_NO_SELECTION}. */
    selected: number;
    /** The index it moved away from. */
    previous: number;
    /** `adw_sidebar_get_selected_item` — `undefined` when nothing is selected. */
    item: AdwSidebarItemSpec | undefined;
    /** True only for {@link SidebarState.activate} (a row click); false for programmatic changes. */
    interactive: boolean;
}

/** Result of {@link SidebarState.activate}. */
export interface SidebarActivation {
    /** The index that was clicked, echoed back unchanged. */
    index: number;
    /**
     * Whether a row was actually activated. False when `index` addresses no
     * rendered, enabled row — libadwaita's callbacks run off an existing,
     * sensitive `GtkListBoxRow`, so there is nothing to activate otherwise.
     */
    activated: boolean;
    /** Whether the selection moved. `activated && !selectionChanged` is a re-click of the current row. */
    selectionChanged: boolean;
}

/** Per-instance subscriber, same shape as `ComboStateListener` (rows.ts:114). */
export type SidebarStateListener = (change: SidebarSelectionChange) => void;

/**
 * The TS stand-in for `GtkFilter` on `AdwSidebar:filter` (adw-sidebar.c:3127).
 *
 * Decides only what is RENDERED and whether the sidebar counts as empty — never
 * the selection index space, which counts the unfiltered model.
 */
export type SidebarItemFilter = (item: AdwSidebarItemSpec, index: number) => boolean;

/**
 * The out-of-range rule, and the one all three implementations disagreed on:
 * anything that is not a valid position becomes NO SELECTION — never the
 * nearest in-range index.
 *
 * `adw_sidebar_set_selected` (adw-sidebar.c:3028-3029) is literally
 * `if (selected >= self->n_items) selected = GTK_INVALID_LIST_POSITION;`. A
 * negative input agrees with that for free: as a `guint`, `-7` is `4294967289`,
 * which is `>= n_items` for any real sidebar.
 *
 * Non-integers and `NaN` are rejected rather than truncated. C cannot express
 * them, so there is no ground truth to copy; rejecting is the reading that
 * matches "not a valid position is no position", and it is what stops
 * `sidebar.selected = 1.5` from leaving the NativeScript port highlighting no
 * row while reporting a selection.
 */
export function clampSidebarSelection(index: number, count: number): number {
    if (!Number.isInteger(index) || index < 0 || index >= count) return ADW_SIDEBAR_NO_SELECTION;
    return index;
}

/**
 * Where the selection lands after the item model spliced — `items_changed_cb`
 * (adw-sidebar.c:2246-2284), which neither renderer implemented.
 *
 * Four cases, in the C code's order:
 *   1. `0 → n` auto-selects index 0 and notifies (adw-sidebar.c:2270-2273);
 *   2. a splice covering the selected index clears it (adw-sidebar.c:2275-2278);
 *   3. a splice at or before it shifts by `added - removed` (adw-sidebar.c:2280-2283);
 *   4. a splice after it changes nothing.
 *
 * The comparisons run in the UNSIGNED domain (`>>> 0`) because that is where C
 * runs them: with no selection, `selected` is `G_MAXUINT`, so case 2 can never
 * fire and case 3 wraps. That wraparound is REPRODUCED, not repaired — inserting
 * two items above a selection-less sidebar genuinely selects index 1 in GTK, and
 * a renderer that "fixed" it would stop matching the toolkit it mirrors.
 */
export function adjustSidebarSelection(
    selected: number,
    oldCount: number,
    newCount: number,
    position: number,
    removed: number,
    added: number,
): number {
    // "Select the first item when adding them" — runs before any shift logic.
    if (oldCount === 0 && newCount > 0) return clampSidebarSelection(0, newCount);

    const sel = selected >>> 0;
    const index = position >>> 0;

    if (index <= sel && index + removed > sel) return ADW_SIDEBAR_NO_SELECTION;
    if (index <= sel) return clampSidebarSelection((sel + added - removed) >>> 0, newCount);
    return selected;
}

/**
 * Flatten the sections into the item model, the way `items_changed_cb`'s section
 * walk does: `set_first_index (section, current); current += get_n_items (section)`
 * (adw-sidebar.c:2261-2267).
 *
 * `sectionFirstIndex[i]` is `adw_sidebar_section_get_first_index` for section
 * `i` — a zero-item section advances nothing, so it shares its successor's index.
 *
 * With a `filter`, `items` is the RENDERED subset while every `index` stays in
 * the unfiltered space; `sectionFirstIndex` is likewise unfiltered.
 */
export function flattenSidebarItems(
    sections: readonly AdwSidebarSectionSpec[],
    filter?: SidebarItemFilter | null,
): { items: SidebarFlatItem[]; sectionFirstIndex: number[] } {
    const items: SidebarFlatItem[] = [];
    const sectionFirstIndex: number[] = [];
    let current = 0;

    sections.forEach((section, sectionIndex) => {
        sectionFirstIndex.push(current);

        section.items.forEach((item, sectionItemIndex) => {
            const index = current + sectionItemIndex;
            if (filter && !filter(item, index)) return;

            items.push({
                index,
                sectionIndex,
                sectionItemIndex,
                item,
                titleVisible: stringIsNotEmpty(item.title),
                subtitleVisible: stringIsNotEmpty(item.subtitle),
                iconVisible: stringIsNotEmpty(item.iconName),
            });
        });

        current += section.items.length;
    });

    return { items, sectionFirstIndex };
}

/**
 * The header walk itself, over an ALREADY-rendered row list — so a caller that
 * has just filtered its rows does not pay for the flatten a second time.
 */
function deriveSidebarHeaders(
    sections: readonly AdwSidebarSectionSpec[],
    items: readonly SidebarFlatItem[],
): SidebarHeaderSpec[] {
    const headers: SidebarHeaderSpec[] = [];
    let previousSection: number | null = null;

    for (const flat of items) {
        if (previousSection === flat.sectionIndex) continue;

        const first = previousSection === null;
        previousSection = flat.sectionIndex;

        const title = sections[flat.sectionIndex]?.title ?? '';
        if (first && title.length === 0) continue;

        headers.push({
            sectionIndex: flat.sectionIndex,
            kind: title.length > 0 ? 'title' : 'separator',
            title,
            first,
        });
    }

    return headers;
}

/**
 * The headers that actually get drawn, in render order.
 *
 * In sidebar mode a header is a property OF A ROW (`gtk_list_box_row_set_header`,
 * adw-sidebar.c:1563), so a section with no rows contributes none; in page mode
 * the group's `visible` is bound to `filtered n-items > 0` (adw-sidebar.c:1780-1781),
 * which comes to the same thing. Either way it is the sections that RENDER
 * something that produce headers — not the declared section list, which is what
 * the web port used and why an empty leading section drew a stray separator.
 *
 * The section owning the first rendered row gets `first: true`; when that
 * section has no title its header is bound to `string_is_not_empty(title)` and
 * therefore invisible (adw-sidebar.c:1521-1527), so it is omitted entirely.
 */
export function sidebarHeaders(
    sections: readonly AdwSidebarSectionSpec[],
    filter?: SidebarItemFilter | null,
): SidebarHeaderSpec[] {
    return deriveSidebarHeaders(sections, flattenSidebarItems(sections, filter).items);
}

/**
 * The sidebar state machine both renderers drive.
 *
 * Programmatic changes ({@link setSelected}, {@link setSections},
 * {@link insertSection}, {@link removeSectionAt}, {@link removeAllSections})
 * notify with `interactive: false`; {@link activate} — the row click — notifies
 * with `interactive: true` and applies the selection BEFORE reporting the
 * activation, matching GtkListBox's `row-selected`-then-`row-activated` order
 * (adw-sidebar.c:2188-2191) and page mode's `set_selected`-then-emit
 * (`boxed_row_activated_cb`, adw-sidebar.c:1672-1673).
 */
export class SidebarState {
    private _mode: AdwSidebarMode = 'sidebar';
    private _sections: AdwSidebarSectionSpec[] = [];
    private _filter: SidebarItemFilter | null = null;
    private _selected: number = ADW_SIDEBAR_NO_SELECTION;

    private _items: SidebarFlatItem[] = [];
    private _sectionFirstIndex: number[] = [];
    private _visibleItems: SidebarFlatItem[] = [];
    private _headers: SidebarHeaderSpec[] = [];

    private readonly _listeners = new Set<SidebarStateListener>();

    /** Subscribe to selection changes. Returns an unsubscribe function. */
    subscribe(listener: SidebarStateListener): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(previous: number, interactive: boolean): void {
        const change: SidebarSelectionChange = {
            selected: this._selected,
            previous,
            item: this.selectedItem,
            interactive,
        };
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(change);
    }

    /** Store an already-derived index; notify only on a real change (adw-sidebar.c:3031-3032). */
    private _applySelected(next: number, interactive: boolean): boolean {
        if (next === this._selected) return false;
        const previous = this._selected;
        this._selected = next;
        this._emit(previous, interactive);
        return true;
    }

    /** Recompute everything derived from `sections` + `filter`. */
    private _invalidate(): void {
        const flat = flattenSidebarItems(this._sections);
        const filter = this._filter;
        this._items = flat.items;
        this._sectionFirstIndex = flat.sectionFirstIndex;
        this._visibleItems = filter ? this._items.filter((entry) => filter(entry.item, entry.index)) : this._items;
        this._headers = deriveSidebarHeaders(this._sections, this._visibleItems);
    }

    /** The current look/behaviour. Defaults to `'sidebar'` (adw-sidebar.c:2860). */
    get mode(): AdwSidebarMode {
        return this._mode;
    }

    /**
     * Switch mode. Returns whether it changed — `adw_sidebar_set_mode` early-returns
     * on the current value (adw-sidebar.c:2968-2969). Never touches the selection.
     */
    setMode(mode: AdwSidebarMode): boolean {
        if (mode === this._mode) return false;
        this._mode = mode;
        return true;
    }

    /**
     * Whether the selection is PAINTED. Page mode tracks the selection but shows
     * no selected row: its rows are plain `AdwActionRow`s in a boxed list
     * (`create_boxed_row`, adw-sidebar.c:1676) and the mode is documented as
     * "the selection is invisible, but still tracked" (adw-sidebar.c:2948-2951).
     */
    get selectionVisible(): boolean {
        return this._mode === 'sidebar';
    }

    /** The declared sections. */
    get sections(): readonly AdwSidebarSectionSpec[] {
        return this._sections;
    }

    /**
     * Replace every section at once — the renderers' "here is my whole tree" call.
     *
     * Equivalent to `adw_sidebar_remove_all()` followed by appending each section,
     * i.e. two splices: everything removed (which clears the selection via
     * adw-sidebar.c:2275-2278) and everything added (which re-runs the `0 → n`
     * auto-select of index 0 at adw-sidebar.c:2270-2273). They are coalesced into
     * ONE notification, because one property write should produce one change.
     */
    setSections(sections: readonly AdwSidebarSectionSpec[]): void {
        const oldCount = this.count;
        this._sections = [...sections];
        this._invalidate();

        const cleared = adjustSidebarSelection(this._selected, oldCount, 0, 0, oldCount, 0);
        const next = adjustSidebarSelection(cleared, 0, this.count, 0, 0, this.count);
        this._applySelected(next, false);
    }

    /**
     * Insert a section, returning the index it landed at.
     *
     * `adw_sidebar_insert` appends when `position` is negative OR at/past the end
     * (adw-sidebar.c:3358-3364) — so on a two-section sidebar, positions `-1`,
     * `2` and `5` all append, and position `2` is NOT an "insert at 2".
     */
    insertSection(section: AdwSidebarSectionSpec, position: number): number {
        const oldCount = this.count;
        const length = this._sections.length;
        const at = Number.isInteger(position) && position >= 0 && position < length ? position : length;

        this._sections.splice(at, 0, section);
        this._invalidate();

        const firstIndex = this._sectionFirstIndex[at] ?? 0;
        const next = adjustSidebarSelection(this._selected, oldCount, this.count, firstIndex, 0, section.items.length);
        this._applySelected(next, false);

        return at;
    }

    /**
     * Remove the section at `index`. Returns false for an index that addresses no
     * section — `adw_sidebar_remove` warns and returns when the section is not
     * found (adw-sidebar.c:3387-3393), changing nothing.
     */
    removeSectionAt(index: number): boolean {
        const section = this.sectionAt(index);
        if (!section) return false;

        const oldCount = this.count;
        const firstIndex = this._sectionFirstIndex[index] ?? 0;
        const removed = section.items.length;

        this._sections.splice(index, 1);
        this._invalidate();

        this._applySelected(
            adjustSidebarSelection(this._selected, oldCount, this.count, firstIndex, removed, 0),
            false,
        );
        return true;
    }

    /** `adw_sidebar_remove_all` (adw-sidebar.c:3417) — one splice removing every item. */
    removeAllSections(): void {
        const oldCount = this.count;
        this._sections = [];
        this._invalidate();
        this._applySelected(adjustSidebarSelection(this._selected, oldCount, 0, 0, oldCount, 0), false);
    }

    /**
     * Re-derive the item model after an ITEM's own properties changed in place.
     *
     * libadwaita has no such call because it does not need one: title, subtitle
     * and icon are live `g_object_bind_property` bindings straight onto the
     * labels (adw-sidebar.c:1409-1421) and `notify::icon-name` goes to
     * `notify_icon_cb` (:1393-1397) — none of them runs through
     * `items_changed_cb`, so the selection cannot move. This method is the same
     * contract for renderers that hand `SidebarState` mutable specs: the derived
     * flags are recomputed, the selection is untouched, nothing is emitted.
     * Both ports ignored post-construction item changes entirely.
     */
    refresh(): void {
        this._invalidate();
    }

    /** `adw_sidebar_get_section` — `undefined` past the end (adw-sidebar.c:3297-3298). */
    sectionAt(index: number): AdwSidebarSectionSpec | undefined {
        if (!Number.isInteger(index) || index < 0) return undefined;
        return this._sections[index];
    }

    /** `adw_sidebar_section_get_first_index` — 0 for a section that is not in this sidebar. */
    sectionFirstIndex(sectionIndex: number): number {
        return this._sectionFirstIndex[sectionIndex] ?? 0;
    }

    /** Number of items in the UNFILTERED model — the selection index space (adw-sidebar.c:2255). */
    get count(): number {
        return this._items.length;
    }

    /** The full flattened item model, in flat-index order. */
    get items(): readonly SidebarFlatItem[] {
        return this._items;
    }

    /** `adw_sidebar_get_item` — `undefined` for `index >= n_items` (adw-sidebar.c:3256). */
    itemAt(index: number): AdwSidebarItemSpec | undefined {
        if (!Number.isInteger(index) || index < 0) return undefined;
        return this._items[index]?.item;
    }

    /** The current item filter, or `null`. */
    get filter(): SidebarItemFilter | null {
        return this._filter;
    }

    /**
     * Set the item filter — `adw_sidebar_set_filter` (adw-sidebar.c:3127-3139).
     *
     * It only swaps the filter on the `GtkFilterListModel`; the selection is
     * never re-derived, so a selected item that filters out stays selected.
     */
    setFilter(filter: SidebarItemFilter | null): void {
        if (filter === this._filter) return;
        this._filter = filter;
        this._invalidate();
    }

    /** The items that pass the filter — the rows a renderer actually builds. */
    get visibleItems(): readonly SidebarFlatItem[] {
        return this._visibleItems;
    }

    /** The headers to draw, derived from the sections that render at least one row. */
    get headers(): readonly SidebarHeaderSpec[] {
        return this._headers;
    }

    /**
     * The `.empty` / placeholder state — `update_placeholder` counts the FILTERED
     * model (adw-sidebar.c:1828, :1839-1842), so a fully filtered-out sidebar is
     * empty even though its selection index space is not.
     */
    get isEmpty(): boolean {
        return this._visibleItems.length === 0;
    }

    /** The selected flat index, or {@link ADW_SIDEBAR_NO_SELECTION}. */
    get selected(): number {
        return this._selected;
    }

    /** `adw_sidebar_get_selected_item` (adw-sidebar.c:3092). */
    get selectedItem(): AdwSidebarItemSpec | undefined {
        return this.itemAt(this._selected);
    }

    /**
     * Programmatic selection — {@link clampSidebarSelection} then notify with
     * `interactive: false`. Returns whether it changed.
     */
    setSelected(index: number): boolean {
        return this._applySelected(clampSidebarSelection(index, this.count), false);
    }

    /**
     * A row click. Selects (notifying `interactive: true` if that moved) and then
     * reports the activation, which libadwaita emits on EVERY click including a
     * re-click of the already-selected row (`row_activated_cb`, adw-sidebar.c:1601-1612).
     * That unconditional emit is how re-tapping the current row reveals the content
     * pane of a split view (adw-sidebar.c:73-75) — the NativeScript port had no
     * activation path at all, so that gesture did nothing there.
     *
     * A row that is filtered out, `visible: false`, or `enabled: false` is not
     * activatable: it either has no `GtkListBoxRow` or has an insensitive one.
     */
    activate(index: number): SidebarActivation {
        const row = this._visibleItems.find((entry) => entry.index === index);
        if (!row || row.item.visible === false || row.item.enabled === false) {
            return { index, activated: false, selectionChanged: false };
        }

        const selectionChanged = this._applySelected(clampSidebarSelection(index, this.count), true);
        return { index, activated: true, selectionChanged };
    }
}
