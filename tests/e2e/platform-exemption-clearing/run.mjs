// E2E test for `scripts/clear-committed-platform-exemptions.mjs`.
//
// `gjsify.platformsUncommitted` is the honest-deferral hatch: "declared, CI
// builds it, no artifact in this repo yet". The conformance rule turns it into
// a FAILURE the moment `prebuilds/<target>/` appears, so a deferral cannot
// outlive its cause.
//
// That makes `commit-prebuilds` — the job that ENDS the cause by pushing the
// artifact — the one place the marker must also end. Without this script the
// first run that lands a new target commits a self-contradictory manifest and
// `main` goes red until someone sends a follow-up PR; the mechanism would buy
// its honesty with a broken default branch per new platform.
//
// The asymmetry is the part worth pinning: an entry whose artifact ARRIVED is
// cleared, an entry whose artifact did NOT is left alone, because that one
// still describes reality (a skipped package, a leg that did not run).
// Fixtures are synthetic package trees in a temp dir — the real manifests must
// not be mutated by a test the e2e suite runs four-at-a-time.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/platform-exemption-clearing/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(MONOREPO_ROOT, 'scripts', 'clear-committed-platform-exemptions.mjs');
const GENERATOR = join(MONOREPO_ROOT, 'scripts', 'generate-platform-packages.mjs');

const { clearSatisfiedExemptions } = await import(`file://${SCRIPT}`);
const { auditPlatformPackages, generatorContext } = await import(`file://${GENERATOR}`);

/**
 * A realistic POST-SPLIT pair, copied out of the real tree so the fixture IS
 * generator output rather than a hand-written approximation.
 *
 * That distinction is the whole reason the defect survived: the synthetic
 * `@gjsify/thing` fixture above has no generated `README.md`, so a suite that
 * ran on every PR shard could not see that clearing an exemption invalidates
 * one. A fixture that cannot reach the bug is not coverage.
 */
function splitPairFixture() {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-split-pair-'));
    // `planPlatformPackages` derives each child's semver `range` from
    // `isWorkspaceMember`; without the root manifest the copied `workspace:*`
    // entry mismatches and the plan describes something else entirely.
    writeFileSync(
        join(root, 'package.json'),
        `${JSON.stringify({ name: 'root', workspaces: ['packages/*/*'] }, null, 4)}\n`,
    );
    // `collectNativePackages` only considers a package native when it has
    // `meson.build`, `binding.gyp` or a string `gjsify.prebuilds` — and a
    // post-split bridge has NONE of those in its manifest, so without this the
    // plan finds zero parents and the whole fixture silently proves nothing
    // (measured: `parents found: 0`). Only `existsSync` is consulted, so an
    // empty file is faithful. No `binding.gyp`, so the parent classifies as
    // meson → `prebuildOwnership` 'split' rather than a 'committed-here' failure.
    for (const rel of [
        join('packages', 'node', 'tls-native', 'package.json'),
        join('packages', 'node', 'tls-native-darwin-x64', 'package.json'),
        join('packages', 'node', 'tls-native-darwin-x64', 'README.md'),
    ]) {
        mkdirSync(join(root, dirname(rel)), { recursive: true });
        copyFileSync(join(MONOREPO_ROOT, rel), join(root, rel));
    }
    writeFileSync(join(root, 'packages', 'node', 'tls-native', 'meson.build'), '# fixture\n');
    // Narrow the parent to the ONE target under test. `tls-native` really
    // declares seven, and `platform-packages` requires a child package per
    // declared target — copying one child out of seven makes the audit report the
    // six missing siblings, which would drown the assertion this test is for.
    // Narrowing keeps the pair internally consistent instead of faking six
    // packages whose committed Linux artifacts also carry measured glibc floors.
    const parentManifest = join(root, 'packages', 'node', 'tls-native', 'package.json');
    const parent = JSON.parse(readFileSync(parentManifest, 'utf8'));
    parent.gjsify.platforms = ['darwin-x64'];
    parent.optionalDependencies = Object.fromEntries(
        Object.entries(parent.optionalDependencies ?? {}).filter(([name]) => name.endsWith('-darwin-x64')),
    );
    writeFileSync(parentManifest, `${JSON.stringify(parent, null, 4)}\n`);
    // The landing: an EMPTY directory is enough, because `expectedFiles` is
    // artifact-independent for a darwin target (`measureLibcFields`
    // short-circuits off linux to the same shape as the no-directory fallback).
    mkdirSync(join(root, 'packages', 'node', 'tls-native-darwin-x64', 'prebuilds', 'darwin-x64'), { recursive: true });
    return {
        root,
        childDir: join(root, 'packages', 'node', 'tls-native-darwin-x64'),
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

/**
 * A synthetic workspace root holding one package.
 *
 * `realpathSync` is not needed here — nothing compares paths against a
 * resolver's output — but `mkdtemp` still goes under `tmpdir()`, which on macOS
 * is a symlinked `/var/folders/…`; the script only ever joins onto the root it
 * is handed, so both spellings work.
 */
function fixture({ platforms, uncommitted, presentDirs = [] }) {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-exemptions-'));
    const pkgDir = join(root, 'packages', 'node', 'thing');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
        join(pkgDir, 'package.json'),
        `${JSON.stringify(
            {
                name: '@gjsify/thing',
                gjsify: { prebuilds: 'prebuilds', platforms, platformsUncommitted: uncommitted },
            },
            null,
            4,
        )}\n`,
    );
    for (const target of presentDirs) mkdirSync(join(pkgDir, 'prebuilds', target), { recursive: true });
    return {
        root,
        manifest: join(pkgDir, 'package.json'),
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

const readGjsify = (manifest) => JSON.parse(readFileSync(manifest, 'utf8')).gjsify;

describe('clear-committed-platform-exemptions', () => {
    it('clears an entry whose prebuild directory has arrived', () => {
        const f = fixture({
            platforms: ['linux-x64', 'darwin-x64'],
            uncommitted: { 'darwin-x64': 'CI builds it; not committed here yet' },
            presentDirs: ['linux-x64', 'darwin-x64'],
        });
        try {
            const { cleared, paths } = clearSatisfiedExemptions(f.root);
            assert.deepEqual(cleared, ['@gjsify/thing darwin-x64']);
            assert.deepEqual(paths, ['packages/node/thing/package.json']);
            const g = readGjsify(f.manifest);
            // The object goes away with its last entry — an empty
            // `platformsUncommitted` would be a declaration promising nothing.
            assert.equal(g.platformsUncommitted, undefined);
            // The PROMISE stays: only the deferral was resolved.
            assert.deepEqual(g.platforms, ['linux-x64', 'darwin-x64']);
        } finally {
            f.cleanup();
        }
    });

    it('leaves an entry alone while its artifact is still absent', () => {
        // The load-bearing half: a skipped package or a leg that did not run
        // must keep its exemption, because it still describes reality.
        const f = fixture({
            platforms: ['linux-x64', 'darwin-x64'],
            uncommitted: { 'darwin-x64': 'CI builds it; not committed here yet' },
            presentDirs: ['linux-x64'],
        });
        try {
            const { cleared, paths } = clearSatisfiedExemptions(f.root);
            assert.deepEqual(cleared, []);
            assert.deepEqual(paths, []);
            assert.deepEqual(readGjsify(f.manifest).platformsUncommitted, {
                'darwin-x64': 'CI builds it; not committed here yet',
            });
        } finally {
            f.cleanup();
        }
    });

    it('clears only the satisfied entries of a multi-target exemption', () => {
        const f = fixture({
            platforms: ['darwin-x64', 'win32-x64'],
            uncommitted: { 'darwin-x64': 'arrived', 'win32-x64': 'still blocked' },
            presentDirs: ['darwin-x64'],
        });
        try {
            const { cleared } = clearSatisfiedExemptions(f.root);
            assert.deepEqual(cleared, ['@gjsify/thing darwin-x64']);
            assert.deepEqual(readGjsify(f.manifest).platformsUncommitted, { 'win32-x64': 'still blocked' });
        } finally {
            f.cleanup();
        }
    });

    it('does not write in dry-run mode', () => {
        const f = fixture({
            platforms: ['darwin-x64'],
            uncommitted: { 'darwin-x64': 'arrived' },
            presentDirs: ['darwin-x64'],
        });
        try {
            const before = readFileSync(f.manifest, 'utf8');
            const { cleared } = clearSatisfiedExemptions(f.root, { dryRun: true });
            assert.deepEqual(cleared, ['@gjsify/thing darwin-x64']);
            assert.equal(readFileSync(f.manifest, 'utf8'), before);
        } finally {
            f.cleanup();
        }
    });

    it('ignores a package that declares no exemptions', () => {
        const f = fixture({ platforms: ['linux-x64'], uncommitted: undefined, presentDirs: ['linux-x64'] });
        try {
            assert.deepEqual(clearSatisfiedExemptions(f.root).cleared, []);
        } finally {
            f.cleanup();
        }
    });

    it('is a no-op on the real repo today', () => {
        // Every exemption currently in the tree is genuinely unsatisfied; if
        // this ever fires, an artifact landed without its marker being cleared.
        assert.deepEqual(clearSatisfiedExemptions(MONOREPO_ROOT, { dryRun: true }).cleared, []);
    });

    it('leaves a tree the generator agrees with', () => {
        // THE MECHANISM, and the assertion whose absence cost 41 hours.
        //
        // The cases above pin the FIELD that gets removed. None of them pinned
        // the STATE the removal leaves behind — and that is where the defect
        // lived: `gjsify.platformsUncommitted` is an input to the generated
        // `README.md` as well as to the manifest, so clearing it in the manifest
        // alone leaves a README the generator no longer agrees with, and
        // `commit-prebuilds`' gate fails two steps later on a byte comparison.
        //
        // Deliberately invariant-shaped rather than case-shaped: it names no
        // filename, so whatever `expectedFiles` emits next is covered without
        // touching this test. And it runs on every PR with no artifact, no macOS
        // leg and no write access — which is what makes the class visible off
        // `main`, where `commit-prebuilds` cannot run at all.
        const f = splitPairFixture();
        try {
            const { cleared, paths } = clearSatisfiedExemptions(f.root);
            assert.deepEqual(cleared, ['@gjsify/tls-native-darwin-x64 darwin-x64']);
            // Both generated files, not just the manifest.
            assert.deepEqual(paths.sort(), [
                'packages/node/tls-native-darwin-x64/README.md',
                'packages/node/tls-native-darwin-x64/package.json',
            ]);
            assert.deepEqual(auditPlatformPackages(generatorContext(f.root)).failures, []);
        } finally {
            f.cleanup();
        }
    });

    it('does not touch the generated README on a dry run', () => {
        // The guard on the `dryRun: true` call above, which runs against the REAL
        // monorepo root: unguarded re-emission would rewrite live package READMEs
        // every time this suite runs.
        const f = splitPairFixture();
        try {
            const before = readFileSync(join(f.childDir, 'README.md'), 'utf8');
            const { cleared } = clearSatisfiedExemptions(f.root, { dryRun: true });
            assert.deepEqual(cleared, ['@gjsify/tls-native-darwin-x64 darwin-x64']);
            assert.equal(readFileSync(join(f.childDir, 'README.md'), 'utf8'), before);
            assert.match(readFileSync(join(f.childDir, 'package.json'), 'utf8'), /platformsUncommitted/);
        } finally {
            f.cleanup();
        }
    });
});
