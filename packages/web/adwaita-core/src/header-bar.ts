// AdwHeaderBar — headless (ADR 0004).
//
// A header bar looks like "three slots and a title" and is not. Three rules in it are
// derivations, each written independently in every port so far, and each already wrong
// in at least one of them:
//
//   1. `pack_end` PREPENDS. `adw_header_bar_pack_start` is `gtk_box_append`
//      (adw-header-bar.c:1083) and `adw_header_bar_pack_end` is `gtk_box_prepend`
//      (:1106) — "packed with reference to the end" means the FIRST widget packed sits
//      nearest the end, and each later one goes in front of it. The NativeScript port
//      appended, so every end slot came out mirrored: `packEnd(menu); packEnd(search)`
//      drew `menu | search` where libadwaita draws `search | menu`.
//   2. Clearing the title widget REBUILDS the derived title. `adw_header_bar_set_title_widget`
//      (:1189) empties the centre, and on a NULL argument calls `construct_title_label`
//      again (:1210). Neither port has this: the NativeScript one has no null path at
//      all, and the web one drops the derived title and never brings it back — so a bar
//      that gave its centre away can never take it back, which GTK does on one call.
//   3. The title is RESOLVED, not stored. `Adw.HeaderBar` has no `title` property.
//      `update_title` (:475) walks a chain: a bottom sheet showing a drag handle blanks
//      it, else the navigation page's title, else the dialog's, else the root window's,
//      else `g_get_application_name`, else `g_get_prgname`.
//
// AND THE DERIVED CENTRE IS A `GtkLabel`, not an `AdwWindowTitle`. `construct_title_label`
// (:512) builds `gtk_label_new (NULL)` with the `title` class, `single-line-mode`,
// `ellipsize=END` and `width-chars = MIN_TITLE_CHARS`. Both ports document the opposite —
// `adwaita-web`'s element says "the title widget it creates when none is given IS an
// `AdwWindowTitle`" — and that claim is what made a title/subtitle PAIR look like
// fidelity. It is a divergence, and a defensible one for a declarative surface, but it
// has to be named as one; {@link HeaderBarState} keeps the subtitle and marks it.
//
// Reference: refs/libadwaita/src/adw-header-bar.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { WindowTitleState } from './action-row.js';

/**
 * What a header bar can inherit a title from, nearest first.
 *
 * The order is `update_title`'s (adw-header-bar.c:475-509) and the names are its
 * getters. A renderer supplies whichever it can observe and omits the rest; an absent
 * field is "no such ancestor", which is what a NULL getter means there.
 */
export interface HeaderBarTitleSources {
    /**
     * TRUE when the bar sits in an `AdwBottomSheet` whose drag handle is shown.
     *
     * First and unconditional: the handle occupies the same space, so the title is
     * blanked outright rather than falling through to the next source.
     */
    readonly bottomSheetShowsDragHandle?: boolean;
    /** `adw_navigation_page_get_title` of the page the bar belongs to. */
    readonly navigationPageTitle?: string | null;
    /** `adw_dialog_get_title` of the enclosing dialog. */
    readonly dialogTitle?: string | null;
    /** `gtk_window_get_title` of the root, when the root IS a window. */
    readonly windowTitle?: string | null;
    /** `g_get_application_name`. */
    readonly applicationName?: string | null;
    /** `g_get_prgname`. */
    readonly programName?: string | null;
}

/**
 * Resolve what the derived title label shows.
 *
 * Returns `''` for "show nothing", which is `gtk_label_set_text (…, NULL)` — the label
 * exists and is empty, as distinct from there being no label at all. An EMPTY STRING in
 * a source does not stop the walk: `update_title` tests pointers (`if (!title)`), and
 * `gtk_window_get_title` returning `""` is a pointer, so an empty window title ends the
 * chain there rather than falling through to the application name.
 */
export function resolveHeaderBarTitle(sources: HeaderBarTitleSources): string {
    if (sources.bottomSheetShowsDragHandle === true) return '';
    for (const value of [
        sources.navigationPageTitle,
        sources.dialogTitle,
        sources.windowTitle,
        sources.applicationName,
        sources.programName,
    ]) {
        if (value !== null && value !== undefined) return value;
    }
    return '';
}

/** What a renderer draws. `derivedTitle` is null exactly while a title widget holds the centre. */
export interface HeaderBarRenderState<T> {
    /** Start slot, in draw order — first packed is furthest from the centre. */
    readonly start: readonly T[];
    /** End slot, in draw order — first packed is NEAREST the end, so last in this list. */
    readonly end: readonly T[];
    /** The custom centre, or null while the derived title holds it. */
    readonly titleWidget: T | null;
    /** The derived title's text, or null while a title widget holds the centre. */
    readonly derivedTitle: string | null;
    /**
     * The derived subtitle.
     *
     * A DIVERGENCE, deliberate and kept: libadwaita's derived centre is a single
     * `GtkLabel` with no subtitle — an app that wants one sets an `AdwWindowTitle` as
     * its title widget. Both existing renderers expose a `subtitle` on the bar itself,
     * which is friendlier for a declarative surface and is what their markup already
     * uses. Null while a title widget holds the centre, like {@link derivedTitle}.
     */
    readonly derivedSubtitle: string | null;
}

/**
 * `Adw.HeaderBar`'s packing and title-widget state, over opaque children.
 *
 * Generic in the child type because the core holds no widgets: `T` is whatever the
 * renderer's node is, and this class only ever compares them by identity.
 */
export class HeaderBarState<T> {
    private readonly _start: T[] = [];
    private readonly _end: T[] = [];
    private _titleWidget: T | null = null;
    private readonly _title = new WindowTitleState();
    private _sources: HeaderBarTitleSources = {};

    /** `adw_header_bar_pack_start` — `gtk_box_append` (adw-header-bar.c:1083). */
    packStart(child: T): void {
        this._start.push(child);
    }

    /**
     * `adw_header_bar_pack_end` — `gtk_box_prepend` (adw-header-bar.c:1106).
     *
     * Stored in DRAW order, so the prepend is a `unshift` here: the first widget packed
     * ends up last in {@link HeaderBarRenderState.end} and therefore nearest the end of
     * the bar. Keeping draw order rather than pack order means a renderer appends the
     * list left to right and cannot re-derive the mirror by accident.
     */
    packEnd(child: T): void {
        this._end.unshift(child);
    }

    /** `adw_header_bar_remove`. Returns whether the child was found in either slot. */
    remove(child: T): boolean {
        for (const list of [this._start, this._end]) {
            const at = list.indexOf(child);
            if (at !== -1) {
                list.splice(at, 1);
                return true;
            }
        }
        if (this._titleWidget === child) {
            this.setTitleWidget(null);
            return true;
        }
        return false;
    }

    /** The custom centre, or null while the derived title holds it. */
    get titleWidget(): T | null {
        return this._titleWidget;
    }

    /**
     * `adw_header_bar_set_title_widget` (adw-header-bar.c:1189). Returns whether it changed.
     *
     * Setting the SAME widget returns early with no notify (`:1198`) — including
     * null-over-null, which is why a renderer must not read this as "the derived title
     * was rebuilt". Passing null rebuilds the derived title; passing a widget drops it.
     */
    setTitleWidget(widget: T | null): boolean {
        if (this._titleWidget === widget) return false;
        this._titleWidget = widget;
        return true;
    }

    /** The bar's title text, when it is not resolved from ancestry. */
    get title(): string {
        return this._title.title;
    }

    /** Returns whether it changed. */
    setTitle(title: string | null | undefined): boolean {
        return this._title.setTitle(title);
    }

    /** The bar's subtitle — the documented divergence, see {@link HeaderBarRenderState.derivedSubtitle}. */
    get subtitle(): string {
        return this._title.subtitle;
    }

    /** Returns whether it changed. */
    setSubtitle(subtitle: string | null | undefined): boolean {
        return this._title.setSubtitle(subtitle);
    }

    /**
     * Install what the bar can inherit a title from. Returns whether it changed.
     *
     * A renderer that observes none of these never calls it, and the explicitly set
     * {@link title} is used on its own — which is what both current renderers do today.
     */
    setTitleSources(sources: HeaderBarTitleSources): boolean {
        const before = resolveHeaderBarTitle(this._sources);
        this._sources = sources;
        return resolveHeaderBarTitle(sources) !== before;
    }

    /** The current render snapshot. */
    get state(): HeaderBarRenderState<T> {
        const held = this._titleWidget !== null;
        // An explicitly set title wins over the resolved chain: a renderer that sets
        // one is answering the question the chain exists to answer. The chain is
        // consulted only where nothing was set, which is `update_title`'s own position
        // — it runs when the bar has no title of its own to show.
        const derived = this._title.title !== '' ? this._title.title : resolveHeaderBarTitle(this._sources);
        return {
            start: [...this._start],
            end: [...this._end],
            titleWidget: this._titleWidget,
            derivedTitle: held ? null : derived,
            derivedSubtitle: held ? null : this._title.subtitle,
        };
    }
}
