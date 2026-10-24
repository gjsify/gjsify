// SPDX-License-Identifier: MIT
// The GTK / libadwaita / GLib / GtkSourceView catalogs the darwin bundle ships.
//
// WHAT WAS MEASURED, in a published `.app` on macOS 27 / M4 under a sandbox that denies
// every read below /opt/homebrew and /usr/local:
//
//   lsof:  /opt/homebrew/Cellar/gtk4/4.24.1/share/locale/de/LC_MESSAGES/gtk40.mo
//          /opt/homebrew/Cellar/libadwaita/1.10.0/share/locale/de/LC_MESSAGES/libadwaita.mo
//   cause: those paths are COMPILED INTO libgtk-4 / libadwaita / libglib-2.0, so without
//          Homebrew the catalogs are simply absent and GTK's own strings (the file chooser,
//          the about dialog, Adw's widgets) stay in English under a German locale. No error,
//          no fallback message — the defect reads as an untranslated app.
//
// Homebrew ships one `.mo` per locale per domain under `share/locale/<lang>/LC_MESSAGES/`,
// and there is no `gtk4-locale` formula to install instead, so the bytes come from the same
// keg prefix the rest of the bundle is built from. Only the four domains the bundle's own
// libraries own are staged; a consumer's own gettext domain is the app's job (see
// packages/node-gi/node-gi/overrides/package.js `initGettext`).
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The domains the bundle's own libraries answer for, in priority order. */
export const DARWIN_LOCALE_DOMAINS = ['gtk40', 'libadwaita', 'glib20', 'gtksourceview-5'];

/**
 * Stage every locale Homebrew carries for the four domains above.
 *
 * @param {string} outDir bundle root (`…/gtk`)
 * @param {string} sourceLocaleDir Homebrew's `share/locale`
 * @returns {{ locales: string[], files: number }}
 */
export function stageDarwinLocale(outDir, sourceLocaleDir) {
    if (!existsSync(sourceLocaleDir)) {
        throw new Error(
            `stageDarwinLocale: ${sourceLocaleDir} does not exist — install gtk4/libadwaita/glib ` +
                'into the build prefix first.',
        );
    }
    const targetRoot = join(outDir, 'share', 'locale');
    let locales = 0;
    let files = 0;
    for (const lang of readdirSync(sourceLocaleDir)) {
        const srcMessages = join(sourceLocaleDir, lang, 'LC_MESSAGES');
        if (!existsSync(srcMessages) || !statSync(srcMessages).isDirectory()) continue;
        let wroteAny = false;
        for (const domain of DARWIN_LOCALE_DOMAINS) {
            const src = join(srcMessages, `${domain}.mo`);
            if (!existsSync(src)) continue;
            const destDir = join(targetRoot, lang, 'LC_MESSAGES');
            mkdirSync(destDir, { recursive: true });
            copyFileSync(src, join(destDir, `${domain}.mo`));
            files++;
            wroteAny = true;
        }
        if (wroteAny) locales++;
    }
    return { locales, files };
}
