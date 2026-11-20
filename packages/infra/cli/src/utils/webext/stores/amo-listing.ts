// Reads what `gjsify webext listing` wrote for AMO (`<dir>/amo/<lang>/*.txt`) and maps it onto
// the fields AMO's API takes. Pure but for the file reads: the network half is `updateListing`
// in amo.ts.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { StoreListingInput } from './index.js';

/** The locales addons-server accepts for translated fields (its `LANGUAGES` setting). */
export const AMO_LOCALES: readonly string[] = [
    'ar',
    'bg',
    'ca',
    'cak',
    'cs',
    'da',
    'de',
    'dsb',
    'el',
    'en-CA',
    'en-GB',
    'en-US',
    'es',
    'eu',
    'fa',
    'fi',
    'fr',
    'fy-NL',
    'ga-IE',
    'he',
    'hsb',
    'hu',
    'id',
    'it',
    'ja',
    'ka',
    'kab',
    'ko',
    'mk',
    'mn',
    'nl',
    'pl',
    'pt-BR',
    'pt-PT',
    'ro',
    'ru',
    'sk',
    'sl',
    'sq',
    'sv-SE',
    'tr',
    'uk',
    'vi',
    'zh-CN',
    'zh-TW',
];

/**
 * The AMO locale for a generator language (`en`, `de`, `pt_BR`, `de-DE`), or null when AMO has none
 * that is unambiguous. `en` is AMO's `en-US`, the default locale of every listing.
 */
export function amoLocale(language: string): string | null {
    const [primary = '', region] = language.replace(/_/g, '-').split('-');
    const lower = primary.toLowerCase();
    const exact = AMO_LOCALES.find(
        (l) => l.toLowerCase() === (region === undefined ? lower : `${lower}-${region.toLowerCase()}`),
    );
    if (exact !== undefined) return exact;
    if (lower === 'en') return 'en-US';
    if (AMO_LOCALES.includes(lower)) return lower;
    const regional = AMO_LOCALES.filter((l) => l.startsWith(`${lower}-`));
    return regional.length === 1 ? regional[0]! : null;
}

export interface AmoListingFiles {
    readonly input: Omit<StoreListingInput, 'approvalNotes'> & { readonly approvalNotesText?: string };
    /** Generator language → AMO locale, for the report. */
    readonly locales: Readonly<Record<string, string>>;
}

const readText = (dir: string, name: string): string | undefined => {
    const path = join(dir, name);
    return existsSync(path) ? readFileSync(path, 'utf8').trim() : undefined;
};

/**
 * Reads `<listingRoot>/amo/<lang>/{summary,description,privacy,reviewer-notes}.txt`. Throws one
 * error naming every problem, so a run needs one fix, not one per language. `name.txt` is never read.
 */
export function readAmoListing(listingRoot: string): AmoListingFiles {
    const amoDir = join(listingRoot, 'amo');
    if (!existsSync(amoDir)) {
        throw new Error(`${amoDir} does not exist. Run \`gjsify webext listing --store amo\` first.`);
    }
    const problems: string[] = [];
    const summary: Record<string, string> = {};
    const description: Record<string, string> = {};
    const privacyPolicy: Record<string, string> = {};
    const locales: Record<string, string> = {};
    const reviewerNotes: Record<string, string> = {};
    const languages = readdirSync(amoDir)
        .filter(
            (entry) => statSync(join(amoDir, entry)).isDirectory() && existsSync(join(amoDir, entry, 'summary.txt')),
        )
        .sort();
    for (const language of languages) {
        const dir = join(amoDir, language);
        const locale = amoLocale(language);
        if (locale === null) {
            problems.push(`language "${language}" has no AMO locale (known: ${AMO_LOCALES.join(', ')}).`);
            continue;
        }
        const taken = Object.entries(locales).find(([, l]) => l === locale);
        if (taken !== undefined) {
            problems.push(`languages "${taken[0]}" and "${language}" both map to AMO locale ${locale}.`);
            continue;
        }
        locales[language] = locale;
        const s = readText(dir, 'summary.txt');
        const d = readText(dir, 'description.txt');
        if (s === undefined || s === '') problems.push(`${language}/summary.txt is missing or empty.`);
        else summary[locale] = s;
        if (d === undefined || d === '') problems.push(`${language}/description.txt is missing or empty.`);
        else description[locale] = d;
        const p = readText(dir, 'privacy.txt');
        if (p !== undefined && p !== '') privacyPolicy[locale] = p;
        const r = readText(dir, 'reviewer-notes.txt');
        if (r !== undefined && r !== '') reviewerNotes[language] = r;
    }
    if (languages.length === 0) problems.push(`${amoDir} holds no language directory with a summary.txt.`);
    if (problems.length > 0)
        throw new Error(`the AMO listing in ${amoDir} cannot be sent:\n  ${problems.join('\n  ')}`);

    // Reviewer notes are one plain string per version: the default language's, i.e. `en`, else the first.
    const notesLanguage = 'en' in reviewerNotes ? 'en' : Object.keys(reviewerNotes)[0];
    return {
        input: {
            summary,
            description,
            ...(Object.keys(privacyPolicy).length > 0 ? { privacyPolicy } : {}),
            ...(notesLanguage === undefined ? {} : { approvalNotesText: reviewerNotes[notesLanguage]! }),
        },
        locales,
    };
}
