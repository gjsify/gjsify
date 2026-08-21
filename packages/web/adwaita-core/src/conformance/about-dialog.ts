// About-dialog conformance vectors — the spec both renderers are held to.
//
// The `CREDIT_PERSON_VECTORS` rows are the C's answer, not a second reading of it: they
// were produced by COMPILING the vendored `parse_person` against GLib 2.88 with the
// `mailto:` step from `add_credits_section` and printing its three out-parameters.
// Several surprised the reading — `"Ada <https://x>"` leaves the `<` in the NAME,
// `"Ada <>"` is a link row with the URI `mailto:`, `"xhttps://x"` is the person `"x"`.
//
// The visibility tables are exhaustive rather than hand-picked:
// `update_details`/`update_support`/`update_credits_legal_group` are boolean algebra
// over three or four flags, and an exhaustive table cannot be cherry-picked.
//
// Reference: refs/libadwaita/src/adw-about-dialog.c
// Reference: refs/libadwaita/src/adw-about-dialog.ui
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** One `parse_person` expectation. */
export interface CreditPersonVector {
    /** The raw credit line, as an app puts it in `developers` etc. */
    input: string;
    /** `*name` after `g_strstrip`. */
    name: string;
    /** `*link` — `null` is "no link", `''` is an EMPTY link and still a link. */
    link: string | null;
    /** `*is_email`, i.e. `*q1 == '<'`. */
    isEmail: boolean;
    /** The URI the row gets, per `add_credits_section`. */
    uri: string | null;
    rule: string;
}

/**
 * `parse_person`, verified against real GLib.
 *
 * Seven rows pin the plausible-looking simplifications a re-implementation reaches for:
 * anchoring the angle pair at the end of the string, testing the link for `@`, requiring
 * whitespace before a bare URL, accepting `mailto:` as a scheme, `String.trim()` instead
 * of `g_strstrip`, treating index 0 as falsy, and never reaching the `r1 <= q1 + 1`
 * branch.
 */
export const CREDIT_PERSON_VECTORS: ReadonlyArray<CreditPersonVector> = [
    {
        input: 'Ada Lovelace',
        name: 'Ada Lovelace',
        link: null,
        isEmail: false,
        uri: null,
        rule: 'a bare name is an action row, not a link row',
    },
    {
        input: 'Ada Lovelace <ada@lovelace.org>',
        name: 'Ada Lovelace',
        link: 'ada@lovelace.org',
        isEmail: true,
        uri: 'mailto:ada@lovelace.org',
        rule: 'the documented `Name <email>` form',
    },
    {
        input: 'Ada Lovelace<ada@lovelace.org>',
        name: 'Ada Lovelace',
        link: 'ada@lovelace.org',
        isEmail: true,
        uri: 'mailto:ada@lovelace.org',
        rule: 'no space is required before the `<` — strchr scans, it does not match a pattern',
    },
    {
        input: 'Ada Lovelace <ada@lovelace.org> and friends',
        name: 'Ada Lovelace',
        link: 'ada@lovelace.org',
        isEmail: true,
        uri: 'mailto:ada@lovelace.org',
        rule: 'the pair is NOT anchored at the end (:499-500); trailing text is dropped from the title',
    },
    {
        input: 'Ada Lovelace <ada>',
        name: 'Ada Lovelace',
        link: 'ada',
        isEmail: true,
        uri: 'mailto:ada',
        rule: "is_email is `*q1 == '<'` and nothing else (:521) — there is no `@` test",
    },
    {
        input: 'Ada Lovelace <>',
        name: 'Ada Lovelace',
        link: '',
        isEmail: true,
        uri: 'mailto:',
        rule: 'g_strndup of zero bytes is "" and `if (link)` is a POINTER test — still a link row',
    },
    {
        input: 'Ada Lovelace <ada@lovelace.org',
        name: 'Ada Lovelace <ada@lovelace.org',
        link: null,
        isEmail: false,
        uri: null,
        rule: 'no closing `>` means no pair at all (:500), and the whole line becomes the title',
    },
    {
        input: 'Ada Lovelace https://lovelace.org',
        name: 'Ada Lovelace',
        link: 'https://lovelace.org',
        isEmail: false,
        uri: 'https://lovelace.org',
        rule: 'a bare https URL is a non-email link',
    },
    {
        input: 'Ada Lovelace http://lovelace.org',
        name: 'Ada Lovelace',
        link: 'http://lovelace.org',
        isEmail: false,
        uri: 'http://lovelace.org',
        rule: 'plain http is recognised too (:501)',
    },
    {
        input: 'Ada Lovelace(https://lovelace.org)',
        name: 'Ada Lovelace(',
        link: 'https://lovelace.org)',
        isEmail: false,
        uri: 'https://lovelace.org)',
        rule: 'strstr needs no leading space and `)` is not a terminator — both halves keep their bracket',
    },
    {
        input: 'https://lovelace.org',
        name: '',
        link: 'https://lovelace.org',
        isEmail: false,
        uri: 'https://lovelace.org',
        rule: 'a URL at index 0 is a valid non-NULL pointer; a truthiness port drops it',
    },
    {
        input: 'Ada Lovelace <https://lovelace.org>',
        name: 'Ada Lovelace <',
        link: 'https://lovelace.org',
        isEmail: false,
        uri: 'https://lovelace.org',
        rule: 'r1 <= q1 + 1 (:514): the URL wins, is NOT an email, and the `<` stays in the name',
    },
    {
        input: 'Ada Lovelace <ada@lovelace.org> https://lovelace.org',
        name: 'Ada Lovelace',
        link: 'ada@lovelace.org',
        isEmail: true,
        uri: 'mailto:ada@lovelace.org',
        rule: 'a URL AFTER a complete pair loses — r1 > q1 + 1 (:514)',
    },
    {
        input: 'Ada Lovelace https://lovelace.org <ada@lovelace.org>',
        name: 'Ada Lovelace',
        link: 'https://lovelace.org',
        isEmail: false,
        uri: 'https://lovelace.org',
        rule: 'a URL BEFORE the pair wins, and its end is the space (:507)',
    },
    {
        input: 'See http://a.example and https://b.example',
        name: 'See',
        link: 'http://a.example',
        isEmail: false,
        uri: 'http://a.example',
        rule: 'with both schemes present the EARLIER one wins (:504)',
    },
    {
        input: 'See https://a.example and http://b.example',
        name: 'See',
        link: 'https://a.example',
        isEmail: false,
        uri: 'https://a.example',
        rule: 'the same rule the other way round — https first, so https wins',
    },
    {
        input: 'Ada Lovelace mailto:ada@lovelace.org',
        name: 'Ada Lovelace mailto:ada@lovelace.org',
        link: null,
        isEmail: false,
        uri: null,
        rule: '`mailto:` is NOT a recognised bare scheme (:501-502) — the line stays one plain title',
    },
    {
        input: 'Ada Lovelace ftp://lovelace.org',
        name: 'Ada Lovelace ftp://lovelace.org',
        link: null,
        isEmail: false,
        uri: null,
        rule: 'nor is any other scheme; only http:// and https:// are searched for',
    },
    {
        input: 'Ada Lovelace https://lovelace.org\tmore',
        name: 'Ada Lovelace',
        link: 'https://lovelace.org',
        isEmail: false,
        uri: 'https://lovelace.org',
        rule: 'a tab ends the URL (:507)',
    },
    {
        input: 'Ada Lovelace https://lovelace.org\nmore',
        name: 'Ada Lovelace',
        link: 'https://lovelace.org',
        isEmail: false,
        uri: 'https://lovelace.org',
        rule: 'a newline ends the URL (:507)',
    },
    {
        input: 'Ada Lovelace https://lovelace.org\rmore',
        name: 'Ada Lovelace',
        link: 'https://lovelace.org\rmore',
        isEmail: false,
        uri: 'https://lovelace.org\rmore',
        rule: 'but \\r is NOT in the strpbrk set (:507) — it is swallowed into the URI',
    },
    {
        input: '  Ada Lovelace  ',
        name: 'Ada Lovelace',
        link: null,
        isEmail: false,
        uri: null,
        rule: 'g_strstrip removes surrounding ASCII space (:533)',
    },
    {
        input: '\u00A0Ada Lovelace\u00A0',
        name: '\u00A0Ada Lovelace\u00A0',
        link: null,
        isEmail: false,
        uri: null,
        rule: 'and ONLY ASCII space — String.trim() would eat the NBSP',
    },
    {
        input: '  Ada  <ada@lovelace.org>',
        name: 'Ada',
        link: 'ada@lovelace.org',
        isEmail: true,
        uri: 'mailto:ada@lovelace.org',
        rule: 'the strip runs after the split, so the space before the `<` goes too',
    },
    { input: '', name: '', link: null, isEmail: false, uri: null, rule: 'an empty line is an empty title' },
    {
        input: '   ',
        name: '',
        link: null,
        isEmail: false,
        uri: null,
        rule: 'a blank line strips to an empty title — the row still exists',
    },
    {
        input: '<ada@lovelace.org>',
        name: '',
        link: 'ada@lovelace.org',
        isEmail: true,
        uri: 'mailto:ada@lovelace.org',
        rule: 'a `<` at index 0 is a valid pointer — an email with no name',
    },
    {
        input: 'Ada <ADA@LOVELACE.ORG>',
        name: 'Ada',
        link: 'ADA@LOVELACE.ORG',
        isEmail: true,
        uri: 'mailto:ADA@LOVELACE.ORG',
        rule: 'nothing is case-folded on this path',
    },
    {
        input: 'Ada Lovelace <mailto:ada@lovelace.org>',
        name: 'Ada Lovelace',
        link: 'mailto:ada@lovelace.org',
        isEmail: true,
        uri: 'mailto:mailto:ada@lovelace.org',
        rule: 'the prefix is unconditional (:573), so a mailto: inside brackets is doubled — faithfully',
    },
    {
        input: 'Jörg Schröder <joerg@example.org>',
        name: 'Jörg Schröder',
        link: 'joerg@example.org',
        isEmail: true,
        uri: 'mailto:joerg@example.org',
        rule: 'the offsets are byte offsets in C and code-unit offsets here; ASCII delimiters make them agree',
    },
    {
        input: 'Ada\tLovelace <ada@lovelace.org>',
        name: 'Ada\tLovelace',
        link: 'ada@lovelace.org',
        isEmail: true,
        uri: 'mailto:ada@lovelace.org',
        rule: 'an INTERIOR tab survives — g_strstrip only touches the ends',
    },
    {
        input: 'Ada Lovelace <ada@lovelace.org><bob@example.org>',
        name: 'Ada Lovelace',
        link: 'ada@lovelace.org',
        isEmail: true,
        uri: 'mailto:ada@lovelace.org',
        rule: 'the FIRST `<` and the first `>` after it — one link per person, ever',
    },
    {
        input: 'Ada > Lovelace',
        name: 'Ada > Lovelace',
        link: null,
        isEmail: false,
        uri: null,
        rule: 'a `>` with no `<` before it is just text (q1 is NULL, so q2 is never looked for)',
    },
    {
        input: 'Ada Lovelace <ada@lovelace.org> <bob@example.org>',
        name: 'Ada Lovelace',
        link: 'ada@lovelace.org',
        isEmail: true,
        uri: 'mailto:ada@lovelace.org',
        rule: 'the same, spaced out — a second address is silently dropped from the title too',
    },
    {
        input: 'httpss://lovelace.org',
        name: 'httpss://lovelace.org',
        link: null,
        isEmail: false,
        uri: null,
        rule: 'neither literal occurs — "https://" needs the colon right after the s',
    },
    {
        input: 'xhttps://lovelace.org',
        name: 'x',
        link: 'https://lovelace.org',
        isEmail: false,
        uri: 'https://lovelace.org',
        rule: 'strstr does not care what precedes the match — the name becomes the single leading char',
    },
];

/** One `translator-credits` split expectation. */
export interface TranslatorCreditsVector {
    value: string | null;
    /** The names the "Translated by" section is built from. */
    people: ReadonlyArray<string>;
    rule: string;
}

/**
 * The sentinel guard + split, with `g_strsplit`'s
 * token behaviour verified against GLib 2.88.
 *
 * The empty-string row is the one a port gets wrong: `g_strsplit ("", "\n", 0)`
 * is a ZERO-length vector, so `add_credits_section` bails at `!*people`
 * and no section is drawn, where JS `''.split('\n')` is `['']` and
 * draws the section with one blank row.
 *
 * CORE-ONLY: GAP — `adw-about-dialog` has no `translator-credits` property, and the browser
 * spec skips every row that sets one (`if (input.translatorCredits !== undefined) continue`, in
 * adw-about-dialog.spec.ts). So the empty-string row above — the one this docblock singles out
 * as what a port gets wrong — reaches nothing outside the core suite. It was exempted here as an
 * internal step of ABOUT_DIALOG_CREDITS_LEGAL_VECTORS, a three-boolean visibility table with no
 * translator input at all. Tracked in #1072
 */
export const TRANSLATOR_CREDITS_VECTORS: ReadonlyArray<TranslatorCreditsVector> = [
    { value: 'Ada Lovelace', people: ['Ada Lovelace'], rule: 'one translator, one row' },
    { value: 'Ada\nBob', people: ['Ada', 'Bob'], rule: 'newline-separated, in order' },
    {
        value: 'translator-credits',
        people: [],
        rule: 'the untranslated gettext sentinel is suppressed (:605)',
    },
    {
        value: 'translator_credits',
        people: [],
        rule: 'the older underscore spelling is checked too (:604)',
    },
    { value: '', people: [], rule: 'g_strsplit("") is a ZERO-length vector, not [""] — no section at all' },
    { value: null, people: [], rule: 'unset behaves as unset (:603)' },
    {
        value: 'Ada\n\nBob',
        people: ['Ada', '', 'Bob'],
        rule: 'an interior blank line IS a token and IS a row — only NULL pointers are skipped (:557)',
    },
    { value: 'Ada\n', people: ['Ada', ''], rule: 'a trailing newline produces a trailing empty row' },
    {
        value: 'Translator-Credits',
        people: ['Translator-Credits'],
        rule: 'the sentinel test is g_strcmp0, i.e. case-SENSITIVE',
    },
];

/** One assembled credits-page expectation. */
export interface CreditsSectionsVector {
    input: {
        developers?: ReadonlyArray<string>;
        designers?: ReadonlyArray<string>;
        artists?: ReadonlyArray<string>;
        documenters?: ReadonlyArray<string>;
        translatorCredits?: string | null;
        creditSections?: ReadonlyArray<{ title: string | null; people: ReadonlyArray<string> }>;
    };
    /** The groups on the Credits page, in order, with each row's title + URI. */
    sections: ReadonlyArray<{ title: string | null; people: ReadonlyArray<{ name: string; uri: string | null }> }>;
    rule: string;
}

/**
 * `update_credits` — which groups exist, in which order.
 *
 * The order is fixed by the five `add_credits_section` calls then the
 * app's own sections in insertion order. An empty property is not an
 * empty group, it is no group.
 */
export const CREDITS_SECTIONS_VECTORS: ReadonlyArray<CreditsSectionsVector> = [
    {
        input: {},
        sections: [],
        rule: 'nothing set — the Credits page has no groups, so its row is hidden (:629-630)',
    },
    {
        input: { developers: ['Ada Lovelace <ada@lovelace.org>'] },
        sections: [{ title: 'Code by', people: [{ name: 'Ada Lovelace', uri: 'mailto:ada@lovelace.org' }] }],
        rule: 'developers is titled "Code by", not "Developers" (:611)',
    },
    {
        input: { designers: [], artists: ['Bob'], documenters: [] },
        sections: [{ title: 'Artwork by', people: [{ name: 'Bob', uri: null }] }],
        rule: 'empty arrays contribute NO group at all (:545-546)',
    },
    {
        input: {
            documenters: ['Dee'],
            developers: ['Ada'],
            artists: ['Art'],
            designers: ['Des'],
            translatorCredits: 'Tra',
        },
        sections: [
            { title: 'Code by', people: [{ name: 'Ada', uri: null }] },
            { title: 'Design by', people: [{ name: 'Des', uri: null }] },
            { title: 'Artwork by', people: [{ name: 'Art', uri: null }] },
            { title: 'Documentation by', people: [{ name: 'Dee', uri: null }] },
            { title: 'Translated by', people: [{ name: 'Tra', uri: null }] },
        ],
        rule: 'the five built-ins keep source order regardless of the order they were set (:611-619)',
    },
    {
        input: { developers: ['Ada'], translatorCredits: 'translator-credits' },
        sections: [{ title: 'Code by', people: [{ name: 'Ada', uri: null }] }],
        rule: 'the sentinel drops the Translated by group entirely',
    },
    {
        input: {
            developers: ['Ada'],
            creditSections: [
                { title: 'Backers', people: ['Bob https://bob.example'] },
                { title: null, people: ['Anonymous'] },
            ],
        },
        sections: [
            { title: 'Code by', people: [{ name: 'Ada', uri: null }] },
            { title: 'Backers', people: [{ name: 'Bob', uri: 'https://bob.example' }] },
            { title: null, people: [{ name: 'Anonymous', uri: null }] },
        ],
        rule: 'extra sections come LAST, in call order, and their title may be NULL (:3240, :3252)',
    },
];

/** The `update_details` half of the truth table. */
export interface AboutDialogDetailsVector {
    /** `website` non-empty. */
    website: boolean;
    /** `comments` non-empty. */
    comments: boolean;
    /** `add_link` was called at least once. */
    customLinks: boolean;
    /** `release-notes` non-empty. */
    releaseNotes: boolean;
    /** The seven widgets `update_details` decides. */
    visible: {
        detailsGroup: boolean;
        whatsNewRow: boolean;
        detailsRow: boolean;
        websiteRow: boolean;
        commentsLabel: boolean;
        linksGroup: boolean;
        detailsWebsiteRow: boolean;
    };
    rule: string;
}

/**
 * `update_details`, exhaustive over (website, comments,
 * custom links) plus the two rows that show what release notes add.
 *
 * `website only` matters most: the ONE combination where the website link stays
 * on the main page and no Details row is offered, and the one a port gets wrong by
 * folding `website` into its "has details" predicate. `show_details` is
 * `has_comments || has_custom_links` — website is deliberately not in it.
 */
export const ABOUT_DIALOG_DETAILS_VECTORS: ReadonlyArray<AboutDialogDetailsVector> = [
    {
        website: false,
        comments: false,
        customLinks: false,
        releaseNotes: false,
        visible: {
            detailsGroup: false,
            whatsNewRow: false,
            detailsRow: false,
            websiteRow: false,
            commentsLabel: false,
            linksGroup: false,
            detailsWebsiteRow: false,
        },
        rule: 'nothing set — the whole first group is gone',
    },
    {
        website: true,
        comments: false,
        customLinks: false,
        releaseNotes: false,
        visible: {
            detailsGroup: true,
            whatsNewRow: false,
            detailsRow: false,
            websiteRow: true,
            commentsLabel: false,
            linksGroup: false,
            detailsWebsiteRow: false,
        },
        rule: 'website ALONE stays on the main page and offers no Details row (:1112 with :1108)',
    },
    {
        website: false,
        comments: true,
        customLinks: false,
        releaseNotes: false,
        visible: {
            detailsGroup: true,
            whatsNewRow: false,
            detailsRow: true,
            websiteRow: false,
            commentsLabel: true,
            linksGroup: false,
            detailsWebsiteRow: false,
        },
        rule: 'comments open the Details page; with no website there is no links group (:1109)',
    },
    {
        website: true,
        comments: true,
        customLinks: false,
        releaseNotes: false,
        visible: {
            detailsGroup: true,
            whatsNewRow: false,
            detailsRow: true,
            websiteRow: false,
            commentsLabel: true,
            linksGroup: true,
            detailsWebsiteRow: true,
        },
        rule: 'website MOVES to the Details page as soon as the page has other content (:1112-1113)',
    },
    {
        website: false,
        comments: false,
        customLinks: true,
        releaseNotes: false,
        visible: {
            detailsGroup: true,
            whatsNewRow: false,
            detailsRow: true,
            websiteRow: false,
            commentsLabel: false,
            linksGroup: true,
            detailsWebsiteRow: false,
        },
        rule: 'a custom link alone is enough to open the Details page (:1108-1109)',
    },
    {
        website: true,
        comments: false,
        customLinks: true,
        releaseNotes: false,
        visible: {
            detailsGroup: true,
            whatsNewRow: false,
            detailsRow: true,
            websiteRow: false,
            commentsLabel: false,
            linksGroup: true,
            detailsWebsiteRow: true,
        },
        rule: 'custom links move the website even without comments',
    },
    {
        website: false,
        comments: true,
        customLinks: true,
        releaseNotes: false,
        visible: {
            detailsGroup: true,
            whatsNewRow: false,
            detailsRow: true,
            websiteRow: false,
            commentsLabel: true,
            linksGroup: true,
            detailsWebsiteRow: false,
        },
        rule: 'the links group exists for the custom links even with no website row in it',
    },
    {
        website: true,
        comments: true,
        customLinks: true,
        releaseNotes: false,
        visible: {
            detailsGroup: true,
            whatsNewRow: false,
            detailsRow: true,
            websiteRow: false,
            commentsLabel: true,
            linksGroup: true,
            detailsWebsiteRow: true,
        },
        rule: 'everything set — the main-page website row is still hidden, never both',
    },
    {
        website: false,
        comments: false,
        customLinks: false,
        releaseNotes: true,
        visible: {
            detailsGroup: true,
            whatsNewRow: true,
            detailsRow: false,
            websiteRow: false,
            commentsLabel: false,
            linksGroup: false,
            detailsWebsiteRow: false,
        },
        rule: 'release notes alone keep the GROUP alive for the What’s New row (:1116-1118)',
    },
    {
        website: true,
        comments: true,
        customLinks: true,
        releaseNotes: true,
        visible: {
            detailsGroup: true,
            whatsNewRow: true,
            detailsRow: true,
            websiteRow: false,
            commentsLabel: true,
            linksGroup: true,
            detailsWebsiteRow: true,
        },
        rule: 'release notes are orthogonal to the rest of the group',
    },
];

/** The `update_support` half of the truth table. */
export interface AboutDialogSupportVector {
    /** `support-url` non-empty. */
    supportUrl: boolean;
    /** `issue-url` non-empty. */
    issueUrl: boolean;
    /** `debug-info` non-empty. */
    debugInfo: boolean;
    /** The four widgets `update_support` decides — all on the MAIN page. */
    visible: { supportGroup: boolean; supportRow: boolean; issueRow: boolean; troubleshootingRow: boolean };
    rule: string;
}

/**
 * `update_support`, exhaustive.
 *
 * Every widget here is a child of `support_group`, which the template puts on the
 * MAIN page, as both the template and the class docs say. The
 * browser renderer put Support Questions and Report an Issue on the Details page,
 * hiding the issue tracker behind a navigation step AND making the Details page
 * appear for a dialog with no Details content in GTK terms.
 */
export const ABOUT_DIALOG_SUPPORT_VECTORS: ReadonlyArray<AboutDialogSupportVector> = [
    {
        supportUrl: false,
        issueUrl: false,
        debugInfo: false,
        visible: { supportGroup: false, supportRow: false, issueRow: false, troubleshootingRow: false },
        rule: 'nothing set — no support group',
    },
    {
        supportUrl: true,
        issueUrl: false,
        debugInfo: false,
        visible: { supportGroup: true, supportRow: true, issueRow: false, troubleshootingRow: false },
        rule: 'support-url draws its row on the MAIN page (:1128)',
    },
    {
        supportUrl: false,
        issueUrl: true,
        debugInfo: false,
        visible: { supportGroup: true, supportRow: false, issueRow: true, troubleshootingRow: false },
        rule: 'issue-url likewise (:1129)',
    },
    {
        supportUrl: true,
        issueUrl: true,
        debugInfo: false,
        visible: { supportGroup: true, supportRow: true, issueRow: true, troubleshootingRow: false },
        rule: 'both links, no Troubleshooting row without debug info',
    },
    {
        supportUrl: false,
        issueUrl: false,
        debugInfo: true,
        visible: { supportGroup: true, supportRow: false, issueRow: false, troubleshootingRow: true },
        rule: 'debug-info alone opens the group for the Troubleshooting row (:1130)',
    },
    {
        supportUrl: true,
        issueUrl: false,
        debugInfo: true,
        visible: { supportGroup: true, supportRow: true, issueRow: false, troubleshootingRow: true },
        rule: 'the three are independent',
    },
    {
        supportUrl: false,
        issueUrl: true,
        debugInfo: true,
        visible: { supportGroup: true, supportRow: false, issueRow: true, troubleshootingRow: true },
        rule: 'the three are independent',
    },
    {
        supportUrl: true,
        issueUrl: true,
        debugInfo: true,
        visible: { supportGroup: true, supportRow: true, issueRow: true, troubleshootingRow: true },
        rule: 'everything set',
    },
];

/** The `update_credits_legal_group` half of the truth table. */
export interface AboutDialogCreditsLegalVector {
    /** `credits_box` has children. */
    hasCredits: boolean;
    /** `legal_box` has children. */
    hasLegal: boolean;
    /** `add_acknowledgement_section` was called. */
    hasAcknowledgements: boolean;
    /** The four widgets, all on the main page. */
    visible: {
        creditsLegalGroup: boolean;
        creditsRow: boolean;
        legalRow: boolean;
        acknowledgementsRow: boolean;
    };
    rule: string;
}

/**
 * `update_credits_legal_group` with the three template bindings,
 * exhaustive.
 *
 * Each row's visibility is bound directly to its page's box, so the group is
 * the OR of the three and never appears empty.
 */
export const ABOUT_DIALOG_CREDITS_LEGAL_VECTORS: ReadonlyArray<AboutDialogCreditsLegalVector> = [
    {
        hasCredits: false,
        hasLegal: false,
        hasAcknowledgements: false,
        visible: { creditsLegalGroup: false, creditsRow: false, legalRow: false, acknowledgementsRow: false },
        rule: 'no page has content — the group is gone',
    },
    {
        hasCredits: true,
        hasLegal: false,
        hasAcknowledgements: false,
        visible: { creditsLegalGroup: true, creditsRow: true, legalRow: false, acknowledgementsRow: false },
        rule: 'credits only',
    },
    {
        hasCredits: false,
        hasLegal: true,
        hasAcknowledgements: false,
        visible: { creditsLegalGroup: true, creditsRow: false, legalRow: true, acknowledgementsRow: false },
        rule: 'legal only',
    },
    {
        hasCredits: true,
        hasLegal: true,
        hasAcknowledgements: false,
        visible: { creditsLegalGroup: true, creditsRow: true, legalRow: true, acknowledgementsRow: false },
        rule: 'credits + legal',
    },
    {
        hasCredits: false,
        hasLegal: false,
        hasAcknowledgements: true,
        visible: { creditsLegalGroup: true, creditsRow: false, legalRow: false, acknowledgementsRow: true },
        rule: 'acknowledgements alone open the group (:486) — neither renderer has this page',
    },
    {
        hasCredits: true,
        hasLegal: false,
        hasAcknowledgements: true,
        visible: { creditsLegalGroup: true, creditsRow: true, legalRow: false, acknowledgementsRow: true },
        rule: 'independent',
    },
    {
        hasCredits: false,
        hasLegal: true,
        hasAcknowledgements: true,
        visible: { creditsLegalGroup: true, creditsRow: false, legalRow: true, acknowledgementsRow: true },
        rule: 'independent',
    },
    {
        hasCredits: true,
        hasLegal: true,
        hasAcknowledgements: true,
        visible: { creditsLegalGroup: true, creditsRow: true, legalRow: true, acknowledgementsRow: true },
        rule: 'all three',
    },
];

/** One main-page header-field visibility expectation. */
export interface AboutDialogHeaderVector {
    property: 'application-icon' | 'application-name' | 'developer-name' | 'version';
    value: string;
    visible: boolean;
    rule: string;
}

/**
 * The four `x && *x` visibility tests on the main page.
 *
 * All four are FIRST-CHARACTER tests, so a single space is content, and there is no fallback
 * anywhere: an unset application name shows NO label, an unset icon NO image.
 */
export const ABOUT_DIALOG_HEADER_VECTORS: ReadonlyArray<AboutDialogHeaderVector> = [
    { property: 'application-icon', value: 'org.gnome.Builder', visible: true, rule: 'an icon name shows the image' },
    {
        property: 'application-icon',
        value: '',
        visible: false,
        rule: 'unset hides the image — there is no application-x-executable fallback (:2313-2314)',
    },
    { property: 'application-name', value: 'Builder', visible: true, rule: 'a name shows the title-1 label' },
    {
        property: 'application-name',
        value: '',
        visible: false,
        rule: 'unset hides the label — there is no "Application" fallback (:2376-2377)',
    },
    {
        property: 'application-name',
        value: ' ',
        visible: true,
        rule: 'a single space is a first character, so the label IS shown (no trimming)',
    },
    { property: 'developer-name', value: 'The GNOME Project', visible: true, rule: 'a developer line is shown' },
    { property: 'developer-name', value: '', visible: false, rule: 'unset hides it (:2426-2427)' },
    { property: 'version', value: '48.0', visible: true, rule: 'a version shows the pill' },
    { property: 'version', value: '', visible: false, rule: 'unset hides it (:2476)' },
];

/** One template-label expectation. */
export interface AboutDialogLabelVector {
    label:
        | 'dialogTitle'
        | 'detailsRow'
        | 'websiteRow'
        | 'supportRow'
        | 'issueRow'
        | 'troubleshootingRow'
        | 'creditsRow'
        | 'legalRow'
        | 'acknowledgementsRow'
        | 'whatsNewRow'
        | 'detailsPage'
        | 'creditsPage'
        | 'legalPage';
    /** The template string, mnemonic marker included. */
    text: string;
    /** What a renderer with no accelerator layer paints (`stripMnemonic`). */
    plain: string;
    rule: string;
}

/**
 * The template labels (adw-about-dialog.ui), with and without their mnemonic
 * markers.
 *
 * `dialogTitle` catches the invented one: the main navigation page binds its
 * title to `AdwDialog:title`, whose template default is the bare word "About"
 * from the template. The application name is NOT part of it — it appears on its own in the
 * header revealer that fades in on scroll. A renderer titling the
 * page "About <app>" AND labelling the dialog "About <app>" says the app's name
 * three times on one screen.
 *
 * CORE-ONLY: GAP — the renderers read these strings THROUGH `ADW_ABOUT_DIALOG_LABELS`, so a
 * spec reading them back would be circular with respect to the `.ui` fidelity this table exists
 * to pin. ABOUT_DIALOG_HEADER/DETAILS_VECTORS are about icon and name visibility and row
 * presence, never the label text, and `whatsNewRow` — the U+2019 row above — is filtered out of
 * the browser spec. Tracked in #1072
 */
export const ABOUT_DIALOG_LABEL_VECTORS: ReadonlyArray<AboutDialogLabelVector> = [
    {
        label: 'dialogTitle',
        text: 'About',
        plain: 'About',
        rule: 'the bare word (.ui:6) — never "About <app name>", which is the header revealer’s job (.ui:29-31)',
    },
    { label: 'detailsRow', text: '_Details', plain: 'Details', rule: 'row titles carry mnemonics (.ui:119-120)' },
    { label: 'websiteRow', text: '_Website', plain: 'Website', rule: 'the same title on both pages (.ui:136, :350)' },
    {
        label: 'supportRow',
        text: '_Support Questions',
        plain: 'Support Questions',
        rule: 'a main-page row (.ui:152)',
    },
    { label: 'issueRow', text: '_Report an Issue', plain: 'Report an Issue', rule: 'a main-page row (.ui:162)' },
    {
        label: 'troubleshootingRow',
        text: '_Troubleshooting',
        plain: 'Troubleshooting',
        rule: 'a main-page row (.ui:172)',
    },
    { label: 'creditsRow', text: '_Credits', plain: 'Credits', rule: '.ui:193' },
    { label: 'legalRow', text: '_Legal', plain: 'Legal', rule: '.ui:210' },
    { label: 'acknowledgementsRow', text: '_Acknowledgements', plain: 'Acknowledgements', rule: '.ui:228' },
    {
        label: 'whatsNewRow',
        text: 'What’s _New',
        plain: 'What’s New',
        rule: 'U+2019, not an ASCII apostrophe, and the marker is mid-string (.ui:102)',
    },
    { label: 'detailsPage', text: 'Details', plain: 'Details', rule: 'PAGE titles carry no marker (.ui:311)' },
    { label: 'creditsPage', text: 'Credits', plain: 'Credits', rule: '.ui:507' },
    { label: 'legalPage', text: 'Legal', plain: 'Legal', rule: '.ui:539' },
];

/** One `gtk_license_info` row expectation. */
export interface LicenseInfoVector {
    /** The `GtkLicense` value, i.e. the array index. */
    licenseType: number;
    /** `gtk_license_info[i].spdx_id`. */
    spdxId: string | null;
    /** `gtk_license_info[i].url`. */
    url: string | null;
    rule: string;
}

/**
 * Spot rows from `gtk_license_info` — the ends and the boundaries,
 * not a second copy of the whole table.
 *
 * Index 18 is pinned because `G_STATIC_ASSERT (G_N_ELEMENTS (gtk_license_info)
 * - 1 == GTK_LICENSE_0BSD)` is the C's own drift check; this is that
 * assertion, ported.
 *
 * CORE-ONLY: GAP — `adw-about-dialog` has no `license-type` property. It derives the type as
 * CUSTOM or UNKNOWN from whether `license` is empty (elements/adw-about-dialog.ts), and nothing
 * on either side reads an `spdxId` or a `url`, so rows 2, 7 and 18 reach no renderer; the
 * NativeScript bridge ships the widget without a spec. It was exempted here as an internal step
 * of ABOUT_DIALOG_CREDITS_LEGAL_VECTORS, a three-boolean visibility table whose only licence
 * input is `hasLegal`. Tracked in #1072
 */
export const LICENSE_INFO_VECTORS: ReadonlyArray<LicenseInfoVector> = [
    { licenseType: 0, spdxId: null, url: null, rule: 'unknown carries nothing (:216)' },
    {
        licenseType: 1,
        spdxId: null,
        url: null,
        rule: 'custom carries nothing either — the text comes from the property (:217)',
    },
    {
        licenseType: 2,
        spdxId: 'GPL-2.0-or-later',
        url: 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html',
        rule: 'the first real row, at index 2 — a table that skipped the two nulls shifts everything',
    },
    {
        licenseType: 7,
        spdxId: 'MIT',
        url: 'https://opensource.org/licenses/mit-license.php',
        rule: 'MIT_X11 (:229)',
    },
    {
        licenseType: 18,
        spdxId: '0BSD',
        url: 'https://opensource.org/license/0bsd',
        rule: 'the last row — G_STATIC_ASSERT pins it to GTK_LICENSE_0BSD (:253-256)',
    },
];

/** One SPDX-id lookup expectation. */
export interface LicenseSpdxVector {
    /** The AppStream `project_license` value. */
    spdxId: string;
    /** The `GtkLicense` it resolves to, or `null` for no match. */
    licenseType: number | null;
    rule: string;
}

/**
 * The two lookup loops in `populate_from_appdata`.
 *
 * CORE-ONLY: GAP — both lookups run inside `populate_from_appdata`, and neither renderer has an
 * appdata path to route an SPDX id through. Tracked in #1072
 */
export const LICENSE_SPDX_VECTORS: ReadonlyArray<LicenseSpdxVector> = [
    { spdxId: 'MIT', licenseType: 7, rule: 'an exact table match (:1227)' },
    { spdxId: 'GPL-3.0-or-later', licenseType: 3, rule: 'the -or-later variant is its own row' },
    { spdxId: 'GPL-3.0-only', licenseType: 10, rule: 'and so is -only' },
    { spdxId: 'GPL-2.0', licenseType: 9, rule: 'the deprecated bare id aliases to -ONLY, not -or-later (:265)' },
    { spdxId: 'GPL-3.0', licenseType: 10, rule: 'the second alias (:266)' },
    { spdxId: '0BSD', licenseType: 18, rule: 'the last row is reachable by id' },
    { spdxId: 'WTFPL', licenseType: null, rule: 'no match; the caller falls back to custom (:1241-1242)' },
    { spdxId: 'mit', licenseType: null, rule: 'g_strcmp0 is case-sensitive' },
    { spdxId: '', licenseType: null, rule: 'the empty id matches nothing — indices 0/1 hold NULL, not ""' },
];

/** One `get_license_text` expectation. */
export interface LicenseTextVector {
    licenseType: number;
    license: string;
    /** What the Legal page shows, `null` meaning "no licence text at all". */
    text: string | null;
    rule: string;
}

/**
 * `get_license_text`.
 *
 * CORE-ONLY: GAP — `getLicenseText` is called by no renderer. The browser element writes
 * `this.license` straight into the Legal page and never builds the stock preamble with its URL
 * and Pango markup, so the rows for types 7 and 18 reach nothing outside the core suite.
 * Tracked in #1072
 */
export const LICENSE_TEXT_VECTORS: ReadonlyArray<LicenseTextVector> = [
    {
        licenseType: 0,
        license: 'ignored',
        text: null,
        rule: 'unknown returns NULL and the custom text is not consulted (:639-640)',
    },
    {
        licenseType: 1,
        license: 'All rights reserved.',
        text: 'All rights reserved.',
        rule: 'custom passes through (:642-643)',
    },
    {
        licenseType: 1,
        license: '',
        text: '',
        rule: 'custom + empty is "" — NOT null; the difference decides whether a legal section exists',
    },
    {
        licenseType: 7,
        license: '',
        text: 'This application comes with absolutely no warranty. See the <a href="https://opensource.org/licenses/mit-license.php">The MIT License (MIT)</a> for details.',
        rule: 'the preamble takes the URL first, then the name (:648-650), and contains Pango markup',
    },
    {
        licenseType: 18,
        license: 'ignored',
        text: 'This application comes with absolutely no warranty. See the <a href="https://opensource.org/license/0bsd">BSD Zero-Clause License</a> for details.',
        rule: 'a non-custom type ignores the license string entirely',
    },
];

/** One licence-setter step. */
export interface LicenseSetterStep {
    property: 'license' | 'license-type';
    value: string | number;
}

/** One licence-setter sequence expectation. */
export interface LicenseSetterVector {
    /** The calls, in order, starting from the property defaults. */
    steps: ReadonlyArray<LicenseSetterStep>;
    license: string;
    licenseType: number;
    /** Every `g_object_notify_by_pspec` from every step, concatenated in order. */
    notify: ReadonlyArray<'license' | 'license-type'>;
    rule: string;
}

/**
 * The two setters, which are ONE state machine.
 *
 * Each notifies BOTH properties whenever it does anything, so setting either can move the
 * other. The trap is the
 * asymmetry in the early-outs: `set_license` bails on an unchanged STRING before
 * it would have set the type to custom, so re-assigning the same text after a
 * licence-type change DOES switch the type, while assigning `""` to an already
 * empty licence does not.
 *
 * CORE-ONLY: a property-ordering table with no rendered surface — the RESULT is
 * ABOUT_DIALOG_CREDITS_LEGAL_VECTORS, driven by the browser suite. ONE renderer, not two: the
 * NativeScript bridge ships an `adw-about-dialog` widget and no spec for it, so nothing on that
 * side is held to ANY about-dialog vector.
 */
export const LICENSE_SETTER_VECTORS: ReadonlyArray<LicenseSetterVector> = [
    {
        steps: [],
        license: '',
        licenseType: 0,
        notify: [],
        rule: 'the defaults: "" (:2044) and unknown (:2032)',
    },
    {
        steps: [{ property: 'license', value: 'All rights reserved.' }],
        license: 'All rights reserved.',
        licenseType: 1,
        notify: ['license', 'license-type'],
        rule: 'setting a text forces custom and notifies both (:3471-3477)',
    },
    {
        steps: [{ property: 'license-type', value: 3 }],
        license: '',
        licenseType: 3,
        notify: ['license', 'license-type'],
        rule: 'a non-custom type notifies license too, even though it was already "" (:3414)',
    },
    {
        steps: [
            { property: 'license', value: 'Custom text' },
            { property: 'license-type', value: 3 },
        ],
        license: '',
        licenseType: 3,
        notify: ['license', 'license-type', 'license', 'license-type'],
        rule: 'choosing a stock licence CLEARS the custom text (:3407-3408) — the two are one state',
    },
    {
        steps: [
            { property: 'license', value: 'Custom text' },
            { property: 'license-type', value: 1 },
        ],
        license: 'Custom text',
        licenseType: 1,
        notify: ['license', 'license-type'],
        rule: 'setting custom when already custom is an early-out (:3404-3405) — nothing notified',
    },
    {
        steps: [
            { property: 'license', value: 'Custom text' },
            { property: 'license-type', value: 3 },
            { property: 'license', value: 'Custom text' },
        ],
        license: 'Custom text',
        licenseType: 1,
        notify: ['license', 'license-type', 'license', 'license-type', 'license', 'license-type'],
        rule: 'the SAME text again does switch back to custom, because the string did change (:3466)',
    },
    {
        steps: [
            { property: 'license-type', value: 3 },
            { property: 'license', value: '' },
        ],
        license: '',
        licenseType: 3,
        notify: ['license', 'license-type'],
        rule: 'but assigning "" to an already-empty licence bails first — the GPL text STAYS on screen',
    },
    {
        steps: [{ property: 'license-type', value: 19 }],
        license: '',
        licenseType: 0,
        notify: [],
        rule: 'out of range is rejected outright (:3401-3402), not clamped',
    },
    {
        steps: [{ property: 'license-type', value: -1 }],
        license: '',
        licenseType: 0,
        notify: [],
        rule: 'below GTK_LICENSE_UNKNOWN likewise',
    },
];

/** One Legal-page visibility expectation. */
export interface LegalSectionVector {
    copyright: string;
    licenseType: number;
    license: string;
    /** Whether the app's own legal section is drawn at all. */
    visible: boolean;
    rule: string;
}

/**
 * `append_legal_section`'s early-outs for the default section.
 *
 * CORE-ONLY: an internal step of a pipeline whose COMPOSED result is renderer-driven — driving it separately would assert the same thing twice (ABOUT_DIALOG_CREDITS_LEGAL_VECTORS)
 */
export const LEGAL_SECTION_VECTORS: ReadonlyArray<LegalSectionVector> = [
    { copyright: '', licenseType: 0, license: '', visible: false, rule: 'nothing set — no Legal page, no Legal row' },
    { copyright: '© 2026 Ada', licenseType: 0, license: '', visible: true, rule: 'a copyright alone is enough' },
    { copyright: '', licenseType: 7, license: '', visible: true, rule: 'a stock licence alone is enough' },
    {
        copyright: '',
        licenseType: 1,
        license: '',
        visible: false,
        rule: 'custom with an EMPTY text contributes nothing — the trap `licenseText` returning "" sets',
    },
    {
        copyright: '',
        licenseType: 1,
        license: 'All rights reserved.',
        visible: true,
        rule: 'custom with text does',
    },
    {
        copyright: ' ',
        licenseType: 0,
        license: '',
        visible: true,
        rule: 'a single space is a first character (:666) — the section exists and looks empty',
    },
];
