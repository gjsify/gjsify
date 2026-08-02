// E2E test for `scripts/check-prebuild-loader-path.mjs` — the guard that a
// shipped prebuild resolves its OWN sibling libraries from its own directory.
//
// The bug it exists to catch, in full: the `*-native` bridges ship TWO
// libraries whose leaf names differ on purpose — `libgjsify<name>.{so,dylib}`
// (the Vala library the typelib names) and `libgjsify_<name>.{so,dylib}` (the
// cargo cdylib it links against, underscore). The typelib mentions only the
// first, so nothing else in the pipeline names the second, and a `cp` list that
// forgets it produces an artifact that builds green, uploads green, gets
// committed to main — and dies at `dlopen` on a user's machine with
//
//     Library not loaded: @rpath/libgjsify_rolldown.dylib
//       Reason: tried: '…/prebuilds/darwin-arm64/libgjsify_rolldown.dylib' (no such file)
//
// which reads like a broken rpath and is a missing FILE. That is exactly what
// the darwin rolldown leg shipped.
//
// The committed prebuilds are the fixtures ON PURPOSE: they are real linked
// artifacts, and the darwin-arm64 ones give the Mach-O parser real coverage
// from a Linux CI host that cannot run a single instruction of them — which is
// the only way a committed macOS binary gets checked at all before someone with
// a Mac tries to use it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prebuildDir } from '../helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/prebuild-loader-path/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CHECKER = join(MONOREPO_ROOT, 'scripts', 'check-prebuild-loader-path.mjs');

const { checkPrebuildDir, readLibrary, readTypelibSharedLibraries } = await import(`file://${CHECKER}`);
// The libc-axis readers live in the SAME parser (AGENTS.md: extend `binary.mjs`,
// never add a second) but are not part of the loader-path CLI's surface, so they
// come from the package directly.
const { readElfNeeded, readElfGlibcRequires, compareGlibcVersions } = await import(
    `file://${join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'binary.mjs')}`
);

/** The Vala+Rust pairs, with the leaf names that MUST stay in step. */
// Since ADR 0017 there is no single parent `prebuilds/` to join a target onto —
// each target lives in its own package — so a pair names its bridge and the
// directory is resolved per target through the shared `prebuildDir()`.
const PAIRS = [
    { pillar: 'infra', bridge: 'rolldown-native', vala: 'libgjsifyrolldown', rust: 'libgjsify_rolldown' },
    { pillar: 'infra', bridge: 'oxfmt-native', vala: 'libgjsifyoxfmt', rust: 'libgjsify_oxfmt' },
    {
        pillar: 'infra',
        bridge: 'lightningcss-native',
        vala: 'libgjsifylightningcss',
        rust: 'libgjsify_lightningcss',
    },
];

/**
 * Every target token this suite knows how to inspect, in the CURRENT grammar
 * `<os>-<arch>[-musl]`.
 *
 * `linux-*-musl` is listed although nothing commits one yet: each loop below
 * skips a target whose library is absent, so the day a musl leg lands its
 * artifacts are checked with no fixture edit. Listing it is also the cheap half
 * of the standing "fixtures recompose the target name" item in
 * `status/open-todos.md` — the token shape appears once here instead of inline at
 * three loop heads.
 */
const TARGETS = ['linux-x64', 'linux-x64-musl', 'linux-arm64', 'linux-arm64-musl', 'darwin-arm64'];

describe('check-prebuild-loader-path: committed prebuilds', () => {
    for (const { pillar, bridge, vala, rust } of PAIRS) {
        for (const target of TARGETS) {
            const staged = prebuildDir(pillar, bridge, target);
            const ext = target.startsWith('darwin') ? '.dylib' : '.so';
            if (!existsSync(join(staged, `${vala}${ext}`))) continue; // target not shipped (yet)

            it(`${vala}${ext} in ${target} resolves its sibling from its own directory`, () => {
                assert.deepEqual(checkPrebuildDir(staged), []);
            });

            it(`${vala}${ext} in ${target} records ${rust}${ext} + the self-relative search path`, () => {
                const info = readLibrary(join(staged, `${vala}${ext}`));
                assert.ok(info, 'expected a parseable shared library');
                const token = info.format === 'macho' ? '@loader_path' : '$ORIGIN';
                // The Mach-O side carries the leaf behind `@rpath/`; the ELF side
                // records the bare soname. Both must name the UNDERSCORE leaf —
                // getting that spelling wrong is the other half of this trap.
                assert.ok(
                    info.needed.some((n) => n.endsWith(`${rust}${ext}`)),
                    `expected a dependency on ${rust}${ext}, got ${info.needed.join(', ')}`,
                );
                assert.ok(
                    info.searchPaths.includes(token),
                    `expected ${token} in the search paths, got ${info.searchPaths.join(', ') || '(none)'}`,
                );
            });
        }
    }
});

describe('check-prebuild-loader-path: failure modes', () => {
    /** Stage a subset of a real prebuild into a throwaway directory. */
    function stageSubset(sourceDir, names) {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-loader-path-'));
        for (const n of names) copyFileSync(join(sourceDir, n), join(dir, n));
        return dir;
    }

    const source = prebuildDir('infra', 'oxfmt-native', 'darwin-arm64');

    it('fails when the sibling cdylib is not staged (the darwin rolldown bug)', () => {
        const dir = stageSubset(source, ['libgjsifyoxfmt.dylib', 'GjsifyOxfmt-1.0.typelib']);
        try {
            const problems = checkPrebuildDir(dir);
            assert.equal(problems.length, 1);
            assert.match(problems[0], /libgjsify_oxfmt\.dylib is NOT staged/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('passes once the sibling is staged alongside it', () => {
        const dir = stageSubset(source, ['libgjsifyoxfmt.dylib', 'libgjsify_oxfmt.dylib']);
        try {
            assert.deepEqual(checkPrebuildDir(dir), []);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('reports a directory that holds no library at all', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-loader-path-'));
        try {
            writeFileSync(join(dir, 'Foo-1.0.typelib'), 'not a library');
            assert.match(checkPrebuildDir(dir).join('\n'), /holds no \.so/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('reports a missing directory instead of passing vacuously', () => {
        const dir = join(mkdtempSync(join(tmpdir(), 'gjsify-loader-path-')), 'absent');
        assert.match(checkPrebuildDir(dir).join('\n'), /not a directory/);
    });

    it('SKIPS a format it cannot parse rather than calling it broken', () => {
        // A future win32 `.dll` is PE/COFF, which this parser does not speak.
        // Claiming a platform is broken because the checker cannot read it would
        // make the guard lie; the job's load test is the functional backstop.
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-loader-path-'));
        try {
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'gjsifyfoo.dll'), 'MZ not really a PE image');
            assert.deepEqual(checkPrebuildDir(dir), []);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('typelib shared-library records', () => {
    const TERMINAL_LE = prebuildDir('node', 'terminal-native', 'linux-x64', 'GjsifyTerminal-1.0.typelib');

    it('reads the library a little-endian typelib names', () => {
        assert.deepEqual(readTypelibSharedLibraries(TERMINAL_LE), ['libgjsifyterminal.so']);
    });

    it('reads a BIG-endian typelib — the s390x case', () => {
        // A typelib is written in the byte order of the machine that compiled
        // it and carries no endianness flag, so a `linux-s390x` one read from
        // an x86-64 host is byte-swapped. Read little-endian it yields an
        // out-of-range offset, which looks exactly like "this namespace names
        // no library" — silently skipping the staged-leaf check on the one
        // architecture we ship that is big-endian. Found against a real
        // emulated s390x build; reproduced here by swapping the committed
        // one's header so the suite needs no second binary fixture.
        const src = readFileSync(TERMINAL_LE);
        const swapped = Buffer.from(src);
        for (const offset of [40, 52]) swapped.writeUInt32BE(src.readUInt32LE(offset), offset);
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-typelib-'));
        try {
            const file = join(dir, 'GjsifyTerminal-1.0.typelib');
            writeFileSync(file, swapped);
            assert.deepEqual(readTypelibSharedLibraries(file), ['libgjsifyterminal.so']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('returns null for a file that is not a typelib', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-typelib-'));
        try {
            const file = join(dir, 'Fake-1.0.typelib');
            writeFileSync(file, 'x'.repeat(256));
            assert.equal(readTypelibSharedLibraries(file), null);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('libc axis — DT_NEEDED, read from the committed binaries', () => {
    // These two facts used to be hand-maintained (which is to say: absent). The
    // readers exist so `libc` and `gjsify.glibcRequires` are MEASURED, and the
    // committed prebuilds are the fixtures for the same reason the loader-path
    // checks use them: real linked artifacts, on five architectures, two byte
    // orders, none of which this x86-64 host can execute.
    const TERMINAL = (target) => prebuildDir('node', 'terminal-native', target, 'libgjsifyterminal.so');
    const TLS = (target) => prebuildDir('node', 'tls-native', target, 'libgjsifytls.so');

    it('reports libc.so.6 for a bridge that links it — on every arch, both byte orders', () => {
        // `linux-s390x` is the big-endian one. The ELF header carries its own
        // byte order, so this is not a guess — but it IS the case a
        // little-endian-only reader gets silently wrong, exactly as the typelib
        // reader above did before it learned to probe.
        for (const target of ['linux-x64', 'linux-arm64', 'linux-ppc64', 'linux-s390x', 'linux-riscv64']) {
            const needed = readElfNeeded(TERMINAL(target));
            assert.ok(Array.isArray(needed), `${target}: expected a measurement, got null`);
            assert.ok(needed.includes('libc.so.6'), `${target}: expected libc.so.6, got ${needed.join(', ')}`);
            // Leaf names, not raw strings — the question is always "does it need
            // libc", which is a question about the leaf.
            assert.ok(
                needed.every((n) => !n.includes('/')),
                `${target}: expected leaf names, got ${needed.join(', ')}`,
            );
        }
    });

    it('reports NO libc soname for a bridge that reaches libc only through GLib', () => {
        // `@gjsify/tls-native` on x64 calls into GLib/GIO/GnuTLS and nothing
        // else, so it loads against whatever libc the host's GLib was built for.
        // That third state — not glibc, not musl — is why an unsuffixed target
        // means "default build" rather than "glibc build".
        const needed = readElfNeeded(TLS('linux-x64'));
        assert.ok(Array.isArray(needed));
        assert.ok(!needed.includes('libc.so.6'), `expected no libc.so.6, got ${needed.join(', ')}`);
        assert.ok(needed.includes('libgnutls.so.30'), needed.join(', '));
    });

    it('reports the SAME package as glibc-linked on riscv64 — the requirement is per TARGET', () => {
        // Measured, and it is the finding that shaped the `libc` rule: Fedora's
        // riscv64 toolchain records libc + the interpreter explicitly, so
        // `@gjsify/tls-native` is libc-agnostic on four targets and glibc-only on
        // this one. npm's package-level `libc` field cannot express that, which
        // is why `prebuild-libc` leaves it absent and says so in a note.
        const needed = readElfNeeded(TLS('linux-riscv64'));
        assert.ok(needed.includes('libc.so.6'), needed.join(', '));
    });

    it('returns NULL — not [] — for a file that is not an ELF at all', () => {
        // The contract the whole audit rests on: null is "not measured", `[]` is
        // "measured, records nothing". A caller that collapses them concludes
        // "no libc.so.6, therefore musl-safe" about a file nobody parsed.
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-elf-'));
        try {
            const file = join(dir, 'libnothing.so');
            writeFileSync(file, 'x'.repeat(512));
            assert.equal(readElfNeeded(file), null);
            assert.equal(readElfGlibcRequires(file), null);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('returns null rather than throwing on a Mach-O image', () => {
        // The darwin artifacts are legitimate files this reader does not speak.
        // Throwing would abort a whole audit run over a platform it never
        // claimed to inspect.
        const dylib = prebuildDir('infra', 'oxfmt-native', 'darwin-arm64', 'libgjsifyoxfmt.dylib');
        assert.equal(readElfNeeded(dylib), null);
        assert.equal(readElfGlibcRequires(dylib), null);
    });
});

describe('libc axis — the glibc floor, read from SHT_GNU_verneed', () => {
    it('reads the floor the dynamic linker will actually enforce', () => {
        // Spot-checked against the two extremes in the tree. The low one is a
        // pure-Vala bridge using only ancient symbols; the high one is a Rust
        // cdylib and single-handedly sets this repo's Linux baseline
        // (glibc 2.39 = Ubuntu 24.04 / Debian 13), which is precisely the fact
        // no declaration revealed before it was measured.
        assert.equal(
            readElfGlibcRequires(prebuildDir('node', 'terminal-native', 'linux-x64', 'libgjsifyterminal.so')),
            '2.2.5',
        );
        assert.equal(
            readElfGlibcRequires(prebuildDir('infra', 'lightningcss-native', 'linux-x64', 'libgjsify_lightningcss.so')),
            '2.39',
        );
    });

    it('reads a BIG-endian .gnu.version_r — the s390x case', () => {
        // Same trap as the big-endian typelib above, one section over.
        assert.equal(
            readElfGlibcRequires(prebuildDir('node', 'terminal-native', 'linux-s390x', 'libgjsifyterminal.so')),
            '2.2',
        );
    });

    it('reports null for a library that requires no versioned glibc symbol', () => {
        // The Vala half of a Rust pair records no libc at all, so it has no
        // floor. This is why the rule takes the MAXIMUM over the whole staged
        // directory: reading only the typelib-named library would report "no
        // glibc requirement" for the three packages with the highest floors.
        assert.equal(
            readElfGlibcRequires(prebuildDir('infra', 'lightningcss-native', 'linux-x64', 'libgjsifylightningcss.so')),
            null,
        );
    });

    it('compares versions numerically, so 2.9 does not outrank 2.34', () => {
        // The one comparison a lexical sort gets wrong on the actual data — and
        // it appears twice: picking the maximum inside a `.gnu.version_r` table,
        // and comparing a measurement against a declared floor.
        assert.ok(compareGlibcVersions('2.34', '2.9') > 0);
        assert.ok(compareGlibcVersions('2.9', '2.34') < 0);
        assert.equal(compareGlibcVersions('2.34', '2.34.0'), 0);
        assert.ok(compareGlibcVersions('2.2.5', '2.2') > 0);
        assert.ok(compareGlibcVersions('2.39', '2.28') > 0);
    });
});
