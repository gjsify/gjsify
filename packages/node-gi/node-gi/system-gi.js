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
// THAT IS ONE LAYOUT, NOT THE LAYOUT — {@link giLibraryDirsForTypelibDir} holds the
// second one and the measurement that found it.
//
// PURE FUNCTION of injected host facts (platform / env / fs / pkg-config), like
// `hostTarget()` beside it and the CLI's `resolvePrebuildDirName()` — so the
// darwin branch is unit-testable from a Linux host and the host values are read
// only at the outermost call site, as defaults.
//
// MIRRORED, DELIBERATELY, in `packages/infra/cli/src/utils/system-gi.ts`. The
// same loader gap breaks a `gjs` child too (Homebrew's `gjs` has an rpath into
// GLIB's keg only, so it resolves no other keg's leaves — measured, trace in that
// file), and `gjsify run/showcase/storybook` must repair it in the env it hands
// the child. The CLI cannot IMPORT this module: ADR 0005 Decision 2 forbids a
// Tier-1 package taking a dependency edge on `@gjsify/node-gi`. So the port is
// pinned by an agreement test — `packages/infra/cli/src/utils/system-gi.spec.ts`
// imports THIS file by relative path and asserts identical arrays for a table of
// injected inputs. It pins a THIRD copy the same way, `@gjsify/utils/core`'s
// `system-gi-dirs.ts`. Change one, change all three; the lift that deletes two of
// them is tracked in `status/open-todos.md`.
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
// POSIX path semantics, not the HOST's. This function answers a question about
// a darwin filesystem — `platform` is a PARAMETER, so the host running the code
// may be any of the three. Node's default `join`/`dirname`/`basename` follow the
// host, so on win32 `join('/usr/local/lib', 'girepository-1.0')` becomes
// `\usr\local\lib\girepository-1.0` and never matches the darwin path the
// caller (or the injected `existsDir`) is holding. Measured on the Windows leg:
// three `systemGiLibraryDirs` specs returned `[]` where they assert a prefix.
// `PROBED_GI_LIBDIRS` is darwin-only, so POSIX is always the right dialect here.
import { posix } from 'node:path';
const { basename, dirname, join } = posix;

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

/**
 * The subdir GI installs typelibs into — historically `1.0` even for the girepository-2.0 API.
 *
 * Exported because the whole layout rule turns on this one string and all three
 * copies of the rule must turn on the SAME one; the agreement suite compares it
 * across them rather than trusting three literals to stay equal.
 */
export const TYPELIB_SUBDIR = 'girepository-1.0';

/**
 * The library directories a typelib directory implies, most specific first.
 *
 * TWO LAYOUTS put a typelib and the library it names in different places, and a
 * path on its own cannot always tell which one it is looking at:
 *
 *   * GI's INSTALL layout — `<libdir>/girepository-1.0/Gtk-4.0.typelib` beside
 *     `<libdir>/libgtk-4.1.dylib`. The libdir is the PARENT.
 *   * A STAGED layout — the pair sits FLAT in one directory. That is what an
 *     ADR 0017 prebuild is (`<pkg>/prebuilds/darwin-x64/WebKit-6.0.typelib` beside
 *     `libgjsifywebkit.dylib`) and what `gjsify.ship.bundledTypelibs` stages. The
 *     libdir is the DIRECTORY ITSELF.
 *
 * {@link TYPELIB_SUBDIR} as the basename is a POSITIVE signal for the first: a
 * directory GI itself named is GI's own layout, and its parent is the answer.
 * Absent that name the layout is UNKNOWN — a relocated stack's typelib directory
 * carries no required name — so both readings are offered and `existsDir` keeps
 * whichever is real.
 *
 * OFFERING BOTH IS CHEAP AND ORDER IS NOT. The caller prepends the survivors to a
 * loader search path, so a directory that names nothing costs one `stat` per miss —
 * but whichever comes FIRST is where a bare leaf resolves from, and only the staged
 * reading can hold a library at all. Hence staged-then-parent, and hence the marker
 * DECIDING for the install layout rather than a probe offering both everywhere:
 * `<libdir>/girepository-1.0/` is the one directory guaranteed to hold no library,
 * and the canonical case must gain no noise.
 *
 * MEASURED, and the parent-only derivation is what it cost. macOS 15.7.9 / Node
 * 24.18.1 / `@gjsify/webkit-native` 0.45.0, with
 * `GI_TYPELIB_PATH=<…>/webkit-native-darwin-x64/prebuilds/darwin-x64` and nothing
 * else: GI found the typelib and never its backer.
 *
 *     GLib-GIRepository-WARNING: Failed to load shared library
 *       'libgjsifywebkit.dylib' referenced by the typelib
 *     TypeError: WebKit.WebView is not a constructible GObject type
 *
 * dyld's own trace named `…/webkit-native-darwin-x64/prebuilds/libgjsifywebkit.dylib`
 * — the PARENT of the directory the dylib is in, which is this function's previous
 * answer written out. On darwin that is not a degraded search but a dead one:
 * `@gjsify/webkit-native` is the only WebKit any darwin host has (ADR 0022).
 * @param {string} typelibDir one entry of a `GI_TYPELIB_PATH`
 * @returns {string[]} candidate library directories, unverified
 */
export function giLibraryDirsForTypelibDir(typelibDir) {
    const parent = dirname(typelibDir);
    return basename(typelibDir) === TYPELIB_SUBDIR ? [parent] : [typelibDir, parent];
}

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
 *      libraries are wherever {@link giLibraryDirsForTypelibDir} says the layout
 *      puts them. Accepted on directory existence alone: an explicit statement is
 *      not second-guessed.
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

    // 1. Explicit: the libdirs each typelib dir implies, both layouts.
    for (const typelibDir of splitSearchPath(env.GI_TYPELIB_PATH)) {
        for (const libDir of giLibraryDirsForTypelibDir(typelibDir)) {
            if (existsDir(libDir)) add(libDir);
        }
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

/**
 * dyld's OWN default fallback list, verbatim from `dyld(1)`:
 * `$HOME/lib:/usr/local/lib:/lib:/usr/lib`.
 *
 * Load-bearing because `DYLD_FALLBACK_LIBRARY_PATH` REPLACES this list rather
 * than extending it, so a composition that omits part of it hands the child a
 * SMALLER search path than the same child would have had with the variable
 * unset. MEASURED, and it cost a whole platform: both writers used to append a
 * bare `/usr/lib`, dropping `/usr/local/lib` — where every Homebrew GTK library
 * lives on Intel macOS — so every `gjsify` gjs command on such a Mac died in
 * `dlopen(libsoup-3.0.0.dylib)` before it had downloaded anything (the CLI's own
 * fetcher goes through Soup), and so did the Node-free bootstrap the Getting
 * Started page prints. The tell that it was OURS: plain
 * `gjs -c 'imports.gi.Soup'` loads fine with no DYLD variable set.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string[]}
 */
export function dyldDefaultFallbackDirs(env = process.env) {
    const home = env['HOME'];
    return [...(home ? [`${home}/lib`] : []), '/usr/local/lib', '/lib', '/usr/lib'];
}

/**
 * Compose a `DYLD_FALLBACK_LIBRARY_PATH` value: `wanted`, then the launching
 * environment's own value, then {@link dyldDefaultFallbackDirs} —
 * unconditionally, because the target is a CHILD (a re-exec, or a spawned gjs)
 * and it must never search less than one launched without gjsify. Deduplicated:
 * `systemGiLibraryDirs()` can legitimately yield a directory the tail also
 * names, and a repeat costs the loader a second stat on every miss. First
 * occurrence wins everywhere, so dropping later repeats preserves behaviour.
 * @param {readonly string[]} wanted
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function composeDyldFallback(wanted, env = process.env) {
    return [
        ...new Set([...wanted, ...splitSearchPath(env['DYLD_FALLBACK_LIBRARY_PATH']), ...dyldDefaultFallbackDirs(env)]),
    ].join(':');
}
