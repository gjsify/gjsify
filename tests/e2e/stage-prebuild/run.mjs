// E2E test for `scripts/stage-prebuild.mjs` — the shared native-prebuild stager.
//
// Regression guard for the OS/arch axis. Eleven packages used to stage their
// prebuild with a hand-written one-liner:
//
//     mkdir -p prebuilds/linux-x64 && cp build/libfoo.so … prebuilds/linux-x64/
//
// which is wrong twice off Linux/x86_64: the target directory is hard-coded,
// and so is the `.so` suffix — a macOS build emits `.dylib`, so `cp` fails and
// `gjsify workspace <pkg> build:prebuilds` cannot stage anything at all. That
// is the reason the darwin prebuilds had to be produced by a bespoke CI job
// rather than by the package's own script.
//
// Two properties this pins, because both are load-bearing for the audit:
//
//   1. The directory name is taken from the package's own `gjsify.platforms`
//      declaration, never invented — an undeclared host is a hard error, so a
//      local build cannot create a target CI does not reproduce.
//   2. Artifacts are matched by EXTENSION, not by filename, so renaming a
//      library in meson.build cannot silently ship a stale/partial set.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/stage-prebuild/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const STAGER = join(MONOREPO_ROOT, 'scripts', 'stage-prebuild.mjs');

const { pickDeclaredTarget } = await import(`file://${STAGER}`);

/** Build a throwaway package with a `build/` dir holding `files`. */
function fixture(platforms, files) {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-stage-'));
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: '@gjsify/fixture-native', gjsify: { prebuilds: 'prebuilds', platforms } }),
    );
    mkdirSync(join(dir, 'build'), { recursive: true });
    for (const f of files) writeFileSync(join(dir, 'build', f), f);
    return dir;
}

function runStager(dir) {
    return execFileSync(process.execPath, [STAGER, dir], { encoding: 'utf8' });
}

describe('stage-prebuild: target selection', () => {
    it('matches the host on the ONE `${platform}-${arch}` spelling', () => {
        const declared = ['linux-x64', 'linux-arm64', 'darwin-arm64', 'win32-x64'];
        assert.equal(pickDeclaredTarget(declared, 'linux', 'x64'), 'linux-x64');
        assert.equal(pickDeclaredTarget(declared, 'linux', 'arm64'), 'linux-arm64');
        assert.equal(pickDeclaredTarget(declared, 'darwin', 'arm64'), 'darwin-arm64');
        assert.equal(pickDeclaredTarget(declared, 'win32', 'x64'), 'win32-x64');
        // Identical in both vocabularies — nothing to translate.
        assert.equal(pickDeclaredTarget(['linux-riscv64'], 'linux', 'riscv64'), 'linux-riscv64');
    });

    it('does NOT accept the retired uname spelling', () => {
        // The stager is a WRITE path: accepting `linux-x86_64` here is how a
        // second spelling would creep back onto disk. A declaration in the old
        // vocabulary fails the audit (`scripts/audit-runtimes.mjs --check`) and
        // fails here too, with the actionable "not in `gjsify.platforms`"
        // message — never by silently staging into an undeclared directory.
        assert.equal(pickDeclaredTarget(['linux-x86_64'], 'linux', 'x64'), null);
        assert.equal(pickDeclaredTarget(['linux-aarch64'], 'linux', 'arm64'), null);
    });

    it('returns null for a host the package does not declare', () => {
        const declared = ['linux-x64'];
        assert.equal(pickDeclaredTarget(declared, 'win32', 'x64'), null);
        assert.equal(pickDeclaredTarget(declared, 'darwin', 'arm64'), null);
        assert.equal(pickDeclaredTarget(declared, 'linux', 'riscv64'), null);
    });

    it('does not confuse one OS for another at the same arch', () => {
        assert.equal(pickDeclaredTarget(['darwin-arm64'], 'linux', 'arm64'), null);
    });
});

describe('stage-prebuild: staging', () => {
    it('copies every artifact extension, including .dylib', () => {
        const dir = fixture([`${process.platform}-${process.arch}`, 'linux-x64', 'darwin-arm64'], [
            'libfoo.so',
            'libfoo.dylib',
            'Foo-1.0.gir',
            'Foo-1.0.typelib',
            'meson-logs.txt', // not an artifact — must NOT be staged
        ]);
        try {
            runStager(dir);
            const target = pickDeclaredTarget(
                [`${process.platform}-${process.arch}`, 'linux-x64', 'darwin-arm64'],
                process.platform,
                process.arch,
            );
            const staged = readdirSync(join(dir, 'prebuilds', target)).sort();
            assert.deepEqual(staged, ['Foo-1.0.gir', 'Foo-1.0.typelib', 'libfoo.dylib', 'libfoo.so']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('replaces a stale artifact set rather than merging into it', () => {
        const platforms = [`${process.platform}-${process.arch}`, 'linux-x64', 'darwin-arm64'];
        const dir = fixture(platforms, ['libold.so']);
        try {
            runStager(dir);
            // Rename the library, as a meson.build edit would.
            const target = pickDeclaredTarget(platforms, process.platform, process.arch);
            rmSync(join(dir, 'build', 'libold.so'));
            writeFileSync(join(dir, 'build', 'libnew.so'), 'new');
            runStager(dir);
            const staged = readdirSync(join(dir, 'prebuilds', target));
            assert.deepEqual(staged, ['libnew.so'], 'the renamed-away library must not survive');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails loudly on a host the package does not declare', () => {
        // Declare only a target this host cannot be.
        const other = process.platform === 'linux' ? 'darwin-arm64' : 'linux-x64';
        const dir = fixture([other], ['libfoo.so']);
        try {
            assert.throws(() => runStager(dir), /not in/i);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('fails loudly when the build produced no artifact', () => {
        const dir = fixture([`${process.platform}-${process.arch}`, 'linux-x64', 'darwin-arm64'], ['meson-logs.txt']);
        try {
            assert.throws(() => runStager(dir), /none of/i);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
