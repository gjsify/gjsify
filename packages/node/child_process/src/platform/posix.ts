// Reference: Node.js lib/child_process.js (`normalizeSpawnArguments`) + POSIX signal(7).
// Reimplemented for GJS using GLib — shared POSIX behaviour for the linux /
// darwin / generic-POSIX platform modules.
//
// Everything here is expressed as a RUNTIME CAPABILITY PROBE (does `/bin/sh`
// exist? is `setsid` on PATH?) rather than a compile-time OS assumption, so a
// POSIX host we have never seen still gets a correct answer instead of a
// hard-coded Linux path.

import GLib from '@girs/glib-2.0';
import type Gio from '@girs/gio-2.0';

/**
 * Signal numbers that are identical across every POSIX platform we target
 * (Linux, macOS/BSD). The ones that DIFFER — `SIGUSR1`, `SIGUSR2`, `SIGCHLD`,
 * `SIGCONT`, `SIGSTOP`, `SIGBUS`, … — live in `linux.ts` / `darwin.ts`, which
 * spread this table and then override.
 */
export const COMMON_SIGNALS: Readonly<Record<string, number>> = Object.freeze({
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGILL: 4,
    SIGTRAP: 5,
    SIGABRT: 6,
    SIGIOT: 6,
    SIGFPE: 8,
    SIGKILL: 9,
    SIGSEGV: 11,
    SIGPIPE: 13,
    SIGALRM: 14,
    SIGTERM: 15,
    SIGXCPU: 24,
    SIGXFSZ: 25,
    SIGVTALRM: 26,
    SIGPROF: 27,
    SIGWINCH: 28,
});

let _defaultShell: string | null = null;

/**
 * Node's default shell for `shell: true` on POSIX.
 *
 * `refs/node/lib/child_process.js` picks `/system/bin/sh` when
 * `process.platform === 'android'` and `/bin/sh` otherwise. We probe for the
 * binaries instead of the platform string: an Android/Bionic userland has no
 * `/bin/sh`, so the probe reproduces Node's choice without needing to know
 * which libc we are on. Cached — the answer cannot change within a process.
 */
export function defaultShell(): string {
    if (_defaultShell !== null) return _defaultShell;
    if (
        !GLib.file_test('/bin/sh', GLib.FileTest.IS_EXECUTABLE) &&
        GLib.file_test('/system/bin/sh', GLib.FileTest.IS_EXECUTABLE)
    ) {
        _defaultShell = '/system/bin/sh';
    } else {
        _defaultShell = '/bin/sh';
    }
    return _defaultShell;
}

/**
 * Build the full argv for a `shell: true` / `shell: '<path>'` spawn.
 * Mirrors Node's POSIX branch verbatim: `<shell> -c <command>`.
 */
export function shellArgv(command: string, shell: string | boolean | undefined): string[] {
    const file = typeof shell === 'string' && shell.length > 0 ? shell : defaultShell();
    return [file, '-c', command];
}

let _argv0Shell: string | null | undefined;

/**
 * Pick a shell that implements `exec -a NAME` — a bash/ksh/zsh extension, NOT
 * POSIX `sh`. On Fedora/RHEL `/bin/sh` IS bash so the default works, but on
 * Debian/Ubuntu it is `dash`, which has no `exec -a` and would silently run the
 * command with the wrong `argv[0]`. Prefer an explicit `bash` (or `zsh`) from
 * PATH and only fall back to the default shell when neither is installed.
 */
function argv0Shell(): string {
    if (_argv0Shell === undefined) {
        _argv0Shell = GLib.find_program_in_path('bash') ?? GLib.find_program_in_path('zsh');
    }
    return _argv0Shell ?? defaultShell();
}

/**
 * Rewrite argv so the child sees `argv0` as its `argv[0]`.
 *
 * `Gio.SubprocessLauncher` does not expose `g_subprocess_launcher_set_child_setup()`
 * to GObject-Introspection (it is `(skip)`-annotated because it takes a raw C
 * function pointer), and `GSubprocess` never sets `G_SPAWN_FILE_AND_ARGV_ZERO`,
 * so there is no way to reach `execve()`'s argv[0] from JS. The shell's
 * `exec -a "$0" "$@"` performs exactly the same syscall, at the cost of one
 * extra short-lived process.
 */
export function applyArgv0(argv0: string, argv: string[]): string[] {
    return [argv0Shell(), '-c', 'exec -a "$0" "$@"', argv0, ...argv];
}

let _setsid: string | null | undefined;

/**
 * argv prefix that promotes the child to a new session / process-group leader
 * (Node's `detached: true`), or `null` when no such helper exists here.
 *
 * `setsid(2)` itself is unreachable from JS for the same introspection reason
 * as `argv0` above, so we shell out to `setsid(1)` (util-linux). It is resolved
 * from PATH rather than hard-coded to `/usr/bin/setsid` so distributions that
 * install it elsewhere (Nix, Alpine, `/bin/setsid`) keep working.
 *
 * macOS ships no `setsid(1)`, so this returns `null` there unless the user
 * installed one (e.g. Homebrew `util-linux`). See `darwin.ts` for the exact
 * degraded contract.
 */
export function detachedPrefix(): string[] | null {
    if (_setsid === undefined) _setsid = GLib.find_program_in_path('setsid');
    return _setsid === null ? null : [_setsid];
}

/**
 * Deliver `signal` to a running `Gio.Subprocess`.
 *
 * `SIGKILL` routes through `force_exit()` (Gio's dedicated kernel-level path);
 * everything else is translated through the platform's signal table and sent
 * via `send_signal()`. Unknown names fall back to `SIGTERM`, which is what
 * Gio's own kill paths use.
 */
export function killProcess(
    proc: Gio.Subprocess,
    signal: string | number | undefined,
    signals: Readonly<Record<string, number>>,
): void {
    const sig = signal ?? 'SIGTERM';
    if (sig === 'SIGKILL' || sig === 9) {
        proc.force_exit();
        return;
    }
    const num = typeof sig === 'number' ? sig : (signals[sig] ?? signals.SIGTERM);
    proc.send_signal(num);
}
