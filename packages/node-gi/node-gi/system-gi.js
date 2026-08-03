// SPDX-License-Identifier: MIT
// @gjsify/node-gi/system-gi — WHERE the host's GObject-Introspection stack keeps
// its shared libraries, so the dynamic loader can find the ones a typelib names
// by BARE LEAF (`libgtk-4.1.dylib`, `libgdk_pixbuf-2.0.0.dylib`, …).
//
// WHY THIS EXISTS — the failure it removes, measured on macOS 15.7.8 / Homebrew
// /usr/local / Node 24.18.1 / GTK 4.22.4, the first release that shipped a
// darwin-x64 addon:
//
//     GLib-GIRepository-WARNING: Failed to load shared library 'libgtk-4.1.dylib'
//       referenced by the typelib: dlopen(libgtk-4.1.dylib, 0x0009): tried:
//       'libgtk-4.1.dylib' (no such file), …, '/usr/lib/libgtk-4.1.dylib' (no such file)
//     TypeError: Gtk.DrawingArea is not a subclassable GObject type
//
// Everything WAS installed: `/usr/local/lib/libgtk-4.1.dylib` exists and
// `/usr/local/lib/girepository-1.0/Gtk-4.0.typelib` names exactly that leaf. The
// gap is the LOADER, not the installation — modern dyld does not carry
// `/usr/local/lib` in its default fallback search path, and a plain `node` has no
// rpath there (Homebrew's own `gjs` binary does, which is why `--runtime gjs`
// never showed this and `--runtime node` did). `gi_repository_require` resolves
// the typelib, `g_module_open('libgtk-4.1.dylib')` then fails, no
// `gtk_drawing_area_get_type` is ever registered, and the failure surfaces one
// layer up as "not a subclassable GObject type".
//
// The value CANNOT come from `pkg-config --variable=libdir gtk4`. Measured on the
// same host: that answers `/usr/local/Cellar/gtk4/4.22.4/lib` — a PER-FORMULA
// directory that fixes GTK and leaves `libgdk_pixbuf-2.0.0.dylib` (a different
// formula, so a different Cellar libdir) still unresolvable. What works is the
// directory every keg is symlinked into, `<prefix>/lib`, because it is the UNION.
// So the question this module answers is "which directories hold the GI stack",
// never "where is one library".
//
// THE RULE — a typelib and the library it names are SIBLINGS by GI's own install
// layout: `<libdir>/girepository-1.0/Gtk-4.0.typelib` beside
// `<libdir>/libgtk-4.1.dylib`. A directory holding `girepository-1.0/` therefore
// IS a GI library directory. That convention is what makes this
// package-manager-agnostic: it lands on `/usr/local/lib` (Homebrew x64),
// `/opt/homebrew/lib` (Homebrew arm64), `/opt/local/lib` (MacPorts) or a custom
// prefix without needing to know that any of them exist.
//
// PURE FUNCTION of injected host facts (platform / env / fs / pkg-config), like
// `hostTarget()` beside it and the CLI's `resolvePrebuildDirName()` — so the
// darwin branch is unit-testable from a Linux host and the host values are read
// only at the outermost call site, as defaults.
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Prefixes a macOS GI stack is installed under in practice — probed, never
 * assumed: each is accepted only when it actually holds a `girepository-1.0/`.
 *
 * This is the no-pkg-config safety net, and it is load-bearing rather than
 * belt-and-braces: `brew install gtk4` installs RUNTIME dependencies only, so a
 * user running a published showcase routinely has the entire GTK stack and no
 * `pkg-config` at all (it is a BUILD dependency of those formulae). The
 * pkg-config source below is the GENERAL mechanism — it is what finds a jhbuild
 * or otherwise bespoke prefix — but it cannot be the only one.
 * @type {Record<string, readonly string[]>}
 */
const PROBED_GI_LIBDIRS = {
    darwin: ['/opt/homebrew/lib', '/usr/local/lib', '/opt/local/lib'],
};

/** The subdir GI installs typelibs into — historically `1.0` even for the girepository-2.0 API. */
const TYPELIB_SUBDIR = 'girepository-1.0';

/** Memoized `pkg-config` answer: the spawn happens at most once per process. */
let pkgConfigDirsCache = null;

/**
 * Split an OS search-path variable, dropping empty segments.
 * @param {string | undefined} value
 * @param {string} [separator]
 * @returns {string[]}
 */
export function splitSearchPath(value, separator = ':') {
    return (value ?? '').split(separator).filter(Boolean);
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
function isDirectory(dir) {
    try {
        return statSync(dir).isDirectory();
    } catch {
        // Any stat failure means the same thing here — ENOENT on an uninstalled
        // prefix, EACCES on a path this process may not read: not a usable libdir.
        return false;
    }
}

/**
 * `pkg-config`'s OWN configured `.pc` search path plus `$PKG_CONFIG_PATH`. Every
 * entry is a `<libdir>/pkgconfig` (or `<datadir>/pkgconfig`) directory, so its
 * parent is a candidate libdir — which is how a prefix nobody hardcoded is
 * found. Measured on the reported host: `pc_path` =
 * `/usr/local/lib/pkgconfig:/usr/local/share/pkgconfig:/usr/lib/pkgconfig:…`,
 * whose first parent is exactly the `/usr/local/lib` that resolves every leaf.
 *
 * `spawnSync` reports a missing executable as `result.error`, not by throwing —
 * an absent `pkg-config` is expected on a runtime-only GTK install, so it is a
 * checked return value here and not an exception path.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]}
 */
export function pkgConfigSearchDirs(env) {
    if (pkgConfigDirsCache) return pkgConfigDirsCache;
    const dirs = splitSearchPath(env.PKG_CONFIG_PATH);
    // Lazily required, never imported at module top level: `index.js` deliberately
    // keeps node:child_process out of non-darwin module graphs because an eager
    // import tripped a Deno teardown regression on an unrelated conformance file.
    const { spawnSync } = require('node:child_process');
    const res = spawnSync('pkg-config', ['--variable=pc_path', 'pkg-config'], {
        encoding: 'utf8',
        timeout: 10_000,
    });
    if (!res.error && res.status === 0) dirs.push(...splitSearchPath(String(res.stdout).trim()));
    pkgConfigDirsCache = dirs;
    return dirs;
}

/**
 * Directories holding the host's system GObject-Introspection shared libraries —
 * most specific first, deduplicated, each verified on disk.
 *
 * Three sources, in precedence order:
 *   1. `GI_TYPELIB_PATH` — the host stating outright where typelibs live; the
 *      libraries are the sibling `dirname()`. Accepted on directory existence
 *      alone: an explicit statement is not second-guessed.
 *   2. `pkg-config`'s `.pc` search path → each `<dir>/pkgconfig`'s parent. The
 *      general mechanism (any prefix, including a custom one).
 *   3. {@link PROBED_GI_LIBDIRS} — the standard macOS prefixes, for the common
 *      case where GTK is installed and pkg-config is not.
 * Sources 2 and 3 are GUESSES at a prefix, so each must show the
 * `girepository-1.0/` marker before it is believed.
 *
 * Empty off darwin, and that is a statement about LOADERS, not about GI. Linux
 * resolves these leaves through `ld.so`'s system-wide configured cache
 * (`/etc/ld.so.conf.d`), which a package install populates — nothing per-process
 * is needed. dyld is the one loader that neither consults a system-wide config
 * NOR re-reads its search path after launch, which is why darwin needs a re-exec
 * and nobody else does.
 *
 * win32 is deliberately absent rather than proven unnecessary: `PATH` is the DLL
 * search path, a Windows GTK distribution puts its `bin` there itself, and
 * Windows re-reads that path at every `LoadLibrary` — so if a system GTK ever
 * turns out not to be on it, the repair is an in-process `process.env.PATH`
 * prepend (the shape `maybePrependGtkRuntimeDllPath()` already uses for the
 * bundle), never this re-exec. Untested there, and node-gi's win32 GTK support is
 * Phase 2 regardless.
 * @param {object} [opts]
 * @param {string} [opts.platform] defaults to `process.platform`
 * @param {NodeJS.ProcessEnv} [opts.env] defaults to `process.env`
 * @param {(dir: string) => boolean} [opts.existsDir] directory predicate (injectable for tests)
 * @param {(env: NodeJS.ProcessEnv) => string[]} [opts.searchDirs] pkg-config `.pc` dirs (injectable)
 * @returns {string[]} absolute directories, or `[]` when this platform's loader needs none
 */
export function systemGiLibraryDirs({
    platform = process.platform,
    env = process.env,
    existsDir = isDirectory,
    searchDirs = pkgConfigSearchDirs,
} = {}) {
    const probed = PROBED_GI_LIBDIRS[platform];
    if (!probed) return [];

    /** @type {string[]} */
    const out = [];
    const add = (dir) => {
        if (dir && dir !== '/' && !out.includes(dir)) out.push(dir);
    };

    // 1. Explicit: the typelib dir's sibling libdir.
    for (const typelibDir of splitSearchPath(env.GI_TYPELIB_PATH)) {
        const libDir = dirname(typelibDir);
        if (existsDir(libDir)) add(libDir);
    }

    // 2 + 3. Candidate prefixes, believed only on the girepository-1.0 marker.
    /** @type {string[]} */
    const candidates = [];
    for (const pcDir of searchDirs(env)) {
        if (basename(pcDir) === 'pkgconfig') candidates.push(dirname(pcDir));
    }
    candidates.push(...probed);
    for (const libDir of candidates) {
        if (existsDir(join(libDir, TYPELIB_SUBDIR))) add(libDir);
    }

    return out;
}

/**
 * Whether `current` (a split `DYLD_FALLBACK_LIBRARY_PATH`) already covers every
 * directory in `wanted` — the "nothing to do" test that keeps a correctly
 * launched process (a CI job, or a launcher that exported the variable) from
 * re-execing at all, and keeps a re-exec'd child from doing it twice.
 * @param {readonly string[]} wanted
 * @param {readonly string[]} current
 * @returns {boolean}
 */
export function pathCovers(wanted, current) {
    return wanted.every((dir) => current.includes(dir));
}
