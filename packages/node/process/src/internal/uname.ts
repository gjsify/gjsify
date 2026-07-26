// POSIX `uname` probe — the single source of truth for OS and CPU
// architecture under GJS.
//
// Why a subprocess rather than a GLib call: GLib has no architecture API at
// all, and `GLib.get_os_info('ID')` answers with the DISTRIBUTION id (measured:
// `fedora`), not the OS family — so mapping it to a Node `platform` value would
// need a whitelist of every distro that will ever exist. `uname -s` and
// `uname -m` are both POSIX (unlike the GNU-only `-o`, which Darwin rejects
// outright), so one `uname -sm` call answers both axes portably, on Linux,
// macOS and the BSDs alike.
//
// The result is cached for the lifetime of the process: exactly one spawn,
// paid once, shared by `detectPlatform()` and `detectArch()`.

import { mapMachine, mapSysname } from '@gjsify/utils/core';

import { getGjsGlobal } from './gjs.js';

type ProcessPlatform = NodeJS.Platform;
type ProcessArch = NodeJS.Architecture;

export interface UnameInfo {
    platform: ProcessPlatform;
    arch: ProcessArch;
}

let _cache: UnameInfo | null | undefined;

/**
 * Run `uname -sm` once and map both fields. Returns `null` when the probe is
 * unavailable (no GLib, spawn refused, unrecognised output) so callers can
 * fall back rather than assert a guess.
 */
export function probeUname(): UnameInfo | null {
    if (_cache !== undefined) return _cache;
    _cache = null;
    try {
        const GLib = getGjsGlobal().imports?.gi?.GLib;
        if (!GLib) return _cache;
        const spawnSync = GLib['spawn_sync'] as
            | ((
                  cwd: string | null,
                  argv: string[],
                  envp: string[] | null,
                  flags: number,
                  childSetup: unknown,
              ) => [boolean, Uint8Array, Uint8Array, number])
            | undefined;
        const flags = (GLib as unknown as { SpawnFlags?: { SEARCH_PATH?: number } }).SpawnFlags?.SEARCH_PATH;
        if (!spawnSync || flags === undefined) return _cache;

        const [ok, stdout] = spawnSync(null, ['uname', '-sm'], null, flags, null);
        if (!ok || !stdout) return _cache;

        // "Linux x86_64\n" — sysname first, machine last. Splitting on
        // whitespace tolerates the multi-token sysnames MinGW reports.
        const parts = new TextDecoder().decode(stdout).trim().split(/\s+/);
        if (parts.length < 2) return _cache;
        const platform = mapSysname(parts[0]);
        const arch = mapMachine(parts[parts.length - 1]);
        if (!platform || !arch) return _cache;

        _cache = { platform, arch };
    } catch {
        /* probe unavailable — caller falls back */
    }
    return _cache;
}

/** Test seam: drop the cached probe result. */
export function resetUnameCache(): void {
    _cache = undefined;
}
