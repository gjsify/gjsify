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
import { dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/platform-exemption-clearing/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(MONOREPO_ROOT, 'scripts', 'clear-committed-platform-exemptions.mjs');
const GENERATOR = join(MONOREPO_ROOT, 'scripts', 'generate-platform-packages.mjs');

const { clearSatisfiedExemptions } = await import(`file://${SCRIPT}`);
const { auditPlatformPackages, expectedFiles, generatorContext, planPlatformPackages } = await import(
    `file://${GENERATOR}`
);

/** The deferral reason the fixture declares. Any non-empty string works. */
const FIXTURE_WHY = 'a fixture reason — the deferral text is not what this suite is about';

/**
 * A realistic POST-SPLIT pair, copied out of the real tree so the fixture IS
 * generator output rather than a hand-written approximation.
 *
 * That distinction is the whole reason the defect survived: the synthetic
 * `@gjsify/thing` fixture above has no generated `README.md`, so a suite that
 * ran on every PR shard could not see that clearing an exemption invalidates
 * one. A fixture that cannot reach the bug is not coverage.
 *
 * The pair is copied for SHAPE and then re-emitted into the state under test —
 * it does not INHERIT that state. The distinction is the second half of this
 * suite's own lesson, and it cost `main`:
 *
 *   `commit-prebuilds` pushes under `[skip ci]`, so nothing runs on the commit
 *   it makes. On 2026-08-03 that commit landed the darwin-x64 artifacts and —
 *   exactly as designed — cleared `platformsUncommitted` from the live
 *   `tls-native-darwin-x64` manifest. This fixture used to copy that field in,
 *   so the moment the mechanism under test worked in production, the test for it
 *   lost its precondition: `cleared` went to `[]` on every subsequent PR, with a
 *   bare deepEqual diff naming nothing about the cause. `main` was red for every
 *   PR and the commit that broke it had no CI at all.
 *
 * So the exemption is DECLARED here, via the generator, in the `uncommitted`
 * state. `state`/`why` are the same two fields the script under test overrides
 * in the other direction. Seeding both generated files matters: the script only
 * reports a path it actually had to write, so a README already in cleared shape
 * would silently shrink `paths` to the manifest alone and the assertion below
 * would pass while proving half of what it claims.
 */
function splitPairFixture({
    pillar = 'node',
    bridge = 'tls-native',
    target = 'darwin-x64',
    /**
     * Files copied out of the REAL committed prebuild into the landing
     * directory, or `[]` for an empty one.
     *
     * Empty is faithful for a darwin target and only for one: `measureLibcFields`
     * short-circuits off linux, so `expectedFiles` is artifact-INDEPENDENT there
     * and an empty directory produces the same manifest a full one would. On a
     * LINUX target it is the opposite — the whole point is that the generator
     * MEASURES what landed, which is where the refusal this suite guards comes
     * from. A darwin-only fixture therefore cannot reach it, and did not: the
     * clearer refused its first real linux landing on `main` (run 34311463250)
     * with every case in this file green.
     */
    artifact = [],
} = {}) {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-split-pair-'));
    const childRel = join('packages', pillar, `${bridge}-${target}`);
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
        join('packages', pillar, bridge, 'package.json'),
        join(childRel, 'package.json'),
        join(childRel, 'README.md'),
    ]) {
        mkdirSync(join(root, dirname(rel)), { recursive: true });
        copyFileSync(join(MONOREPO_ROOT, rel), join(root, rel));
    }
    writeFileSync(join(root, 'packages', pillar, bridge, 'meson.build'), '# fixture\n');
    // Narrow the parent to the ONE target under test. `tls-native` really
    // declares seven, and `platform-packages` requires a child package per
    // declared target — copying one child out of seven makes the audit report the
    // six missing siblings, which would drown the assertion this test is for.
    // Narrowing keeps the pair internally consistent instead of faking six
    // packages whose committed Linux artifacts also carry measured glibc floors.
    const parentManifest = join(root, 'packages', pillar, bridge, 'package.json');
    const parent = JSON.parse(readFileSync(parentManifest, 'utf8'));
    parent.gjsify.platforms = [target];
    parent.optionalDependencies = Object.fromEntries(
        Object.entries(parent.optionalDependencies ?? {}).filter(([name]) => name.endsWith(`-${target}`)),
    );
    writeFileSync(parentManifest, `${JSON.stringify(parent, null, 4)}\n`);

    // Put the child INTO the state under test, from the generator, so the
    // fixture owns its own precondition. Done before the artifact directory
    // exists: `expectedFiles` measures a binary when one is there, and the
    // point here is the no-artifact shape.
    const childDir = join(root, childRel);
    const childName = JSON.parse(readFileSync(join(childDir, 'package.json'), 'utf8')).name;
    const plan = planPlatformPackages(generatorContext(root));
    // Matched by NAME, like the script under test: `platformPackageName()` is the
    // one truth for the parent→child mapping, and a path comparison breaks the
    // first time a root sits behind a symlink (macOS `/var` vs `/private/var`).
    let plannedParent = null;
    let planned = null;
    for (const candidate of plan.parents) {
        const hit = candidate.targets.find((t) => t.name === childName);
        if (hit) {
            plannedParent = candidate;
            planned = hit;
            break;
        }
    }
    // A fixture that silently proves nothing is the failure mode this whole
    // comment block is about, so say so instead of asserting on the aftermath.
    assert.ok(planned, `fixture is not a pair: the plan found no target named ${childName}`);
    for (const [name, contents] of Object.entries(
        expectedFiles(plannedParent, { ...planned, state: 'uncommitted', why: FIXTURE_WHY }),
    )) {
        writeFileSync(join(childDir, name), contents);
    }

    // The landing. `artifact` decides whether the generator has bytes to measure
    // — see the parameter's own note for why an empty directory is faithful on
    // darwin and blind on linux.
    const landing = join(childDir, 'prebuilds', target);
    mkdirSync(landing, { recursive: true });
    const source = join(MONOREPO_ROOT, childRel, 'prebuilds', target);
    for (const name of artifact) copyFileSync(join(source, name), join(landing, name));
    return {
        root,
        childRel: toPosix(childRel),
        childDir,
        childName,
        target: planned.target,
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

/** `join()` gives back the host separator; the reported paths are POSIX. */
const toPosix = (p) => p.split(sep).join('/');

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
            assert.deepEqual(cleared, [`${f.childName} ${f.target}`]);
            // Both generated files, not just the manifest.
            assert.deepEqual(paths.sort(), [`${f.childRel}/README.md`, `${f.childRel}/package.json`]);
            assert.deepEqual(auditPlatformPackages(generatorContext(f.root)).failures, []);
        } finally {
            f.cleanup();
        }
    });

    it('clears a `-musl` exemption whose REAL artifact landed, measurement and all', () => {
        // THE CASE THAT WAS MISSING, and it cost the first musl release.
        //
        // Every other case here lands a darwin target, where `measureLibcFields`
        // short-circuits off linux and the generator's manifest cannot depend on
        // what arrived. So nothing in this suite had ever driven the clearer
        // through the measurement it refuses on — and on the first run that did
        // (34311463250, the #1607 merge) it refused: `readElfGlibcRequires`
        // attributed a `GLIBC_2.0` version need to glibc when the file it names is
        // `libgcc_s.so.1`, the generator therefore wanted a
        // `gjsify.glibcRequires` entry on `@gjsify/lightningcss-native-linux-arm64-musl`,
        // and the clearer will not make a measured declaration from a `[skip ci]`
        // job. `commit-prebuilds` stayed red with all thirteen build legs green
        // and the four musl npm packages stayed empty.
        //
        // The pair is the WORST one on purpose: arm64-musl is the only artifact in
        // the tree whose only `GLIBC_*` version need names a non-glibc file, and
        // both of its libraries are copied so the aggregation over a Rust pair is
        // in scope too.
        const f = splitPairFixture({
            pillar: 'infra',
            bridge: 'lightningcss-native',
            target: 'linux-arm64-musl',
            artifact: [
                'libgjsifylightningcss.so',
                'libgjsify_lightningcss.so',
                'GjsifyLightningcss-1.0.typelib',
                'GjsifyLightningcss-1.0.gir',
            ],
        });
        try {
            const { cleared, paths } = clearSatisfiedExemptions(f.root);
            assert.deepEqual(cleared, [`${f.childName} ${f.target}`]);
            assert.deepEqual(paths.sort(), [`${f.childRel}/README.md`, `${f.childRel}/package.json`]);
            // The measured half, stated rather than implied: the artifact is
            // musl-linked, so it keeps the `libc: ["musl"]` its TOKEN gives it and
            // gains NO glibc floor. A floor here would be a promise about glibc
            // made by a binary no glibc host can load.
            const child = JSON.parse(readFileSync(join(f.childDir, 'package.json'), 'utf8'));
            assert.deepEqual(child.libc, ['musl']);
            assert.equal(child.gjsify.glibcRequires, undefined);
            assert.equal(child.gjsify.platformsUncommitted, undefined);
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
            assert.deepEqual(cleared, [`${f.childName} ${f.target}`]);
            assert.equal(readFileSync(join(f.childDir, 'README.md'), 'utf8'), before);
            assert.match(readFileSync(join(f.childDir, 'package.json'), 'utf8'), /platformsUncommitted/);
        } finally {
            f.cleanup();
        }
    });
});
