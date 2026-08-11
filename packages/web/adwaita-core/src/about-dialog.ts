// Adwaita about-dialog derivations — headless (ADR 0004).
//
// Four parts of `Adw.AboutDialog` are pure derivations over strings, and they decide
// what a user sees: which licence text is shown, how a credit line splits into a name
// and a link, which of the six pages exist at all, and how the credit sections are
// assembled. Lifted once, with a vector table both renderers assert against
// (`conformance/about-dialog.ts`).
//
// `parse_person` is 40 lines of pointer arithmetic and every simplification of it is
// wrong in a way that only shows up on somebody's name:
//
// - it scans for the FIRST `<` ANYWHERE, not an angle pair anchored at the END, so
// `"Ada <ada@x.org> (retired)"` still has a link;
// - `is_email` is `*q1 == '<'` and NOTHING else — no `@` test, so `"Ada <ada>"` (an
// intranet login) is still mailed;
// - the URL search is `strstr`: it does not care what precedes or follows it, so
// `"Ada(https://x)"` has a link;
// - only `http://` and `https://` are recognised — `mailto:` as a bare scheme is NOT
// a link in GTK;
// - the URL ends at the first of ` `, `\n`, `\t`, `>` — `\r` is not in that set;
// - a URL INSIDE angle brackets wins over the brackets (`r1 <= q1 + 1`) and leaves
// the `<` behind in the NAME, so `"Ada <https://x>"` is the person `"Ada <"`;
// - the name is stripped with `g_strstrip`, which is ASCII-only — the same trap
// `avatar.ts` documents, so both call {@link gStrStrip}.
//
// Every row of `CREDIT_PERSON_VECTORS` was produced by COMPILING the vendored
// `parse_person` against real GLib and printing its output, not by reading it — the only
// way to be sure a lift of pointer arithmetic is a lift and not a second reading.
//
// NOT lifted, deliberately:
// - `debug-info` is an app-supplied opaque string, never assembled by the widget;
// - there is NO URL validation anywhere in the C (`set_website` / `set_support_url`
// only guard against NULL), so none is invented here;
// - the AppStream release-notes parser IS portable, but no renderer has the What's New
// page yet. `whatsNewRow` in the visibility table is derived from whether release
// notes are SET, which is all a renderer needs until the page exists.
//
// PLATFORM-NEUTRAL: renders nothing, imports nothing, touches no global.
//
// Reference: refs/libadwaita/src/adw-about-dialog.c (AdwAboutDialog)
// Reference: refs/libadwaita/src/adw-about-dialog.ui (the page + row tree)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { gStrStrip } from './glib.js';

/** One `LicenseInfo` row — the struct. */
export interface AdwLicenseInfo {
    /** The translatable licence name, `null` for `unknown` and `custom`. */
    name: string | null;
    /** The canonical licence URL, hardcoded (never translated). */
    url: string | null;
    /** The SPDX identifier AppStream metadata is matched against. */
    spdxId: string | null;
}

/**
 * `GtkLicense` as the INDEX into {@link ADW_LICENSES}, which is what the C uses it as
 * (`gtk_license_info[license_type]`). Order and row contents come from the vendored table
 * plus its static assertion that the last index is `GTK_LICENSE_0BSD`; the member
 * SPELLINGS come from the `Gtk.License` enum in `@girs/gtk-4.0`, since `refs/gtk` is not
 * vendored here.
 */
export const GTK_LICENSE = {
    UNKNOWN: 0,
    CUSTOM: 1,
    GPL_2_0: 2,
    GPL_3_0: 3,
    LGPL_2_1: 4,
    LGPL_3_0: 5,
    BSD: 6,
    MIT_X11: 7,
    ARTISTIC: 8,
    GPL_2_0_ONLY: 9,
    GPL_3_0_ONLY: 10,
    LGPL_2_1_ONLY: 11,
    LGPL_3_0_ONLY: 12,
    AGPL_3_0: 13,
    AGPL_3_0_ONLY: 14,
    BSD_3: 15,
    APACHE_2_0: 16,
    MPL_2_0: 17,
    '0BSD': 18,
} as const;

/** A `GtkLicense` value, i.e. a valid index into {@link ADW_LICENSES}. */
export type AdwLicenseType = (typeof GTK_LICENSE)[keyof typeof GTK_LICENSE];

/**
 * The 19 `gtk_license_info` rows in enum order. Indices 0 and 1 are all-`null` on purpose:
 * `unknown` shows nothing and `custom` takes its text from the `license` property, so
 * neither has a name, a URL or an SPDX id to match — and skipping them would shift every
 * later licence by two.
 */
export const ADW_LICENSES: ReadonlyArray<AdwLicenseInfo> = [
    { name: null, url: null, spdxId: null }, // GTK_LICENSE_UNKNOWN
    { name: null, url: null, spdxId: null }, // GTK_LICENSE_CUSTOM
    {
        name: 'GNU General Public License, version 2 or later',
        url: 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html',
        spdxId: 'GPL-2.0-or-later',
    },
    {
        name: 'GNU General Public License, version 3 or later',
        url: 'https://www.gnu.org/licenses/gpl-3.0.html',
        spdxId: 'GPL-3.0-or-later',
    },
    {
        name: 'GNU Lesser General Public License, version 2.1 or later',
        url: 'https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html',
        spdxId: 'LGPL-2.1-or-later',
    },
    {
        name: 'GNU Lesser General Public License, version 3 or later',
        url: 'https://www.gnu.org/licenses/lgpl-3.0.html',
        spdxId: 'LGPL-3.0-or-later',
    },
    {
        name: 'BSD 2-Clause License',
        url: 'https://opensource.org/licenses/bsd-license.php',
        spdxId: 'BSD-2-Clause',
    },
    {
        name: 'The MIT License (MIT)',
        url: 'https://opensource.org/licenses/mit-license.php',
        spdxId: 'MIT',
    },
    {
        name: 'Artistic License 2.0',
        url: 'https://opensource.org/licenses/artistic-license-2.0.php',
        spdxId: 'Artistic-2.0',
    },
    {
        name: 'GNU General Public License, version 2 only',
        url: 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html',
        spdxId: 'GPL-2.0-only',
    },
    {
        name: 'GNU General Public License, version 3 only',
        url: 'https://www.gnu.org/licenses/gpl-3.0.html',
        spdxId: 'GPL-3.0-only',
    },
    {
        name: 'GNU Lesser General Public License, version 2.1 only',
        url: 'https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html',
        spdxId: 'LGPL-2.1-only',
    },
    {
        name: 'GNU Lesser General Public License, version 3 only',
        url: 'https://www.gnu.org/licenses/lgpl-3.0.html',
        spdxId: 'LGPL-3.0-only',
    },
    {
        name: 'GNU Affero General Public License, version 3 or later',
        url: 'https://www.gnu.org/licenses/agpl-3.0.html',
        spdxId: 'AGPL-3.0-or-later',
    },
    {
        name: 'GNU Affero General Public License, version 3 only',
        url: 'https://www.gnu.org/licenses/agpl-3.0.html',
        spdxId: 'AGPL-3.0-only',
    },
    {
        name: 'BSD 3-Clause License',
        url: 'https://opensource.org/licenses/BSD-3-Clause',
        spdxId: 'BSD-3-Clause',
    },
    {
        name: 'Apache License, Version 2.0',
        url: 'https://opensource.org/licenses/Apache-2.0',
        spdxId: 'Apache-2.0',
    },
    {
        name: 'Mozilla Public License 2.0',
        url: 'https://opensource.org/licenses/MPL-2.0',
        spdxId: 'MPL-2.0',
    },
    {
        name: 'BSD Zero-Clause License',
        url: 'https://opensource.org/license/0bsd',
        spdxId: '0BSD',
    },
];

/** One deprecated-SPDX alias — the `LicenseAlias` struct at:258-261. */
export interface AdwLicenseAlias {
    /** The retired SPDX id apps still ship in their AppStream metadata. */
    spdxId: string;
    /** The `GtkLicense` it resolves to. */
    licenseType: AdwLicenseType;
}

/**
 * The two deprecated SPDX ids.
 *
 * Both map to the `-only` variant, not the `-or-later` one — the bare
 * `GPL-2.0` predates the split and meant "version 2", so resolving it to
 * `GPL-2.0-or-later` would silently widen an app's stated licence.
 */
export const ADW_LICENSE_ALIASES: ReadonlyArray<AdwLicenseAlias> = [
    { spdxId: 'GPL-2.0', licenseType: GTK_LICENSE.GPL_2_0_ONLY },
    { spdxId: 'GPL-3.0', licenseType: GTK_LICENSE.GPL_3_0_ONLY },
];

/**
 * The licence preamble, with `%s` for the URL and `%s` for the name, in
 * that order.
 *
 * Translatable as a whole; the two `%s` are filled with a HARDCODED url and a
 * SEPARATELY translated name. It contains Pango markup, which the
 * Legal page renders as such — a renderer that escapes it shows the user raw
 * `<a href=…>`.
 */
export const ADW_LICENSE_WARRANTY_TEMPLATE =
    'This application comes with absolutely no warranty. See the <a href="%s">%s</a> for details.';

/**
 * Whether `value` is inside the `gtk_license_info` bounds — the setter's
 * `g_return_if_fail`.
 *
 * The integer test has no counterpart in the C, where the parameter is already
 * a `GtkLicense`; here the value arrives from an attribute or JSON, and a
 * fractional index would read `undefined` out of the table instead of being
 * rejected.
 */
export function isLicenseType(value: number): value is AdwLicenseType {
    return Number.isInteger(value) && value >= GTK_LICENSE.UNKNOWN && value < ADW_LICENSES.length;
}

/**
 * The `GtkLicense` an AppStream `project_license` SPDX id resolves to, or
 * `null` when nothing matches — the two lookup loops at:1226-1239.
 *
 * The exact-match loop runs over the WHOLE table including indices 0 and 1,
 * whose `spdxId` is `null` and therefore never equal to a real id. The alias
 * loop runs afterwards and can override the first, which only matters for ids
 * that are in both lists — today none are.
 *
 * The caller's remaining step is NOT folded in here because it is stateful:
 * `populate_from_appdata` falls back to `custom` only when the dialog's licence
 * type is still `unknown` after both loops, which depends on what
 * was set before, not on the id.
 */
export function licenseTypeForSpdxId(spdxId: string): AdwLicenseType | null {
    for (let index = 0; index < ADW_LICENSES.length; index++) {
        if (ADW_LICENSES[index]!.spdxId === spdxId) return index as AdwLicenseType;
    }
    for (const alias of ADW_LICENSE_ALIASES) {
        if (alias.spdxId === spdxId) return alias.licenseType;
    }
    return null;
}

/**
 * `get_license_text` — the text the Legal page shows for a licence.
 *
 * Three cases, and the difference between the first two is what a renderer gets
 * wrong: `unknown` returns NULL, meaning the Legal page shows NO licence at all,
 * while `custom` returns the raw `license` string, which may itself be empty.
 * Both look like "nothing" on screen; only the second still contributes a legal
 * section when a copyright is set.
 */
export function licenseText(licenseType: AdwLicenseType, license: string): string | null {
    if (licenseType === GTK_LICENSE.UNKNOWN) return null;
    if (licenseType === GTK_LICENSE.CUSTOM) return license;

    const info = ADW_LICENSES[licenseType]!;
    // Replacer FUNCTIONS, not strings: a literal replacement would interpret
    // `$&`/`$'` inside a licence name or URL as a capture reference.
    return ADW_LICENSE_WARRANTY_TEMPLATE.replace('%s', () => info.url ?? '').replace('%s', () => info.name ?? '');
}

/** The `license` / `license-type` pair, as a renderer holds it. */
export interface AdwLicenseState {
    /** `license` — the custom licence text. Empty string, never null. */
    license: string;
    /** `license-type` — the `GtkLicense`. */
    licenseType: AdwLicenseType;
}

/** The `GParamSpec` defaults: `""` and `unknown`. */
export const ADW_LICENSE_DEFAULTS: Readonly<AdwLicenseState> = {
    license: '',
    licenseType: GTK_LICENSE.UNKNOWN,
};

/** The GObject property names the two licence setters notify. */
export type AdwLicenseNotify = 'license' | 'license-type';

/** What one licence setter did: the new state, and what it notified. */
export interface AdwLicenseTransition {
    /** The state after the call — the same object contents when nothing changed. */
    state: AdwLicenseState;
    /** Whether the setter got past its early-out. */
    changed: boolean;
    /** The `g_object_notify_by_pspec` calls, in emission order. */
    notify: ReadonlyArray<AdwLicenseNotify>;
}

const UNCHANGED = (state: AdwLicenseState): AdwLicenseTransition => ({ state, changed: false, notify: [] });

/**
 * `adw_about_dialog_set_license_type`.
 *
 * Setting any type other than `custom` CLEARS the custom licence text to `""`
 * — the two properties are one state, not two. Both are notified
 * whether or not the string actually moved.
 *
 * An out-of-range value is rejected outright (`g_return_if_fail`),
 * which is a no-op, not a clamp: the state keeps whatever it had.
 */
export function setLicenseType(state: AdwLicenseState, licenseType: number): AdwLicenseTransition {
    if (!isLicenseType(licenseType)) return UNCHANGED(state);
    if (state.licenseType === licenseType) return UNCHANGED(state);

    return {
        state: {
            license: licenseType === GTK_LICENSE.CUSTOM ? state.license : '',
            licenseType,
        },
        changed: true,
        notify: ['license', 'license-type'],
    };
}

/**
 * `adw_about_dialog_set_license`.
 *
 * Setting a licence text forces the type to `custom` — but only after
 * the early-out on an UNCHANGED string, which makes the pair
 * asymmetric in a way that is easy to miss: with the text already `""`, setting
 * `""` again does NOT switch the type to `custom`, so an app trying to clear a
 * `GPL-3.0` licence by assigning the empty string keeps the GPL text on screen.
 */
export function setLicense(state: AdwLicenseState, license: string): AdwLicenseTransition {
    if (state.license === license) return UNCHANGED(state);

    return {
        state: { license, licenseType: GTK_LICENSE.CUSTOM },
        changed: true,
        notify: ['license', 'license-type'],
    };
}

/** One parsed credit line — `parse_person`'s three out-parameters, plus the URI. */
export interface AdwCreditPerson {
    /** The displayed row title: everything before the link, `g_strstrip`ped. */
    name: string;
    /**
     * The link as it appears in the source string, or `null` when the line has
     * none.
     *
     * `''` and `null` are DIFFERENT states: the C tests `if (link)` on a
     * pointer, so the empty string produced by `"Ada <>"` is still a link and
     * still makes the row an `AdwLinkRow`.
     */
    link: string | null;
    /** `*q1 == '<'` — whether the link came out of angle brackets. */
    isEmail: boolean;
    /** `add_credits_section`'s final URI: `mailto:` + link, or the link. */
    uri: string | null;
}

/** The `strpbrk` terminator set that ends a bare URL. `\r` is not in it. */
const URL_TERMINATORS = ' \n\t>';

/** `strpbrk (from, " \n\t>")` — the first terminator at or after `from`, or `-1`. */
function indexOfUrlEnd(person: string, from: number): number {
    for (let index = from; index < person.length; index++) {
        if (URL_TERMINATORS.includes(person[index]!)) return index;
    }
    return -1;
}

/**
 * `parse_person` — split one credit line into a name and a link.
 *
 * Every index here is compared with `>= 0`, never for truthiness: a `<` or a
 * `http://` at position 0 is a valid non-NULL pointer in the C and a falsy `0`
 * in JS, so `"<ada@x.org>"` and `"https://x.org"` — a person with no name — are
 * exactly where a truthiness port silently produces the unparsed line instead.
 */
export function parseCreditPerson(person: string): AdwCreditPerson {
    // q1/q2: the first `<` anywhere, and the first `>` at or after it.
    let q1 = person.indexOf('<');
    let q2 = q1 < 0 ? -1 : person.indexOf('>', q1);

    // r1/r2: the earliest bare URL, and where it ends. Only these two
    // schemes are recognised — `mailto:` as a bare scheme is not a link in GTK.
    const httpAt = person.indexOf('http://');
    const httpsAt = person.indexOf('https://');
    let r1 = httpAt;
    if (httpAt < 0 || (httpsAt >= 0 && httpsAt < httpAt)) r1 = httpsAt;
    let r2 = -1;
    if (r1 >= 0) {
        r2 = indexOfUrlEnd(person, r1);
        if (r2 < 0) r2 = person.length; // `strchr (r1, '\0')` — the end of the string
    }

    // A bare URL beats the angle pair when there is no complete pair, or when
    // the URL starts AT or just after the `<` — i.e. the brackets contain the
    // URL. The `<` then stays in the name, which is not a bug to fix here.
    // The C also tests `r2` there; it cannot be NULL once `r1` is set, because
    // the fallback is `strchr (r1, '\0')`, which always finds the terminator.
    if (r1 >= 0 && (q1 < 0 || q2 < 0 || r1 <= q1 + 1)) {
        q1 = r1;
        q2 = r2;
    }

    let name: string;
    let link: string | null;
    let isEmail: boolean;

    if (q1 >= 0 && q2 >= 0) {
        name = person.slice(0, q1);
        isEmail = person[q1] === '<'; // the ONLY test; there is no `@` test
        link = isEmail ? person.slice(q1 + 1, q2) : person.slice(q1, q2);
    } else {
        name = person;
        link = null;
        isEmail = false;
    }

    name = gStrStrip(name); // ASCII whitespace only

    return { name, link, isEmail, uri: link === null ? null : isEmail ? `mailto:${link}` : link };
}

/**
 * The two untranslated `translator-credits` sentinels.
 *
 * Apps mark the literal string `"translator-credits"` as translatable and each
 * locale replaces it with its own translator list; in an untranslated locale it
 * comes back unchanged, and showing THAT to the user is the bug this guards.
 * The underscore spelling is the older gettext convention and is still checked.
 */
export const ADW_TRANSLATOR_CREDITS_SENTINELS: ReadonlyArray<string> = ['translator_credits', 'translator-credits'];

/**
 * The translator names for a `translator-credits` value — `g_strsplit (…, "\n",
 * 0)` past the sentinel guard.
 *
 * `g_strsplit` returns an EMPTY vector for the empty string, where JS
 * `''.split('\n')` returns `['']`. The difference is visible: the C shows no
 * "Translated by" section at all, a `split()`-based port shows the section with
 * one blank row in it. Blank INTERIOR lines are kept, because `g_strsplit` keeps
 * them and `add_credits_section` only skips NULL pointers, not empty strings.
 */
export function translatorCreditsPeople(value: string | null | undefined): string[] {
    if (value === null || value === undefined) return [];
    if (ADW_TRANSLATOR_CREDITS_SENTINELS.includes(value)) return [];
    if (value.length === 0) return []; // g_strsplit ("", …) is a zero-length vector
    return value.split('\n');
}

/** The five built-in credit section titles, in `update_credits` order. */
export const ADW_CREDITS_SECTION_TITLES = {
    developers: 'Code by',
    designers: 'Design by',
    artists: 'Artwork by',
    documenters: 'Documentation by',
    translators: 'Translated by',
} as const;

/** An app-provided extra section (`add_credit_section`). */
export interface AdwCreditsSectionInput {
    /** The section heading. Nullable in the C signature. */
    title: string | null;
    /** The raw credit lines, each in `parse_person` syntax. */
    people: ReadonlyArray<string>;
}

/** One assembled credits group. */
export interface AdwCreditsSection {
    /** The `AdwPreferencesGroup` title. */
    title: string | null;
    /** The parsed rows, in source order. */
    people: ReadonlyArray<AdwCreditPerson>;
}

/** The credit inputs `update_credits` reads. */
export interface AdwCreditsInput {
    developers?: ReadonlyArray<string>;
    designers?: ReadonlyArray<string>;
    artists?: ReadonlyArray<string>;
    documenters?: ReadonlyArray<string>;
    /** The raw `translator-credits` string, sentinels and all. */
    translatorCredits?: string | null;
    /** Extra sections, in `add_credit_section` call order. */
    creditSections?: ReadonlyArray<AdwCreditsSectionInput>;
}

/**
 * `update_credits` — the Credits page, as a list of groups.
 *
 * A section with no people is not "an empty group", it is NO group:
 * `add_credits_section` returns before creating one. The order is
 * fixed — developers, designers, artists, documenters, translators, then the
 * app's own sections in the order they were added — and it is not alphabetical
 * or configurable.
 *
 * One C quirk is deliberately NOT reproduced: `add_credit_section` sets
 * `credits_box` visible unconditionally, even when the section it just
 * tried to add was empty and nothing was created — so an
 * `add_credit_section ("Backers", {NULL})` leaves GTK with a Credits row that
 * opens a blank page. That is an artefact of mutating a widget tree
 * incrementally, not a derivation; recomputing from the sections, as
 * `update_credits` itself does, is the same rule without the stale
 * flag.
 */
export function creditsSections(input: AdwCreditsInput = {}): AdwCreditsSection[] {
    const ordered: AdwCreditsSectionInput[] = [
        { title: ADW_CREDITS_SECTION_TITLES.developers, people: input.developers ?? [] },
        { title: ADW_CREDITS_SECTION_TITLES.designers, people: input.designers ?? [] },
        { title: ADW_CREDITS_SECTION_TITLES.artists, people: input.artists ?? [] },
        { title: ADW_CREDITS_SECTION_TITLES.documenters, people: input.documenters ?? [] },
        { title: ADW_CREDITS_SECTION_TITLES.translators, people: translatorCreditsPeople(input.translatorCredits) },
        ...(input.creditSections ?? []),
    ];

    return ordered
        .filter((section) => section.people.length > 0)
        .map((section) => ({ title: section.title, people: section.people.map(parseCreditPerson) }));
}

/**
 * The row and page labels from the template, mnemonic markers intact.
 *
 * They are here because the visibility table below names these exact widgets
 * and a renderer has to be able to draw them. `_` is a GTK accelerator marker
 * in every ROW title (`use-underline=True` on each) and NOT in the page titles;
 * a renderer without an accelerator layer runs the row titles through
 * `stripMnemonic`.
 *
 * `dialogTitle` is the one that gets invented: the main page's title is bound
 * to `AdwDialog:title`, whose template default is the bare word "About"
 * — not "About <app name>". The application NAME
 * appears separately, in the header revealer that fades in on scroll.
 */
export const ADW_ABOUT_DIALOG_LABELS = {
    dialogTitle: 'About', //.ui
    whatsNewRow: 'What’s _New', //.ui (U+2019, not an ASCII apostrophe)
    detailsRow: '_Details', //.ui
    websiteRow: '_Website', //.ui and:350 — the same title on both pages
    supportRow: '_Support Questions', //.ui
    issueRow: '_Report an Issue', //.ui
    troubleshootingRow: '_Troubleshooting', //.ui
    creditsRow: '_Credits', //.ui
    legalRow: '_Legal', //.ui
    acknowledgementsRow: '_Acknowledgements', //.ui
    whatsNewPage: 'What’s New', //.ui
    detailsPage: 'Details', //.ui
    troubleshootingPage: 'Troubleshooting', //.ui
    creditsPage: 'Credits', //.ui
    legalPage: 'Legal', //.ui
    acknowledgementsPage: 'Acknowledgements', //.ui
} as const;

/** Everything the visibility derivation reads. */
export interface AdwAboutDialogProps {
    /** `application-icon`. */
    applicationIcon: string;
    /** `application-name`. */
    applicationName: string;
    /** `developer-name`. */
    developerName: string;
    /** `version`. */
    version: string;
    /** `comments` — Details-page body text. */
    comments: string;
    /** `website` — shown on the MAIN page or the Details page, never both. */
    website: string;
    /** `support-url` — a MAIN-page row. */
    supportUrl: string;
    /** `issue-url` — a MAIN-page row. */
    issueUrl: string;
    /** `debug-info` — an app-supplied blob; only its emptiness is derived. */
    debugInfo: string;
    /** `release-notes`; non-empty is the whole `whats_new_row` rule. */
    releaseNotes: string;
    /** Whether `add_link` was ever called. */
    hasCustomLinks: boolean;
    /** Whether `credits_box` ended up with children. */
    hasCredits: boolean;
    /** Whether `legal_box` ended up with children. */
    hasLegal: boolean;
    /** Whether `add_acknowledgement_section` was ever called. */
    hasAcknowledgements: boolean;
}

/** Which widgets `update_details`/`update_support`/`update_credits_legal_group` show. */
export interface AdwAboutDialogVisibility {
    /** Main page: the 128px app icon. */
    appIcon: boolean;
    /** Main page: the title-1 app name. */
    appName: boolean;
    /** Main page: the developer line. */
    developerName: boolean;
    /** Main page: the version pill. */
    version: boolean;
    /** Main page: the first group. */
    detailsGroup: boolean;
    /** Main page: "What's New". */
    whatsNewRow: boolean;
    /** Main page: "Details", the row that pushes the subpage. */
    detailsRow: boolean;
    /** Main page: "Website", shown only when the Details page has nothing else. */
    websiteRow: boolean;
    /** Main page: the support group. */
    supportGroup: boolean;
    /** Main page: "Support Questions". */
    supportRow: boolean;
    /** Main page: "Report an Issue". */
    issueRow: boolean;
    /** Main page: "Troubleshooting". */
    troubleshootingRow: boolean;
    /** Main page: the Credits/Legal/Acknowledgements group. */
    creditsLegalGroup: boolean;
    /** Main page: "Credits", bound to `credits_box` (.ui). */
    creditsRow: boolean;
    /** Main page: "Legal", bound to `legal_box` (.ui). */
    legalRow: boolean;
    /** Main page: "Acknowledgements", bound to `acknowledgements_box` (.ui). */
    acknowledgementsRow: boolean;
    /** Details page: the comments label. */
    commentsLabel: boolean;
    /** Details page: the links group. */
    linksGroup: boolean;
    /** Details page: "Website", the other half of the either/or. */
    detailsWebsiteRow: boolean;
}

/**
 * `update_details` + `update_support` +
 * `update_credits_legal_group`, as one truth table.
 *
 * The three rules a port does not arrive at by guessing:
 *
 * 1. **Website is not a Details-page trigger.** `show_details` is
 * `has_comments || has_custom_links` — website is deliberately
 * absent. A dialog with only a website and nothing else keeps the website
 * on the MAIN page and offers no Details row at all, because a
 * subpage holding one link is worse than the link.
 * 2. **The website row exists twice**, once per page, and exactly one of the
 * two is visible. They are separate widgets in the template
 * (`website_row`.ui, `details_website_row`.ui).
 * 3. **Support and issue links live on the MAIN page** (.ui),
 * not on Details. Only comments and links (website + `add_link`) are on the
 * Details page. The browser renderer put all three link rows on Details,
 * which buried the issue tracker one navigation step deeper than GTK.
 *
 * `hasCustomLinks` is a latch in the C — `add_link` sets it and nothing clears
 * it — so a renderer passes "has any extra link ever been added", not
 * "does the links group currently have children".
 */
export function aboutDialogVisibility(props: Partial<AdwAboutDialogProps> = {}): AdwAboutDialogVisibility {
    const hasWebsite = (props.website ?? '').length > 0;
    const hasComments = (props.comments ?? '').length > 0;
    const hasReleaseNotes = (props.releaseNotes ?? '').length > 0;
    const hasCustomLinks = props.hasCustomLinks ?? false;

    const showDetails = hasComments || hasCustomLinks;
    const showLinks = (hasWebsite && hasComments) || hasCustomLinks;

    const hasSupportUrl = (props.supportUrl ?? '').length > 0;
    const hasIssueUrl = (props.issueUrl ?? '').length > 0;
    const hasDebugInfo = (props.debugInfo ?? '').length > 0;

    const hasCredits = props.hasCredits ?? false;
    const hasLegal = props.hasLegal ?? false;
    const hasAcknowledgements = props.hasAcknowledgements ?? false;

    return {
        appIcon: (props.applicationIcon ?? '').length > 0,
        appName: (props.applicationName ?? '').length > 0,
        developerName: (props.developerName ?? '').length > 0,
        version: (props.version ?? '').length > 0,

        detailsGroup: hasWebsite || hasComments || showLinks || hasReleaseNotes,
        whatsNewRow: hasReleaseNotes,
        detailsRow: hasComments || showLinks,
        websiteRow: hasWebsite && !showDetails,

        supportGroup: hasSupportUrl || hasIssueUrl || hasDebugInfo,
        supportRow: hasSupportUrl,
        issueRow: hasIssueUrl,
        troubleshootingRow: hasDebugInfo,

        creditsLegalGroup: hasCredits || hasLegal || hasAcknowledgements,
        creditsRow: hasCredits,
        legalRow: hasLegal,
        acknowledgementsRow: hasAcknowledgements,

        commentsLabel: hasComments,
        linksGroup: showLinks,
        detailsWebsiteRow: hasWebsite && showDetails,
    };
}

/**
 * Whether the Legal page has anything on it — `append_legal_section`'s two
 * early-outs collapsed for the DEFAULT section.
 *
 * The section is dropped when the copyright is empty AND the licence text is
 * empty-or-absent; `force_title` is FALSE for the app's own section, so
 * there is no title-only case here. Note the licence half goes through
 * {@link licenseText}, which means a `custom` type with an empty string
 * contributes nothing while a `GPL-3.0` type always does.
 */
export function legalSectionVisible(copyright: string, licenseType: AdwLicenseType, license: string): boolean {
    const text = licenseText(licenseType, license);
    return copyright.length > 0 || (text !== null && text.length > 0);
}
