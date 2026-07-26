// Reference: Node.js lib/child_process.js + Linux signal(7).
// Linux (glibc / musl / Bionic) specialisation of the shared POSIX behaviour.
//
// Everything except the signal table is identical to generic POSIX, so it is
// re-exported from `posix.ts` rather than duplicated:
//   - `shell: true`      → `/bin/sh -c <command>` (`/system/bin/sh` on Bionic)
//   - `detached: true`   → `setsid(1)`, resolved from PATH (util-linux; present
//                          on every mainstream distribution)
//   - `argv0`            → `bash -c 'exec -a "$0" "$@"'` (`/bin/sh` is `dash`
//                          on Debian/Ubuntu and has no `exec -a`)

import type Gio from '@girs/gio-2.0';

import { COMMON_SIGNALS, killProcess as posixKillProcess } from './posix.js';

export { applyArgv0, defaultShell, detachedPrefix, shellArgv } from './posix.js';

/**
 * Linux signal numbers (`signal(7)`, `asm-generic/signal.h`). Differs from BSD /
 * macOS for `SIGBUS`, `SIGUSR1`, `SIGUSR2`, `SIGCHLD`, `SIGCONT`, `SIGSTOP`,
 * `SIGTSTP`, `SIGURG`, `SIGIO` and `SIGSYS` — see `darwin.ts`.
 */
export const SIGNALS: Readonly<Record<string, number>> = Object.freeze({
    ...COMMON_SIGNALS,
    SIGBUS: 7,
    SIGUSR1: 10,
    SIGUSR2: 12,
    SIGCHLD: 17,
    SIGCONT: 18,
    SIGSTOP: 19,
    SIGTSTP: 20,
    SIGTTIN: 21,
    SIGTTOU: 22,
    SIGURG: 23,
    SIGIO: 29,
    SIGPOLL: 29,
    SIGPWR: 30,
    SIGSYS: 31,
});

export function killProcess(proc: Gio.Subprocess, signal: string | number | undefined): void {
    posixKillProcess(proc, signal, SIGNALS);
}
