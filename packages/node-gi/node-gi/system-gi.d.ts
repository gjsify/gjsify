// SPDX-License-Identifier: MIT
/** Injectable host facts for {@link systemGiLibraryDirs} — the darwin branch is testable from Linux. */
export interface SystemGiOptions {
    /** `process.platform` value; defaults to the running process. */
    platform?: string;
    /** Environment to read `GI_TYPELIB_PATH` / `PKG_CONFIG_PATH` from; defaults to `process.env`. */
    env?: NodeJS.ProcessEnv;
    /** Directory-existence predicate; defaults to a `statSync` probe. */
    existsDir?: (dir: string) => boolean;
    /** `pkg-config`'s `.pc` search directories; defaults to {@link pkgConfigSearchDirs}. */
    searchDirs?: (env: NodeJS.ProcessEnv) => string[];
}
/** The subdir GI's own install layout puts typelibs in — the marker that names that layout. */
export const TYPELIB_SUBDIR: string;
/** Library dirs a typelib dir implies, most specific first — install layout and staged layout, unverified. */
export function giLibraryDirsForTypelibDir(typelibDir: string): string[];
/** Split an OS search-path variable, dropping empty segments. */
export function splitSearchPath(value: string | undefined, separator?: string): string[];
/** `$PKG_CONFIG_PATH` plus `pkg-config`'s own `pc_path`; memoized, absent pkg-config yields just the env. */
export function pkgConfigSearchDirs(env: NodeJS.ProcessEnv): string[];
/** Directories holding the host's system GI shared libraries, most specific first; `[]` off darwin. */
export function systemGiLibraryDirs(opts?: SystemGiOptions): string[];
/** Whether a split loader path already covers every wanted directory. */
export function pathCovers(wanted: readonly string[], current: readonly string[]): boolean;
