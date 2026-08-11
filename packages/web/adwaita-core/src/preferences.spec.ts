// Preferences derivation specs — driven by the shared conformance vectors, so
// this suite and the two renderer suites assert the SAME table.

import { describe, expect, it } from '@gjsify/unit';

import {
    UNTITLED_PAGE_LABEL,
    collectSearchRows,
    countVisiblePages,
    createSearchRowSubtitle,
    defaultCaseFolder,
    derivePreferencesGroupHeader,
    escapeMarkup,
    makeComparable,
    rowMatchesQuery,
    searchPreferences,
    stripMarkup,
    stripMnemonic,
} from './preferences.js';
import {
    CASE_FOLD_VECTORS,
    MAKE_COMPARABLE_VECTORS,
    PREFERENCES_GROUP_HEADER_VECTORS,
    PREFERENCES_SEARCH_PAGES,
    PREFERENCES_SEARCH_VECTORS,
    ROW_MATCH_VECTORS,
    SEARCH_CORPUS_VECTORS,
    SEARCH_ROW_SUBTITLE_VECTORS,
    STRIP_MARKUP_VECTORS,
    STRIP_MNEMONIC_VECTORS,
} from './conformance/preferences.js';

export default async () => {
    await describe('derivePreferencesGroupHeader (Adw.PreferencesGroup update_*_visibility)', async () => {
        for (const { input, state, rule } of PREFERENCES_GROUP_HEADER_VECTORS) {
            await it(`${JSON.stringify(input)} — ${rule}`, () => {
                expect(derivePreferencesGroupHeader(input)).toStrictEqual(state);
            });
        }

        await it('never reports single-line without a visible header', () => {
            // is_single_line is only consulted for a header that is SHOWN: a
            // `single-line` class on a hidden header gives it a 34px min-height.
            const disagreements: string[] = [];
            for (const title of ['', 'Appearance']) {
                for (const description of ['', 'Controls how it looks.']) {
                    for (const hasHeaderSuffix of [false, true]) {
                        const state = derivePreferencesGroupHeader({ title, description, hasHeaderSuffix });
                        if (state.singleLine && !state.headerVisible) {
                            disagreements.push(JSON.stringify({ title, description, hasHeaderSuffix }));
                        }
                    }
                }
            }
            expect(disagreements).toStrictEqual([]);
        });

        await it('every row without dependsOnMarkup also holds for a verbatim renderer', () => {
            // Both renderers paint labels as plain text and pass `useMarkup: false`, and
            // this guard keeps their suites drivable from the table: a new row whose
            // expectation depends on markup interpretation fails HERE, once, instead of in
            // two renderer suites that would each have to be taught to skip it.
            const undrivable = PREFERENCES_GROUP_HEADER_VECTORS.filter(({ input, state, dependsOnMarkup }) => {
                if (dependsOnMarkup) return false;
                const verbatim = derivePreferencesGroupHeader({ ...input, useMarkup: false });
                return JSON.stringify(verbatim) !== JSON.stringify(state);
            }).map(({ input }) => JSON.stringify(input));
            expect(undrivable).toStrictEqual([]);
        });

        await it('hides the listbox at zero rows and shows it at one', () => {
            // Creating the `.boxed-list` div unconditionally makes an empty group stroke
            // the full-width box-shadow hairline of a card with nothing in it.
            expect(derivePreferencesGroupHeader({ rowCount: 0 }).listboxVisible).toBe(false);
            expect(derivePreferencesGroupHeader({ rowCount: 1 }).listboxVisible).toBe(true);
            expect(derivePreferencesGroupHeader({}).listboxVisible).toBe(false);
        });
    });

    await describe('defaultCaseFolder (g_utf8_casefold)', async () => {
        for (const { text, folded, naiveLowerCase, rule } of CASE_FOLD_VECTORS) {
            await it(`${JSON.stringify(text)} → ${JSON.stringify(folded)} — ${rule}`, () => {
                expect(defaultCaseFolder(text)).toBe(folded);
                // The table records what toLowerCase() gives, so a "simplification"
                // back to it fails on the exact input it would break.
                expect(text.toLowerCase()).toBe(naiveLowerCase);
            });
        }

        await it('is idempotent — folding a folded string changes nothing', () => {
            const drifting = CASE_FOLD_VECTORS.filter(({ text }) => {
                const once = defaultCaseFolder(text);
                return defaultCaseFolder(once) !== once;
            }).map(({ text }) => text);
            expect(drifting).toStrictEqual([]);
        });

        await it('is not reproducible by NFKC + toLowerCase', () => {
            // The plausible substitute repairs the ligature but over-normalises the
            // digraph into two characters.
            // Escaped: `d\u017E` and `\u01C6` are indistinguishable on screen.
            expect('\u01C4'.normalize('NFKC').toLowerCase()).toBe('d\u017E');
            expect(defaultCaseFolder('\u01C4')).toBe('\u01C6');
            expect('Straße'.normalize('NFKC').toLowerCase()).toBe('straße');
        });
    });

    await describe('stripMarkup (pango_parse_markup)', async () => {
        for (const { markup, plain, rule } of STRIP_MARKUP_VECTORS) {
            await it(`${JSON.stringify(markup)} → ${JSON.stringify(plain)} — ${rule}`, () => {
                expect(stripMarkup(markup)).toBe(plain);
            });
        }

        await it('returns null instead of throwing, so callers can keep the raw text', () => {
            // C logs a g_critical and carries on with the unparsed string; throwing here
            // would drop the row out of the search index.
            expect(stripMarkup('<<<')).toBe(null);
            expect(makeComparable('Tom & Jerry', { useMarkup: true })).toBe('tom & jerry');
        });
    });

    await describe('stripMnemonic (adw_strip_mnemonic)', async () => {
        for (const { text, stripped, rule } of STRIP_MNEMONIC_VECTORS) {
            await it(`${JSON.stringify(text)} → ${JSON.stringify(stripped)} — ${rule}`, () => {
                expect(stripMnemonic(text)).toBe(stripped);
            });
        }
    });

    await describe('escapeMarkup (g_markup_escape_text)', async () => {
        await it('escapes the five markup characters', () => {
            expect(escapeMarkup('Tom & Jerry')).toBe('Tom &amp; Jerry');
            expect(escapeMarkup('<b>')).toBe('&lt;b&gt;');
        });

        await it('uses GLib’s NUMERIC references for the quotes', () => {
            // Not &apos;/&quot;: "tidying" these up produces a different subtitle string
            // for the same page title.
            expect(escapeMarkup(`'x' "y"`)).toBe('&#39;x&#39; &#34;y&#34;');
        });

        await it('leaves ordinary text, including non-ASCII, alone', () => {
            expect(escapeMarkup('Straße → Ǆ')).toBe('Straße → Ǆ');
        });
    });

    await describe('makeComparable (Adw.PreferencesDialog make_comparable)', async () => {
        for (const { source, options, comparable, rule } of MAKE_COMPARABLE_VECTORS) {
            await it(`${JSON.stringify(source)} ${JSON.stringify(options)} → ${JSON.stringify(comparable)} — ${rule}`, () => {
                expect(makeComparable(source, options)).toBe(comparable);
            });
        }

        await it('folds BEFORE parsing markup, not after', () => {
            // The observable consequence of the order: an injected folder sees
            // the raw markup, because it runs first.
            const seen: string[] = [];
            const spy = (text: string) => {
                seen.push(text);
                return text.toLowerCase();
            };
            makeComparable('<b>Dark</b> Style', { useMarkup: true }, spy);
            expect(seen).toStrictEqual(['<b>Dark</b> Style']);
        });

        await it('accepts an injected folder, so a renderer can trade the table away', () => {
            const asciiOnly = (text: string) => text.toLowerCase();
            expect(makeComparable('Straße', {}, asciiOnly)).toBe('straße');
            expect(makeComparable('Straße', {})).toBe('strasse');
        });

        await it('treats a missing string as empty rather than crashing', () => {
            expect(makeComparable(null)).toBe('');
            expect(makeComparable(undefined)).toBe('');
        });
    });

    await describe('rowMatchesQuery (filter_search_results)', async () => {
        for (const { row, query, matches, rule } of ROW_MATCH_VECTORS) {
            await it(`${JSON.stringify(row.title)} / ${JSON.stringify(query)} → ${matches} — ${rule}`, () => {
                expect(rowMatchesQuery(row, query)).toBe(matches);
            });
        }

        await it('folds the query but does not markup-parse it', () => {
            // The entry text goes through g_utf8_casefold ONLY, so typing
            // an entity searches for its literal characters.
            expect(rowMatchesQuery({ title: 'AT&amp;T' }, 'at&t')).toBe(true);
            expect(rowMatchesQuery({ title: 'AT&amp;T' }, '&amp;')).toBe(false);
        });
    });

    await describe('collectSearchRows (the three-filter corpus)', async () => {
        for (const { pages, titles, rule } of SEARCH_CORPUS_VECTORS) {
            await it(`${rule}`, () => {
                expect(collectSearchRows(pages).map((entry) => entry.row.title)).toStrictEqual([...titles]);
            });
        }

        await it('carries the ancestors a subtitle needs, by reference', () => {
            const [entry] = collectSearchRows(PREFERENCES_SEARCH_PAGES);
            expect(entry!.page).toBe(PREFERENCES_SEARCH_PAGES[0]!);
            expect(entry!.group).toBe(PREFERENCES_SEARCH_PAGES[0]!.groups[0]!);
            expect(entry!.row).toBe(PREFERENCES_SEARCH_PAGES[0]!.groups[0]!.rows[0]!);
        });

        await it('counts visible pages the way get_n_pages does', () => {
            expect(countVisiblePages(PREFERENCES_SEARCH_PAGES)).toBe(2);
            expect(countVisiblePages([])).toBe(0);
        });
    });

    await describe('createSearchRowSubtitle', async () => {
        for (const { input, subtitle, rule } of SEARCH_ROW_SUBTITLE_VECTORS) {
            await it(`${JSON.stringify(input)} → ${JSON.stringify(subtitle)} — ${rule}`, () => {
                expect(createSearchRowSubtitle(input)).toBe(subtitle);
            });
        }

        await it('joins with U+2192 and exactly one space either side', () => {
            const subtitle = createSearchRowSubtitle({ groupTitle: 'B', pageTitle: 'A', nVisiblePages: 2 })!;
            expect([...subtitle]).toStrictEqual(['A', ' ', '→', ' ', 'B']);
        });

        await it('takes a translated placeholder without hard-coding English', () => {
            expect(
                createSearchRowSubtitle({
                    groupTitle: 'Fonts',
                    pageTitle: '',
                    nVisiblePages: 2,
                    untitledPageLabel: 'Seite ohne Titel',
                }),
            ).toBe('Seite ohne Titel → Fonts');
            expect(UNTITLED_PAGE_LABEL).toBe('Untitled page');
        });
    });

    await describe('searchPreferences (corpus + filter + subtitle)', async () => {
        for (const { query, results, rule } of PREFERENCES_SEARCH_VECTORS) {
            await it(`${JSON.stringify(query)} → ${results.length} result(s) — ${rule}`, () => {
                expect(
                    searchPreferences(PREFERENCES_SEARCH_PAGES, query).map((result) => ({
                        title: result.title,
                        subtitle: result.subtitle,
                    })),
                ).toStrictEqual(results.map((result) => ({ title: result.title, subtitle: result.subtitle })));
            });
        }

        await it('every end-to-end row also holds for a verbatim renderer', () => {
            // Same guard as the header table: the two renderers describe their
            // rows with `useMarkup: false`, so a vector row whose expectation
            // depends on markup being STRIPPED would be undrivable by both.
            const verbatimPages = PREFERENCES_SEARCH_PAGES.map((page) => ({
                ...page,
                groups: page.groups.map((group) => ({
                    ...group,
                    rows: group.rows.map((row) => ({ ...row, useMarkup: false })),
                })),
            }));
            const undrivable = PREFERENCES_SEARCH_VECTORS.filter(({ query, results }) => {
                const actual = searchPreferences(verbatimPages, query).map(({ title, subtitle }) => ({
                    title,
                    subtitle,
                }));
                return JSON.stringify(actual) !== JSON.stringify(results.map((r) => ({ ...r })));
            }).map(({ query }) => query);
            expect(undrivable).toStrictEqual([]);
        });

        await it('carries the source page and row, so a result can be activated', () => {
            // search_result_activated_cb switches the visible page and
            // focuses the row; both come off the result, not off a second lookup.
            const [result] = searchPreferences(PREFERENCES_SEARCH_PAGES, 'strasse');
            expect(result!.page.name).toBe('network');
            expect(result!.row.title).toBe('Straße');
        });

        await it('copies use-markup and use-underline onto the result row', () => {
            const [result] = searchPreferences(PREFERENCES_SEARCH_PAGES, 'dark');
            expect(result!.useMarkup).toBe(true);
            expect(result!.useUnderline).toBe(false);
            expect(result!.title).toBe('<b>Dark</b> Style');
        });

        await it('returns results in corpus order, not match order', () => {
            const titles = searchPreferences(PREFERENCES_SEARCH_PAGES, '').map((result) => result.title);
            expect(titles).toStrictEqual(['<b>Dark</b> Style', 'Display name', 'Sync over Wi-Fi', 'Straße', 'Reset']);
        });
    });
};
