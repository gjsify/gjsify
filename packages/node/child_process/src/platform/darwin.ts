// Reference: Node.js lib/child_process.js + macOS/BSD signal(3).
// macOS specialisation of the shared POSIX behaviour.
//
// Shell + argv0 behave exactly as on Linux (`/bin/sh` exists, and `bash` is
// still shipped in `/bin/bash`), so those are re-exported from `posix.ts`.
// Two things differ in practice:
//
//   - `detached: true` — macOS ships NO `setsid(1)` binary (it is a util-linux
//     tool). `detachedPrefix()` therefore returns `null` unless the user
//     installed one (Homebrew `util-linux` puts it on PATH). DEGRADED CONTRACT:
//     the child is still spawned and still outlives its parent (GIO sets no
//     `PR_SET_PDEATHSIG` equivalent), but it stays in the parent's process
//     group, so terminal-generated signals (SIGINT/SIGHUP from Ctrl-C or a
//     closing terminal) still reach it. Full session detachment needs
//     `setsid(2)`, which is unreachable from JS because
//     `g_subprocess_launcher_set_child_setup()` is not introspectable.
//
//   - `timeout` — macOS has no GNU `timeout(1)` (Homebrew ships it as
//     `gtimeout`). This package no longer depends on it at all: `spawnSync`'s
//     timeout is enforced in-process by a GLib timer driving
//     `communicate_async()` on a private main context (see `../communicate.ts`),
//     which is portable AND reports the real child pid and kill signal.

import type Gio from '@girs/gio-2.0';

import { COMMON_SIGNALS, killProcess as posixKillProcess } from './posix.js';

export { applyArgv0, defaultShell, detachedPrefix, shellArgv } from './posix.js';

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
