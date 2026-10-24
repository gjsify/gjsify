// WHERE the app's own icon theme root (`<app>/data/icons`) lives — decided without touching GTK
// or the disk.
//
// Free of platform imports for the same reason `locale-dir.ts` is: the environment and the
// filesystem arrive as parameters, so the decision is exercised on Node as well as GJS.
// `application.ts` supplies the real ones and does the `add_search_path`. The one import is
// the shape-decided separator lookup, which needs no host either.
//
// THE HOLE THIS CLOSES. An app started straight from its build (`gjsify run dist/app.gjs.mjs`)
// has no launcher, so nothing exported `XDG_DATA_DIRS` and GTK never looks into the app's
// `data/icons/hicolor/...`. Measured: `Gtk.IconTheme.has_icon(appId)` was false and the About
// dialog drew an empty square; after `add_search_path('<repo>/data/icons')` it was true. A
// packaged build was never affected, since the `gjsify ship` launcher exports the variable.
// Every app carried its own copy of this search until it moved here.

import { lastPathSeparatorIndex } from '@gjsify/utils/core';

/** How many directories above the bundle are tried. Room to spare for `dist/app/x.gjs.mjs`. */
export const ICON_DIR_SEARCH_DEPTH = 6;

export interface ResolveIconDirOptions {
    /** Wins over everything: a dev tree, or a test fixture. */
    iconDir?: string;
    /** Environment to read `GJSIFY_ICON_DIR` from. */
    env?: Record<string, string | undefined>;
    /** Directory of the running bundle, where the upward search starts. Omitted skips the search. */
    startDir?: string;
    /** Whether a directory exists. Injected so the decision needs no disk. */
    isDirectory?: (path: string) => boolean;
}

/**
 * Resolve the app's icon theme root, or `undefined` when nothing names or contains one.
 *
 * Precedence: explicit option, then `GJSIFY_ICON_DIR`, then a bounded upward search from
 * `startDir` for `data/icons`. An EMPTY value counts as unset, as with `GJSIFY_LOCALE_DIR`:
 * `add_search_path('')` would add the current directory.
 *
 * The search is bounded because the bundle's depth below the app root differs by layout
 * (`src/frontends/desktop` is three levels, `dist/app` two). A fixed "one up" once landed in
 * the non-existent `dist/data`. Without an answer the caller adds nothing, which leaves the
 * theme exactly as it was.
 */
export function resolveIconDir(options: ResolveIconDirOptions = {}): string | undefined {
    const explicit = nonEmpty(options.iconDir) ?? nonEmpty(options.env?.GJSIFY_ICON_DIR);
    if (explicit !== undefined) return explicit;
    if (options.startDir === undefined || options.isDirectory === undefined) return undefined;
    return searchUp(options.startDir, options.isDirectory);
}

/** `dirname` of a `file:` URL, or `undefined` for any other scheme (or nothing). */
export function bundleDirFromUrl(url: string | undefined): string | undefined {
    if (url === undefined || !url.startsWith('file://')) return undefined;
    const path = decodeURIComponent(new URL(url).pathname);
    const cut = lastPathSeparatorIndex(path);
    if (cut < 0) return undefined;
    return cut === 0 ? '/' : path.slice(0, cut);
}

function searchUp(start: string, isDirectory: (path: string) => boolean): string | undefined {
    let dir = start;
    for (let up = 0; up < ICON_DIR_SEARCH_DEPTH; up++) {
        const candidate = `${dir === '/' ? '' : dir}/data/icons`;
        if (isDirectory(candidate)) return candidate;
        const cut = lastPathSeparatorIndex(dir);
        if (cut <= 0) {
            if (dir === '/') break;
            dir = '/';
        } else {
            dir = dir.slice(0, cut);
        }
    }
    return undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
}
