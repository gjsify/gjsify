// SPDX-License-Identifier: MIT
// Is a GObject-Introspection namespace INSTALLED on this host — the question
// `gi_repository_require()` answers, asked without loading anything.
//
// WHY THIS EXISTS. `gjsify system-check` used to answer it with `pkg-config
// --modversion libadwaita-1`, which is a question about the DEVELOPMENT package.
// Measured on postmarketOS v26.06 / aarch64 (OnePlus 6T, gjs 1.88.1, no node):
// libadwaita 1.9.2 installed, `Adw-1.typelib` present, every Adwaita app on the
// device running — and `system-check` printing `✗ libadwaita` under **Required**
// and exiting 1, because `libadwaita-dev` (which ships the `.pc` file and
// nothing a running app loads) was not installed. A check that fails on a host
// where the thing it checks demonstrably works is worse than no check: it sends
// people to install packages they do not need, and it teaches them to ignore the
// output — the same failure mode `checkTypeSkew`'s comment in
// `check-system-deps.ts` describes from the other direction.
//
// THE ORACLE is the typelib FILE on girepository's search path:
//   * it is what GI itself resolves, so it cannot disagree with what an app does;
//   * it is identical under GJS and Node, so the CLI's two entry points give the
//     same answer (`pkg-config` at least had that property; `imports.gi` would
//     not);
//   * it needs no `dlopen`, and a presence probe must not have the side effect of
//     loading GTK into the process asking the question.
//
// It answers PRESENCE only. The version still comes from `pkg-config` where that
// is installed — see `checkGiLibrary` in `check-system-deps.ts`, which reports a
// version when it can and a bare `✓` when it cannot. Presence without a version
// is the honest answer on a runtime-only host; `✗` was not.
//
// PURE FUNCTION of injected host facts (platform / env / fs / pkg-config), like
// `systemGiLibraryDirs()` and `resolvePrebuildDirName()` beside it, so the
// darwin and win32 branches are unit-tested from Linux.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { pkgConfigSearchDirs, splitSearchPath, systemGiLibraryDirs, TYPELIB_SUBDIR } from './system-gi.js';

/** Injectable host facts — every platform branch is testable from any host. */
export interface GiTypelibOptions {
    /** `process.platform` value; defaults to the running process. */
    platform?: string;
    /** Environment to read `GI_TYPELIB_PATH` / `PATH` from; defaults to `process.env`. */
    env?: Record<string, string | undefined>;
    /** Directory-existence predicate; defaults to a `statSync` probe. */
    existsDir?: (dir: string) => boolean;
    /** File-existence predicate; defaults to `existsSync`. */
    existsFile?: (file: string) => boolean;
    /** Immediate subdirectory names of `dir`, or `[]`; defaults to a `readdirSync` probe. */
    listDirs?: (dir: string) => string[];
    /** `pkg-config`'s `.pc` search directories; defaults to {@link pkgConfigSearchDirs}. */
    searchDirs?: (env: Record<string, string | undefined>) => string[];
}

/**
 * Library prefixes a Linux GI stack is installed under, before multiarch.
 * `/usr/lib64` is Fedora/openSUSE, `/usr/lib` everything else, `/usr/local/lib`
 * a source install. Each is accepted only when it actually holds the marker
 * directory, so naming one that does not exist costs a `stat` and nothing else.
 */
const LINUX_LIBDIRS = ['/usr/lib', '/usr/lib64', '/usr/local/lib'] as const;

/**
 * Where a Debian/Ubuntu multiarch layout hides the typelibs
 * (`/usr/lib/x86_64-linux-gnu/girepository-1.0`). The triplet is DISCOVERED by
 * listing the parent rather than derived from `process.arch`: the mapping from
 * Node's arch names to Debian triplets is a table that would need a row per
 * port, and one `readdir` of `/usr/lib` answers it for every architecture
 * including the ones nobody has written down.
 */
const MULTIARCH_PARENTS = ['/usr/lib'] as const;

function isDirectory(dir: string): boolean {
    try {
        return statSync(dir).isDirectory();
    } catch {
        // ENOENT on an uninstalled prefix, EACCES on a path this process may not
        // read: not a usable typelib directory either way.
        return false;
    }
}

function subdirectories(dir: string): string[] {
    try {
        return readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    } catch {
        return [];
    }
}

/**
 * Directories girepository looks for typelibs in, most specific first,
 * deduplicated, each verified on disk.
 *
 * Sources, in precedence order:
 *   1. `GI_TYPELIB_PATH` — the host stating outright where typelibs live.
 *      Believed on existence alone; an explicit statement is not second-guessed.
 *   2. `pkg-config`'s `.pc` search path → `<libdir>/girepository-1.0`. The
 *      general mechanism: it finds a jhbuild or otherwise bespoke prefix that no
 *      list here could name. Present only when pkg-config is, which on a
 *      runtime-only host it is not — hence 3.
 *   3. Platform defaults, each believed only on the marker directory existing.
 *
 * Source 3 is where the platforms differ, and each branch is a statement about
 * that platform's install layout:
 *   * **linux** — {@link LINUX_LIBDIRS} plus the discovered multiarch triplets.
 *   * **darwin** — {@link systemGiLibraryDirs}, which already probes Homebrew,
 *     MacPorts and pkg-config prefixes for exactly this marker. Reused rather
 *     than re-derived: the two must not be able to disagree about where the GI
 *     stack is.
 *   * **win32** — a GTK distribution ships `<prefix>/bin` on `PATH` and its
 *     typelibs in the sibling `<prefix>/lib/girepository-1.0`, so PATH is the
 *     prefix oracle. (Untested against a real Windows GTK; it costs a `stat` per
 *     `bin` entry and cannot make any host worse than the empty list it replaces.)
 */
export function systemGiTypelibDirs({
    platform = process.platform,
    env = process.env,
    existsDir = isDirectory,
    listDirs = subdirectories,
    searchDirs = pkgConfigSearchDirs,
}: GiTypelibOptions = {}): string[] {
    // POSIX semantics unless the TARGET is win32 — `platform` is a parameter, so
    // this answers a question about a foreign filesystem from any host. The same
    // trap `system-gi.ts` documents: a host-following `join` turns
    // `/usr/lib/girepository-1.0` into a backslash path on Windows and matches
    // nothing the caller holds.
    const { join, dirname, basename } = platform === 'win32' ? win32 : posix;
    const separator = platform === 'win32' ? ';' : ':';

    const out: string[] = [];
    const add = (dir: string): void => {
        if (dir && !out.includes(dir)) out.push(dir);
    };

    // 1. Explicit.
    for (const dir of splitSearchPath(env['GI_TYPELIB_PATH'], separator)) {
        if (existsDir(dir)) add(dir);
    }

    // 2 + 3. Candidate libdirs, believed only on the marker.
    const libDirs: string[] = [];
    for (const pcDir of searchDirs(env)) {
        if (basename(pcDir) === 'pkgconfig') libDirs.push(dirname(pcDir));
    }

    if (platform === 'linux') {
        libDirs.push(...LINUX_LIBDIRS);
        for (const parent of MULTIARCH_PARENTS) {
            for (const entry of listDirs(parent)) libDirs.push(join(parent, entry));
        }
    } else if (platform === 'darwin') {
        libDirs.push(...systemGiLibraryDirs({ platform, env, existsDir, searchDirs }));
    } else if (platform === 'win32') {
        for (const pathEntry of splitSearchPath(env['PATH'], separator)) {
            if (basename(pathEntry).toLowerCase() === 'bin') libDirs.push(join(dirname(pathEntry), 'lib'));
        }
    }

    for (const libDir of libDirs) {
        const typelibDir = join(libDir, TYPELIB_SUBDIR);
        if (existsDir(typelibDir)) add(typelibDir);
    }

    return out;
}

/**
 * The installed `<namespace>-<version>.typelib`, or `null`.
 *
 * `version` is GI's API version as it appears in a `gi://` specifier (`4.0` for
 * `gi://Gtk?version=4.0`, `1` for Adwaita) — the same string the filename
 * carries, so the caller states it exactly once.
 */
export function findSystemTypelib(
    namespace: string,
    version: string,
    { existsFile = existsSync, ...options }: GiTypelibOptions = {},
): string | null {
    const { join } = options.platform === 'win32' ? win32 : posix;
    const leaf = `${namespace}-${version}.typelib`;
    for (const dir of systemGiTypelibDirs(options)) {
        const candidate = join(dir, leaf);
        if (existsFile(candidate)) return candidate;
    }
    return null;
}
