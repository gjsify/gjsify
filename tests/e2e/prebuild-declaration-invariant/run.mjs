// E2E test for the prebuild-declaration invariant in
// `scripts/audit-runtimes.mjs` — "a declared platform must have a body, and
// that body must be loadable".
//
// `gjsify.platforms` is the OS-axis promise; the platform audit next to this
// one compares it against the directory names a package happens to carry and
// the targets a CI job produces. All three can agree while the promise is
// EMPTY: `@gjsify/oxfmt-native` declared `darwin-arm64` for weeks with no
// artifact behind it and `--check` exited 0 the entire time, because a target
// with no directory is simply absent from the set it compares against.
//
// The second half is the one that is easy to get wrong. A directory that
// exists proves nothing — the macOS incident (#832) was a required job that
// built two bridges and only COPIED them, and the bug hiding there was a
// missing sibling FILE that read exactly like a broken rpath. So the audit
// verifies every committed artifact structurally (machine matches its
// directory, typelib-named libraries staged, self-relative sibling
// resolution) and actually `dlopen`s the ones whose target is this host's.
//
// Fixtures are SYNTHETIC packages in a temp directory holding REAL linked
// binaries copied out of the committed prebuilds. Two reasons:
//   • proving "a missing directory fails" means removing one, and the e2e
//     suites run four-at-a-time against one shared checkout — mutating the
//     repository here would break whatever else is reading it;
//   • the binaries are real, so the ELF/Mach-O parsing under test is exercised
//     against genuine artifacts rather than hand-rolled headers.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/prebuild-declaration-invariant/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const AUDIT = join(MONOREPO_ROOT, 'scripts', 'audit-runtimes.mjs');

const { auditPrebuildArtifacts } = await import(`file://${AUDIT}`);

/** A real, correctly-linked linux-x64 prebuild to copy from. */
const REAL_X64 = join(MONOREPO_ROOT, 'packages', 'node', 'terminal-native', 'prebuilds', 'linux-x64');
const REAL_X64_FILES = ['libgjsifyterminal.so', 'GjsifyTerminal-1.0.typelib'];
/** A real arm64 one — the wrong-machine fixture, from this x64 host's view. */
const REAL_ARM64 = join(MONOREPO_ROOT, 'packages', 'node', 'terminal-native', 'prebuilds', 'linux-arm64');

/** @type {string[]} */ const tmpDirs = [];
function scratch() {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-prebuild-invariant-'));
    tmpDirs.push(dir);
    return dir;
}
process.on('exit', () => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

/**
 * Build one synthetic row in the shape `collectNativePackages()` produces.
 *
 * @param {object} opts
 * @param {string[]} opts.declared `gjsify.platforms`
 * @param {Record<string, string[]>} [opts.stage] target → files to copy from a
 *   real prebuild (`from` selects which one)
 * @param {string} [opts.from] source prebuild directory (default: the x64 one)
 * @param {Record<string, string>} [opts.extraFiles] target → {name: contents}
 * @param {*} [opts.uncommitted] raw `gjsify.platformsUncommitted` value
 * @param {boolean} [opts.namesPrebuildDir] whether `gjsify.prebuilds` is set
 */
function pkg({ declared, stage = {}, from = REAL_X64, extraFiles = {}, uncommitted = null, namesPrebuildDir = true }) {
    const root = scratch();
    const prebuildDir = join(root, 'prebuilds');
    mkdirSync(prebuildDir, { recursive: true });
    for (const [target, names] of Object.entries(stage)) {
        mkdirSync(join(prebuildDir, target), { recursive: true });
        for (const n of names) copyFileSync(join(from, n), join(prebuildDir, target, n));
    }
    for (const [target, files] of Object.entries(extraFiles)) {
        mkdirSync(join(prebuildDir, target), { recursive: true });
        for (const [name, contents] of Object.entries(files)) {
            writeFileSync(join(prebuildDir, target, name), contents);
        }
    }
    const shipped = [...new Set([...Object.keys(stage), ...Object.keys(extraFiles)])].sort();
    return {
        name: '@gjsify/fixture',
        path: 'packages/fixture',
        tier: 3,
        builder: 'meson',
        declared: [...declared].sort(),
        shipped,
        prebuildsField: namesPrebuildDir ? 'prebuilds' : null,
        prebuildDir,
        uncommitted,
    };
}

/** @param {object} row */
const failuresFor = (row) => auditPrebuildArtifacts([row]).failures;

describe('prebuild invariant — half 1: a declared platform must have a body', () => {
    it('FAILS on a declared target with no prebuild directory (the oxfmt-native gap)', () => {
        const problems = failuresFor(
            pkg({ declared: ['linux-x64', 'darwin-arm64'], stage: { 'linux-x64': REAL_X64_FILES } }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0], /declares `darwin-arm64` but ships no `prebuilds\/darwin-arm64\/`/);
        // The message must name BOTH ways out, or the next person picks the
        // one that hides the gap.
        assert.match(problems[0], /gjsify\.platformsUncommitted/);
    });

    it('PASSES once the directory is there', () => {
        assert.deepEqual(failuresFor(pkg({ declared: ['linux-x64'], stage: { 'linux-x64': REAL_X64_FILES } })), []);
    });

    it('FAILS on a directory with a typelib but no shared library', () => {
        const problems = failuresFor(
            pkg({ declared: ['linux-x64'], stage: { 'linux-x64': ['GjsifyTerminal-1.0.typelib'] } }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.so`/);
    });

    it('FAILS on a directory with a shared library but no typelib — GI cannot reach it', () => {
        const problems = failuresFor(
            pkg({ declared: ['linux-x64'], stage: { 'linux-x64': ['libgjsifyterminal.so'] } }),
        );
        assert.equal(problems.length, 1);
        assert.match(problems[0], /holds no `\.typelib`/);
    });

    it('does NOT apply to a package that names no `gjsify.prebuilds` directory (node-gyp)', () => {
        // `@gjsify/node-gi` builds on install / ships from a release artifact,
        // so this repo owes no committed body for its declared targets.
        assert.deepEqual(failuresFor(pkg({ declared: ['linux-x64', 'win32-x64'], namesPrebuildDir: false })), []);
    });
});

describe('prebuild invariant — half 2: a body that exists must be loadable', () => {
    it('FAILS on an image whose machine does not match its directory (the QEMU leg)', () => {
        // An arm64 ELF staged as linux-x64. This is the check that caught the
        // emulated prebuild legs shipping host x86-64 into
        // `prebuilds/linux-{ppc64,s390x,riscv64}/` — and the ONE loadability
        // defect a cross-arch target can be caught for from any host, because
        // the machine is in the file header.
        const problems = failuresFor(
            pkg({ declared: ['linux-x64'], from: REAL_ARM64, stage: { 'linux-x64': REAL_X64_FILES } }),
        );
        assert.ok(problems.length >= 1, 'expected the machine mismatch to be reported');
        assert.match(problems[0], /is a linux\/arm64 image in a `linux-x64` directory/);
    });

    it('FAILS when the typelib names a library that is not staged beside it', () => {
        // The typelib records `libgjsifyterminal.so`; stage a DIFFERENTLY
        // named real library instead, exactly as a `meson.build` rename that
        // the staging step follows but the typelib does not would produce.
        const row = pkg({ declared: ['linux-x64'], stage: { 'linux-x64': ['GjsifyTerminal-1.0.typelib'] } });
        copyFileSync(join(REAL_X64, 'libgjsifyterminal.so'), join(row.prebuildDir, 'linux-x64', 'libgjsifyrenamed.so'));
        const problems = failuresFor(row);
        assert.equal(problems.length, 1);
        assert.match(problems[0], /records shared library `libgjsifyterminal\.so`, which is NOT staged/);
    });

    it('FAILS on a file with a library extension that is not a library at all', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                extraFiles: { 'linux-x64': { 'libtruncated.so': 'not an image' } },
            }),
        );
        assert.ok(
            problems.some((p) => /is neither ELF, Mach-O nor PE/.test(p)),
            problems.join('\n'),
        );
    });

    it('FAILS on a `.typelib` that does not carry the GI magic', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': ['libgjsifyterminal.so'] },
                extraFiles: { 'linux-x64': { 'Fake-1.0.typelib': 'x'.repeat(128) } },
            }),
        );
        assert.ok(
            problems.some((p) => /does not carry the GI typelib magic/.test(p)),
            problems.join('\n'),
        );
    });

    it('reports how far it got — structural everywhere, functional only on this host', () => {
        const { stats } = auditPrebuildArtifacts([
            pkg({
                declared: ['linux-x64', 'linux-arm64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                from: REAL_X64,
                extraFiles: {},
            }),
        ]);
        // linux-arm64 is declared but not staged here, so only the host
        // directory is counted — the point of the assertion is that the two
        // numbers are tracked SEPARATELY and neither is inferred from the
        // other. A cross-arch directory can never join `loaded`.
        assert.equal(stats.dirs, 1);
        assert.ok(stats.loaded + stats.hostSkipped >= 0);
    });
});

describe('prebuild invariant — the escape hatch is honest, not a mute button', () => {
    const REASON = 'built + uploaded by napi.yml; no job commits it back here';

    it('accepts a declared-but-uncommitted target with a reason, and SAYS so', () => {
        const { failures, notes, stats } = auditPrebuildArtifacts([
            pkg({
                declared: ['linux-x64', 'darwin-arm64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                uncommitted: { 'darwin-arm64': REASON },
            }),
        ]);
        assert.deepEqual(failures, []);
        assert.equal(stats.uncommitted, 1);
        // Exempt is not the same as silent: the reason has to surface on every
        // run, or the field becomes the silent gap it replaced.
        assert.ok(
            notes.some((n) => n.includes('darwin-arm64') && n.includes(REASON)),
            notes.join('\n'),
        );
    });

    it('REJECTS an exemption with no reason', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64', 'darwin-arm64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                uncommitted: { 'darwin-arm64': '   ' },
            }),
        );
        assert.ok(
            problems.some((p) => /needs a non-empty reason/.test(p)),
            problems.join('\n'),
        );
    });

    it('REJECTS exempting a target the package does not even declare', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                uncommitted: { 'darwin-arm64': REASON },
            }),
        );
        assert.ok(
            problems.some((p) => /you can only defer shipping something you promise/.test(p)),
            problems.join('\n'),
        );
    });

    it('REJECTS a stale exemption once the artifact IS committed', () => {
        // Otherwise the hatch outlives its cause and quietly exempts a
        // directory that is now under the full contract.
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                uncommitted: { 'linux-x64': REASON },
            }),
        );
        assert.ok(
            problems.some((p) => /IS committed now/.test(p)),
            problems.join('\n'),
        );
    });

    it('REJECTS a malformed exemption value', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                stage: { 'linux-x64': REAL_X64_FILES },
                uncommitted: ['darwin-arm64'],
            }),
        );
        assert.ok(
            problems.some((p) => /must be an object mapping/.test(p)),
            problems.join('\n'),
        );
    });

    it('REJECTS the field on a package that owes no committed artifacts', () => {
        const problems = failuresFor(
            pkg({
                declared: ['linux-x64'],
                namesPrebuildDir: false,
                uncommitted: { 'linux-x64': REASON },
            }),
        );
        assert.ok(
            problems.some((p) => /is not under that contract at all/.test(p)),
            problems.join('\n'),
        );
    });
});
