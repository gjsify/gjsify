// `GLib.get_language_names()` for a host that has no `LANGUAGE` / `LC_MESSAGES` / `LANG`: the browser
// (`navigator.languages`) and NativeScript (Android `LocaleList`, iOS `NSLocale.preferredLanguages`).
// There is no ICU on NativeScript, so `Intl` is not an answer there; this is the GLib way to ask
// "what does the user speak, best first".
//
// Two halves, both pure:
//
//   · `computeLanguageNames(locales)` is `g_get_language_names` over a list of POSIX locales —
//     what GLib does with `LANGUAGE=a:b:c`. For each entry it emits the variants (`append_locale_variants`),
//     most specific first, then appends `"C"`. Ported from GLib glib/gcharset.c, and held to real GLib by
//     `GLIB_LANGUAGE_VECTORS`, which run on `gi://GLib` itself.
//   · `languageNamesFromTags(tags)` is the host half: BCP 47 tags in, POSIX locales out, then the above.
//
// FAITHFUL TO GLIB, quirks included: nothing is deduplicated (`["C"]` gives `["C", "C"]`, `["de_DE", "de"]`
// gives `de_DE, de, de, C`), because GLib does not. Two deliberate differences, both for a list a HOST
// wrote rather than a person typing `LANGUAGE=`:
//   · an empty entry is skipped (GLib would emit `""`);
//   · `/usr/share/locale/locale.alias` is not consulted — there is no such file here.
//
// `languageNamesFromTags` DOES drop repeats (first occurrence wins, `"C"` stays last): a browser's
// `["de-DE", "de"]` is the normal shape of the list, not a typo, and `de_DE, de, de, C` would hand a
// caller walking the list the same candidate twice.
//
// BCP 47 → POSIX (`localeFromLanguageTag`): `language[-script][-region][-variant…][-extension…]` becomes
// `language[_REGION]` and nothing else.
//   · The language is 2 or 3 ASCII letters, lowercased. `und`, private-use (`x-…`) and grandfathered
//     tags (`i-klingon`) have no POSIX spelling and yield `null`.
//   · The script (`Hant`, `Latn`) is DROPPED. POSIX has no script slot; the nearest thing is a modifier
//     (`sr_RS@latin`), but that table is glibc's and is not derivable from the tag, so inventing one
//     would put a name in the list no catalogue is installed under. `zh-Hant-TW` is `zh_TW` (the
//     territory already picks the script there); `sr-Latn-RS` is `sr_RS`.
//   · The region is 2 ASCII letters, uppercased. A UN M.49 region (`es-419`) has no POSIX territory, so
//     it is dropped and the language stands alone.
//   · Variants, extensions (`-u-ca-gregory`) and private use after them are dropped.
//   · `_` is accepted as the separator too (Android's `Locale.toString()` and some Linux hosts), and a
//     POSIX codeset or modifier (`de_DE.UTF-8`, `@euro`) is not a language tag and is cut off.
//
// Reference: GLib glib/gcharset.c (explode_locale, append_locale_variants, g_get_language_names_with_category)
// Copyright (c) GNOME contributors (GLib). LGPLv2.1+.

const COMPONENT_CODESET = 1;
const COMPONENT_TERRITORY = 2;
const COMPONENT_MODIFIER = 4;

function isAsciiLetters(text: string, minLength: number, maxLength: number): boolean {
    if (text.length < minLength || text.length > maxLength) return false;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i) | 0x20;
        if (code < 0x61 || code > 0x7a) return false;
    }
    return true;
}

/** `append_locale_variants`: every combination of the optional parts, most specific first. */
function localeVariants(locale: string): string[] {
    const uscore = locale.indexOf('_');
    let dot = locale.indexOf('.', uscore >= 0 ? uscore : 0);
    let at = locale.indexOf('@', dot >= 0 ? dot : uscore >= 0 ? uscore : 0);

    let mask = 0;
    let modifier = '';
    let codeset = '';
    let territory = '';

    if (at >= 0) {
        mask |= COMPONENT_MODIFIER;
        modifier = locale.slice(at);
    } else {
        at = locale.length;
    }

    if (dot >= 0 && dot < at) {
        mask |= COMPONENT_CODESET;
        codeset = locale.slice(dot, at);
    } else {
        dot = at;
    }

    let languageEnd = uscore;
    if (uscore >= 0 && uscore < dot) {
        mask |= COMPONENT_TERRITORY;
        territory = locale.slice(uscore, dot);
    } else {
        languageEnd = dot;
    }

    const language = locale.slice(0, languageEnd);
    const variants: string[] = [];
    for (let i = mask; i >= 0; i--) {
        if ((i & ~mask) !== 0) continue;
        variants.push(
            language +
                (i & COMPONENT_TERRITORY ? territory : '') +
                (i & COMPONENT_CODESET ? codeset : '') +
                (i & COMPONENT_MODIFIER ? modifier : ''),
        );
    }
    return variants;
}

/**
 * `g_get_language_names()` over the POSIX locales `locales` (what `LANGUAGE=a:b:c` would hold, each
 * entry itself `language[_territory][.codeset][@modifier]`): the variants of each in order, then `"C"`.
 * An entry holding a colon list is expanded like GLib's `LANGUAGE` is.
 */
export function computeLanguageNames(locales: readonly string[]): string[] {
    const names: string[] = [];
    for (const entry of locales) {
        for (const locale of entry.split(':')) {
            if (locale === '') continue;
            for (const variant of localeVariants(locale)) names.push(variant);
        }
    }
    names.push('C');
    return names;
}

/** A BCP 47 tag as the POSIX locale `language[_REGION]`, or `null` when it names none. See the header. */
export function localeFromLanguageTag(tag: string): string | null {
    // A POSIX codeset or modifier glued on (`de_DE.UTF-8@euro`) is not part of a language tag.
    const parts = tag.split(/[.@]/)[0].split(/[-_]/);
    const language = parts[0];
    if (!isAsciiLetters(language, 2, 3) || language.toLowerCase() === 'und') return null;

    const lead = language.toLowerCase();
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        // The script comes before the region; it is skipped, never kept.
        if (isAsciiLetters(part, 4, 4)) continue;
        if (isAsciiLetters(part, 2, 2)) return `${lead}_${part.toUpperCase()}`;
        // A UN M.49 region, a variant, an extension singleton, an extlang: no POSIX territory follows.
        break;
    }
    return lead;
}

/**
 * The names a host that speaks in BCP 47 tags (`navigator.languages`, `NSLocale.preferredLanguages`)
 * answers `get_language_names()` with: each tag as a POSIX locale, variants most specific first, no
 * repeats, `"C"` last. No tag names a language: just `["C"]`.
 */
export function languageNamesFromTags(tags: readonly string[]): string[] {
    const locales: string[] = [];
    for (const tag of tags) {
        const locale = typeof tag === 'string' ? localeFromLanguageTag(tag) : null;
        if (locale !== null) locales.push(locale);
    }

    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of computeLanguageNames(locales)) {
        if (name === 'C' || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
    }
    names.push('C');
    return names;
}
