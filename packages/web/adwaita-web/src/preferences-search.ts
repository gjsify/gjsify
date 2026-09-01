// Preferences search for the browser renderer — the DOM half only.
//
// The pipeline itself (case fold, markup parse, the three-filter corpus, the
// `page → group` subtitle) is headless and lives in `@gjsify/adwaita-core`;
// what belongs here is the one genuinely renderer-specific step: reading a
// `<adw-preferences-page>` subtree and describing it as the renderer-free tree
// the core reasons over.
//
// Reference: refs/libadwaita/src/adw-preferences-dialog.c
//   (adw_preferences_dialog_init's page/group/row model)
// Reference: refs/libadwaita/src/adw-action-row.c, adw-entry-row.c,
//   adw-expander-row.c, adw-button-row.c (which rows ARE action rows)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import {
    searchPreferences,
    type PreferencesSearchGroup,
    type PreferencesSearchPage,
    type PreferencesSearchResult,
    type PreferencesSearchRow,
    type SearchPreferencesOptions,
} from '@gjsify/adwaita-core';

/**
 * The rows that derive from `AdwActionRow` and therefore have their SUBTITLE searched
 * (`filter_search_results`).
 *
 * A tag-name set rather than an `instanceof` chain, because the browser elements are all
 * direct `HTMLElement` subclasses: the GObject hierarchy is not reproduced in the DOM, so
 * the distinction has to be stated. The test is NOT "has a subtitle" —
 * `adw-entry-row`, `adw-expander-row` and `adw-button-row` derive from
 * `AdwPreferencesRow` in C, so text typed into an entry row is deliberately not searchable.
 */
const ACTION_ROW_TAGS: ReadonlySet<string> = new Set([
    'adw-action-row',
    'adw-switch-row',
    'adw-combo-row',
    'adw-spin-row',
]);

/**
 * `ADW_IS_PREFERENCES_ROW` for the browser elements — the first clause of
 * `row_has_title`. Spelled out rather than inferred from the `adw-` prefix, because a
 * group's boxed list legitimately holds other things: a bare `<gtk-button>` dropped in as
 * a footer is not a preferences row and must not be searchable.
 */
const PREFERENCES_ROW_TAGS: ReadonlySet<string> = new Set([
    ...ACTION_ROW_TAGS,
    'adw-entry-row',
    'adw-password-entry-row',
    'adw-expander-row',
    'adw-button-row',
]);

/** `gtk_widget_get_visible` for a DOM element. */
function isVisible(element: Element): boolean {
    return !(element instanceof HTMLElement && element.hidden);
}

/** A group element's rows, whether or not it has upgraded into its listbox yet. */
function groupRows(group: Element): Element[] {
    const listbox = group.querySelector(':scope > .adw-preferences-group-listbox');
    return Array.from((listbox ?? group).children).filter((child) =>
        PREFERENCES_ROW_TAGS.has(child.tagName.toLowerCase()),
    );
}

/** Describe one `<adw-*-row>` element for the search corpus. */
function describeRow(row: Element): PreferencesSearchRow<Element> {
    const subtitle = row.getAttribute('subtitle');
    return {
        title: row.getAttribute('title') ?? '',
        subtitle,
        visible: isVisible(row),
        isActionRow: ACTION_ROW_TAGS.has(row.tagName.toLowerCase()),
        // The browser rows paint their title as TEXT, not as Pango markup, so
        // the string compared is the string shown. Rendering markup is a
        // separate, still-open gap; closing it flips this one flag.
        useMarkup: false,
        useUnderline: false,
        ref: row,
    };
}

/** Describe one `<adw-preferences-group>` element. */
function describeGroup(group: Element): PreferencesSearchGroup<Element> {
    return {
        title: group.getAttribute('title') ?? '',
        visible: isVisible(group),
        rows: groupRows(group).map(describeRow),
        ref: group,
    };
}

/**
 * Describe every `<adw-preferences-page>` under `root` as the tree
 * `searchPreferences` indexes.
 *
 * Page identity is read off the element itself — which is why the dialog keeps
 * the page elements in its subtree instead of hoisting their children out. A
 * flattened dialog has no page titles, and `create_search_row_subtitle` needs
 * them the moment a second page exists.
 */
export function describePreferencesPages(root: ParentNode): PreferencesSearchPage<Element>[] {
    return Array.from(root.querySelectorAll('adw-preferences-page')).map((page) => ({
        name: page.getAttribute('name'),
        title: page.getAttribute('title') ?? '',
        iconName: page.getAttribute('icon-name'),
        useUnderline: page.hasAttribute('use-underline'),
        visible: isVisible(page),
        description: page.getAttribute('description') ?? '',
        groups: Array.from(page.querySelectorAll('adw-preferences-group')).map(describeGroup),
        ref: page,
    }));
}

/**
 * Search the preferences pages under `root`, returning the result rows a
 * `search_results` list box would be bound to.
 *
 * Each result carries the `<adw-preferences-page>` and the row element, so a
 * caller can reproduce `search_result_activated_cb`: reveal the page, focus
 * the row.
 */
export function searchPreferencesDom(
    root: ParentNode,
    query: string,
    options?: SearchPreferencesOptions,
): PreferencesSearchResult<Element>[] {
    return searchPreferences(describePreferencesPages(root), query, options);
}
