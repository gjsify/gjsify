// BINDING an app's translations — the reading half of ADR 0024 § A8–A10.
//
// `gjsify ship` stages compiled catalogues into `share/locale/` and its launcher exports
// `GJSIFY_LOCALE_DIR`, because only the launcher knows whether the payload became `/usr` in a
// `.deb`, a `--prefix` tree, or `/app` in a Flatpak. This is the side that reads it, and it lives
// here rather than in each app because the interesting part is not the four calls — it is their
// ORDER and the default domain.
//
// WHY `textdomain()` IS SET, not only `dgettext()` used: GtkBuilder resolves every
// `translatable="yes"` string — so everything coming out of a `.blp` file — in the DEFAULT domain,
// inside GTK, where the app never gets the chance to pass one. Binding only via `dgettext` would
// translate the TypeScript strings and leave the Blueprint ones in the source language, which
// reads as a half-finished translation rather than as a missing call.

// MEASURED against a real compiled catalogue (gettext 0.26, GJS 1.88.1), because "the calls did
// not throw" is not evidence that a lookup resolves — an untranslated UI is indistinguishable from
// an app that has no translation:
//   de_DE.utf8 + a bound dir -> "Aufbau", and n=1/n=3 pick "%d Schicht"/"%d Schichten"
//   en_US.utf8 + a bound dir -> the msgids, i.e. English needs no catalogue of its own
//   no GJSIFY_LOCALE_DIR     -> /usr/share/locale, msgids returned (never the current directory)
// A msgid absent from the catalogue came back unchanged in all three.
// That third line is a LINUX measurement and stays one: `systemLocaleDir` answers darwin and
// win32 with no directory at all, so there the domain is left unbound and the msgids come back
// without a directory having been named. Same observable result, no invented path.

import GLib from 'gi://GLib?version=2.0';
import Gettext from 'gettext';

import { resolveLocaleDir, type ResolveLocaleDirOptions } from './locale-dir.js';

export type InitLocaleOptions = Omit<ResolveLocaleDirOptions, 'env'>;

/** A domain-bound lookup. Callable for the common case; `plural`/`context` for the rest. */
export interface Translator {
    (msgid: string): string;
    /** `n`-aware lookup. Pass the untranslated singular and plural. */
    plural(singular: string, plural: string, n: number): string;
    /** Disambiguating lookup, for a msgid whose meaning depends on where it appears. */
    context(context: string, msgid: string): string;
    /**
     * The bound directory and domain — for a diagnostic line, never for a lookup.
     *
     * `undefined` when nothing was bound: no catalogues were staged and the platform has no
     * system directory either (macOS, Windows). Every lookup then returns its msgid.
     */
    readonly localeDir: string | undefined;
    readonly domain: string;
}

/**
 * Bind `domain` and return its lookup function.
 *
 * Safe to call when no catalogue exists: gettext then returns each msgid unchanged, which is why
 * the msgids themselves must be the source language rather than keys.
 */
export function initLocale(domain: string, options: InitLocaleOptions = {}): Translator {
    const localeDir = resolveLocaleDir({
        ...options,
        env: { GJSIFY_LOCALE_DIR: GLib.getenv('GJSIFY_LOCALE_DIR') ?? undefined },
        // THIS is the impure side, so the `process` read belongs here rather than in
        // `locale-dir.ts`. Guarded because a GJS bundle built with `--globals none` has no
        // `process` at all, and `systemLocaleDir` reads an absent platform as "leave it alone".
        platform: typeof process === 'undefined' ? undefined : (process.platform as string | undefined),
    });

    // Adopt the environment's locale. `gtk_init()` does this too, but a CLI sharing the app's
    // kernel translates before any GTK call exists and would otherwise stay in the C locale.
    Gettext.setlocale(Gettext.LocaleCategory.ALL, '');
    // NOT bound when there is no directory — on macOS and Windows, an app carrying no catalogues
    // of its own has nowhere to be bound TO. `bindtextdomain(domain, <a path that resolves but
    // holds nothing>)` is indistinguishable from a working binding until a lookup silently
    // returns its msgid; leaving the domain unbound reaches the same msgid by the honest route
    // and lets `Translator.localeDir` say `undefined` instead of naming a directory.
    if (localeDir !== undefined) Gettext.bindtextdomain(domain, localeDir);
    Gettext.textdomain(domain);

    return Object.assign((msgid: string): string => Gettext.dgettext(domain, msgid), {
        plural: (singular: string, plural: string, n: number): string => Gettext.dngettext(domain, singular, plural, n),
        context: (context: string, msgid: string): string => Gettext.dpgettext(domain, context, msgid),
        localeDir,
        domain,
    });
}
