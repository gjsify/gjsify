// The GLib language-names core against the shared vectors (real GJS is the oracle for the POSIX ones,
// in `glib-language.gjs.spec.ts`; the tag rule has no GLib input to be compared with).

import { describe, expect, it } from '@gjsify/unit';

import {
    GLIB_LANGUAGE_TAG_VECTORS,
    GLIB_LANGUAGE_VECTORS,
    driveGLibLanguageTagVectors,
    driveGLibLanguageVectors,
} from './conformance/glib-language.js';
import { computeLanguageNames, languageNamesFromTags, localeFromLanguageTag } from './glib-language.js';

export default async () => {
    let locales: readonly string[] = [];
    await driveGLibLanguageVectors(
        {
            name: 'adwaita-core',
            isOracle: false,
            GLib: { get_language_names: () => computeLanguageNames(locales) },
            withLocales: (next, read) => {
                locales = next;
                return read();
            },
        },
        { describe, it, expect },
        GLIB_LANGUAGE_VECTORS,
    );

    let tags: readonly string[] = [];
    await driveGLibLanguageTagVectors(
        {
            name: 'adwaita-core',
            isOracle: false,
            GLib: { get_language_names: () => languageNamesFromTags(tags) },
            withTags: (next, read) => {
                tags = next;
                return read();
            },
        },
        { describe, it, expect },
        GLIB_LANGUAGE_TAG_VECTORS,
    );

    await describe('adwaita-core: GLib language names', async () => {
        await it('expands a colon list inside one entry like LANGUAGE', () => {
            expect(computeLanguageNames(['de_DE:en']).join(',')).toBe('de_DE,de,en,C');
        });
        await it('skips empty entries and answers C for no locale at all', () => {
            expect(computeLanguageNames(['', 'de::en']).join(',')).toBe('de,en,C');
            expect(computeLanguageNames([]).join(',')).toBe('C');
        });
        await it('reads a tag spelled with underscores or a POSIX tail', () => {
            expect(localeFromLanguageTag('de_DE')).toBe('de_DE');
            expect(localeFromLanguageTag('de_DE.UTF-8@euro')).toBe('de_DE');
            expect(localeFromLanguageTag('EN-us')).toBe('en_US');
        });
        await it('names no language for what is not one', () => {
            expect(localeFromLanguageTag('C')).toBe(null);
            expect(localeFromLanguageTag('POSIX')).toBe(null);
            expect(localeFromLanguageTag('')).toBe(null);
        });
    });
};
