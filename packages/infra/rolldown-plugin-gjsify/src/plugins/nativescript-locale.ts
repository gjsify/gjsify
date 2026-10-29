// Compile an app's `po/` into `locale/<lang>/LC_MESSAGES/<domain>.mo` ASSETS of the bundle.
//
// On Android the GLib gettext (gi-runtime-android's libintl reader) opens the catalog from the
// real filesystem, and NativeScript extracts `assets/app/**` to `<filesDir>/app/**`. So the `.mo`
// tree has to ride along in the staging dir the NS build copies — emitted as assets rather than
// written beside the output, because Vite's `emptyOutDir` wipes anything written before the
// bundle. The runtime resolves the same directory with `localeDir` (`@gjsify/adwaita-app/locale`).

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { findAvailableLanguages, planCatalogNames } from '@gjsify/vite-plugin-gettext';
import type { Plugin } from 'rolldown';

const run = promisify(execFile);

export const NATIVESCRIPT_LOCALE_PLUGIN = 'gjsify-nativescript-locale';

/** Directory below the app root (`<filesDir>/app`) that holds the catalogs. */
export const NATIVESCRIPT_LOCALE_DIR = 'locale';

export interface NativescriptLocaleOptions {
    /** Directory with the `<lang>.po` catalogs. */
    poDirectory: string;
    /** gettext domain — the `.mo` file name, and what the app passes to `bindtextdomain`. */
    domain: string;
    /** Output names for catalogs the built-in table does not know, as in `gettextPlugin`. */
    localeNames?: Record<string, readonly string[]>;
}

export interface LocaleAsset {
    fileName: string;
    source: Uint8Array;
}

/** `msgfmt` with an argv array (no shell); `-o -` streams the `.mo` to stdout. */
export async function msgfmtToBuffer(poFile: string): Promise<Uint8Array> {
    const { stdout } = await run('msgfmt', ['--output-file=-', poFile], {
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
}

export async function collectLocaleAssets(
    options: NativescriptLocaleOptions,
    compile: (poFile: string) => Promise<Uint8Array> = msgfmtToBuffer,
): Promise<LocaleAsset[]> {
    if (!existsSync(options.poDirectory)) {
        throw new Error(`${NATIVESCRIPT_LOCALE_PLUGIN}: PO directory ${options.poDirectory} does not exist`);
    }
    const languages = await findAvailableLanguages(options.poDirectory, NATIVESCRIPT_LOCALE_PLUGIN, false);
    const plans = planCatalogNames(languages, {
        pluginName: NATIVESCRIPT_LOCALE_PLUGIN,
        namespace: 'posix',
        localeNames: options.localeNames,
    });

    const assets: LocaleAsset[] = [];
    for (const plan of plans) {
        const source = await compile(join(options.poDirectory, `${plan.catalog}.po`));
        for (const dir of plan.posix) {
            assets.push({
                fileName: `${NATIVESCRIPT_LOCALE_DIR}/${dir}/LC_MESSAGES/${options.domain}.mo`,
                source,
            });
        }
    }
    return assets;
}

export function nativescriptLocalePlugin(options: NativescriptLocaleOptions): Plugin {
    return {
        name: NATIVESCRIPT_LOCALE_PLUGIN,
        async generateBundle() {
            for (const asset of await collectLocaleAssets(options)) {
                this.emitFile({ type: 'asset', fileName: asset.fileName, source: asset.source });
            }
        },
    };
}
