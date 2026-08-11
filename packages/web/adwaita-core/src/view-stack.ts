// Headless `Adw.ViewStack` selection state machine (ADR 0004 — headless Adwaita core).
//
// An ordered list of named pages of which exactly one is shown: the name lookup,
// the five guard clauses on an index change, the "first VISIBLE page" auto-pick
// that runs on add, on remove and when a page's `visible` flag flips, and which of
// those paths notifies.
//
// Four rules that are easy to get wrong:
// - a position is a `guint` in C (`adw_view_stack_pages_select_item`), so a
// FRACTIONAL index cannot exist: {@link ViewStackState.setVisibleIndex} rejects
// it with `Number.isInteger`, not `Number.isFinite`.
// - the per-page `visible` flag drives three of them: the auto-pick takes the
// first VISIBLE page and not the first added, a hidden page cannot be selected,
// and hiding the visible page falls back to the next visible one.
// - an empty page name is a legal lookup, not "no name" (`g_strcmp0`).
// - the auto-picked first page DOES notify.
//
// Renders nothing, imports no platform, holds no timer. Same interactive-vs-
// programmatic tagging as `ComboState`/`SpinState` in `rows.ts`: an explicit
// `setVisibleIndex`/`setVisibleName` is `interactive: true`, every auto-pick is
// `interactive: false`, so a renderer can re-emit `notify::visible-child` on both
// (as C does) while a bound switcher can still tell a user pick from a model-driven
// one.
//
// Reference: refs/libadwaita/src/adw-view-stack.c (AdwViewStack, AdwViewStackPage)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/**
 * Input shape for a page. `title` omitted falls back to `name`
 * ({@link resolvePageTitle}, a deliberate deviation from `add_internal`, which leaves
 * the title NULL); `icon` is a GTK icon NAME normalized by
 * {@link normalizeIconName}; `visible` defaults to `true`. `content` is the
 * renderer's opaque node — an `HTMLElement` on web, a NativeScript `View` on NS.
 */
export interface AdwViewStackPageSpec<T = unknown> {
    /** Stable id used by `visible-child-name` and by a bound switcher. */
    name: string;
    /** Human-facing title; falls back to `name` when absent. `null` is absent — it is what `getAttribute` returns. */
    title?: string | null;
    /** GTK icon name; a single trailing `-symbolic` is stripped. `null` is absent. */
    icon?: string | null;
    /** The renderer's page node. */
    content?: T;
    /** Whether the page participates in selection at all. Defaults to `true`. */
    visible?: boolean;
    /** `AdwViewStackPage:badge-number`. Defaults to 0 — no badge. */
    badgeNumber?: number;
    /** `AdwViewStackPage:needs-attention`. Defaults to `false`. */
    needsAttention?: boolean;
    /** `AdwViewStackPage:use-underline`. Defaults to `false`. */
    useUnderline?: boolean;
}

/**
 * A resolved page descriptor, as a bound switcher reads it. `title` and `icon` are
 * already normalized so no renderer repeats the fallback, and `icon` is `''` when
 * absent — never `undefined`, which switcher code that reads `page.icon.length`
 * relies on.
 */
export interface AdwViewStackPageInfo<T = unknown> {
    /** Stable id used by `visible-child-name` and by a bound switcher. */
    readonly name: string;
    /** Human-facing title, already resolved against `name`. */
    readonly title: string;
    /** Normalized GTK icon name, `''` when the page has none. */
    readonly icon: string;
    /** The renderer's page node, `undefined` for a headless page. */
    readonly content: T | undefined;
    /** Whether the page can be selected — `AdwViewStackPage:visible`. */
    readonly visible: boolean;
    /** `AdwViewStackPage:badge-number`. 0 means no badge. */
    readonly badgeNumber: number;
    /** `AdwViewStackPage:needs-attention` — the bare dot, with or without a badge. */
    readonly needsAttention: boolean;
    /** `AdwViewStackPage:use-underline` — whether the title carries a mnemonic. */
    readonly useUnderline: boolean;
}

/** Payload of a selection change. */
export interface ViewStackStateChange<T = unknown> {
    /** Index of the newly-visible page, `-1` when nothing is selected. */
    index: number;
    /** Its name, `''` when nothing is selected. */
    name: string;
    /** Its title, `''` when nothing is selected. */
    title: string;
    /** Its descriptor, `undefined` when nothing is selected. */
    page: AdwViewStackPageInfo<T> | undefined;
    /**
     * `true` for an explicit {@link ViewStackState.setVisibleIndex} /
     * {@link ViewStackState.setVisibleName}, `false` for an auto-pick from `addPage` /
     * `setPageVisible`. libadwaita notifies on BOTH — the flag lets a switcher suppress
     * its own feedback loop, not a renderer drop the notification.
     */
    interactive: boolean;
}

/** Subscriber for {@link ViewStackState} changes. */
export type ViewStackStateListener<T = unknown> = (change: ViewStackStateChange<T>) => void;

/** Internal, mutable twin of {@link AdwViewStackPageInfo}. */
interface PageRecord<T> {
    name: string;
    title: string;
    icon: string;
    content: T | undefined;
    visible: boolean;
    badgeNumber: number;
    needsAttention: boolean;
    useUnderline: boolean;
}

/**
 * The title a page renders with: `title` when given, else the page `name`. A named
 * function because it is a DEVIATION from C, where `add_internal` stores a NULL title
 * and a native `AdwViewSwitcher` then renders no label. An explicitly empty title
 * stays empty — only an absent one falls back.
 */
export function resolvePageTitle(title: string | null | undefined, name: string): string {
    return title ?? name;
}

/**
 * The one shape a normalized icon name may have: a single identifier token. Both
 * renderers use the result as an IDENTIFIER — `adwaita-web` interpolates it into a
 * `.adw-icon--<name>` mask class, `adwaita-nativescript` looks it up in its
 * rasterized-symbolic map — so a value that is not one token produces markup instead
 * of a lookup.
 */
const ICON_NAME_TOKEN = /^[A-Za-z0-9_-]+$/;

/**
 * A GTK icon name reduced to its renderer-neutral form: `''` for absent or unusable,
 * and a single anchored `-symbolic` suffix stripped. The strip is end-anchored and
 * applied ONCE, so `go-symbolic-next` survives intact and `go-next-symbolic-symbolic`
 * loses only the last suffix.
 *
 * The token guard belongs HERE, not in each caller: a name that is not one token
 * cannot be one CSS class, and interpolating `icon-name="a b"` into
 * `.adw-icon--<name>` injected a stray `b` class onto the icon node. Unusable names
 * resolve to "no icon" so the renderer's absent-icon path takes over.
 *
 * Consequence: a reverse-DNS APPLICATION icon name (`org.gnome.Builder`) is not a
 * token and normalizes to `''` — it never had a mask class either, since
 * `.adw-icon--org.gnome.Builder` parses as three classes.
 */
export function normalizeIconName(icon: string | null | undefined): string {
    const base = (icon ?? '').replace(/-symbolic$/, '');
    return ICON_NAME_TOKEN.test(base) ? base : '';
}

/** C's `g_warning` on an unknown name, as a recorded string. */
function nameNotFoundDiagnostic(name: string): string {
    return `Child name '${name}' not found in AdwViewStack`;
}

/** C's `g_warning` on a duplicate name, as a recorded string. */
function duplicateNameDiagnostic(name: string): string {
    return `While adding page: duplicate child name in AdwViewStack: ${name}`;
}

/**
 * The ordered page list of an `Adw.ViewStack` plus its visible-child selection, with
 * the C guard / ordering / fallback rules applied once for every renderer. `T` is the
 * renderer's page-content type; the state machine never looks inside it, and holds no
 * timer or global, so an instance is a plain value a test can drive step by step.
 */
export class ViewStackState<T = unknown> {
    private readonly _pages: PageRecord<T>[] = [];
    private _visibleIndex = -1;
    private readonly _listeners = new Set<ViewStackStateListener<T>>();
    private readonly _diagnostics: string[] = [];
    /** Cached frozen projection of {@link pages}; dropped on any structural change. */
    private _pagesView: readonly AdwViewStackPageInfo<T>[] | null = null;

    /** Subscribe to selection changes. Returns an unsubscribe function. */
    subscribe(listener: ViewStackStateListener<T>): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    private _emit(interactive: boolean): void {
        const page = this._pageAt(this._visibleIndex);
        const change: ViewStackStateChange<T> = {
            index: this._visibleIndex,
            name: page?.name ?? '',
            title: page?.title ?? '',
            page,
            interactive,
        };
        // Snapshot so a listener that unsubscribes mid-fan-out can't skip another.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
        for (const listener of [...this._listeners]) listener(change);
    }

    /** Bounds-safe lookup — indexing is not enough, `_visibleIndex` is `-1` when empty. */
    private _pageAt(index: number): PageRecord<T> | undefined {
        return index >= 0 && index < this._pages.length ? this._pages[index] : undefined;
    }

    /** `set_visible_child (self, NULL)`'s scan for the first VISIBLE page. */
    private _firstVisibleIndex(): number {
        return this._pages.findIndex((page) => page.visible);
    }

    private _record(spec: AdwViewStackPageSpec<T>): PageRecord<T> {
        return {
            name: spec.name,
            title: resolvePageTitle(spec.title, spec.name),
            icon: normalizeIconName(spec.icon),
            content: spec.content,
            visible: spec.visible ?? true,
            badgeNumber: Number.isFinite(spec.badgeNumber) ? Math.trunc(spec.badgeNumber as number) : 0,
            needsAttention: spec.needsAttention === true,
            useUnderline: spec.useUnderline === true,
        };
    }

    /** All pages in add order — a frozen projection, so a switcher cannot mutate the model. */
    get pages(): readonly AdwViewStackPageInfo<T>[] {
        this._pagesView ??= Object.freeze(this._pages.slice());
        return this._pagesView;
    }

    /** Number of pages — `adw_view_stack_pages_get_n_items`. */
    get count(): number {
        return this._pages.length;
    }

    /**
     * Index of the FIRST page named `name`, or `-1` — `find_page_for_name`. An exact,
     * unnormalized compare: `g_strcmp0` walks UTF-8 bytes, so the NFC and NFD spellings
     * of a name are different names in C exactly as they are under JS `===`.
     */
    indexOfName(name: string): number {
        return this._pages.findIndex((page) => page.name === name);
    }

    /**
     * Whether the page at `position` is the selected one —
     * `adw_view_stack_pages_is_selected`. An out-of-range position is simply not
     * selected, never an error.
     */
    isSelected(position: number): boolean {
        if (!Number.isInteger(position)) return false;
        if (position < 0 || position >= this._pages.length) return false;
        return position === this._visibleIndex;
    }

    /**
     * Append a page and return its descriptor.
     *
     * Selects it only when nothing is selected yet AND the page is visible (`add_page`),
     * notifying with `interactive: false` as C does. A duplicate name is accepted (C
     * warns but still adds) and recorded in {@link duplicateNames}.
     */
    addPage(spec: AdwViewStackPageSpec<T>): AdwViewStackPageInfo<T> {
        return this._insertRecord(this._record(spec), this._pages.length);
    }

    /**
     * Insert a page at `position`, or `null` when `position` is not an integer in
     * `[0, count]`.
     *
     * `Adw.ViewStack` has no insert-at-position API of its own; this is the
     * generalisation of {@link addPage} (now `insertPage(spec, count)`) that
     * `Adw.TabView` needs, whose `attach_page` is `g_list_store_insert` plus the same
     * auto-select-when-nothing-is-selected rule.
     *
     * Inserting BEFORE the current selection shifts that selection's index up by one and
     * notifies nothing: C holds a page pointer, so the selected page is unchanged and
     * only its position moved.
     */
    insertPage(spec: AdwViewStackPageSpec<T>, position: number): AdwViewStackPageInfo<T> | null {
        if (!Number.isInteger(position)) return null;
        if (position < 0 || position > this._pages.length) return null;
        return this._insertRecord(this._record(spec), position);
    }

    private _insertRecord(record: PageRecord<T>, position: number): AdwViewStackPageInfo<T> {
        if (this.indexOfName(record.name) >= 0) this._diagnostics.push(duplicateNameDiagnostic(record.name));

        this._pages.splice(position, 0, record);
        this._pagesView = null;

        if (this._visibleIndex < 0) {
            if (record.visible) {
                this._visibleIndex = position;
                this._emit(false);
            }
            return record;
        }
        // The selection is a PAGE, not a slot — an insert before it only moves it.
        if (position <= this._visibleIndex) this._visibleIndex += 1;
        return record;
    }

    /**
     * Move the page at `from` to index `to`, keeping the SELECTION on whichever
     * page it was already on. Returns whether anything moved.
     *
     * Remove-then-insert, as `adw_tab_view_reorder_page` and
     * `adw_tab_view_set_page_pinned` do — so `to` is an index in the list WITHOUT the
     * moved page, which is what makes `set_page_pinned`'s `new_pos = n_pinned_pages` land
     * where C lands.
     *
     * Emits NOTHING: C reorders without calling `set_selected_page`, and only the list
     * model reports the change (`page-reordered`).
     */
    movePage(from: number, to: number): boolean {
        if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
        if (from < 0 || from >= this._pages.length) return false;
        if (to < 0 || to >= this._pages.length) return false;
        if (from === to) return false;

        const [record] = this._pages.splice(from, 1);
        this._pages.splice(to, 0, record!);
        this._pagesView = null;

        if (this._visibleIndex === from) this._visibleIndex = to;
        else {
            let index = this._visibleIndex;
            if (index > from) index -= 1;
            if (index >= to) index += 1;
            this._visibleIndex = index;
        }
        return true;
    }

    /**
     * Remove the first page named `name`. Returns whether anything was removed.
     *
     * When the removed page was the visible one the selection becomes `-1` and NOTHING is
     * emitted: `stack_remove` clears `visible_child` directly and never calls
     * `set_visible_child`, so there is no re-pick and no notification. Removing any OTHER
     * page keeps the same page selected — C holds a pointer, so the selection follows the
     * page and only its index shifts.
     */
    removePage(name: string): boolean {
        const index = this.indexOfName(name);
        if (index < 0) return false;

        this._pages.splice(index, 1);
        this._pagesView = null;

        if (index === this._visibleIndex) this._visibleIndex = -1;
        else if (index < this._visibleIndex) this._visibleIndex -= 1;
        return true;
    }

    /** Index of the visible page, `-1` when none — distinct from "page 0 is selected". */
    get visibleIndex(): number {
        return this._visibleIndex;
    }

    /**
     * Select by index. Returns whether the selection changed.
     *
     * Rejects — as a silent no-op that emits nothing — a non-integer, a negative, an
     * out-of-range, the already-selected and a non-`visible` index. `Number.isInteger`
     * rather than `Number.isFinite` is the point: `adw_view_stack_pages_select_item` takes
     * a `guint` position, so `1.5` is not a position that can exist. The hidden-page
     * clause is C's `if (gtk_widget_get_visible (page->widget))`.
     */
    setVisibleIndex(index: number, interactive = true): boolean {
        if (!Number.isInteger(index)) return false;
        if (index < 0 || index >= this._pages.length) return false;
        if (index === this._visibleIndex) return false;
        if (!this._pages[index]!.visible) return false;

        this._visibleIndex = index;
        this._emit(interactive);
        return true;
    }

    /** Name of the visible page, `''` when none — C returns NULL. */
    get visibleName(): string {
        return this._pageAt(this._visibleIndex)?.name ?? '';
    }

    /**
     * Select by name. Returns whether the selection changed.
     *
     * `null`/`undefined` is a SILENT no-op — C returns before the lookup and therefore
     * before its warning. An unknown name is a no-op that records a {@link diagnostics}
     * entry (C's `g_warning`). An EMPTY name is a legal lookup that matches a page
     * literally named `''`: `find_page_for_name` compares with `g_strcmp0`, which
     * special-cases only NULL.
     */
    setVisibleName(name: string | null | undefined, interactive = true): boolean {
        if (name === null || name === undefined) return false;

        const index = this.indexOfName(name);
        if (index < 0) {
            this._diagnostics.push(nameNotFoundDiagnostic(name));
            return false;
        }
        return this.setVisibleIndex(index, interactive);
    }

    /** The visible page's descriptor, or `undefined` — renderers read `.content` off it. */
    get visiblePage(): AdwViewStackPageInfo<T> | undefined {
        return this._pageAt(this._visibleIndex);
    }

    /** Title of the visible page, `''` when none — what a header bar mirrors. */
    get visibleTitle(): string {
        return this._pageAt(this._visibleIndex)?.title ?? '';
    }

    /**
     * Flip a page's `visible` flag. Returns whether the SELECTION moved (not
     * whether the flag changed) — the renderer already knows it asked for the
     * flip; what it cannot derive is the fallback.
     *
     * Implements `update_child_visible`: making a page visible while NOTHING is selected
     * selects it; hiding the selected page runs `set_visible_child (self, NULL)`, whose
     * scan takes the first still-visible page — and selects nothing, notifying with index
     * `-1`, when there is none. Setting the flag to its current value returns early.
     *
     * DEVIATION, deliberate: C keeps TWO flags (`AdwViewStackPage:visible` and the child
     * widget's own `gtk_widget_get_visible`) and its NULL-scan consults only the widget
     * one, so clearing `page->visible` on a page that is FIRST in the list re-picks that
     * same page and returns without notifying. A renderer has one notion of "shown", so
     * this collapses to one flag — matching C's `gtk_widget_set_visible (child, FALSE)`
     * path, where the scan does skip the hidden page.
     */
    setPageVisible(name: string, visible: boolean): boolean {
        const index = this.indexOfName(name);
        if (index < 0) {
            this._diagnostics.push(nameNotFoundDiagnostic(name));
            return false;
        }

        const page = this._pages[index]!;
        const next = !!visible;
        if (page.visible === next) return false;
        page.visible = next;

        if (this._visibleIndex < 0 && next) {
            this._visibleIndex = index;
            this._emit(false);
            return true;
        }
        if (this._visibleIndex === index && !next) {
            this._visibleIndex = this._firstVisibleIndex();
            this._emit(false);
            return true;
        }
        return false;
    }

    /**
     * Names that occur more than once in the CURRENT page list, in the order their first
     * repeat was added — the mechanism replacing C's `g_warning`. Duplicate names are
     * legal and first-match-wins, so a `visibleChildName` that silently resolves to the
     * wrong page needs the class to be visible somewhere. Derived from the model rather
     * than logged, so removing the duplicate clears it.
     */
    get duplicateNames(): readonly string[] {
        const seen = new Set<string>();
        const duplicates: string[] = [];
        for (const page of this._pages) {
            if (seen.has(page.name)) {
                if (!duplicates.includes(page.name)) duplicates.push(page.name);
            } else {
                seen.add(page.name);
            }
        }
        return duplicates;
    }

    /**
     * Every diagnostic C would have printed as a `g_warning`, in order — the unknown-name
     * lookups and the duplicate-name adds. Data rather than stderr so a test can assert on
     * the class.
     */
    get diagnostics(): readonly string[] {
        return this._diagnostics;
    }
}
