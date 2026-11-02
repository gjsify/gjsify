// `initLocale` on NativeScript — the `nativescript` condition of `./locale`. One condition
// serves both platforms (ADR 0032 § 9's umbrella has no NS-platform split), so this file must
// not assume Android even though its catalogue-staging story (below) is Android's.
//
// The GNOME `locale.ts` cannot run here: it reads GLib's environment, adopts the process locale
// with `setlocale`, and resolves a `gjsify ship` directory that does not exist inside an APK.
// What an Android app has instead is the `.mo` tree the build stages as assets
// (`nativescriptLocale`), which NativeScript extracts to `<filesDir>/app/locale`, and a libintl
// reader (gi-runtime-android) that re-reads `LANGUAGE` on EVERY lookup and never calls
// `setlocale`. So: bind the extracted directory, and re-derive `LANGUAGE` when the user switches
// the system language — nothing about the lookup itself is cached.
//
// `gettext` is the GJS built-in's name, exactly as in `locale.ts`: `--app nativescript` aliases it
// to `@gjsify/node-gi/gettext`, so this package carries no dependency on the experimental bridge
// (ADR 0005 — the build injection is the sanctioned seam). The `LANGUAGE` bridge, including
// following a system language switch, lives in node-gi's NativeScript host.

import Gettext from 'gettext';

import type { InitLocaleOptions, Translator } from './locale.js';

// The runtime class hands out the Application without `@nativescript/core` — the same route
// node-gi's host takes to find the app dir, so this file adds no dependency on the core package.
declare const com: { tns?: { NativeScriptApplication?: { getInstance(): AndroidApplication | null } } } | undefined;

interface AndroidApplication {
    getFilesDir(): { getPath(): string } | null;
}

// `typeof` first: `com` is an Android-only global (Java's package namespace), absent — not
// merely `undefined` — on iOS, and `com?.tns` still READS the undeclared identifier before its
// `?.` ever runs, throwing `ReferenceError: com is not defined` at the first lookup instead of
// returning `null` as every other platform-less caller here expects. Measured on Learn6502's
// iOS build, 2026-11-02 (crashed on `initLocale`, the app's own first call after `setTranslator`).
function application(): AndroidApplication | null {
    return typeof com === 'undefined' ? null : (com?.tns?.NativeScriptApplication?.getInstance() ?? null);
}

/** Where the build stages the catalogues: `<filesDir>/app/locale`, or `undefined` before the Application exists. */
export function localeDir(): string | undefined {
    const filesDir = application()?.getFilesDir()?.getPath();
    return filesDir === undefined ? undefined : `${filesDir}/app/locale`;
}

export type { InitLocaleOptions, Translator };

export function initLocale(domain: string, options: InitLocaleOptions = {}): Translator {
    const dir = options.localeDir ?? localeDir();
    // Bound only when a directory exists, as on GNOME: an unbound domain answers every lookup
    // with its msgid, and `Translator.localeDir` says `undefined` instead of naming a path.
    if (dir !== undefined) Gettext.bindtextdomain(domain, dir);
    Gettext.textdomain(domain);

    return Object.assign((msgid: string): string => Gettext.dgettext(domain, msgid), {
        plural: (singular: string, plural: string, n: number): string => Gettext.dngettext(domain, singular, plural, n),
        context: (context: string, msgid: string): string => Gettext.dpgettext(domain, context, msgid),
        localeDir: dir,
        domain,
    });
}
