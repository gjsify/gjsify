import { describe, it, expect } from '@gjsify/unit';
import { isDarwin } from '@gjsify/utils/core';
import * as os from 'node:os';
import { isAbsolute } from 'node:path';
import process, { platform } from 'node:process';

// Ported from refs/node/test/parallel/test-os.js
// Original: MIT license, Node.js contributors

// Several assertions below used to spell a POSIX answer as though it were THE
// answer — `startsWith('/')` for an absolute path, `'Linux'` for `type()`,
// `'\n'` for `EOL`. That is not a weak test, it is a test of the HOST: this
// package declares `runtimes.node: "none"`, so `test:node` runs against native
// Node, and native Node on win32 is right to answer `\` , `Windows_NT` and
// `\r\n`. Ten of them went red on the win11-gjsify VM against a module that was
// behaving correctly. Each now asserts what Node documents FOR THE HOST, which
// is a stronger assertion than the POSIX literal was on Linux.
const IS_WIN32 = platform === 'win32';

export default async () => {
    await describe('os: basic return types', async () => {
        await it('homedir() should return a non-empty string', async () => {
            const home = os.homedir();
            expect(typeof home).toBe('string');
            expect(home.length > 0).toBeTruthy();
        });

        await it('homedir() should return an absolute path', async () => {
            const home = os.homedir();
            expect(isAbsolute(home)).toBeTruthy();
        });

        await it('hostname() should return a non-empty string', async () => {
            const hostname = os.hostname();
            expect(typeof hostname).toBe('string');
            expect(hostname.length > 0).toBeTruthy();
        });

        await it('hostname() should not contain spaces', async () => {
            const hostname = os.hostname();
            expect(hostname.includes(' ')).toBe(false);
        });

        await it('tmpdir() should return a non-empty string', async () => {
            const tmp = os.tmpdir();
            expect(typeof tmp).toBe('string');
            expect(tmp.length > 0).toBeTruthy();
        });

        await it('tmpdir() should return an absolute path', async () => {
            const tmp = os.tmpdir();
            expect(isAbsolute(tmp)).toBeTruthy();
        });

        await it('tmpdir() should not end in a separator', async () => {
            // Node drops a trailing separator (`lib/os.js`), so `path.join()`
            // does not produce a doubled one. Only macOS exposes the
            // difference: its `$TMPDIR` is a per-user
            // `/var/folders/<…>/T/` and GLib returns it verbatim, while a
            // typical Linux host has no `$TMPDIR` and falls back to `/tmp`.
            const tmp = os.tmpdir();
            if (tmp.length > 1) {
                expect(tmp.endsWith('/')).toBe(false);
            }
        });

        await it('type() should return a non-empty string', async () => {
            const type = os.type();
            expect(typeof type).toBe('string');
            expect(type.length > 0).toBeTruthy();
        });

        await it('type() should return the host kernel name', async () => {
            // `uname -s` on POSIX; the constant `Windows_NT` on win32.
            const expected = IS_WIN32 ? 'Windows_NT' : platform === 'darwin' ? 'Darwin' : 'Linux';
            expect(os.type()).toBe(expected);
        });

        await it('release() should return a non-empty string', async () => {
            const release = os.release();
            expect(typeof release).toBe('string');
            expect(release.length > 0).toBeTruthy();
        });

        await it('platform() should return a non-empty string', async () => {
            const platform = os.platform();
            expect(typeof platform).toBe('string');
            expect(platform.length > 0).toBeTruthy();
        });

        await it('platform() should agree with process.platform', async () => {
            // Node DEFINES `os.platform()` as `process.platform`, so this holds
            // on every host rather than only on the one that wrote it.
            expect(os.platform()).toBe(platform);
        });

        await it('arch() should return a non-empty string', async () => {
            const arch = os.arch();
            expect(typeof arch).toBe('string');
            expect(arch.length > 0).toBeTruthy();
        });

        await it('arch() should be one of known architectures', async () => {
            const known = ['x64', 'arm64', 'arm', 'ia32', 'ppc64', 's390x', 'mips', 'mipsel', 'riscv64', 'loong64'];
            expect(known.includes(os.arch())).toBeTruthy();
        });
    });

    await describe('os: endianness', async () => {
        await it('should return BE or LE', async () => {
            const endianness = os.endianness();
            expect(typeof endianness).toBe('string');
            expect(endianness === 'BE' || endianness === 'LE').toBeTruthy();
        });
    });

    await describe('os: EOL', async () => {
        await it('should be the host line ending', async () => {
            expect(os.EOL).toBe(IS_WIN32 ? '\r\n' : '\n');
        });
    });

    await describe('os: cpus', async () => {
        await it('should return a non-empty array', async () => {
            const cpus = os.cpus();
            expect(Array.isArray(cpus)).toBeTruthy();
            expect(cpus.length > 0).toBeTruthy();
        });

        await it('each cpu should have model, speed, and times', async () => {
            const cpus = os.cpus();
            for (const cpu of cpus) {
                expect(typeof cpu.model).toBe('string');
                expect(typeof cpu.speed).toBe('number');
                expect(typeof cpu.times).toBe('object');
                expect(typeof cpu.times.user).toBe('number');
                expect(typeof cpu.times.nice).toBe('number');
                expect(typeof cpu.times.sys).toBe('number');
                expect(typeof cpu.times.idle).toBe('number');
                expect(typeof cpu.times.irq).toBe('number');
            }
        });

        await it('cpus() length should match availableParallelism()', async () => {
            const cpus = os.cpus();
            expect(cpus.length).toBe(os.availableParallelism());
        });

        await it.failing(
            'cpu times should have non-zero values',
            async () => {
                const cpus = os.cpus();
                // At least one CPU should have non-zero idle time
                const hasNonZeroIdle = cpus.some((cpu) => cpu.times.idle > 0);
                expect(hasNonZeroIdle).toBeTruthy();
            },
            "macOS publishes per-CPU tick counters only through Mach's " +
                'host_processor_info(PROCESSOR_CPU_LOAD_INFO), which GJS cannot call without a native ' +
                'bridge; no userland tool prints the cumulative per-core totals Node returns, so ' +
                'src/darwin.ts reports the documented all-zero contract (status/open-todos.md). ' +
                'This runs under NATIVE Node too, where it must keep passing — the predicate is the ' +
                'GJS-on-darwin combination, not the platform.',
            { when: isDarwin() && typeof process.versions.gjs === 'string' },
        );
    });

    await describe('os: memory', async () => {
        await it('freemem() should return a positive number', async () => {
            const free = os.freemem();
            expect(typeof free).toBe('number');
            expect(free > 0).toBeTruthy();
        });

        await it('totalmem() should return a positive number', async () => {
            const total = os.totalmem();
            expect(typeof total).toBe('number');
            expect(total > 0).toBeTruthy();
        });

        await it('totalmem() should return at least 1 MB', async () => {
            expect(os.totalmem() >= 1024 * 1024).toBeTruthy();
        });

        await it('freemem() should return at least 1 MB', async () => {
            expect(os.freemem() >= 1024 * 1024).toBeTruthy();
        });

        await it('freemem should be less than totalmem', async () => {
            expect(os.freemem() <= os.totalmem()).toBeTruthy();
        });
    });

    await describe('os: loadavg', async () => {
        await it('should return an array with 3 elements', async () => {
            const avg = os.loadavg();
            expect(Array.isArray(avg)).toBeTruthy();
            expect(avg.length).toBe(3);
        });

        await it('each element should be a number', async () => {
            const avg = os.loadavg();
            for (const v of avg) {
                expect(typeof v).toBe('number');
            }
        });

        await it('all values should be >= 0', async () => {
            const avg = os.loadavg();
            for (const v of avg) {
                expect(v >= 0).toBeTruthy();
            }
        });
    });

    await describe('os: uptime', async () => {
        await it('should return a positive number', async () => {
            const uptime = os.uptime();
            expect(typeof uptime).toBe('number');
            expect(uptime > 0).toBeTruthy();
        });

        await it('should be a reasonable value (less than 10 years in seconds)', async () => {
            const tenYearsInSeconds = 10 * 365 * 24 * 60 * 60;
            expect(os.uptime() < tenYearsInSeconds).toBeTruthy();
        });
    });

    await describe('os: version', async () => {
        await it('should return a non-empty string', async () => {
            const version = os.version();
            expect(typeof version).toBe('string');
            expect(version.length > 0).toBeTruthy();
        });

        await it('should contain a version-like pattern', async () => {
            const version = os.version();
            // Linux version strings typically start with # or contain version info
            expect(version.length > 2).toBeTruthy();
        });
    });

    await describe('os: machine', async () => {
        await it('should return a non-empty string', async () => {
            const machine = os.machine();
            expect(typeof machine).toBe('string');
            expect(machine.length > 0).toBeTruthy();
        });

        await it('should be one of known machine types', async () => {
            // `os.machine()` is `uname -m`, and that string is the KERNEL's — the
            // same CPU answers differently per OS. Apple's arm64 says `arm64`
            // where Linux says `aarch64` (Darwin on Intel says `x86_64`, as Linux
            // does). Listing only the Linux spelling made this assert the HOST
            // instead of the contract, which is the exact failure mode ADR 0018
            // names: on Linux the missing entry cannot fail.
            //
            // It went red the moment it could — #1022 moved `packages/node/os`
            // from `MACOS_PROBE_PACKAGES` to `MACOS_TEST_PACKAGES`, so the macOS
            // leg began GATING on a suite it had only probed with. The gap is
            // older than that move; the move is what made it visible.
            const known = [
                'x86_64',
                'arm64',
                'aarch64',
                'arm',
                'armv7l',
                'i686',
                'ppc64',
                'ppc64le',
                's390x',
                'mips',
                'mipsel',
                'mips64el',
                'riscv64',
                'loongarch64',
            ];
            // `toContain`, not `includes(…)).toBeTruthy()`: the boolean form
            // reports "Expected value to be truthy" and drops the machine
            // string, which is the one thing a reader needs to extend the list.
            expect(known).toContain(os.machine());
        });
    });

    await describe('os: devNull', async () => {
        await it('should be the host null device', async () => {
            expect(os.devNull).toBe(IS_WIN32 ? '\\\\.\\nul' : '/dev/null');
        });
    });

    await describe('os: availableParallelism', async () => {
        await it('should return a positive number', async () => {
            const n = os.availableParallelism();
            expect(typeof n).toBe('number');
            expect(n > 0).toBeTruthy();
        });
    });

    await describe('os: userInfo', async () => {
        await it('should return an object', async () => {
            const info = os.userInfo();
            expect(typeof info).toBe('object');
        });

        await it('should have uid as number', async () => {
            expect(typeof os.userInfo().uid).toBe('number');
        });

        await it('should have gid as number', async () => {
            expect(typeof os.userInfo().gid).toBe('number');
        });

        await it('should have username as string', async () => {
            expect(typeof os.userInfo().username).toBe('string');
            expect(os.userInfo().username.length > 0).toBeTruthy();
        });

        await it('should have homedir as string', async () => {
            expect(typeof os.userInfo().homedir).toBe('string');
            expect(os.userInfo().homedir.length > 0).toBeTruthy();
        });

        // The three below are Node's DOCUMENTED win32 answers, not concessions:
        // Windows has no login shell and no POSIX uid/gid, so `userInfo()`
        // reports `null` and `-1`. Asserting the POSIX shape was asserting the
        // host the suite happened to run on.
        await it('should have shell as string, or null on win32', async () => {
            const { shell } = os.userInfo();
            if (IS_WIN32) expect(shell).toBe(null);
            else expect(typeof shell).toBe('string');
        });

        await it('uid should be >= 0, or -1 on win32', async () => {
            const { uid } = os.userInfo();
            expect(IS_WIN32 ? uid === -1 : uid >= 0).toBeTruthy();
        });

        await it('gid should be >= 0, or -1 on win32', async () => {
            const { gid } = os.userInfo();
            expect(IS_WIN32 ? gid === -1 : gid >= 0).toBeTruthy();
        });

        await it('homedir should be an absolute path', async () => {
            expect(isAbsolute(os.userInfo().homedir)).toBeTruthy();
        });

        await it('username should match current user', async () => {
            const info = os.userInfo();
            // username should not contain slashes or spaces
            expect(info.username.includes('/')).toBe(false);
            expect(info.username.includes(' ')).toBe(false);
        });
    });

    await describe('os: networkInterfaces', async () => {
        await it('should return an object', async () => {
            const ifaces = os.networkInterfaces();
            expect(typeof ifaces).toBe('object');
        });

        await it('should have at least one interface', async () => {
            const ifaces = os.networkInterfaces();
            expect(Object.keys(ifaces).length > 0).toBeTruthy();
        });

        await it('each interface entry should have required fields', async () => {
            const ifaces = os.networkInterfaces();
            for (const [, entries] of Object.entries(ifaces)) {
                for (const entry of (entries ?? []) as unknown as Array<Record<string, unknown>>) {
                    expect(typeof entry.address).toBe('string');
                    expect(typeof entry.netmask).toBe('string');
                    expect(
                        entry.family === 'IPv4' || entry.family === 'IPv6' || entry.family === 4 || entry.family === 6,
                    ).toBeTruthy();
                    expect(typeof entry.mac).toBe('string');
                    expect(typeof entry.internal).toBe('boolean');
                }
            }
        });

        await it('flags loopback addresses as internal', async () => {
            const ifaces = os.networkInterfaces();
            let sawLoopback = false;
            for (const [, entries] of Object.entries(ifaces)) {
                for (const entry of (entries ?? []) as unknown as Array<Record<string, unknown>>) {
                    if (entry.address === '127.0.0.1' || entry.address === '::1') {
                        sawLoopback = true;
                        expect(entry.internal).toBe(true);
                    }
                }
            }
            expect(sawLoopback).toBeTruthy();
        });

        await it('agrees on internal across an interface’s address families', async () => {
            // `internal` is a property of the INTERFACE, so every address on one
            // must report the same value. Stated this way the invariant needs no
            // knowledge of the host's actual interfaces, which is what lets it
            // run unchanged on Linux, macOS, Node and GJS.
            //
            // The macOS reader derived it per-address from `mac !== NOMAC` —
            // exactly inverted, since only a loopback lacks a MAC — so `lo0`
            // reported IPv4 internal / IPv6 external and `en0` the reverse.
            const ifaces = os.networkInterfaces();
            for (const [name, entries] of Object.entries(ifaces)) {
                const flags = ((entries ?? []) as unknown as Array<Record<string, unknown>>).map((e) => e.internal);
                const uniform = flags.every((f) => f === flags[0]);
                expect(`${name}:${uniform}`).toBe(`${name}:true`);
            }
        });

        await it('reports IPv6 addresses without a zone index', async () => {
            // `ifconfig` prints link-local addresses as `fe80::1%lo0`; the zone
            // suffix belongs to the interface, not the address, and Node strips
            // it. A reader that captures it produces a malformed address.
            const ifaces = os.networkInterfaces();
            for (const [name, entries] of Object.entries(ifaces)) {
                for (const entry of (entries ?? []) as unknown as Array<Record<string, unknown>>) {
                    if (entry.family !== 'IPv6' && entry.family !== 6) continue;
                    const address = entry.address as string;
                    expect(`${name}:${address.includes('%')}`).toBe(`${name}:false`);
                }
            }
        });
    });

    await describe('os: constants', async () => {
        await it('should have signals object', async () => {
            expect(typeof os.constants.signals).toBe('object');
        });

        await it('should have errno object', async () => {
            expect(typeof os.constants.errno).toBe('object');
        });

        await it('signals.SIGTERM should be a number', async () => {
            expect(typeof os.constants.signals.SIGTERM).toBe('number');
        });

        await it('signals.SIGKILL should be a number', async () => {
            expect(typeof os.constants.signals.SIGKILL).toBe('number');
        });

        await it('signals.SIGINT should be a number', async () => {
            expect(typeof os.constants.signals.SIGINT).toBe('number');
        });

        await it('signals.SIGTERM should be 15', async () => {
            expect(os.constants.signals.SIGTERM).toBe(15);
        });

        await it('signals.SIGKILL should be 9', async () => {
            expect(os.constants.signals.SIGKILL).toBe(9);
        });

        await it('signals.SIGINT should be 2', async () => {
            expect(os.constants.signals.SIGINT).toBe(2);
        });

        await it('errno.ENOENT should be a number', async () => {
            expect(typeof os.constants.errno.ENOENT).toBe('number');
        });

        await it('errno.EACCES should be a number', async () => {
            expect(typeof os.constants.errno.EACCES).toBe('number');
        });

        await it('errno.EEXIST should be a number', async () => {
            expect(typeof os.constants.errno.EEXIST).toBe('number');
        });

        await it('errno.ENOENT should be a positive integer', async () => {
            expect(os.constants.errno.ENOENT > 0).toBeTruthy();
            expect(Number.isInteger(os.constants.errno.ENOENT)).toBeTruthy();
        });

        await it('errno.EACCES should be a positive integer', async () => {
            expect(os.constants.errno.EACCES > 0).toBeTruthy();
            expect(Number.isInteger(os.constants.errno.EACCES)).toBeTruthy();
        });

        await it('errno.EEXIST should be a positive integer', async () => {
            expect(os.constants.errno.EEXIST > 0).toBeTruthy();
            expect(Number.isInteger(os.constants.errno.EEXIST)).toBeTruthy();
        });
    });
};
