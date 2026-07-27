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

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/prebuild-loader-path/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CHECKER = join(MONOREPO_ROOT, 'scripts', 'check-prebuild-loader-path.mjs');

const { checkPrebuildDir, readLibrary, readTypelibSharedLibraries } = await import(`file://${CHECKER}`);

/** @param {string[]} parts */
const pkgDir = (...parts) => join(MONOREPO_ROOT, 'packages', ...parts);

/** The Vala+Rust pairs, with the leaf names that MUST stay in step. */
const PAIRS = [
    { dir: pkgDir('infra', 'rolldown-native', 'prebuilds'), vala: 'libgjsifyrolldown', rust: 'libgjsify_rolldown' },
    { dir: pkgDir('infra', 'oxfmt-native', 'prebuilds'), vala: 'libgjsifyoxfmt', rust: 'libgjsify_oxfmt' },
    {
        dir: pkgDir('infra', 'lightningcss-native', 'prebuilds'),
        vala: 'libgjsifylightningcss',
        rust: 'libgjsify_lightningcss',
    },
];

describe('check-prebuild-loader-path: committed prebuilds', () => {
    for (const { dir, vala, rust } of PAIRS) {
        for (const target of ['linux-x64', 'linux-arm64', 'darwin-arm64']) {
            const staged = join(dir, target);
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

    const source = pkgDir('infra', 'oxfmt-native', 'prebuilds', 'darwin-arm64');

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
    const TERMINAL_LE = pkgDir('node', 'terminal-native', 'prebuilds', 'linux-x64', 'GjsifyTerminal-1.0.typelib');

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
