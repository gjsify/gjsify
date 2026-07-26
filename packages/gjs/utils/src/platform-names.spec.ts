// The OS/arch vocabulary is the foundation of the platform axis: everything
// that branches on `process.platform` / `process.arch` / `os.platform()` /
// `os.arch()` reads it. Two bugs it exists to prevent, both of which shipped:
//
//   - `@gjsify/os` mapped the OS by lower-casing `uname -s`, which is only
//     accidentally right for Linux and Darwin and produces `mingw64_nt-10.0`
//     on MSYS;
//   - the arch table knew x64 / arm64 / ia32 / arm and returned the raw
//     `uname -m` string for everything else — so ppc64, s390x and riscv64
//     (all of which we ship prebuilds for) got a non-Node value.
//
// These are pure functions over strings, so they are cheap to pin exactly.

import { describe, expect, it } from '@gjsify/unit';
import { mapMachine, mapSysname } from './platform-names.js';

export default async () => {
    await describe('mapSysname', async () => {
        await it('should map the POSIX kernel names Node knows', async () => {
            expect(mapSysname('Linux')).toBe('linux');
            expect(mapSysname('Darwin')).toBe('darwin');
            expect(mapSysname('FreeBSD')).toBe('freebsd');
            expect(mapSysname('OpenBSD')).toBe('openbsd');
            expect(mapSysname('NetBSD')).toBe('netbsd');
            expect(mapSysname('SunOS')).toBe('sunos');
            expect(mapSysname('AIX')).toBe('aix');
        });

        await it('should map the Windows-ish sysnames to their Node platform', async () => {
            // MSYS/MinGW report a versioned sysname, e.g. `MINGW64_NT-10.0-22631`.
            expect(mapSysname('MINGW64_NT-10.0-22631')).toBe('win32');
            expect(mapSysname('MSYS_NT-10.0')).toBe('win32');
            expect(mapSysname('CYGWIN_NT-10.0')).toBe('cygwin');
        });

        await it('should tolerate surrounding whitespace from uname output', async () => {
            expect(mapSysname('  Darwin\n')).toBe('darwin');
        });

        await it('should return undefined rather than guess on an unknown kernel', async () => {
            expect(mapSysname('Multics')).toBeUndefined();
        });
    });

    await describe('mapMachine', async () => {
        await it('should map the 64-bit architectures we ship prebuilds for', async () => {
            expect(mapMachine('x86_64')).toBe('x64');
            expect(mapMachine('amd64')).toBe('x64');
            expect(mapMachine('aarch64')).toBe('arm64');
            expect(mapMachine('arm64')).toBe('arm64');
            expect(mapMachine('ppc64le')).toBe('ppc64');
            expect(mapMachine('s390x')).toBe('s390x');
            expect(mapMachine('riscv64')).toBe('riscv64');
            expect(mapMachine('loongarch64')).toBe('loong64');
        });

        await it('should map the 32-bit families', async () => {
            expect(mapMachine('i686')).toBe('ia32');
            expect(mapMachine('i386')).toBe('ia32');
            expect(mapMachine('armv7l')).toBe('arm');
            expect(mapMachine('armv6l')).toBe('arm');
        });

        await it('should be case- and whitespace-insensitive', async () => {
            expect(mapMachine(' X86_64 \n')).toBe('x64');
            expect(mapMachine('ARM64')).toBe('arm64');
        });

        await it('should return undefined rather than pass through an unknown machine', async () => {
            // The old implementation returned the raw string here, which then
            // flowed into `process.arch` as a value Node never produces.
            expect(mapMachine('vax')).toBeUndefined();
        });
    });
};
