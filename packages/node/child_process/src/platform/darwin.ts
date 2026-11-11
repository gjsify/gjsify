// Reference: Node.js lib/child_process.js + macOS/BSD signal(3).
// macOS specialisation of the shared POSIX behaviour.
//
// Shell + argv0 behave exactly as on Linux (`/bin/sh` exists, and `bash` is
// still shipped in `/bin/bash`), so those are re-exported from `posix.ts`.
// Two things differ in practice:
//
//   - `detached: true` — macOS ships NO `setsid(1)` binary (it is a util-linux
//     tool). `detachedPrefix()` therefore prefers a `setsid` from PATH if the
//     user installed one (e.g. Homebrew `util-linux`), otherwise it falls back
//     to `/usr/bin/perl` (present on every macOS) calling `POSIX::setsid()`
//     followed by `exec { $ARGV[0] } @ARGV`. The `exec` keeps the pid stable,
//     so `child.pid` remains the session leader's pid and `process.kill(-pid)`
//     reaches the whole process group. If even `/usr/bin/perl` is missing the
//     contract degrades to `null`: the child still spawns and still outlives
//     its parent (GIO sets no `PR_SET_PDEATHSIG` equivalent), but it stays in
//     the parent's process group.
//
//   - `timeout` — macOS has no GNU `timeout(1)` (Homebrew ships it as
//     `gtimeout`). This package no longer depends on it at all: `spawnSync`'s
//     timeout is enforced in-process by a GLib timer driving
//     `communicate_async()` on a private main context (see `../communicate.ts`),
//     which is portable AND reports the real child pid and kill signal.

import GLib from '@girs/glib-2.0';
import type Gio from '@girs/gio-2.0';

import { COMMON_SIGNALS, killProcess as posixKillProcess } from './posix.js';

export { applyArgv0, defaultShell, shellArgv } from './posix.js';

let _detachedPrefix: string[] | null | undefined;

/**
 * argv prefix that promotes the child to a new session / process-group leader
 * (Node's `detached: true`), or `null` when no helper exists here.
 *
 * `setsid(2)` itself is unreachable from JS because
 * `g_subprocess_launcher_set_child_setup()` is hidden from GIR. On Linux we
 * shell out to `setsid(1)` from PATH; on stock macOS that binary is absent, so
 * we use the Perl one-liner that ships with the OS. Perl calls `setsid()` and
 * then replaces itself with the target program via `exec`, so the pid we
 * capture at spawn time is the pid of the session leader.
 */
export function detachedPrefix(): string[] | null {
    if (_detachedPrefix === undefined) {
        const setsid = GLib.find_program_in_path('setsid');
        if (setsid !== null) {
            _detachedPrefix = [setsid];
        } else if (GLib.file_test('/usr/bin/perl', GLib.FileTest.IS_EXECUTABLE)) {
            _detachedPrefix = [
                '/usr/bin/perl',
                '-e',
                'use POSIX (); POSIX::setsid(); exec { $ARGV[0] } @ARGV or die "exec: $!"',
                '--',
            ];
        } else {
            _detachedPrefix = null;
        }
    }
    return _detachedPrefix;
}

/**
 * macOS / BSD signal numbers (`/usr/include/sys/signal.h`). Note how far these
 * drift from Linux: `SIGUSR1` is 30 here but 10 on Linux, `SIGSTOP` is 17 here
 * but 19 on Linux. Sending the Linux number on macOS would deliver a
 * completely different signal, which is why the table is per-platform.
 */
export const SIGNALS: Readonly<Record<string, number>> = Object.freeze({
    ...COMMON_SIGNALS,
    SIGEMT: 7,
    SIGBUS: 10,
    SIGSYS: 12,
    SIGURG: 16,
    SIGSTOP: 17,
    SIGTSTP: 18,
    SIGCONT: 19,
    SIGCHLD: 20,
    SIGTTIN: 21,
    SIGTTOU: 22,
    SIGIO: 23,
    SIGUSR1: 30,
    SIGUSR2: 31,
});

export function killProcess(proc: Gio.Subprocess, signal: string | number | undefined): void {
    posixKillProcess(proc, signal, SIGNALS);
}
