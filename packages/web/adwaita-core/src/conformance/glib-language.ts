// `GLib.get_language_names()` as observable behaviour, in two vector sets.
//
// `GLIB_LANGUAGE_VECTORS` answer "what does GLib do with these POSIX locales" and run on real `gi://GLib`
// (the ORACLE: it is given the locales as `LANGUAGE=a:b:c`, which is exactly what the function reads
// first) and on the core. Every `shows` below was MEASURED on GJS 1.88 / GLib 2.88, none derived.
//
// `GLIB_LANGUAGE_TAG_VECTORS` answer "what does a host that knows BCP 47 tags answer". GLib has no such
// input, so there is no oracle for them: the rule is the one written in `glib-language.ts`, and these
// are its examples. Each port's door runs them over its own host read.

import type { ConstructHarness } from './constructs.js';

/** The part of `GLib` the vectors read. */
export interface GLibLanguageLike {
    get_language_names(): string[];
}

export interface GLibLanguageSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly GLib: GLibLanguageLike;
    /** Run `read` while the host's languages are `locales` (POSIX, best first). */
    readonly withLocales: <T>(locales: readonly string[], read: () => T) => T;
}

export interface GLibLanguageTagSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly GLib: GLibLanguageLike;
    /** Run `read` while the host's languages are the BCP 47 `tags`, best first. */
    readonly withTags: <T>(tags: readonly string[], read: () => T) => T;
}

export const GLIB_LANGUAGE_ROWS = [
    'order',
    'territory',
    'codeset',
    'modifier',
    'list',
    'repeats',
    'c-appended',
    'script-in-territory',
] as const;

export type GLibLanguageRow = (typeof GLIB_LANGUAGE_ROWS)[number];

export interface GLibLanguageVector {
    readonly row: GLibLanguageRow;
    readonly rule: string;
    readonly locales: readonly string[];
    readonly shows: readonly string[];
}

/**
 * CORE-ONLY: a door's input is the host's BCP 47 tag list, which has no codeset or modifier to
 * carry, so a POSIX locale such as `en_US.UTF-8@euro` cannot be fed through a port. The doors are
 * held by GLIB_LANGUAGE_TAG_VECTORS; these pin the core's variant order against real GLib.
 */
export const GLIB_LANGUAGE_VECTORS: readonly GLibLanguageVector[] = [
    {
        row: 'order',
        rule: 'every combination of codeset, territory and modifier, most specific first (mask 7 down to 0), then C',
        locales: ['en_US.UTF-8@euro'],
        shows: [
            'en_US.UTF-8@euro',
            'en_US@euro',
            'en.UTF-8@euro',
            'en@euro',
            'en_US.UTF-8',
            'en_US',
            'en.UTF-8',
            'en',
            'C',
        ],
    },
    {
        row: 'territory',
        rule: 'a territory is stripped to the bare language',
        locales: ['pt_BR'],
        shows: ['pt_BR', 'pt', 'C'],
    },
    {
        row: 'codeset',
        rule: 'a codeset without a territory is stripped the same way',
        locales: ['de.UTF-8'],
        shows: ['de.UTF-8', 'de', 'C'],
    },
    {
        row: 'modifier',
        rule: 'a modifier sorts before the same locale without it, at every level',
        locales: ['sr_RS@latin'],
        shows: ['sr_RS@latin', 'sr@latin', 'sr_RS', 'sr', 'C'],
    },
    {
        row: 'list',
        rule: 'each entry expands in turn, then one C at the very end',
        locales: ['de_DE', 'fr@x', 'en'],
        shows: ['de_DE', 'de', 'fr@x', 'fr', 'en', 'C'],
    },
    {
        row: 'repeats',
        rule: 'nothing is deduplicated: a language named twice is listed twice',
        locales: ['de_DE', 'de'],
        shows: ['de_DE', 'de', 'de', 'C'],
    },
    {
        row: 'c-appended',
        rule: 'C is appended even when the locale already is C',
        locales: ['C'],
        shows: ['C', 'C'],
    },
    {
        row: 'script-in-territory',
        rule: 'only the first underscore splits the language, so a script glued on stays in the territory part',
        locales: ['zh_Hant_TW.UTF-8'],
        shows: ['zh_Hant_TW.UTF-8', 'zh_Hant_TW', 'zh.UTF-8', 'zh', 'C'],
    },
];

export const GLIB_LANGUAGE_TAG_ROWS = ['region', 'list', 'script', 'm49', 'extension', 'private', 'none'] as const;

export type GLibLanguageTagRow = (typeof GLIB_LANGUAGE_TAG_ROWS)[number];

export interface GLibLanguageTagVector {
    readonly row: GLibLanguageTagRow;
    readonly rule: string;
    readonly tags: readonly string[];
    readonly shows: readonly string[];
}

export const GLIB_LANGUAGE_TAG_VECTORS: readonly GLibLanguageTagVector[] = [
    {
        row: 'region',
        rule: 'language-REGION becomes language_REGION, then the bare language, then C',
        tags: ['pt-BR'],
        shows: ['pt_BR', 'pt', 'C'],
    },
    {
        row: 'list',
        rule: 'a repeated language is listed once, first occurrence wins, C stays last',
        tags: ['de-DE', 'de', 'en-US'],
        shows: ['de_DE', 'de', 'en_US', 'en', 'C'],
    },
    {
        row: 'script',
        rule: 'the script has no POSIX slot and is dropped, the region stays',
        tags: ['zh-Hant-TW', 'sr-Latn-RS'],
        shows: ['zh_TW', 'zh', 'sr_RS', 'sr', 'C'],
    },
    {
        row: 'm49',
        rule: 'a UN M.49 region has no POSIX territory: the language stands alone',
        tags: ['es-419'],
        shows: ['es', 'C'],
    },
    {
        row: 'extension',
        rule: 'extensions and variants after the region are dropped',
        tags: ['de-DE-u-ca-gregory', 'sl-rozaj'],
        shows: ['de_DE', 'de', 'sl', 'C'],
    },
    {
        row: 'private',
        rule: 'und, private use and grandfathered tags name no language and are skipped',
        tags: ['und', 'x-private', 'i-klingon', 'fr'],
        shows: ['fr', 'C'],
    },
    {
        row: 'none',
        rule: 'no tag at all answers just C',
        tags: [],
        shows: ['C'],
    },
];

export async function driveGLibLanguageVectors(
    subject: GLibLanguageSubject,
    harness: ConstructHarness,
    vectors: readonly GLibLanguageVector[] = GLIB_LANGUAGE_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: GLib language names`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, () => {
                const observed = subject.withLocales(vector.locales, () => subject.GLib.get_language_names());
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}

export async function driveGLibLanguageTagVectors(
    subject: GLibLanguageTagSubject,
    harness: ConstructHarness,
    vectors: readonly GLibLanguageTagVector[] = GLIB_LANGUAGE_TAG_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: GLib language names from BCP 47 tags`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, () => {
                const observed = subject.withTags(vector.tags, () => subject.GLib.get_language_names());
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
