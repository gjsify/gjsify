// `initLocale` on NativeScript / Android — the `nativescript` condition of `./locale`.
//
// The GNOME `locale.ts` cannot run here: it reads GLib's environment, adopts the process locale
// with `setlocale`, and resolves a `gjsify ship` directory that does not exist inside an APK.
// What an Android app has instead is the `.mo` tree the build stages as assets
// (`nativescriptLocale`), which NativeScript extracts to `<filesDir>/app/locale`, and a libintl
// reader (gi-runtime-android) that re-reads `LANGUAGE` on EVERY lookup and never calls
// `setlocale`. So: bind the extracted directory, and re-derive `LANGUAGE` when the user switches
// the system language — nothing about the lookup itself is cached.
//
// Measured on a Galaxy S9 (de-DE → en-US → de-DE), see the PR description.

import Gettext, { refreshLocale } from '@gjsify/node-gi/gettext';

import type { InitLocaleOptions, Translator } from './locale.js';

// The runtime class hands out the Application without `@nativescript/core` — the same route
// node-gi's host takes to find the app dir, so this file adds no dependency on the core package.
declare const com: { tns?: { NativeScriptApplication?: { getInstance(): AndroidApplication | null } } } | undefined;
declare const android:
    | {
          content?: { ComponentCallbacks2?: new (impl: object) => unknown };
      }
    | undefined;

interface AndroidApplication {
    getFilesDir(): { getPath(): string } | null;
    registerComponentCallbacks(callbacks: unknown): void;
}

function application(): AndroidApplication | null {
    return com?.tns?.NativeScriptApplication?.getInstance() ?? null;
}

/** Where the build stages the catalogues: `<filesDir>/app/locale`, or `undefined` before the Application exists. */
export function localeDir(): string | undefined {
    const filesDir = application()?.getFilesDir()?.getPath();
    return filesDir === undefined ? undefined : `${filesDir}/app/locale`;
}

let watching = false;

/**
 * Call `refreshLocale()` when the system configuration changes — a language switch is one. The
 * Application-level callback fires whether or not the activity handles `locale` itself.
 */
function followSystemLocale(): void {
    if (watching) return;
    const app = application();
    const ComponentCallbacks2 = android?.content?.ComponentCallbacks2;
    if (!app || !ComponentCallbacks2) return;
    app.registerComponentCallbacks(
        new ComponentCallbacks2({
            onConfigurationChanged: () => {
                refreshLocale();
            },
            onLowMemory: () => {},
            onTrimMemory: () => {},
        }),
    );
    watching = true;
}

export type { InitLocaleOptions, Translator };

export function initLocale(domain: string, options: InitLocaleOptions = {}): Translator {
    const dir = options.localeDir ?? localeDir();
    refreshLocale();
    // Bound only when a directory exists, as on GNOME: an unbound domain answers every lookup
    // with its msgid, and `Translator.localeDir` says `undefined` instead of naming a path.
    if (dir !== undefined) Gettext.bindtextdomain(domain, dir);
    Gettext.textdomain(domain);
    followSystemLocale();

    return Object.assign((msgid: string): string => Gettext.dgettext(domain, msgid), {
        plural: (singular: string, plural: string, n: number): string => Gettext.dngettext(domain, singular, plural, n),
        context: (context: string, msgid: string): string => Gettext.dpgettext(domain, context, msgid),
        localeDir: dir,
        domain,
    });
}
