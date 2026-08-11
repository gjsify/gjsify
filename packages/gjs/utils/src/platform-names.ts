// Canonical OS + CPU-architecture vocabulary: POSIX `uname` output → the names Node
// uses for `process.platform` / `process.arch`.
//
// One definition on purpose. `@gjsify/process` (which probes `uname` under GJS) and
// `@gjsify/os` (whose `platform()` / `arch()` are defined as returning those same
// values) have to agree, and two copies of a lookup table are two chances to
// disagree. No platform imports, hence its place in the `/core` half.

// Declared locally rather than as `NodeJS.Platform` / `NodeJS.Architecture`, so this
// module compiles without Node's ambient types. The members are exactly Node's, so
// the values stay assignable to them at every consumer.
export type ProcessPlatform =
    | 'aix'
    | 'android'
    | 'cygwin'
    | 'darwin'
    | 'freebsd'
    | 'haiku'
    | 'linux'
    | 'netbsd'
    | 'openbsd'
    | 'sunos'
    | 'win32';

// Exactly `NodeJS.Architecture`, member for member. Notably NO 32-bit `ppc` or
// `s390`: Node dropped both, so a `uname -m` reporting them maps to undefined rather
// than to a value `process.arch` can never hold.
export type ProcessArch =
    | 'arm'
    | 'arm64'
    | 'ia32'
    | 'loong64'
    | 'mips'
    | 'mipsel'
    | 'ppc64'
    | 'riscv64'
    | 's390x'
    | 'x64';

/** `uname -s` (kernel name) → Node's `process.platform` vocabulary. */
export function mapSysname(sysname: string): ProcessPlatform | undefined {
    const s = sysname.trim();
    switch (s) {
        case 'Linux':
            return 'linux';
        case 'Darwin':
            return 'darwin';
        case 'FreeBSD':
            return 'freebsd';
        case 'OpenBSD':
            return 'openbsd';
        case 'NetBSD':
            return 'netbsd';
        case 'SunOS':
            return 'sunos';
        case 'AIX':
            return 'aix';
        case 'Haiku':
            return 'haiku';
        default:
            // MSYS/MinGW/Cygwin report e.g. `MINGW64_NT-10.0-22631`. Node maps
            // the Cygwin layer to 'cygwin' and native builds to 'win32'; a GJS
            // reached through MinGW is the native-Windows case.
            if (/^CYGWIN/i.test(s)) return 'cygwin';
            if (/^(MINGW|MSYS|Windows)/i.test(s)) return 'win32';
            return undefined;
    }
}

/** `uname -m` (machine) → Node's `process.arch` vocabulary. */
export function mapMachine(machine: string): ProcessArch | undefined {
    const m = machine.trim().toLowerCase();
    switch (m) {
        case 'x86_64':
        case 'amd64':
            return 'x64';
        case 'aarch64':
        case 'arm64':
            return 'arm64';
        case 'i386':
        case 'i486':
        case 'i586':
        case 'i686':
            return 'ia32';
        case 'ppc64le':
        case 'ppc64':
            return 'ppc64';
        case 's390x':
            return 's390x';
        case 'riscv64':
            return 'riscv64';
        case 'loongarch64':
            return 'loong64';
        case 'mipsel':
            return 'mipsel';
        case 'mips':
            return 'mips';
        // NB no 'mips64': Node's `process.arch` vocabulary has no name for
        // 64-bit MIPS, so returning undefined is the honest answer.
        default:
            // armv6l / armv7l / armv8l and friends.
            if (m.startsWith('arm')) return 'arm';
            return undefined;
    }
}
