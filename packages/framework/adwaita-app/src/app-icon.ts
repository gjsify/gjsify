// The GTK half of "an app run from its build tree still finds its own icon".
// The decision of WHERE the icons live is `app-icon-dir.ts`; this adds the result to a theme.

import GLib from 'gi://GLib?version=2.0';
import type Gtk from 'gi://Gtk?version=4.0';

import { type ResolveIconDirOptions, bundleDirFromUrl, resolveIconDir } from './app-icon-dir.js';

export interface AddAppIconDirOptions extends Pick<ResolveIconDirOptions, 'iconDir'> {
    /** Where the upward search starts. Defaults to the directory of this module's bundle. */
    startDir?: string;
}

/**
 * Make `iconName` resolvable on `theme`, adding the app's `data/icons` when the theme lacks it.
 *
 * Returns whether a directory was added. `false` is the normal answer for a packaged install,
 * whose launcher exports `XDG_DATA_DIRS` so the theme already has the icon: nothing is touched
 * there. Call it before anything asks the theme for the name, since `Gtk.IconTheme` caches a
 * lookup.
 */
export function addAppIconDir(theme: Gtk.IconTheme, iconName: string, options: AddAppIconDirOptions = {}): boolean {
    if (theme.has_icon(iconName)) return false;
    const dir = resolveIconDir({
        iconDir: options.iconDir,
        env: { GJSIFY_ICON_DIR: GLib.getenv('GJSIFY_ICON_DIR') ?? undefined },
        // In a bundle, `import.meta.url` of this module is the app bundle itself. A non-`file:`
        // URL (a resource) has no directory to search from, so the search is skipped.
        startDir: options.startDir ?? bundleDirFromUrl(import.meta.url),
        isDirectory: (path) => GLib.file_test(path, GLib.FileTest.IS_DIR),
    });
    if (dir === undefined) return false;
    theme.add_search_path(dir);
    return true;
}
