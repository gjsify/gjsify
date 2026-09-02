// SPDX-License-Identifier: MIT
// WHERE the host's GObject-Introspection stack keeps its shared libraries, so the
// dynamic loader can find the ones a typelib names by BARE LEAF
// (`libgtk-4.1.dylib`, `libgdk_pixbuf-2.0.0.dylib`, …).
//
// A PINNED MIRROR of `packages/node-gi/node-gi/system-gi.js`, and of
// `@gjsify/utils/core`'s `system-gi-dirs.ts` — all three must agree and
// `system-gi.spec.ts` asserts it over a table of injected host shapes. Why a mirror
// and not an import, and what is owed to retire THIS copy (a delegation to
// `@gjsify/utils`, which the CLI already depends on):
// `status/open-todos.md` § "systemGiLibraryDirs() lives in three places".
//
// WHY THIS EXISTS. A failed `dlopen('libgtk-4.1.dylib')` surfaces one layer up as
// something that reads like a type-system bug — `TypeError: Gtk.DrawingArea is not
// a subclassable GObject type` under Node, `Error: Unsupported type void, deriving
// from fundamental void` under a bare `gjs -c "imports.gi.Gtk; Gtk.init()"`:
// `gi_repository_require` resolves the typelib, `g_module_open` then fails, and no
// `gtk_*_get_type` is ever registered.
//
// The gap is the LOADER, not the installation (measured on macOS 15.7.8 / Homebrew
// /usr/local / GTK 4.22.4). `node` has no rpath; Homebrew's `gjs` has one into
// GLIB's keg alone (`…/opt/glib/lib`), so it resolves the glib-family leaves it
// links against and no other keg's. `/usr/local/lib`, where `libgtk-4.1.dylib`
// actually is, is in neither, nor in dyld's default fallback path.
//
// The value CANNOT come from `pkg-config --variable=libdir gtk4`: that answers
// `/usr/local/Cellar/gtk4/4.22.4/lib`, a PER-FORMULA directory that fixes GTK and
// leaves `libgdk_pixbuf-2.0.0.dylib` (different formula, different Cellar libdir)
// unresolvable. What works is `<prefix>/lib`, the UNION every keg is symlinked into.
// The question is "which directories hold the GI stack", never "where is one library".
//
// THE RULE — a typelib and the library it names are SIBLINGS by GI's own install
// layout: `<libdir>/girepository-1.0/Gtk-4.0.typelib` beside
// `<libdir>/libgtk-4.1.dylib`. A directory holding `girepository-1.0/` therefore IS
// a GI library directory, which is what makes this package-manager-agnostic — it
// lands on Homebrew, MacPorts or a custom prefix without knowing any of them exist.
// THAT IS ONE LAYOUT, NOT THE LAYOUT — {@link giLibraryDirsForTypelibDir}; a staged
// pair keeps typelib and backer in ONE directory, and the incident is in the ORIGINAL.
//
// PURE FUNCTION of injected host facts (platform / env / fs / pkg-config), like
// `resolvePrebuildDirName()` and `buildNativeEnv()` beside it, so the darwin branch
// is unit-testable from Linux.
//
// node-gi RE-EXECS itself with the result on `DYLD_FALLBACK_LIBRARY_PATH`, because
// dyld captures that variable at process LAUNCH and an in-process `process.env`
// mutation does nothing. This CLI needs no re-exec: it is the one LAUNCHING the gjs
// child (`buildNativeEnv()` → `spawn('gjs', …, { env })`), the same repair one hop
// earlier. A launcher inside the bundle could not fix it either way — GI resolves
// typelibs and their backers before the bundle's first line runs.
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
// POSIX path semantics, not the HOST's: `platform` is a PARAMETER, so this answers
// a question about a darwin filesystem from any host. Node's host-following
// `join` turns `join('/usr/local/lib', 'girepository-1.0')` into
// `\usr\local\lib\girepository-1.0` on win32, matching nothing the caller (or the
// injected `existsDir`) holds — measured on the Windows leg, three
// `systemGiLibraryDirs` specs returned `[]` where they assert a prefix.
import { posix } from 'node:path';
const { basename, dirname, join } = posix;

/** Injectable host facts — the darwin branch is testable from Linux. */
export interface SystemGiOptions {
    /** `process.platform` value; defaults to the running process. */
    platform?: string;
    /** Environment to read `GI_TYPELIB_PATH` / `PKG_CONFIG_PATH` from; defaults to `process.env`. */
    env?: Record<string, string | undefined>;
    /** Directory-existence predicate; defaults to a `statSync` probe. */
    existsDir?: (dir: string) => boolean;
    /** `pkg-config`'s `.pc` search directories; defaults to {@link pkgConfigSearchDirs}. */
    searchDirs?: (env: Record<string, string | undefined>) => string[];
}

/**
 * Prefixes a macOS GI stack is installed under in practice — probed, never
 * assumed: each is accepted only when it actually holds a `girepository-1.0/`.
 *
 * Load-bearing rather than belt-and-braces: `brew install gtk4` installs RUNTIME
 * dependencies only, so a user running a published showcase routinely has the
 * whole GTK stack and no `pkg-config` at all (a BUILD dependency of those
 * formulae). The pkg-config source below is the general mechanism — it finds a
 * jhbuild or otherwise bespoke prefix — but it cannot be the only one.
 *
 * Exported because a `--app gjs` BUNDLE has to carry the candidates rather than this
 * function's answer: it runs on a host the build machine never saw, so the probe moves
 * into the emitted prologue (`gi-runtime-paths.ts`). `@gjsify/utils`' copy of this rule
 * exports it too; node-gi's does not, and the mirror suite compares OUTPUTS, not surface.
 */
export const PROBED_GI_LIBDIRS: Record<string, readonly string[]> = {
    darwin: ['/opt/homebrew/lib', '/usr/local/lib', '/opt/local/lib'],
};

/**
 * The subdir GI installs typelibs into — historically `1.0` even for the girepository-2.0 API.
 *
 * Exported so `gi-typelib.ts` shares it rather than keeping a fourth copy of the
 * one string this whole layout rule turns on, and compared across all three copies
 * by the agreement suite rather than trusting three literals to stay equal.
 */
export const TYPELIB_SUBDIR = 'girepository-1.0';

/**
 * The library directories a typelib directory implies, most specific first.
 *
 * TWO LAYOUTS, and a path alone cannot always say which: GI's INSTALL layout keeps
 * the libraries in the PARENT (`<libdir>/girepository-1.0/…`), while a STAGED pair —
 * an ADR 0017 prebuild directory, `gjsify.ship.bundledTypelibs` — keeps them in the
 * DIRECTORY ITSELF. {@link TYPELIB_SUBDIR} as the basename is a positive signal for
 * the first; absent it, both readings are offered and the caller's `existsDir` keeps
 * whichever is real.
 *
 * The measurement, and why the ORDER of the two is the load-bearing half, are in the
 * ORIGINAL, `packages/node-gi/node-gi/system-gi.js`.
 */
export function giLibraryDirsForTypelibDir(typelibDir: string): string[] {
    const parent = dirname(typelibDir);
    return basename(typelibDir) === TYPELIB_SUBDIR ? [parent] : [typelibDir, parent];
}

/** Memoized `pkg-config` answer: the spawn happens at most once per process. */
let pkgConfigDirsCache: string[] | null = null;

/** Split an OS search-path variable, dropping empty segments. */
export function splitSearchPath(value: string | undefined, separator = ':'): string[] {
    return (value ?? '').split(separator).filter(Boolean);
}

function isDirectory(dir: string): boolean {
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
 * parent is a candidate libdir — which is how a prefix nobody hardcoded is found.
 *
 * `spawnSync` reports a missing executable as `result.error`, not by throwing, so
 * an absent `pkg-config` (expected on a runtime-only GTK install) is a checked
 * return value and not an exception path. (`@gjsify/child_process` matches Node
 * here deliberately; see its `spawnSync` note.)
 */
export function pkgConfigSearchDirs(env: Record<string, string | undefined>): string[] {
    if (pkgConfigDirsCache) return pkgConfigDirsCache;
    const dirs = splitSearchPath(env['PKG_CONFIG_PATH']);
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
 * Empty off darwin, and that is a statement about LOADERS, not about GI: Linux
 * resolves these leaves through `ld.so`'s system-wide cache (`/etc/ld.so.conf.d`),
 * which a package install populates. dyld is the one loader that neither consults
 * a system-wide config NOR re-reads its search path after launch.
 *
 * win32 is deliberately absent rather than proven unnecessary, and untested:
 * `PATH` is the DLL search path, a Windows GTK distribution puts its `bin` there
 * itself, and Windows re-reads that path at every `LoadLibrary` — so if a system
 * GTK ever turns out not to be on it, the repair is a `PATH` prepend (which
 * {@link buildNativeEnv} already does for the prebuilds), never a second variable.
 *
 * @returns absolute directories, or `[]` when this platform's loader needs none
 */
export function systemGiLibraryDirs({
    platform = process.platform,
    env = process.env,
    existsDir = isDirectory,
    searchDirs = pkgConfigSearchDirs,
}: SystemGiOptions = {}): string[] {
    const probed = PROBED_GI_LIBDIRS[platform];
    if (!probed) return [];

    const out: string[] = [];
    const add = (dir: string): void => {
        if (dir && dir !== '/' && !out.includes(dir)) out.push(dir);
    };

    // 1. Explicit: the libdirs each typelib dir implies, both layouts.
    for (const typelibDir of splitSearchPath(env['GI_TYPELIB_PATH'])) {
        for (const libDir of giLibraryDirsForTypelibDir(typelibDir)) {
            if (existsDir(libDir)) add(libDir);
        }
    }

    // 2 + 3. Candidate prefixes, believed only on the girepository-1.0 marker.
    const candidates: string[] = [];
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
 * directory in `wanted` — the "nothing to do" test.
 *
 * Kept in the port even though this CLI's consumer does not branch on it: a mirror
 * that drifts by one export is a mirror nobody can check. `system-gi.spec.ts`
 * pins both.
 */
export function pathCovers(wanted: readonly string[], current: readonly string[]): boolean {
    return wanted.every((dir) => current.includes(dir));
}

/**
 * dyld's OWN default fallback list, verbatim from `dyld(1)`. Setting
 * `DYLD_FALLBACK_LIBRARY_PATH` REPLACES it, so anything composed for that
 * variable must carry it as a tail. The incident that bought this rule is in the
 * ORIGINAL (`packages/node-gi/node-gi/system-gi.js`); the mirror does not
 * restate it.
 */
export function dyldDefaultFallbackDirs(env: Record<string, string | undefined> = process.env): string[] {
    const home = env['HOME'];
    return [...(home ? [`${home}/lib`] : []), '/usr/local/lib', '/lib', '/usr/lib'];
}

/**
 * Compose a `DYLD_FALLBACK_LIBRARY_PATH` value: `wanted`, then the launching
 * environment's own value, then {@link dyldDefaultFallbackDirs} —
 * unconditionally, so a child launched through gjsify never searches LESS than
 * one launched without it. Deduplicated: `systemGiLibraryDirs()` can legitimately
 * yield a directory the tail also names, and a repeated entry costs the loader a
 * second stat on every miss. First occurrence wins everywhere, so dropping later
 * repeats is behaviour-preserving.
 */
export function composeDyldFallback(
    wanted: readonly string[],
    env: Record<string, string | undefined> = process.env,
): string {
    return [
        ...new Set([...wanted, ...splitSearchPath(env['DYLD_FALLBACK_LIBRARY_PATH']), ...dyldDefaultFallbackDirs(env)]),
    ].join(':');
}
