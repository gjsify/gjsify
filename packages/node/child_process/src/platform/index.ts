// Platform layer for `@gjsify/child_process` — mirrors the `linux.ts` /
// `darwin.ts` / `win32.ts`-behind-an-index shape of `@gjsify/os`.
//
// Reference: Node.js lib/child_process.js — the per-platform decisions Node
// itself makes in `normalizeSpawnArguments` (shell, argv0) plus the POSIX
// signal tables `sanitizeKillSignal` resolves against.
//
// Detection is capability-based, not name-based: we ask the filesystem what is
// actually there instead of parsing a `uname` string, so a host we have never
// seen degrades to the generic POSIX answers rather than to a wrong one.

import GLib from '@girs/glib-2.0';
import type Gio from '@girs/gio-2.0';

import * as darwin from './darwin.js';
import * as linux from './linux.js';
import * as posix from './posix.js';
import * as win32 from './win32.js';

export type Platform = 'linux' | 'android' | 'darwin' | 'win32' | 'posix';

/** The subset of a platform module the rest of the package consumes. */
interface PlatformOps {
    defaultShell(): string;
    shellArgv(command: string, shell: string | boolean | undefined): string[];
    detachedPrefix(): string[] | null;
    applyArgv0(argv0: string, argv: string[]): string[];
    killProcess(proc: Gio.Subprocess, signal: string | number | undefined): void;
    SIGNALS: Readonly<Record<string, number>>;
}

/** Generic-POSIX fallback: POSIX helpers + the signals every POSIX agrees on. */
const genericPosix: PlatformOps = {
    defaultShell: posix.defaultShell,
    shellArgv: posix.shellArgv,
    detachedPrefix: posix.detachedPrefix,
    applyArgv0: posix.applyArgv0,
    killProcess: (proc, signal) => posix.killProcess(proc, signal, posix.COMMON_SIGNALS),
    SIGNALS: posix.COMMON_SIGNALS,
};

let _platform: Platform | null = null;

/**
 * Detect the host platform once, from filesystem facts:
 *
 *   - Windows — GLib returns native paths, so `g_get_current_dir()` is
 *     drive-rooted (`C:\…`) instead of `/`-rooted. This is the same probe
 *     `@gjsify/utils`' `getPathSeparator()` uses.
 *   - Linux — `/proc/self/status` exists (procfs is Linux-only; the kernel
 *     mounts it on every mainstream distribution and inside Flatpak/containers).
 *   - Android — a Linux kernel with a Bionic userland: no `/bin/sh`, but
 *     `/system/bin/sh`. Node reports this as `process.platform === 'android'`
 *     and picks a different default shell for it.
 *   - macOS — no procfs, but the system version plist is always present.
 *   - anything else — generic POSIX.
 */
export function detectPlatform(): Platform {
    if (_platform !== null) return _platform;
    if (!GLib.get_current_dir().startsWith('/')) {
        _platform = 'win32';
    } else if (GLib.file_test('/proc/self/status', GLib.FileTest.EXISTS)) {
        _platform =
            !GLib.file_test('/bin/sh', GLib.FileTest.IS_EXECUTABLE) &&
            GLib.file_test('/system/bin/sh', GLib.FileTest.IS_EXECUTABLE)
                ? 'android'
                : 'linux';
    } else if (GLib.file_test('/System/Library/CoreServices/SystemVersion.plist', GLib.FileTest.EXISTS)) {
        _platform = 'darwin';
    } else {
        _platform = 'posix';
    }
    return _platform;
}

function ops(): PlatformOps {
    switch (detectPlatform()) {
        case 'win32':
            return win32;
        case 'darwin':
            return darwin;
        case 'linux':
        case 'android':
            return linux;
        default:
            return genericPosix;
    }
}

/** Node's default shell for `shell: true` on this platform. */
export function defaultShell(): string {
    return ops().defaultShell();
}

/**
 * Full argv for a shell-mediated spawn — `[<shell>, ...switches, <command>]`.
 * `shell` is the caller's `options.shell` (`true` → platform default, a string
 * → that shell verbatim).
 */
export function shellArgv(command: string, shell: string | boolean | undefined): string[] {
    return ops().shellArgv(command, shell);
}

/**
 * argv prefix implementing `detached: true`, or `null` when the platform has no
 * reachable mechanism (see each platform module for the degraded contract).
 */
export function detachedPrefix(): string[] | null {
    return ops().detachedPrefix();
}

/** Rewrite argv so the child sees `argv0` as `argv[0]`. Throws on Windows. */
export function applyArgv0(argv0: string, argv: string[]): string[] {
    return ops().applyArgv0(argv0, argv);
}

/** Deliver a signal (name or number) to a live `Gio.Subprocess`. */
export function killProcess(proc: Gio.Subprocess, signal: string | number | undefined): void {
    ops().killProcess(proc, signal);
}

/** This platform's signal-name → number table. */
export function signalNumbers(): Readonly<Record<string, number>> {
    return ops().SIGNALS;
}

/**
 * Resolve a signal name/number to this platform's numeric value, falling back
 * to `SIGTERM` for unknown names — the same lenient behaviour Gio's own kill
 * paths use.
 */
export function signalNumber(signal: string | number | undefined): number {
    if (typeof signal === 'number') return signal;
    const table = signalNumbers();
    if (typeof signal === 'string' && table[signal] !== undefined) return table[signal];
    return table.SIGTERM ?? 15;
}
