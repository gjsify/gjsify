// Reference: refs/node/test/parallel/test-os-constants-signals.js
// Original: Copyright (c) Node.js contributors. MIT.
//
// #2001: `os.constants.signals` was ONE table — the Linux build's — served to
// every OS, so a code path mapping a raw signal number or a shell's `128 + n`
// exit status back to a name got the wrong name on darwin, silently.
//
// WHAT EACH TEST CAN PROVE, and where it runs
//
//   node:os is NATIVE Node on the `test:node` leg (`runtimes.node: "none"`) and
//   this package on the `test:gjs` leg. So the comparison that matters — ours
//   against Node's, on the host's OWN table — is an `on('Node.js', …)` block,
//   and it is the only assertion here that would have caught the bug on the OS
//   it was about. `macos-suites.yml` and `windows-suites.yml` both run
//   `test:node`, which is what puts this in front of a darwin and a win32 host.
//
//   The table EXPECTATIONS run everywhere, including Linux CI, and are what
//   keeps a darwin number from being checked only by a maintainer with a Mac:
//   they fail the moment a row is copied from the linux table, on any host.

import { describe, it, expect, on } from '@gjsify/unit';
import * as os from 'node:os';
import { platform } from 'node:process';

import { SIGNALS, signalsFor, type SignalTable } from './signals.js';

const DIVERGES = ['SIGBUS', 'SIGUSR1', 'SIGUSR2', 'SIGCHLD', 'SIGCONT', 'SIGSTOP', 'SIGTSTP'] as const;

/**
 * The same seven keys under glibc, from the Node on a Linux host — asserted
 * alongside the Darwin column so a single-table regression has to fail TWICE,
 * once per number, rather than once per key.
 */
const LINUX_DIVERGENT: Readonly<Record<string, number>> = {
    SIGBUS: 7,
    SIGUSR1: 10,
    SIGUSR2: 12,
    SIGCHLD: 17,
    SIGCONT: 18,
    SIGSTOP: 19,
    SIGTSTP: 20,
};

/**
 * This host, in `gjsify.os`'s three-name vocabulary. A POSIX host `mapSysname`
 * knows but ADR 0018 does not declare (`freebsd`) lands on `linux`, which is the
 * same fallback `signalsFor(undefined)` makes and the one
 * `@gjsify/process`'s `detectPlatform()` makes.
 */
const HOST = platform === 'darwin' || platform === 'win32' ? platform : 'linux';

/** XNU `bsd/sys/signal.h` / `sys/signal.h`. */
const DARWIN: Readonly<Record<string, number>> = {
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
};

/**
 * MEASURED off the Node 24.21.0 on the Windows runner. Eleven names, not the
 * seven the UCRT `<signal.h>` declares — the four extras and their POSIX numbers
 * are that runner's output, which is what corrected the table.
 */
const WIN32: Readonly<Record<string, number>> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGILL: 4,
    SIGFPE: 8,
    SIGKILL: 9,
    SIGSEGV: 11,
    SIGTERM: 15,
    SIGBREAK: 21,
    SIGABRT: 22,
    SIGWINCH: 28,
};

export default async () => {
    await describe('os.constants.signals: the darwin table', async () => {
        await it('matches XNU bsd/sys/signal.h', async () => {
            expect(signalsFor('darwin')).toStrictEqual(DARWIN);
        });

        // The seven signals that move between Linux and Darwin, stated as the
        // assertion the issue filed. Keying on `signalsFor` rather than on
        // `os.constants.signals` keeps this a property of the DATA; the getter is
        // checked against the host separately, below.
        await it('reports the BSD numbers, not the Linux ones, where they differ', async () => {
            for (const name of DIVERGES) {
                // Both halves per key: the value XNU gives it, AND that it is a
                // DIFFERENT number from the one linux carries at the same key —
                // the second half is why one table satisfied both hosts' specs.
                expect(`${name}:${signalsFor('darwin')[name]}≠${signalsFor('linux')[name]}`).toBe(
                    `${name}:${DARWIN[name]}≠${LINUX_DIVERGENT[name]}`,
                );
            }
        });

        // The KEY SET is part of the table too: Node exposes the host's
        // `<signal.h>` intersected with its own 37 names, so a Darwin build has
        // `SIGINFO` (29) and no `SIGSTKFLT` / `SIGPWR` / `SIGPOLL` at all. A table
        // carrying a Linux-only name answers a question no host asked.
        await it('carries the keys Darwin defines and no others', async () => {
            expect(Object.keys(signalsFor('darwin')).sort()).toStrictEqual(Object.keys(DARWIN).sort());
            for (const linuxOnly of ['SIGSTKFLT', 'SIGPWR', 'SIGPOLL']) {
                expect(signalsFor('darwin')[linuxOnly]).toBeUndefined();
                expect(signalsFor('linux')[linuxOnly]).not.toBeUndefined();
            }
        });

        await it('is not the linux table', async () => {
            expect(signalsFor('darwin')).not.toStrictEqual(SIGNALS.linux);
            expect(signalsFor('darwin').SIGBUS).not.toBe(SIGNALS.linux.SIGBUS);
        });
    });

    await describe('os.constants.signals: the win32 table', async () => {
        await it('matches the eleven signals a Node Windows build reports', async () => {
            expect(signalsFor('win32')).toStrictEqual(WIN32);
        });

        // Windows has no signal numbers; the UCRT delivers seven, and `SIGABRT`
        // is 22 there — not the ISO C 6. A table that reached for POSIX here
        // would be wrong twice over.
        await it('gives SIGABRT the CRT value, not the ISO C one', async () => {
            expect(signalsFor('win32').SIGABRT).toBe(22);
            expect(signalsFor('linux').SIGABRT).toBe(6);
        });
    });

    await describe('os.constants.signals: the linux table', async () => {
        // MEASURED out of the Node on a glibc host, not read off
        // `asm-generic/signal.h` — the two disagree, and the disagreement is the
        // point: `asm-generic` also defines `SIGLOST` (29) and `SIGUNUSED` (31),
        // glibc keeps both out of the header Node compiles against, so Node
        // reports neither. A table assembled from the kernel's asm-generic list
        // would carry two names no Linux build of Node has.
        await it("carries glibc's 33 names and no more", async () => {
            expect(Object.keys(signalsFor('linux')).length).toBe(33);
            expect(signalsFor('linux').SIGLOST).toBeUndefined();
            expect(signalsFor('linux').SIGUNUSED).toBeUndefined();
        });

        await it('agrees with glibc on the numbering that moves on other hosts', async () => {
            for (const [name, number] of Object.entries(LINUX_DIVERGENT)) {
                expect(`${name}:${signalsFor('linux')[name]}`).toBe(`${name}:${number}`);
            }
        });

        await it('aliases SIGPOLL onto SIGIO, as glibc does', async () => {
            expect(signalsFor('linux').SIGPOLL).toBe(signalsFor('linux').SIGIO);
        });
    });

    await describe('os.constants.signals: the selector', async () => {
        await it('answers linux for a host outside the declared target set', async () => {
            // `freebsd` is a real `mapSysname` answer and NOT on the `gjsify.os`
            // axis, so `signalsFor` cannot type it — and the Linux fallback is
            // the same one `getOs()` and `detectPlatform()` already make.
            expect(signalsFor(undefined)).toBe(SIGNALS.linux);
        });

        await it('hands out frozen tables, like Node (ObjectFreeze in lib/os.js)', async () => {
            for (const os of ['linux', 'darwin', 'win32'] as const) {
                expect(Object.isFrozen(signalsFor(os))).toBe(true);
            }
        });

        await it('resolves the same table on every read of the getter', async () => {
            expect(signalsFor('linux')).toBe(signalsFor('linux'));
        });
    });

    await describe('os.constants.signals on THIS host', async () => {
        // The SELECTION half of the fix: a per-OS table nobody selects is still
        // the Linux table on a Mac. Stated against `signalsFor(host)` rather than
        // against `os.constants.signals`, because the two legs answer different
        // questions here — under `test:node` that import IS Node's module, so
        // comparing it to ours is the cross-check below, not a wiring check. The
        // GJS leg, where the import is this package, is what proves the getter.
        await it('selects the table for this host', async () => {
            expect(signalsFor(HOST)).toBe(SIGNALS[HOST]);
        });

        await it('every name resolves to a positive integer', async () => {
            for (const [name, number] of Object.entries(os.constants.signals as SignalTable)) {
                expect(`${name}:${typeof number === 'number' && Number.isInteger(number) && number > 0}`).toBe(
                    `${name}:true`,
                );
            }
        });

        await it('carries at least one signal', async () => {
            expect(Object.keys(os.constants.signals).length > 0).toBe(true);
        });
    });

    await on('Gjs', async () => {
        // The wiring, on the one leg where `node:os` IS this package: the getter
        // on `constants` has to hand back the table for THIS host. A per-OS table
        // that nothing selects is still the Linux table on a Mac, and every test
        // above passes on Linux with the getter deleted.
        await it('os.constants.signals resolves through the getter to the host table', async () => {
            expect(os.constants.signals).toStrictEqual(signalsFor(HOST));
        });

        // Node `ObjectFreeze`s `constants.signals` (lib/os.js), so a consumer's
        // `constants.signals.SIGTERM = 1` throws rather than silently rewriting
        // the table every later reader sees.
        await it("the resolved table is frozen, as Node's is", async () => {
            expect(Object.isFrozen(os.constants.signals)).toBe(true);
        });

        // The other constants are untouched by the getter: `errno` is libuv's and
        // still Linux's on every host (tracked in status/open-todos), and a
        // spread that dropped it would take `constants.EEXIST` with it.
        await it('the other constant groups survive the spread', async () => {
            expect(typeof os.constants.errno).toBe('object');
            expect(os.constants.errno.ENOENT).toBe(2);
            expect(os.constants.UV_UDP_REUSEADDR).toBe(4);
            expect(os.constants.priority.PRIORITY_NORMAL).toBe(0);
            expect(os.constants.dlopen.RTLD_NOW).toBe(2);
        });
    });

    await on('Node.js', async () => {
        await describe('os.constants.signals vs native Node', async () => {
            // The assertion #2001 asked for: OUR table against Node's, on the
            // host's OWN numbering. Linux CI proves the linux half; the macOS and
            // Windows suites run `test:node` and prove the other two.
            //
            // Both sides come off the one `node:os` import, which on this leg IS
            // Node's own module — `runtimes.node: "none"` means the node target
            // never substitutes ours, so `ours` below has to be built from
            // `signalsFor` instead of read back out of the import.
            const node = os.constants.signals as Record<string, number>;

            await it('agrees with Node on every signal name', async () => {
                const ours = signalsFor(HOST);
                const differences = Object.entries(node)
                    .filter(([name, number]) => ours[name] !== number)
                    .map(([name, number]) => `${name}: ours=${ours[name]} node=${number}`);
                expect(differences.join(', ')).toBe('');
            });

            await it('names exactly the signals Node names — no more, no fewer', async () => {
                // A missing name is `undefined` where Node has a number; an EXTRA
                // name answers a question the host was never asked. Either one
                // made a `#ifdef SIGxxx` table wrong in the same silent way.
                const ours = signalsFor(HOST);
                expect(Object.keys(ours).sort().join(',')).toBe(Object.keys(node).sort().join(','));
            });
        });
    });
};
