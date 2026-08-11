// Preferences conformance vectors — the spec both renderers are held to.
//
// Two families of rows, matching the two halves lifted into `preferences.ts`:
//
//   - the GROUP HEADER derivation, where both ports had half the rules and
//     neither had `single-line` or hide-the-listbox-when-empty. The rows that
//     used to be wrong are marked in their `rule`;
//   - the SEARCH pipeline, which neither port had at all. Its rows are the
//     expensive ones: the case fold that a `toLowerCase()` port fails only in
//     German and Greek, the fold-THEN-parse order, and the three-filter corpus
//     whose clauses live in three different C files.
//
// `PREFERENCES_SEARCH_PAGES` is deliberately a renderer-free TREE rather than a
// list of expectations: each renderer materialises it into its own widgets —
// DOM elements on web, native views on NativeScript — and then asserts the same
// `PREFERENCES_SEARCH_VECTORS` results against it. That is what makes the
// suites comparable rather than merely similar.
//
// Reference: refs/libadwaita/src/adw-preferences-group.c
// Reference: refs/libadwaita/src/adw-preferences-page.c
// Reference: refs/libadwaita/src/adw-preferences-dialog.c
// Reference: refs/libadwaita/src/adw-widget-utils.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type {
    MakeComparableOptions,
    PreferencesGroupHeaderInput,
    PreferencesGroupHeaderState,
    PreferencesSearchPage,
    PreferencesSearchRow,
    SearchRowSubtitleInput,
} from '../preferences.js';

// ---------------------------------------------------------------------------
// Group header
// ---------------------------------------------------------------------------

/** One `derivePreferencesGroupHeader` expectation. */
export interface PreferencesGroupHeaderVector {
    /** The group's title / description / suffix / row count. */
    input: PreferencesGroupHeaderInput;
    /** The five states C derives from it. */
    state: PreferencesGroupHeaderState;
    /**
     * Set when the expectation only holds for a renderer that INTERPRETS Pango
     * markup in its labels. Both current renderers paint the string verbatim
     * and pass `useMarkup: false`, so their suites skip these rows rather than
     * assert a rule they deliberately do not implement. Closing the
     * markup-rendering gap is what retires the flag.
     */
    dependsOnMarkup?: boolean;
    /** Why this row exists — the rule or the regression it pins down. */
    rule: string;
}

/**
 * `update_title_visibility` / `update_description_visibility` /
 * `update_listbox_visibility` / `is_single_line` / `update_header_visibility`
 * (adw-preferences-group.c:91-156).
 */
export const PREFERENCES_GROUP_HEADER_VECTORS: ReadonlyArray<PreferencesGroupHeaderVector> = [
    {
        input: { title: '', description: '', hasHeaderSuffix: false, rowCount: 0 },
        state: {
            titleVisible: false,
            descriptionVisible: false,
            headerVisible: false,
            singleLine: false,
            listboxVisible: false,
        },
        rule: 'an empty group shows NOTHING — including no boxed-list card, which the web port used to keep painting',
    },
    {
        input: { title: 'Appearance', description: '', hasHeaderSuffix: false, rowCount: 3 },
        state: {
            titleVisible: true,
            descriptionVisible: false,
            headerVisible: true,
            singleLine: true,
            listboxVisible: true,
        },
        rule: 'title only is a SINGLE-LINE header (min-height: 34px), which neither port computed',
    },
    {
        input: {
            title: 'Appearance',
            description: 'Control how the application looks.',
            hasHeaderSuffix: false,
            rowCount: 3,
        },
        state: {
            titleVisible: true,
            descriptionVisible: true,
            headerVisible: true,
            singleLine: false,
            listboxVisible: true,
        },
        rule: 'a description forces two lines, so the header takes margin-bottom: 6px instead',
    },
    {
        input: { title: '', description: '', hasHeaderSuffix: true, rowCount: 1 },
        state: {
            titleVisible: false,
            descriptionVisible: false,
            headerVisible: true,
            singleLine: true,
            listboxVisible: true,
        },
        rule: 'a header suffix alone keeps the header alive and single-line',
    },
    {
        input: { title: '', description: 'Signed out.', hasHeaderSuffix: false, rowCount: 0 },
        state: {
            titleVisible: false,
            descriptionVisible: true,
            headerVisible: true,
            singleLine: false,
            listboxVisible: false,
        },
        rule: 'a description with no title still shows the header, and never single-line',
    },
    {
        input: { title: 'Appearance', description: 'Control how it looks.', hasHeaderSuffix: true, rowCount: 2 },
        state: {
            titleVisible: true,
            descriptionVisible: true,
            headerVisible: true,
            singleLine: false,
            listboxVisible: true,
        },
        rule: 'the description wins over the suffix — is_single_line returns FALSE before it looks at either',
    },
    {
        input: { title: ' ', rowCount: 1 },
        state: {
            titleVisible: true,
            descriptionVisible: false,
            headerVisible: true,
            singleLine: true,
            listboxVisible: true,
        },
        rule: 'only the EXACT empty string hides a label — g_strcmp0(text, "") does not trim',
    },
    {
        input: { title: null, description: null, rowCount: 0 },
        state: {
            titleVisible: false,
            descriptionVisible: false,
            headerVisible: false,
            singleLine: false,
            listboxVisible: false,
        },
        rule: 'NULL is the empty string — adw_preferences_group_set_title normalises it (:508)',
    },
    {
        input: { title: '<b></b>', rowCount: 1 },
        state: {
            titleVisible: false,
            descriptionVisible: false,
            headerVisible: false,
            singleLine: false,
            listboxVisible: true,
        },
        dependsOnMarkup: true,
        rule: 'visibility reads the DISPLAYED text (gtk_label_get_text), so markup-only is empty — the getter still returns the raw markup',
    },
    {
        input: { title: '<b>Sync</b>', rowCount: 1 },
        state: {
            titleVisible: true,
            descriptionVisible: false,
            headerVisible: true,
            singleLine: true,
            listboxVisible: true,
        },
        rule: 'markup around real text is still real text',
    },
    {
        input: { title: 'Tom & Jerry', rowCount: 1 },
        state: {
            titleVisible: true,
            descriptionVisible: false,
            headerVisible: true,
            singleLine: true,
            listboxVisible: true,
        },
        rule: 'a title that does not parse as markup keeps its raw text — a bare & must not hide the label',
    },
    {
        input: { title: '<b></b>', useMarkup: false, rowCount: 1 },
        state: {
            titleVisible: true,
            descriptionVisible: false,
            headerVisible: true,
            singleLine: true,
            listboxVisible: true,
        },
        rule: 'a renderer that paints the title verbatim opts out of the markup rule',
    },
    {
        input: { rowCount: 12 },
        state: {
            titleVisible: false,
            descriptionVisible: false,
            headerVisible: false,
            singleLine: false,
            listboxVisible: true,
        },
        rule: 'rows with no header at all: the card shows, the header does not',
    },
];

// ---------------------------------------------------------------------------
// Case folding
// ---------------------------------------------------------------------------

/** One `defaultCaseFolder` expectation. */
export interface CaseFoldVector {
    /** The string being folded. */
    text: string;
    /** `g_utf8_casefold(text)` — Unicode FULL case folding. */
    folded: string;
    /** What a bare `toLowerCase()` returns, kept in the table as the trap. */
    naiveLowerCase: string;
    rule: string;
}

/**
 * `g_utf8_casefold` (adw-preferences-dialog.c:101, :133).
 *
 * Every row where `folded !== naiveLowerCase` is a query a `toLowerCase()` port
 * silently fails to match — in German, Greek and any text with a typographic
 * ligature. None of it is visible in an ASCII test suite, which is exactly why
 * the rows are here.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (PREFERENCES_SEARCH_VECTORS)
 */
export const CASE_FOLD_VECTORS: ReadonlyArray<CaseFoldVector> = [
    { text: 'Dark Style', folded: 'dark style', naiveLowerCase: 'dark style', rule: 'ASCII is unaffected' },
    { text: 'Straße', folded: 'strasse', naiveLowerCase: 'straße', rule: 'ß folds to ss, so "strasse" finds it' },
    { text: 'STRASSE', folded: 'strasse', naiveLowerCase: 'strasse', rule: 'and the two spellings meet in the middle' },
    { text: 'ẞ', folded: 'ss', naiveLowerCase: 'ß', rule: 'capital sharp s folds the same way' },
    { text: 'ΟΔΟΣ', folded: 'οδοσ', naiveLowerCase: 'οδος', rule: 'final sigma folds to σ; toLowerCase gives ς' },
    { text: 'ς', folded: 'σ', naiveLowerCase: 'ς', rule: 'a literal final sigma folds too' },
    { text: 'ﬁle', folded: 'file', naiveLowerCase: 'ﬁle', rule: 'the fi ligature expands' },
    { text: 'ﬄ', folded: 'ffl', naiveLowerCase: 'ﬄ', rule: 'three-character expansion' },
    {
        text: 'Ǆ',
        folded: 'ǆ',
        naiveLowerCase: 'ǆ',
        rule: 'ONE character — NFKC+toLowerCase would give the two-character "dž", so NFKC is not a substitute',
    },
    { text: 'Müller', folded: 'müller', naiveLowerCase: 'müller', rule: 'an umlaut is not decomposed' },
    // Escaped, not literal: both sides are `i` plus a COMBINING DOT ABOVE, which
    // no editor can show as distinct from a plain `i`.
    {
        text: '\u0130',
        folded: 'i\u0307',
        naiveLowerCase: 'i\u0307',
        rule: 'dotted capital I decomposes identically under both, so no extra rule is needed',
    },
    {
        text: 'ꭰ',
        folded: 'Ꭰ',
        naiveLowerCase: 'ꭰ',
        rule: 'Cherokee folds UP to its capital — the reverse of every other script',
    },
];

// ---------------------------------------------------------------------------
// Markup + mnemonics
// ---------------------------------------------------------------------------

/** One `stripMarkup` expectation. */
export interface StripMarkupVector {
    /** The (already folded, in the real pipeline) markup string. */
    markup: string;
    /** The plain text, or `null` when `pango_parse_markup` fails. */
    plain: string | null;
    rule: string;
}

/**
 * `pango_parse_markup (…, accel_marker 0, …)` as `make_comparable` calls it
 * (adw-preferences-dialog.c:104-114).
 *
 * `null` is not an error case to be smoothed over: it is the branch where C
 * logs a `g_critical` and KEEPS the unparsed string, so every `null` row below
 * is a row that must stay searchable under its literal spelling.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (PREFERENCES_SEARCH_VECTORS)
 */
export const STRIP_MARKUP_VECTORS: ReadonlyArray<StripMarkupVector> = [
    { markup: 'Dark Style', plain: 'Dark Style', rule: 'plain text passes through' },
    { markup: '<b>Dark</b> Style', plain: 'Dark Style', rule: 'tags are dropped, their content kept' },
    { markup: '<b><i>Dark</i></b>', plain: 'Dark', rule: 'nesting' },
    {
        markup: '<b></b>',
        plain: '',
        rule: 'markup with no text is the EMPTY string — this is what hides a group title',
    },
    {
        markup: '<span foreground="red">Dark</span>',
        plain: 'Dark',
        rule: '<span> is the one tag that takes attributes',
    },
    {
        markup: '<b class="x">Dark</b>',
        plain: null,
        rule: 'check_no_attributes: any other tag with an attribute fails',
    },
    { markup: '<div>Dark</div>', plain: null, rule: 'an unknown tag is a parse ERROR, not something to strip' },
    { markup: 'i <3 gtk', plain: null, rule: 'so "<3" stays literal text and stays findable' },
    { markup: '<b>Dark', plain: null, rule: 'an unclosed tag fails at end_parse' },
    { markup: '<b>Dark</i>', plain: null, rule: 'a mismatched close tag fails' },
    { markup: 'AT&amp;T', plain: 'AT&T', rule: 'named entities resolve' },
    { markup: 'a&#38;b', plain: 'a&b', rule: 'decimal character references resolve' },
    { markup: 'a&#x26;b', plain: 'a&b', rule: 'hex character references resolve' },
    { markup: 'Tom & Jerry', plain: null, rule: 'a bare & is a parse error — the canonical failure case' },
    { markup: 'a&nbsp;b', plain: null, rule: 'GMarkup knows five named entities; nbsp is not one' },
    { markup: 'a<!-- note -->b', plain: 'ab', rule: 'comments are passthrough and contribute no text' },
    { markup: 'a<b/>c', plain: 'ac', rule: 'a self-closing tag' },
    { markup: ' ', plain: ' ', rule: 'whitespace is text — a single space is a VISIBLE title' },
    { markup: 'a > b', plain: 'a > b', rule: 'a bare > is legal text, unlike a bare <' },
];

/** One `stripMnemonic` expectation. */
export interface StripMnemonicVector {
    /** The label text with accel markers. */
    text: string;
    /** What `adw_strip_mnemonic` returns. */
    stripped: string;
    rule: string;
}

/**
 * `adw_strip_mnemonic` (adw-widget-utils.c:685-703) — `g_markup_escape_text`
 * followed by `pango_parse_markup` with `accel_marker = '_'`.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (PREFERENCES_SEARCH_VECTORS)
 */
export const STRIP_MNEMONIC_VECTORS: ReadonlyArray<StripMnemonicVector> = [
    { text: 'Appearance', stripped: 'Appearance', rule: 'no marker, no change' },
    { text: '_Appearance', stripped: 'Appearance', rule: 'the marker is dropped, the marked character kept' },
    { text: 'App_earance', stripped: 'Appearance', rule: 'a marker in the middle' },
    { text: 'A__B', stripped: 'A_B', rule: 'a doubled marker collapses to ONE literal underscore' },
    { text: '___A', stripped: '_A', rule: 'three markers: an escaped one, then a marking one' },
    { text: 'A_B_C', stripped: 'ABC', rule: 'every marker is processed, not just the first' },
    { text: 'A_', stripped: 'A', rule: 'a trailing marker has nothing to mark and is simply dropped' },
    { text: '_', stripped: '', rule: 'a lone marker' },
    {
        text: '<b>_A</b>',
        stripped: '<b>A</b>',
        rule: 'the C escapes BEFORE parsing, so mnemonic stripping never eats real markup',
    },
];

// ---------------------------------------------------------------------------
// make_comparable
// ---------------------------------------------------------------------------

/** One `makeComparable` expectation. */
export interface MakeComparableVector {
    /** The raw title or subtitle. */
    source: string;
    /** The row flags plus the title/subtitle `allowUnderline` distinction. */
    options: MakeComparableOptions;
    /** What the search compares against. */
    comparable: string;
    rule: string;
}

/**
 * `make_comparable` (adw-preferences-dialog.c:96-123).
 *
 * The defaults matter as much as the rows: `use-markup` defaults to TRUE
 * (adw-preferences-row.c:185-188) and `use-underline` to FALSE (:155-158), so
 * an ordinary row's title IS markup-parsed and is NOT mnemonic-stripped.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (PREFERENCES_SEARCH_VECTORS)
 */
export const MAKE_COMPARABLE_VECTORS: ReadonlyArray<MakeComparableVector> = [
    {
        source: 'Straße',
        options: { useMarkup: false, useUnderline: false, allowUnderline: true },
        comparable: 'strasse',
        rule: 'the fold runs first and always',
    },
    { source: 'ΟΔΟΣ', options: {}, comparable: 'οδοσ', rule: 'defaults: markup on, underline off' },
    { source: 'ﬁle', options: {}, comparable: 'file', rule: 'ligature expansion survives the markup parse' },
    { source: 'Ǆ', options: {}, comparable: 'ǆ', rule: 'single-character fold' },
    {
        source: '<b>Dark</b> Style',
        options: { useMarkup: true },
        comparable: 'dark style',
        rule: 'FOLD FIRST, PARSE SECOND — the lowercased tags still parse, which is what makes this order work',
    },
    {
        source: 'AT&amp;T',
        options: { useMarkup: true },
        comparable: 'at&t',
        rule: 'the entity is resolved by the parse',
    },
    {
        source: 'Tom & Jerry',
        options: { useMarkup: true },
        comparable: 'tom & jerry',
        rule: 'the parse FAILS and the folded plaintext is kept — the row must not throw and must not leave the index',
    },
    {
        source: '<b>Dark</b> Style',
        options: { useMarkup: false },
        comparable: '<b>dark</b> style',
        rule: 'a row that opts out of markup is compared with its tags intact',
    },
    {
        source: '_Appearance',
        options: { useMarkup: false, useUnderline: true, allowUnderline: true },
        comparable: 'appearance',
        rule: 'the TITLE path strips mnemonics',
    },
    {
        source: '_Appearance',
        options: { useMarkup: false, useUnderline: true, allowUnderline: false },
        comparable: '_appearance',
        rule: 'the SUBTITLE path passes allow_underline = FALSE, so subtitles keep their underscores',
    },
    {
        source: '_Appearance',
        options: { useMarkup: false, useUnderline: false, allowUnderline: true },
        comparable: '_appearance',
        rule: 'a row that does not use mnemonics keeps them as literal text',
    },
    {
        source: 'A__B',
        options: { useUnderline: true, allowUnderline: true },
        comparable: 'a_b',
        rule: 'a doubled accel marker collapses to one literal underscore',
    },
];

// ---------------------------------------------------------------------------
// filter_search_results
// ---------------------------------------------------------------------------

/** One `rowMatchesQuery` expectation. */
export interface RowMatchVector {
    /** The row being tested. */
    row: PreferencesSearchRow;
    /** What the user typed into the search entry. */
    query: string;
    /** Whether `filter_search_results` keeps the row. */
    matches: boolean;
    rule: string;
}

/** `filter_search_results` (adw-preferences-dialog.c:125-153).  *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (PREFERENCES_SEARCH_VECTORS)
 */
export const ROW_MATCH_VECTORS: ReadonlyArray<RowMatchVector> = [
    {
        row: { title: 'Dark Style' },
        query: '',
        matches: true,
        rule: 'strstr(title, "") returns title — EVERY row matches an empty query, so the stack shows "results" before anything is typed',
    },
    { row: { title: 'Dark Style' }, query: 'Dark', matches: true, rule: 'a plain prefix' },
    {
        row: { title: 'Dark Style' },
        query: 'ARK',
        matches: true,
        rule: 'case-insensitive SUBSTRING anywhere — not a prefix, not a word boundary',
    },
    {
        row: { title: 'Dark Style' },
        query: 'style dark',
        matches: false,
        rule: 'the terms are one literal substring, not words',
    },
    { row: { title: 'Dark Style' }, query: 'zzz', matches: false, rule: 'no match' },
    {
        row: { title: 'Sync', subtitle: 'Avoid using mobile data', isActionRow: true },
        query: 'mobile',
        matches: true,
        rule: 'an AdwActionRow also matches on its subtitle',
    },
    {
        row: { title: 'Display name', subtitle: 'Grace Hopper', isActionRow: false },
        query: 'grace',
        matches: false,
        rule: 'AdwEntryRow derives from AdwPreferencesRow, NOT AdwActionRow — the typed text is deliberately not searchable',
    },
    {
        row: { title: 'Straße' },
        query: 'strasse',
        matches: true,
        rule: 'the German canary: a toLowerCase() port returns false here',
    },
    {
        row: { title: 'STRASSE' },
        query: 'straße',
        matches: true,
        rule: 'and the same in the other direction',
    },
    {
        row: { title: '<b>Dark</b> Style' },
        query: 'dark style',
        matches: true,
        rule: 'the query is matched against the markup-STRIPPED title, so a user never types tags',
    },
    {
        row: { title: '<b>Dark</b> Style' },
        query: '<b>',
        matches: false,
        rule: 'and cannot find the tags either',
    },
    {
        row: { title: 'Tom & Jerry' },
        query: '& jer',
        matches: true,
        rule: 'the unparseable title stays searchable under its literal text',
    },
    {
        row: { title: '_Appearance', useUnderline: true },
        query: 'appearance',
        matches: true,
        rule: 'a mnemonic row is found without its underscore',
    },
    {
        row: { title: 'Sync', subtitle: '_Avoid mobile data', useUnderline: true, isActionRow: true },
        query: '_avoid',
        matches: true,
        rule: 'but the SUBTITLE keeps it, because that path passes allow_underline = FALSE',
    },
];

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/** One `collectSearchRows` expectation. */
export interface SearchCorpusVector {
    /** The page tree being indexed. */
    pages: readonly PreferencesSearchPage[];
    /** The row titles the corpus contains, in order. */
    titles: readonly string[];
    rule: string;
}

/**
 * The three-filter chain: `adw_preferences_dialog_init`'s visible-page filter
 * (:632-641) over `adw_preferences_page_get_rows`' `is_visible_group`
 * (adw-preferences-page.c:831-834) over `adw_preferences_group_get_rows`'
 * `row_has_title` (adw-preferences-group.c:736-740).
 *
 * Dropping any clause is invisible — nothing errors, the search just quietly
 * indexes the wrong set — which is why these rows are separate from the
 * end-to-end ones.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (PREFERENCES_SEARCH_VECTORS)
 */
export const SEARCH_CORPUS_VECTORS: ReadonlyArray<SearchCorpusVector> = [
    {
        pages: [
            {
                title: 'General',
                groups: [
                    {
                        title: 'Appearance',
                        rows: [
                            { title: 'Dark Style', visible: true },
                            { title: '', visible: true },
                            { title: 'Region', visible: false },
                        ],
                    },
                ],
            },
        ],
        titles: ['Dark Style'],
        rule: 'row_has_title: an EMPTY title and a hidden row are both excluded',
    },
    {
        pages: [{ title: 'General', groups: [{ title: 'Hidden', visible: false, rows: [{ title: 'Dark Style' }] }] }],
        titles: [],
        rule: 'is_visible_group: an invisible group contributes no rows',
    },
    {
        pages: [
            { title: 'General', visible: false, groups: [{ title: 'Appearance', rows: [{ title: 'Dark Style' }] }] },
        ],
        titles: [],
        rule: 'the page filter: an invisible page contributes no rows',
    },
    {
        pages: [
            { title: 'A', groups: [{ title: 'G1', rows: [{ title: 'One' }, { title: 'Two' }] }] },
            {
                title: 'B',
                groups: [
                    { title: 'G2', rows: [{ title: 'Three' }] },
                    { title: 'G3', rows: [{ title: 'Four' }] },
                ],
            },
        ],
        titles: ['One', 'Two', 'Three', 'Four'],
        rule: 'flatten order is page, then group, then row',
    },
    {
        pages: [{ title: 'General', groups: [] }],
        titles: [],
        rule: 'a page with no groups is legal and contributes nothing',
    },
];

// ---------------------------------------------------------------------------
// create_search_row_subtitle
// ---------------------------------------------------------------------------

/** One `createSearchRowSubtitle` expectation. */
export interface SearchRowSubtitleVector {
    /** The matched row's ancestors, plus the visible-page count. */
    input: SearchRowSubtitleInput;
    /** The second line of the result row, `null` for none. */
    subtitle: string | null;
    rule: string;
}

/** `create_search_row_subtitle` (adw-preferences-dialog.c:168-234).  *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (PREFERENCES_SEARCH_VECTORS)
 */
export const SEARCH_ROW_SUBTITLE_VECTORS: ReadonlyArray<SearchRowSubtitleVector> = [
    {
        input: { groupTitle: 'Appearance', pageTitle: 'General', nVisiblePages: 1 },
        subtitle: 'Appearance',
        rule: 'one visible page: the group title alone, no page and no arrow',
    },
    {
        input: { groupTitle: 'Appearance', pageTitle: 'General', nVisiblePages: 2 },
        subtitle: 'General → Appearance',
        rule: 'several visible pages: page → group, U+2192 with one space either side',
    },
    {
        input: { groupTitle: 'Appearance', pageTitle: '', nVisiblePages: 2 },
        subtitle: 'Untitled page → Appearance',
        rule: 'an empty page title falls back to the translated placeholder',
    },
    {
        input: { groupTitle: '', pageTitle: 'General', nVisiblePages: 2 },
        subtitle: 'General',
        rule: 'an empty GROUP title skips the join entirely — the bare page title, no arrow',
    },
    {
        input: { groupTitle: '', pageTitle: '', nVisiblePages: 2 },
        subtitle: null,
        rule: 'nothing to show at all',
    },
    {
        input: { groupTitle: 'Fonts', pageTitle: '_General', pageUseUnderline: true, nVisiblePages: 2 },
        subtitle: 'General → Fonts',
        rule: 'the PAGE property decides whether the page title is mnemonic-stripped',
    },
    {
        input: { groupTitle: 'Fonts', pageTitle: '_General', pageUseUnderline: false, nVisiblePages: 2 },
        subtitle: '_General → Fonts',
        rule: 'and without it the underscore is literal',
    },
    {
        input: { groupTitle: 'Tom & Jerry', pageTitle: 'Tom & Jerry', rowUseMarkup: true, nVisiblePages: 2 },
        subtitle: 'Tom &amp; Jerry → Tom & Jerry',
        rule: 'the ROW property escapes the PAGE title only — the group title is passed through raw',
    },
    {
        input: { groupTitle: 'Tom & Jerry', pageTitle: 'Tom & Jerry', rowUseMarkup: false, nVisiblePages: 2 },
        subtitle: 'Tom & Jerry → Tom & Jerry',
        rule: 'a non-markup row escapes nothing',
    },
    {
        input: { groupTitle: 'Appearance', nVisiblePages: 2 },
        subtitle: 'Untitled page → Appearance',
        rule: 'no page ancestor is indistinguishable from an untitled one — both reach the placeholder',
    },
    {
        input: { groupTitle: 'Appearance', pageTitle: 'General', nVisiblePages: 0 },
        subtitle: 'Appearance',
        rule: 'zero visible pages behaves like one — the test is > 1',
    },
];

// ---------------------------------------------------------------------------
// End to end
// ---------------------------------------------------------------------------

/**
 * The page tree both renderer suites materialise into real widgets.
 *
 * Chosen so every clause of the pipeline is exercised by at least one query:
 * two visible pages (so subtitles carry the arrow) plus a hidden third, a hidden
 * group, an untitled row, an action row with a searchable subtitle, an entry row
 * whose subtitle must NOT be searched, a German title for the fold, and a
 * markup title.
 */
export const PREFERENCES_SEARCH_PAGES: ReadonlyArray<PreferencesSearchPage> = [
    {
        name: 'general',
        title: 'General',
        groups: [
            {
                title: 'Appearance',
                rows: [
                    { title: '<b>Dark</b> Style', isActionRow: true, subtitle: 'Follow the system setting' },
                    { title: 'Display name', subtitle: 'Grace Hopper' },
                    { title: '' },
                ],
            },
            {
                title: 'Hidden group',
                visible: false,
                rows: [{ title: 'Secret Option' }],
            },
        ],
    },
    {
        name: 'network',
        title: 'Network',
        groups: [
            {
                title: 'Sync',
                rows: [
                    { title: 'Sync over Wi-Fi', isActionRow: true, subtitle: 'Avoid using mobile data' },
                    { title: 'Straße', visible: true },
                    { title: 'Region', visible: false },
                ],
            },
            {
                title: '',
                rows: [{ title: 'Reset' }],
            },
        ],
    },
    {
        name: 'developer',
        title: 'Developer',
        visible: false,
        groups: [{ title: 'Debug', rows: [{ title: 'Verbose logging' }] }],
    },
];

/** One expected search result, as a renderer can read it off its own result row. */
export interface PreferencesSearchExpectation {
    /** The result row's title — copied verbatim from the matched row. */
    title: string;
    /** The result row's subtitle. */
    subtitle: string | null;
}

/** One end-to-end `searchPreferences` expectation over {@link PREFERENCES_SEARCH_PAGES}. */
export interface PreferencesSearchVector {
    /** What the user typed. */
    query: string;
    /** The results, in corpus order. */
    results: readonly PreferencesSearchExpectation[];
    rule: string;
}

/**
 * The whole pipeline over {@link PREFERENCES_SEARCH_PAGES} — corpus, filter and
 * subtitle at once. This is the table a renderer drives its own widgets with.
 */
export const PREFERENCES_SEARCH_VECTORS: ReadonlyArray<PreferencesSearchVector> = [
    {
        query: '',
        results: [
            { title: '<b>Dark</b> Style', subtitle: 'General → Appearance' },
            { title: 'Display name', subtitle: 'General → Appearance' },
            { title: 'Sync over Wi-Fi', subtitle: 'Network → Sync' },
            { title: 'Straße', subtitle: 'Network → Sync' },
            { title: 'Reset', subtitle: 'Network' },
        ],
        rule: 'the empty query is the whole corpus: the untitled row, the hidden group, the hidden row and the hidden PAGE are all absent',
    },
    {
        query: 'dark',
        results: [{ title: '<b>Dark</b> Style', subtitle: 'General → Appearance' }],
        rule: 'the title is compared markup-stripped, but the RESULT keeps the original markup',
    },
    {
        query: 'system',
        results: [{ title: '<b>Dark</b> Style', subtitle: 'General → Appearance' }],
        rule: 'an action row matches through its subtitle',
    },
    {
        query: 'grace',
        results: [],
        rule: 'the entry row does not — AdwEntryRow is not an AdwActionRow',
    },
    {
        query: 'strasse',
        results: [{ title: 'Straße', subtitle: 'Network → Sync' }],
        rule: 'the German canary, end to end',
    },
    {
        query: 'reset',
        results: [{ title: 'Reset', subtitle: 'Network' }],
        rule: 'an untitled GROUP drops the arrow and leaves the bare page title',
    },
    {
        query: 'verbose',
        results: [],
        rule: 'the hidden page contributes nothing, so its rows are unreachable',
    },
    {
        query: 'secret',
        results: [],
        rule: 'and neither does the hidden group',
    },
    {
        query: 'zzz',
        results: [],
        rule: 'no match at all — this is the input that flips the stack to "no-results"',
    },
];
