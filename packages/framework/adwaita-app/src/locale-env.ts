// WHICH `LANG` an app needs when the environment names no locale — decided without touching
// the platform. Import-free like `locale-dir.ts`, so Node exercises every answer.
//
// WHY THIS EXISTS: gettext reads ONLY environment variables (`LANGUAGE`, `LC_ALL`,
// `LC_MESSAGES`, `LANG`) on Windows, and a double-clicked app or a `.cmd` launcher sets none of
// them, so `setlocale(LC_ALL, '')` stays "C" and a de-DE desktop shows English. Linux desktop
// sessions always export `LANG`; macOS needs nothing, because gettext there falls back to the
// `AppleLanguages` preference (so an app started from Finder is translated too). Win32 is the
// only platform with the gap, and `localeEnvToSet` answers `undefined` everywhere else.
//
// THE PLATFORM IS A PARAMETER, never read here (see `locale-dir.ts`).

/** The variables gettext consults, in its own precedence order. */
export const LOCALE_ENV_VARS: readonly string[] = ['LANGUAGE', 'LC_ALL', 'LC_MESSAGES', 'LANG'];

/**
 * A BCP 47 tag (`de-DE`, `zh-Hans-CN`) or a POSIX locale (`de_DE.UTF-8`) as `ll[_CC]`, or
 * `undefined` for "C"/"POSIX"/garbage — a value that must not be written into `LANG`.
 *
 * The script subtag and any extension (`-u-ca-…`) are dropped: gettext catalogues are named
 * `ll_CC`, so `zh-Hant-TW` must become `zh_TW`.
 */
export function posixLocale(tag: string | undefined): string | undefined {
    if (tag === undefined) return undefined;
    const base = tag
        .trim()
        .split(/[.@]/)[0]
        .split(/-u-|-x-/i)[0];
    const [language, ...rest] = base.split(/[-_]/);
    if (!/^[A-Za-z]{2,3}$/.test(language ?? '')) return undefined;
    if (/^(c|posix)$/i.test(language)) return undefined;
    const region = rest.find((part) => /^[A-Za-z]{2}$/.test(part));
    return region === undefined ? language.toLowerCase() : `${language.toLowerCase()}_${region.toUpperCase()}`;
}

export interface LocaleEnvOptions {
    /** `process.platform`. Anything but `win32` answers `undefined`. */
    platform?: string;
    /** The current values of {@link LOCALE_ENV_VARS}. */
    env: Record<string, string | undefined>;
    /** The user's locale, best source first — a BCP 47 tag or a POSIX name. */
    userLocales: readonly (string | undefined)[];
}

/**
 * The value to export as `LANG`, or `undefined` for "leave the environment alone".
 *
 * Only on win32, and only when all four variables are unset or empty: a user who set any of
 * them chose a locale, and this must never override it.
 */
export function localeEnvToSet(options: LocaleEnvOptions): string | undefined {
    if (options.platform !== 'win32') return undefined;
    if (LOCALE_ENV_VARS.some((name) => (options.env[name] ?? '').trim() !== '')) return undefined;
    for (const candidate of options.userLocales) {
        const locale = posixLocale(candidate);
        if (locale !== undefined) return locale;
    }
    return undefined;
}
