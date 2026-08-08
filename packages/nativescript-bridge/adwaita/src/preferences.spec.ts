// Preferences behaviour for the NativeScript renderer, against the SAME vectors
// the browser suite drives its real elements with.
//
// The widgets themselves cannot be imported here — `AdwPreferencesGroup extends
// StackLayout` evaluates the bare `@nativescript/core` specifier at module-eval,
// which is unresolvable on GJS/Node — so the two pure halves live in their own
// modules and the widgets are thin appliers over them. What is asserted is the
// SHIPPING code: `preferences-group-state.ts` and `preferences-search.ts`, not a
// transcription of them.
//
// Both halves were missing here. The group derived exactly one of the five
// states (a non-empty title) and expressed it by adding and removing the header
// Label; there was no description, no header suffix, no `single-line` and no
// listbox rule. The search did not exist at all.

import { describe, expect, it } from '@gjsify/unit';

import {
    PREFERENCES_GROUP_HEADER_VECTORS,
    PREFERENCES_SEARCH_PAGES,
    PREFERENCES_SEARCH_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import type { PreferencesSearchPage } from '@gjsify/adwaita-core';

import {
    PREFERENCES_GROUP_HEADER_CLASS,
    PREFERENCES_GROUP_SINGLE_LINE_CLASS,
    preferencesGroupHeaderState,
    preferencesGroupVisuals,
} from './widgets/preferences-group-state.js';
import {
    describeNsPreferencesPages,
    isNsVisible,
    searchNsPreferences,
    type NsSearchableGroup,
    type NsSearchablePage,
    type NsSearchableRow,
} from './widgets/preferences-search.js';

/** Read the five states back out of what the widget would apply to its views. */
function appliedState(input: Parameters<typeof preferencesGroupVisuals>[0]) {
    const visuals = preferencesGroupVisuals(input);
    return {
        titleVisible: visuals.titleVisibility === 'visible',
        descriptionVisible: visuals.descriptionVisibility === 'visible',
        headerVisible: visuals.headerVisibility === 'visible',
        singleLine: visuals.headerClassName.split(' ').includes(PREFERENCES_GROUP_SINGLE_LINE_CLASS),
        listboxVisible: visuals.listboxVisibility === 'visible',
    };
}

/**
 * The conformance tree as NativeScript widgets present it.
 *
 * Deliberately built from the SHARED vectors rather than hand-written: a group
 * that answers `searchRows()` and a page that answers `searchGroups()` are
 * exactly what `AdwPreferencesGroup` and `AdwPreferencesPage` implement, so the
 * mapper under test is the one that ships.
 */
function asNsPages(pages: readonly PreferencesSearchPage[]): NsSearchablePage[] {
    return pages.map((page) => {
        const groups: NsSearchableGroup[] = page.groups.map((group) => {
            const rows: NsSearchableRow[] = group.rows.map((row) => ({
                title: row.title,
                subtitle: row.subtitle ?? '',
                isActionRow: row.isActionRow === true,
                // NS has three visibility values where GTK has a boolean.
                visibility: row.visible === false ? 'collapse' : 'visible',
            }));
            return {
                title: group.title ?? '',
                visibility: group.visible === false ? 'collapse' : 'visible',
                searchRows: () => rows,
            };
        });
        return {
            title: page.title ?? '',
            name: page.name ?? '',
            useUnderline: page.useUnderline === true,
            visibility: page.visible === false ? 'collapse' : 'visible',
            searchGroups: () => groups,
        };
    });
}

export default async () => {
    await describe('preferencesGroupVisuals (Adw.PreferencesGroup update_*_visibility)', async () => {
        for (const vector of PREFERENCES_GROUP_HEADER_VECTORS) {
            // NS `Label`s paint text verbatim, so this renderer derives with
            // `useMarkup: false`; rows that hinge on markup being interpreted
            // are not its to satisfy.
            if (vector.dependsOnMarkup) continue;

            await it(`${JSON.stringify(vector.input)} — ${vector.rule}`, () => {
                expect(appliedState(vector.input)).toStrictEqual(vector.state);
                // The same table, one layer down: the NS visuals must not drift
                // from the core state they are projected from.
                expect(preferencesGroupHeaderState(vector.input)).toStrictEqual(vector.state);
            });
        }

        await it('collapses rather than hides, so a dead header takes no space', () => {
            // `visibility: 'hidden'` would keep the header's margin — the very
            // thing update_header_visibility exists to remove.
            const visuals = preferencesGroupVisuals({ title: '', description: '', rowCount: 0 });
            expect(visuals.headerVisibility).toBe('collapse');
            expect(visuals.listboxVisibility).toBe('collapse');
        });

        await it('composes single-line into the className, never replacing the base', () => {
            // NS has no classList: the style class has to be spelled into the
            // string, and losing the base class would drop every header rule.
            const single = preferencesGroupVisuals({ title: 'Account', rowCount: 1 });
            expect(single.headerClassName).toBe(
                `${PREFERENCES_GROUP_HEADER_CLASS} ${PREFERENCES_GROUP_SINGLE_LINE_CLASS}`,
            );

            const twoLine = preferencesGroupVisuals({ title: 'Account', description: 'Manage it.', rowCount: 1 });
            expect(twoLine.headerClassName).toBe(PREFERENCES_GROUP_HEADER_CLASS);
        });

        await it('keeps a header alive for a suffix with no text at all', () => {
            const visuals = preferencesGroupVisuals({ hasHeaderSuffix: true, rowCount: 1 });
            expect(visuals.headerVisibility).toBe('visible');
            expect(visuals.headerClassName).toContain(PREFERENCES_GROUP_SINGLE_LINE_CLASS);
        });
    });

    await describe('isNsVisible (gtk_widget_get_visible for a NativeScript view)', async () => {
        await it('treats only "visible" — and an unset property — as shown', () => {
            // 'hidden' keeps the view's space but paints nothing; neither it nor
            // 'collapse' is something a user can read, so neither is indexable.
            expect(isNsVisible('visible')).toBe(true);
            expect(isNsVisible(undefined)).toBe(true);
            expect(isNsVisible('collapse')).toBe(false);
            expect(isNsVisible('hidden')).toBe(false);
        });
    });

    await describe('describeNsPreferencesPages (the three corpus filters)', async () => {
        await it('keeps page identity, which the result subtitles need', () => {
            const described = describeNsPreferencesPages(asNsPages(PREFERENCES_SEARCH_PAGES));
            expect(described.map((page) => page.name)).toStrictEqual(['general', 'network', 'developer']);
            expect(described.map((page) => page.title)).toStrictEqual(['General', 'Network', 'Developer']);
        });

        await it('maps NS visibility onto the visible flag at all three levels', () => {
            const described = describeNsPreferencesPages(asNsPages(PREFERENCES_SEARCH_PAGES));
            expect(described[2]!.visible).toBe(false); // collapsed page
            expect(described[0]!.groups[1]!.visible).toBe(false); // collapsed group
            expect(described[1]!.groups[0]!.rows[2]!.visible).toBe(false); // collapsed row
        });

        await it('carries the widget back on every level, for activation', () => {
            const pages = asNsPages(PREFERENCES_SEARCH_PAGES);
            const described = describeNsPreferencesPages(pages);
            expect(described[0]!.ref).toBe(pages[0]!);
            expect(described[0]!.groups[0]!.ref).toBe(pages[0]!.searchGroups()[0]!);
        });
    });

    await describe('searchNsPreferences (libadwaita conformance vectors)', async () => {
        const pages = asNsPages(PREFERENCES_SEARCH_PAGES);

        for (const { query, results, rule } of PREFERENCES_SEARCH_VECTORS) {
            await it(`${JSON.stringify(query)} → ${results.length} result(s) — ${rule}`, () => {
                expect(
                    searchNsPreferences(pages, query).map((result) => ({
                        title: result.title,
                        subtitle: result.subtitle,
                    })),
                ).toStrictEqual(results.map((result) => ({ title: result.title, subtitle: result.subtitle })));
            });
        }

        await it('returns the row widget, so a result can be activated', () => {
            // search_result_activated_cb reveals the page and focuses the row.
            const [result] = searchNsPreferences(pages, 'strasse');
            expect((result!.row.ref as NsSearchableRow).title).toBe('Straße');
            expect((result!.page.ref as NsSearchablePage).name).toBe('network');
        });

        await it('does not search an entry row’s text, as C does not', () => {
            // AdwEntryRow extends AdwActionRow in THIS port but derives from
            // AdwPreferencesRow in C, so the row classes carry an explicit
            // isActionRow — this is the assertion that keeps them honest.
            expect(searchNsPreferences(pages, 'grace')).toStrictEqual([]);
            expect(searchNsPreferences(pages, 'display name').length).toBe(1);
        });

        await it('finds a German title typed without its ß', () => {
            // The canary for the case fold: a toLowerCase() port returns nothing.
            expect(searchNsPreferences(pages, 'strasse').length).toBe(1);
            expect(searchNsPreferences(pages, 'STRASSE').length).toBe(1);
        });
    });
};
