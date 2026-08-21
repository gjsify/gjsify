// SPDX-License-Identifier: MIT
// Where a win32 bundle's `loaders.cache` says its gdk-pixbuf loader modules ARE — and
// the assertion that the answer resolves inside the bundle.
//
// THE DEFECT (#996, measured on the published gtk-runtime-win32-x64 windowing bundle).
// The builder rewrote every module line of the query tool's output down to a BARE LEAF
// — `"pixbufloader_svg.dll"` — on the stated theory that "gdk-pixbuf resolves the DLL
// paths in it relative to GDK_PIXBUF_MODULEDIR when set (node-gi sets it)". That theory
// is false, and reading gdk-pixbuf 2.44.6 (the version gvsbuild 2026.6.0 pins) says so
// twice over:
//
//   • gdk-pixbuf-io.c `build_module_path()` — the ONLY thing that touches a relative
//     cache entry — joins it with `gdk_pixbuf_get_toplevel()`, which on win32 is the
//     package installation directory of the gdk_pixbuf DLL, i.e. the parent of `bin/`.
//     So the leaf resolved to `<bundle>\pixbufloader_svg.dll`, where nothing has ever
//     been written.
//   • `GDK_PIXBUF_MODULEDIR` is read by queryloaders.c, the GENERATOR, where it only
//     picks which directory to scan. The runtime library reads exactly one variable,
//     `GDK_PIXBUF_MODULE_FILE`. Setting MODULEDIR could not have helped.
//
// Every SVG icon in every win32 windowing bundle since PR #774 therefore failed to
// decode, and nothing noticed: PNG/JPEG/GIF/TIFF are `-Dbuiltin_loaders=all` inside
// gdk_pixbuf-2.0-0.dll and never consult the cache at all, the cache still PARSES so
// `Pixbuf.get_formats()` still advertises `svg`, and the gate was a `Test-Path` on the
// cache file. A window renders; its symbolic icons just come back empty. That is the
// same shape as the darwin half of #996 — a file count standing in for a capability —
// and it took the decode probe to see either.
//
// WHY THE TOOL DID NOT WRITE THIS ITSELF: queryloaders.c writes
// `get_relative_path(get_toplevel(), path)` and falls back to the absolute path when
// that returns NULL. The tool runs out of the gvsbuild prefix, so the staged bundle is
// not under ITS toplevel and the fallback is what we get. Rewriting is right; rewriting
// to a leaf was not.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Where the builder stages the loader modules, relative to the bundle toplevel. */
export const LOADERS_SUBDIR = 'lib/gdk-pixbuf-2.0/2.10.0/loaders';

/**
 * A module line in a loaders.cache: a line that is ONE quoted string ending in `.dll`.
 * Every other line in the format leads with a quoted token too (`"svg" 6 "gdk-pixbuf" …`),
 * so "nothing but the quoted path" is what distinguishes them.
 */
const MODULE_LINE = /^"(.*?)"[ \t]*(\r?)$/;

/** Does this quoted token name a loader module rather than a mime type or a format? */
const isModulePath = (value) => /\.dll$/i.test(value);

/**
 * Rewrite every module line to a path relative to the BUNDLE TOPLEVEL, which is what
 * `build_module_path()` will join it against.
 *
 * FORWARD SLASHES, deliberately, and this is not a style choice. `scan_string()` runs
 * the quoted token through `g_strcompress()`, so a single backslash is an ESCAPE: the
 * honest Windows spelling `lib\gdk-pixbuf-2.0\2.10.0\loaders\…` contains `\2`, which
 * g_strcompress reads as the start of an OCTAL escape and silently mangles. Doubling
 * every backslash would also work and is what the native tool emits; forward slashes
 * need no escaping at all, and Windows accepts them in `LoadLibraryW` and in
 * `g_path_is_absolute`, which is the only other thing that reads this string.
 *
 * PURE, so the win32 rewrite is driven from a Linux host — the same rule the rest of
 * this bundle's platform code follows.
 * @param {string} cache the query tool's raw output
 * @param {{ loadersSubdir?: string }} [options]
 * @returns {string}
 */
export function bundleRelativeLoaderCache(cache, { loadersSubdir = LOADERS_SUBDIR } = {}) {
    return cache
        .split('\n')
        .map((line) => {
            const match = MODULE_LINE.exec(line);
            if (!match || !isModulePath(match[1])) return line;
            // The token is g_strescape'd, so its separators are `\\` or `/`; the leaf
            // itself can contain neither.
            const leaf = match[1].split(/\\+|\//).pop();
            return `"${loadersSubdir}/${leaf}"${match[2]}`;
        })
        .join('\n');
}

/**
 * Every module line must name a file that EXISTS under the bundle, by the same rule
 * gdk-pixbuf will read it: relative to the toplevel.
 *
 * The mechanism, not the single fix. The bare leaf that shipped resolved to a path
 * nobody had written and the build passed, so the class this closes is "the cache names
 * a module the bundle does not have there" — an absolute build path (the query tool's
 * un-rewritten fallback, which resolves on the build host alone), a leaf, a stale
 * subdir, a loader the copy loop missed. The decode probe catches only the one format
 * it decodes; this reads every line.
 * @param {string} cache the cache as it will be written
 * @param {{ bundleDir: string }} options
 * @returns {string[]} empty iff every module line resolves inside the bundle
 */
export function loaderCacheProblems(cache, { bundleDir }) {
    const problems = [];
    const modules = cache
        .split('\n')
        .map((line) => MODULE_LINE.exec(line)?.[1])
        .filter((value) => value !== undefined && isModulePath(value));

    if (modules.length === 0) {
        problems.push(
            'loaders.cache names no loader module at all — gdk-pixbuf would fall back to its ' +
                'builtin formats, so every SVG icon in the bundle decodes to nothing',
        );
        return problems;
    }

    for (const modulePath of modules) {
        if (/^([A-Za-z]:)?[\\/]/.test(modulePath)) {
            problems.push(
                `loaders.cache names the ABSOLUTE path ${modulePath} — that is the query tool's ` +
                    'un-rewritten build path, which resolves on this machine and nowhere else',
            );
            continue;
        }
        if (!modulePath.includes('/') && !modulePath.includes('\\')) {
            problems.push(
                `loaders.cache names the bare leaf ${modulePath} — gdk-pixbuf joins a relative ` +
                    'cache path with the bundle TOPLEVEL (build_module_path), never with ' +
                    'GDK_PIXBUF_MODULEDIR, so this resolves to <bundle>/' +
                    `${modulePath} and no such file is ever written`,
            );
            continue;
        }
        const onDisk = join(bundleDir, modulePath.split('\\').join('/'));
        if (!existsSync(onDisk)) {
            problems.push(`loaders.cache names ${modulePath}, which does not exist under the bundle`);
        }
    }
    return problems;
}
