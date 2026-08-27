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
//      again (:1211, under the `self->title_label == NULL` guard at :1210). Neither
//      port has this: the NativeScript one has no null path at all, and the web one
//      drops the derived title and never brings it back — so a bar that gave its centre
//      away can never take it back, which GTK does on one call.
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
 * The order is `update_title`'s (adw-header-bar.c:475-508) and the names are its
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
 * exists and is empty, as distinct from there being no label at all.
 *
 * AN EMPTY STRING IN A SOURCE ENDS THE WALK. `update_title` tests POINTERS (`if (!title)`
 * at :491, :494, :501 and :504) and `""` is a pointer, so a source answering `""` has
 * ANSWERED — the chain stops rather than falling through to the application name. That is
 * the common case for two of the five, not a corner: `AdwNavigationPage:title` and
 * `AdwDialog:title` both DEFAULT to `""` and can never yield NULL (the page's setter
 * rejects NULL outright, adw-navigation-view.c:2514; the dialog's normalises it to `""`,
 * adw-dialog.c:1465), so a bar under an untitled page or dialog renders BLANK and never
 * reaches the window title. Only `gtk_window_get_title` defaults to NULL.
 *
 * `null` and an absent field both mean "no such ancestor" — the NULL a getter returns, or
 * the branch `update_title` skips — and those DO fall through.
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
 * renderer's node is, and this class only ever compares them by identity (`===`).
 *
 * `T` must therefore be a STABLE reference. {@link remove} and {@link setTitleWidget}'s
 * early return both key off identity, so a renderer that wraps its nodes freshly per call
 * — `remove(wrap(node))` — hands over a value matching nothing and gets a silent `false`.
 * Pass the node itself, or a wrapper cached per node.
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

    /**
     * `adw_header_bar_remove` (adw-header-bar.c:1125). Returns whether the bar held it.
     *
     * Sweeps BOTH slots AND the centre rather than stopping at the first hit. libadwaita
     * never has to: `pack_start` and `pack_end` each refuse a child that already has a
     * parent (`gtk_widget_get_parent (child) == NULL`, :1081 and :1104) and a GTK widget
     * has exactly one, so `adw_header_bar_remove` can dispatch on the parent alone
     * (:1133). `T` is opaque here and carries no parent, so nothing stops a renderer from
     * packing the same value twice, or from packing it and also making it the centre —
     * and a first-match removal then returned `true` with the child still on the bar,
     * which is the one answer a caller cannot recover from.
     *
     * A child the bar never held is `false` here and a `g_critical` there
     * (`ADW_CRITICAL_CANNOT_REMOVE_CHILD`, :1146); the return value is the seam a renderer
     * raises its own diagnostic from.
     */
    remove(child: T): boolean {
        let removed = false;
        for (const list of [this._start, this._end]) {
            for (let at = list.length - 1; at >= 0; at--) {
                if (list[at] === child) {
                    list.splice(at, 1);
                    removed = true;
                }
            }
        }
        if (this._titleWidget === child) {
            this.setTitleWidget(null);
            removed = true;
        }
        return removed;
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
     * Install what the bar can inherit a title from. Returns whether the RESOLVED title
     * moved — swapping the sources for different ones that answer the same is `false`,
     * because `update_title` ends at `gtk_label_set_text` and the label is the output.
     *
     * The report is over the CHAIN, not over {@link state}: while a non-empty
     * {@link title} masks the chain, this can return `true` for a change no renderer will
     * see. The imprecision only runs that way — a `false` here can never hide a moved
     * `derivedTitle` — so a renderer may repaint on it without re-checking.
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
        //
        // So `''` reads two ways here, on purpose: in a SOURCE it is an answer and ends
        // the walk, exactly as an untitled page or dialog does in C; as the bar's OWN
        // `title` it means "unset", the state `Adw.HeaderBar` is permanently in since it
        // has no such property. A renderer with sources installed therefore cannot force
        // a blank centre with `setTitle('')` — it clears the sources instead, which is
        // the only lever C offers either.
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
