// Preferences search for the NativeScript renderer — the view-tree half only.
//
// The pipeline (case fold, markup parse, the three corpus filters, the `page → group`
// subtitle) is headless in `@gjsify/adwaita-core`, so this renderer and
// `@gjsify/adwaita-web` answer identically for the same tree. What belongs here is the
// one NativeScript-specific step: reading a page / group / row tree of real NS views as
// the renderer-free shape the core reasons over — including NS's `visibility` in place
// of `gtk_widget_get_visible`.
//
// TYPE-only NS imports, so specs run off-device (AGENTS.md). The widgets satisfy the
// small STRUCTURAL interfaces below, so a spec drives the shipping mapper with stand-in
// trees rather than transcribing it into a mock.
//
// Reference: refs/libadwaita/src/adw-preferences-dialog.c
// Reference: refs/libadwaita/src/adw-preferences-page.c (is_visible_group)
// Reference: refs/libadwaita/src/adw-preferences-group.c (row_has_title)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { searchPreferences } from '@gjsify/adwaita-core';
import type {
    PreferencesSearchGroup,
    PreferencesSearchPage,
    PreferencesSearchResult,
    PreferencesSearchRow,
    SearchPreferencesOptions,
} from '@gjsify/adwaita-core';

/**
 * What the search reads off a row widget.
 *
 * `isActionRow` is a declared property rather than an `instanceof` test, because the
 * NativeScript hierarchy does NOT match the GObject one: `AdwEntryRow extends
 * AdwActionRow` here to reuse the row chrome, while in C it derives from
 * `AdwPreferencesRow` and its text is therefore deliberately NOT searchable. The row
 * classes carry the C answer.
 */
export interface NsSearchableRow {
    /** `AdwPreferencesRow:title`. */
    readonly title?: string;
    /** `AdwActionRow:subtitle`; only consulted when `isActionRow`. */
    readonly subtitle?: string;
    /** Whether the row derives from `AdwActionRow` in libadwaita. */
    readonly isActionRow?: boolean;
    /** NS `View.visibility`. */
    readonly visibility?: string;
}

/** What the search reads off a group widget. */
export interface NsSearchableGroup {
    /** `AdwPreferencesGroup:title`. */
    readonly title?: string;
    /** NS `View.visibility`. */
    readonly visibility?: string;
    /** The group's boxed-list rows, in order. */
    searchRows(): readonly NsSearchableRow[];
}

/** What the search reads off a page widget. */
export interface NsSearchablePage {
    /** `AdwPreferencesPage:title`. */
    readonly title?: string;
    /** `AdwPreferencesPage:name` — the view-stack child name. */
    readonly name?: string;
    /** `AdwPreferencesPage:use-underline`. */
    readonly useUnderline?: boolean;
    /** NS `View.visibility`. */
    readonly visibility?: string;
    /** The page's groups, in order. */
    searchGroups(): readonly NsSearchableGroup[];
}

/** Any node a search result can point back at. */
export type NsSearchableNode = NsSearchablePage | NsSearchableGroup | NsSearchableRow;

/** A described NS preferences tree, ready for `searchPreferences`. */
export type NsPreferencesSearchPage = PreferencesSearchPage<NsSearchableNode>;

/** One NS search result, carrying the page and row widgets it came from. */
export type NsPreferencesSearchResult = PreferencesSearchResult<NsSearchableNode>;

/**
 * `gtk_widget_get_visible` for a NativeScript view.
 *
 * NS has THREE values where GTK has a boolean, and only `'visible'` counts as
 * shown: `'collapse'` removes the view from layout and `'hidden'` keeps its
 * space but paints nothing — neither is something a user can read or reach, so
 * neither belongs in a search index. An undefined value is a view that never
 * set the property, i.e. the NS default `'visible'`.
 */
export function isNsVisible(visibility: string | undefined): boolean {
    return visibility === undefined || visibility === 'visible';
}

/** Describe one row widget. */
function describeRow(row: NsSearchableRow): PreferencesSearchRow<NsSearchableNode> {
    return {
        title: row.title ?? '',
        subtitle: row.subtitle ?? '',
        visible: isNsVisible(row.visibility),
        isActionRow: row.isActionRow === true,
        // NS `Label`s paint text verbatim — no Pango markup — so the string
        // compared is the string shown.
        useMarkup: false,
        useUnderline: false,
        ref: row,
    };
}

/** Describe one group widget. */
function describeGroup(group: NsSearchableGroup): PreferencesSearchGroup<NsSearchableNode> {
    return {
        title: group.title ?? '',
        visible: isNsVisible(group.visibility),
        rows: group.searchRows().map(describeRow),
        ref: group,
    };
}

/** Describe a list of page widgets as the tree `searchPreferences` indexes. */
export function describeNsPreferencesPages(pages: readonly NsSearchablePage[]): NsPreferencesSearchPage[] {
    return pages.map((page) => ({
        name: page.name ?? '',
        title: page.title ?? '',
        useUnderline: page.useUnderline === true,
        visible: isNsVisible(page.visibility),
        groups: page.searchGroups().map(describeGroup),
        ref: page,
    }));
}

/**
 * Search a list of NativeScript preferences pages.
 *
 * An empty query returns the WHOLE corpus, which is what C does
 * (`strstr (title, "")` is non-NULL) and what keeps the results list populated
 * before the user has typed.
 */
export function searchNsPreferences(
    pages: readonly NsSearchablePage[],
    query: string,
    options?: SearchPreferencesOptions,
): NsPreferencesSearchResult[] {
    return searchPreferences(describeNsPreferencesPages(pages), query, options);
}
