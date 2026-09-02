// WHERE a host's GObject-Introspection stack keeps the shared libraries a typelib
// names by BARE LEAF (`libgtk-4.1.dylib`, …) — the algorithm alone, with every host
// fact passed in.
//
// Canonical home for a rule that had one implementation and two callers coming:
// `@gjsify/node-gi` computes it to set `DYLD_FALLBACK_LIBRARY_PATH` before a
// re-exec, and the CLI needs the same answer to hand GI its paths from inside a
// bundle instead (`giRuntimePathsStub`). node-gi keeps its own copy as a pinned
// mirror — it declares exactly one dependency on purpose — so this is the
// reference the mirror is checked against, not a module it imports.
//
// PURE by ADR 0014's membership rule: no imports, no defaults that reach a host.
// The impure half — `statSync`, and spawning `pkg-config` to learn its `.pc`
// search path — belongs to the caller, which is also what makes every branch
// testable from a Linux runner (ADR 0018 § 5).

import { lastPathSeparatorIndex, splitPathComponents } from './path-shape.js';

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

function dirname(path: string): string {
    const cut = lastPathSeparatorIndex(path);
    if (cut < 0) return '.';
    return cut === 0 ? path.slice(0, 1) : path.slice(0, cut);
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
 * it the layout is unknown, so both readings are offered and the caller's
 * `existsDir` keeps whichever is real.
 *
 * The measurement that bought this — a darwin host that resolved
 * `WebKit-6.0.typelib` and never `libgjsifywebkit.dylib`, because the parent-only
 * derivation named the prebuild directory's PARENT — is recorded in
 * `packages/node-gi/node-gi/system-gi.js`, the copy that runs it.
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
