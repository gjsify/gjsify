// WHERE a host's GObject-Introspection stack keeps the shared libraries a typelib
// names by BARE LEAF (`libgtk-4.1.dylib`, …) — the algorithm alone, with every host
// fact passed in.
//
// The rule lives in THREE places and this is the one meant to be canonical:
// `@gjsify/node-gi` computes it to set `DYLD_FALLBACK_LIBRARY_PATH` before a
// re-exec and cannot import a workspace package (it declares exactly one
// dependency on purpose), while `@gjsify/cli` keeps a pinned TypeScript port
// beside its own impure half. This copy has NO production caller yet — the lift
// is `status/open-todos.md` § "`systemGiLibraryDirs()` lives in three places".
//
// Until that lands, the only thing holding this copy to the other two is the
// agreement suite (`packages/infra/cli/src/utils/system-gi.spec.ts`), which now
// compares all three. It did not always: while it reached only the other two, this
// file's hand-rolled `dirname` had drifted from their `posix.dirname` on any typelib
// dir with a trailing slash, and reversing the order it offers its two candidate
// libdirs left every suite in the repo green.
//
// PURE by ADR 0014's membership rule: no imports, no defaults that reach a host.
// The impure half — `statSync`, and spawning `pkg-config` to learn its `.pc`
// search path — belongs to the caller, which is also what makes every branch
// testable from a Linux runner (ADR 0018 § 5).

import { isWindowsPath, lastPathSeparatorIndex, splitPathComponents } from './path-shape.js';

/** The subdir GI installs typelibs into — historically `1.0` even for the girepository-2.0 API. */
export const TYPELIB_SUBDIR = 'girepository-1.0';

/**
 * Prefixes worth probing per platform, for the common case where GTK is installed
 * and `pkg-config` is not.
 *
 * darwin only, and that is a statement about LOADERS rather than about GI. Linux
 * resolves these leaves through `ld.so`'s system-wide cache (`/etc/ld.so.conf.d`),
 * which a package install populates. dyld is the one loader that neither consults
 * a system-wide config NOR re-reads its search path after launch. win32 is
 * deliberately absent rather than proven unnecessary: `PATH` is the DLL search
 * path, a Windows GTK distribution puts its own `bin` on it, and Windows re-reads
 * it at every `LoadLibrary`.
 */
export const PROBED_GI_LIBDIRS: Readonly<Record<string, readonly string[]>> = {
    darwin: ['/opt/homebrew/lib', '/usr/local/lib', '/opt/local/lib'],
};

/** Split a `PATH`-shaped value. Empty entries dropped; `undefined` yields `[]`. */
export function splitSearchPath(value: string | undefined, separator = ':'): string[] {
    return (value ?? '').split(separator).filter(Boolean);
}

/**
 * A trailing separator is not part of the name, and dropping it is what makes
 * `dirname('/usr/local/lib/girepository-1.0/')` answer `/usr/local/lib` rather than
 * the input minus its final slash.
 *
 * `basename` below already agreed with `node:path` here (it filters empty
 * components), so the two disagreed with each other and this module answered the
 * canonical INSTALL layout with the typelib directory — which holds no library. A
 * `GI_TYPELIB_PATH` written with a trailing slash is an ordinary spelling, and both
 * pinned mirrors use `posix.dirname` and never had it.
 *
 * `(?<=.)` keeps a root its own dirname rather than the empty string.
 */
function stripTrailingSeparators(path: string): string {
    return path.replace(isWindowsPath(path) ? /(?<=.)[\\/]+$/ : /(?<=.)\/+$/, '');
}

function dirname(path: string): string {
    const trimmed = stripTrailingSeparators(path);
    const cut = lastPathSeparatorIndex(trimmed);
    if (cut < 0) return '.';
    return cut === 0 ? trimmed.slice(0, 1) : trimmed.slice(0, cut);
}

function basename(path: string): string {
    const parts = splitPathComponents(path).filter(Boolean);
    return parts.length === 0 ? '' : parts[parts.length - 1];
}

/**
 * The library directories a typelib directory implies, most specific first.
 *
 * TWO LAYOUTS, and a path alone cannot always say which: GI's INSTALL layout keeps
 * the libraries in the PARENT (`<libdir>/girepository-1.0/Gtk-4.0.typelib` beside
 * `<libdir>/libgtk-4.1.dylib`), while a STAGED pair — an ADR 0017 prebuild
 * directory, `gjsify.ship.bundledTypelibs` — keeps them in the DIRECTORY ITSELF.
 * {@link TYPELIB_SUBDIR} as the basename is a positive signal for the first; absent
 * it, both readings are offered and the caller's `existsDir` keeps whichever is real.
 *
 * The measurement, and why the ORDER of the two is the load-bearing half, are in
 * `packages/node-gi/node-gi/system-gi.js`, the copy that ran into it.
 */
export function giLibraryDirsForTypelibDir(typelibDir: string): string[] {
    const parent = dirname(typelibDir);
    return basename(typelibDir) === TYPELIB_SUBDIR ? [parent] : [typelibDir, parent];
}

export interface SystemGiLibraryDirsHost {
    /** `process.platform`, or the platform being reasoned about. */
    platform: string;
    /** The host's `GI_TYPELIB_PATH`, unsplit. */
    typelibPath?: string | undefined;
    /** `pkg-config`'s `.pc` search directories, already resolved by the caller. */
    pkgConfigDirs?: readonly string[];
    /** Directory-existence predicate — the caller's `statSync` or a test double. */
    existsDir: (dir: string) => boolean;
}

/**
 * Absolute library directories this platform's loader needs told about, or `[]`
 * when it needs none.
 *
 * Three sources, in precedence order:
 *
 *   1. `GI_TYPELIB_PATH` — the host stating outright where typelibs live; the
 *      libraries are wherever {@link giLibraryDirsForTypelibDir} says the layout
 *      puts them. Believed on directory existence alone, because an explicit
 *      statement is not second-guessed.
 *   2. `pkg-config`'s `.pc` search path → each `<dir>/pkgconfig`'s parent. The
 *      general mechanism, covering a custom prefix.
 *   3. {@link PROBED_GI_LIBDIRS}.
 *
 * Sources 2 and 3 are GUESSES at a prefix, so each must show the
 * `girepository-1.0/` marker before it is believed. Source 1 is not a guess.
 */
export function systemGiLibraryDirs(host: SystemGiLibraryDirsHost): string[] {
    const probed = PROBED_GI_LIBDIRS[host.platform];
    if (!probed) return [];

    const out: string[] = [];
    const add = (dir: string) => {
        if (dir && dir !== '/' && !out.includes(dir)) out.push(dir);
    };

    for (const typelibDir of splitSearchPath(host.typelibPath)) {
        for (const libDir of giLibraryDirsForTypelibDir(typelibDir)) {
            if (host.existsDir(libDir)) add(libDir);
        }
    }

    const candidates: string[] = [];
    for (const pcDir of host.pkgConfigDirs ?? []) {
        if (basename(pcDir) === 'pkgconfig') candidates.push(dirname(pcDir));
    }
    candidates.push(...probed);
    for (const libDir of candidates) {
        if (host.existsDir(`${libDir}/${TYPELIB_SUBDIR}`)) add(libDir);
    }

    return out;
}
