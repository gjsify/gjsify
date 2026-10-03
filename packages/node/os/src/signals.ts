// Reference: Node.js src/node_constants.cc (`DefineSignalConstants`) — the table
// behind `os.constants.signals`. Copied from Node.js.
//
// NOT A CONSTANT TABLE, AND THAT IS THE WHOLE POINT (#2001)
//
// Node's table is not written out: `DefineSignalConstants` wraps every entry in
// `#ifdef SIGxxx` + `NODE_DEFINE_CONSTANT`, so Node reports whatever the HOST's
// `<signal.h>` says at ITS build time. The key set is the intersection of that
// header with Node's fixed list of 37 names — which is why Linux answers `SIGLOST`
// and a BSD build does not. Ours shipped the Linux build's table on every host:
// on macOS `SIGBUS` is 10 not 7, `SIGUSR1` 30 not 10, `SIGCHLD` 20 not 17, so any
// code mapping a raw signal number — or a shell's `128 + n` exit status — back to
// a name got the wrong name, silently and only on the hosts nobody tests on.
//
// WHY A TABLE AND NOT A PROBE: nothing reachable from this runtime can read the
// host's signal numbers. GLib exposes `unix_signal_add(sig, …)` but no numeric
// constants, and the shell probe that could print them (`kill -l`) is a
// subprocess per call for data that never changes within a process. So the
// numbers are DATA selected by OS, and `signals.spec.ts` checks them against
// `node:os` on each CI OS — a Linux assertion cannot stand in for that, which is
// how this shipped (#1039's lesson, ADR 0018 § 5).
//
// The SECOND copy of these numbers is `@gjsify/child_process`
// (`src/platform/{posix,linux,darwin}.ts`), and the two agree on every key they
// share. They are not the same table and must not be merged: that one resolves a
// `child.kill(name)` on ANY POSIX host, so it is a common-plus-overrides shape and
// carries `SIGEMT`, which is in Darwin's `<sys/signal.h>` and in none of Node's.

import type { TargetOs } from '@gjsify/utils/core';

/** Signal name → the number this host's `<signal.h>` gives it. */
export type SignalTable = Readonly<Record<string, number>>;

/**
 * Linux, from glibc's `bits/signum.h`.
 *
 * MEASURED, not derived from `asm-generic/signal.h`: read out of
 * `os.constants.signals` of the Node on a glibc host, key for key. That matters
 * because the two disagree — `asm-generic` also defines `SIGLOST` (29) and
 * `SIGUNUSED` (31), and glibc keeps both OUT of the header Node compiles against,
 * so Node does not report them and neither may this table. `SIGPOLL` is `SIGIO`,
 * and `SIGPWR`/`SIGSYS` sit where `bits/signum.h` puts them.
 */
const LINUX: SignalTable = Object.freeze({
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGILL: 4,
    SIGTRAP: 5,
    SIGABRT: 6,
    SIGIOT: 6,
    SIGBUS: 7,
    SIGFPE: 8,
    SIGKILL: 9,
    SIGUSR1: 10,
    SIGSEGV: 11,
    SIGUSR2: 12,
    SIGPIPE: 13,
    SIGALRM: 14,
    SIGTERM: 15,
    SIGSTKFLT: 16,
    SIGCHLD: 17,
    SIGCONT: 18,
    SIGSTOP: 19,
    SIGTSTP: 20,
    SIGTTIN: 21,
    SIGTTOU: 22,
    SIGURG: 23,
    SIGXCPU: 24,
    SIGXFSZ: 25,
    SIGVTALRM: 26,
    SIGPROF: 27,
    SIGWINCH: 28,
    SIGIO: 29,
    SIGPOLL: 29,
    SIGPWR: 30,
    SIGSYS: 31,
});

/**
 * macOS, from XNU's `bsd/sys/signal.h` — the same header
 * `@gjsify/child_process` cites, and it agrees with it on every shared key.
 *
 * Two of the conditional `#define`s in that header decide keys rather than
 * values, and both resolve the way a Node build resolves them (`_DARWIN_C_SOURCE`
 * set): `SIGIOT` is defined as `SIGABRT`, while `SIGPOLL` is NOT — that branch
 * would define it as 7, the same slot `SIGEMT` takes. `SIGIO`, `SIGWINCH` and
 * `SIGINFO` sit in the same `_DARWIN_C_SOURCE` branch and are present.
 */
const DARWIN: SignalTable = Object.freeze({
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGILL: 4,
    SIGTRAP: 5,
    SIGABRT: 6,
    SIGIOT: 6,
    SIGFPE: 8,
    SIGKILL: 9,
    SIGBUS: 10,
    SIGSEGV: 11,
    SIGSYS: 12,
    SIGPIPE: 13,
    SIGALRM: 14,
    SIGTERM: 15,
    SIGURG: 16,
    SIGSTOP: 17,
    SIGTSTP: 18,
    SIGCONT: 19,
    SIGCHLD: 20,
    SIGTTIN: 21,
    SIGTTOU: 22,
    SIGIO: 23,
    SIGXCPU: 24,
    SIGXFSZ: 25,
    SIGVTALRM: 26,
    SIGPROF: 27,
    SIGWINCH: 28,
    SIGINFO: 29,
    SIGUSR1: 30,
    SIGUSR2: 31,
});

/**
 * Windows, from the MSVC CRT's `<signal.h>` — the seven signals `signal()` and
 * `raise()` support there, and all Node's `#ifdef`s find.
 *
 * Seven of thirty-odd is the honest answer, not a gap: Windows has no signal
 * numbers, so the CRT defines only what it can deliver. `SIGABRT` is 22 here and
 * NOT the ISO C 6, which is why a table that copied "POSIX says 6" is wrong here
 * twice over.
 */
const WIN32: SignalTable = Object.freeze({
    SIGINT: 2,
    SIGILL: 4,
    SIGFPE: 8,
    SIGSEGV: 11,
    SIGTERM: 15,
    SIGBREAK: 21,
    SIGABRT: 22,
});

/** The one table per operating system ADR 0018 declares as a target. */
export const SIGNALS: Record<TargetOs, SignalTable> = Object.freeze({
    linux: LINUX,
    darwin: DARWIN,
    win32: WIN32,
});

/**
 * This host's table, or the Linux one for a host outside the declared target set.
 *
 * Linux is the fallback because it is the overwhelmingly common GJS host, and
 * because it is what every other OS question in this package already falls back
 * to (`getOs()`, `@gjsify/process`'s `detectPlatform()`). A FreeBSD host — real,
 * and in `mapSysname`'s vocabulary, but not on the `gjsify.os` axis — therefore
 * gets Linux numbers, which is wrong there and stated here rather than guessed
 * at: the BSD layout is not the Linux one, so no partial guess would be closer.
 */
export const signalsFor = (os: TargetOs | undefined): SignalTable => SIGNALS[os ?? 'linux'];
