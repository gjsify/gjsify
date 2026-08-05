// SPDX-License-Identifier: MIT
// WHERE the host's GObject-Introspection stack keeps its shared libraries, so the
// dynamic loader can find the ones a typelib names by BARE LEAF
// (`libgtk-4.1.dylib`, `libgdk_pixbuf-2.0.0.dylib`, …).
//
// ── A DELIBERATE MIRROR ──────────────────────────────────────────────────────
//
// This is a PINNED PORT of `packages/node-gi/node-gi/system-gi.js`. The two must
// agree, and `system-gi.spec.ts` is the check: it imports node-gi's copy by
// relative path and asserts both return identical arrays for a table of injected
// inputs. That is the same shape `impliedExampleNodeEntry()` in
// `@gjsify/manifest-conformance` uses for `resolveNodeEntry()` in this package —
// "this is the check, that is the consumer".
//
// Why a mirror and not an import: ADR 0005 Decision 2 forbids any Tier-1/Tier-2
// package taking a `dependencies`/`optionalDependencies` edge on
// `@gjsify/node-gi`, and `@gjsify/cli` is Tier 1. The alternative — lifting the
// module into a new shared npm name — is the documented expensive path (manual
// first publish + Trusted Publisher bootstrap; the `@gjsify/tls-native` incident
// stalled 60+ packages), so it is tracked in `status/open-todos.md` instead of
// taken here. A spec may reach across the repo because it is never bundled into
// the published `lib/`, which is what lets the agreement be machine-checked
// without creating the forbidden edge.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
//
// Measured twice, on the same class of host, in two runtimes:
//
// 1. Node (macOS 15.7.8 / Homebrew /usr/local / Node 24.18.1 / GTK 4.22.4, the
//    first release that shipped a darwin-x64 addon) — this is node-gi's report:
//
//        GLib-GIRepository-WARNING: Failed to load shared library 'libgtk-4.1.dylib'
//          referenced by the typelib: dlopen(libgtk-4.1.dylib, 0x0009): tried:
//          'libgtk-4.1.dylib' (no such file), …, '/usr/lib/libgtk-4.1.dylib' (no such file)
//        TypeError: Gtk.DrawingArea is not a subclassable GObject type
//
// 2. GJS (same VM, gjs 1.88.1, `gjs -c "imports.gi.Gtk; Gtk.init()"`, nothing
//    gjsify in the process at all) — the reason this CLI needs the module too:
//
//        dlopen(libgtk-4.1.dylib, 0x0009): tried: 'libgtk-4.1.dylib' (no such file),
//          '/System/Volumes/Preboot/Cryptexes/OSlibgtk-4.1.dylib' (no such file),
//          '/usr/local/Cellar/gjs/1.88.1/bin/../../../../opt/glib/lib/libgtk-4.1.dylib'
//            (no such file), '/usr/lib/libgtk-4.1.dylib' (no such file, not in dyld cache)
//        JS ERROR: Error: Unsupported type void, deriving from fundamental void
//
// Read the third path dyld tried: Homebrew's `gjs` binary has an rpath, and it
// points into GLIB's keg (`…/opt/glib/lib`) — nowhere else. So Homebrew's gjs
// resolves the glib-family leaves it links against and NO other keg's. The
// difference between the two reports is cosmetic, not structural: `node` has no
// rpath at all, `gjs` has one into the wrong keg, and `/usr/local/lib` — where
// `libgtk-4.1.dylib` actually is — is in neither, nor in dyld's default fallback
// path. The gap is the LOADER, not the installation: `gi_repository_require`
// resolves the typelib, `g_module_open('libgtk-4.1.dylib')` then fails, no
// `gtk_*_get_type` is ever registered, and the failure surfaces one layer up as
// something that reads like a type-system bug.
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
// `resolvePrebuildDirName()` and `buildNativeEnv()` beside it — so the darwin
// branch is unit-testable from a Linux host and the host values are read only at
// the outermost call site, as defaults.
//
// ── HOW THE CONSUMER DIFFERS FROM NODE-GI'S ──────────────────────────────────
//
// node-gi RE-EXECS its own process with the result on `DYLD_FALLBACK_LIBRARY_PATH`,
// because dyld captures that variable at process LAUNCH and an in-process
// `process.env` mutation therefore does nothing. This CLI never needs a re-exec:
// it is the one LAUNCHING the gjs child (`buildNativeEnv()` →
// `spawn('gjs', …, { env })`), so it sets the variable in the child's launch env,
// which is the same repair one hop earlier. A launcher could not fix this from
// inside the bundle either way — GI resolves typelibs and their backers before the
// bundle's first line runs.
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

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
 * This is the no-pkg-config safety net, and it is load-bearing rather than
 * belt-and-braces: `brew install gtk4` installs RUNTIME dependencies only, so a
 * user running a published showcase routinely has the entire GTK stack and no
 * `pkg-config` at all (it is a BUILD dependency of those formulae). The
 * pkg-config source below is the GENERAL mechanism — it is what finds a jhbuild
 * or otherwise bespoke prefix — but it cannot be the only one.
 */
const PROBED_GI_LIBDIRS: Record<string, readonly string[]> = {
    darwin: ['/opt/homebrew/lib', '/usr/local/lib', '/opt/local/lib'],
};

/** The subdir GI installs typelibs into — historically `1.0` even for the girepository-2.0 API. */
const TYPELIB_SUBDIR = 'girepository-1.0';

/** Memoized `pkg-config` answer: the spawn happens at most once per process. */
let pkgConfigDirsCache: string[] | null = null;

/**
 * Split an OS search-path variable, dropping empty segments.
 */
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
 * parent is a candidate libdir — which is how a prefix nobody hardcoded is
 * found. Measured on the reported host: `pc_path` =
 * `/usr/local/lib/pkgconfig:/usr/local/share/pkgconfig:/usr/lib/pkgconfig:…`,
 * whose first parent is exactly the `/usr/local/lib` that resolves every leaf.
 *
 * `spawnSync` reports a missing executable as `result.error`, not by throwing —
 * an absent `pkg-config` is expected on a runtime-only GTK install, so it is a
 * checked return value here and not an exception path. (`@gjsify/child_process`
 * matches Node here deliberately; see its `spawnSync` note.)
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
 * NOR re-reads its search path after launch, which is why darwin needs the
 * variable set at launch and nobody else does.
 *
 * win32 is deliberately absent rather than proven unnecessary: `PATH` is the DLL
 * search path, a Windows GTK distribution puts its `bin` there itself, and
 * Windows re-reads that path at every `LoadLibrary` — so if a system GTK ever
 * turns out not to be on it, the repair is a `PATH` prepend (which
 * {@link buildNativeEnv} already does for the prebuilds), never a second
 * variable. Untested there.
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

    // 1. Explicit: the typelib dir's sibling libdir.
    for (const typelibDir of splitSearchPath(env['GI_TYPELIB_PATH'])) {
        const libDir = dirname(typelibDir);
        if (existsDir(libDir)) add(libDir);
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
 * Kept in the port even though this CLI's consumer does not branch on it: the
 * mirror's value is that the two files are the SAME file, and a surface that
 * drifts by one export is a mirror nobody can check. `system-gi.spec.ts` pins
 * both.
 */
export function pathCovers(wanted: readonly string[], current: readonly string[]): boolean {
    return wanted.every((dir) => current.includes(dir));
}
