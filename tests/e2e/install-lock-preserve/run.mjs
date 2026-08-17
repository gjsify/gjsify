// E2E test for `gjsify install` LOCKFILE PRESERVATION (the npm/yarn/pnpm
// default that gjsify was missing).
//
// Before the fix, any resolve that had to run (e.g. adding one package) went
// through a FULL re-resolution that bumped every `^`-range to the newest
// registry match — silently churning unrelated transitive deps. The fix: a
// resolve seeds itself with the versions already pinned in the lockfile, so an
// add only moves the genuinely new/changed deps. `--refresh-lockfile` opts back
// into the bump-everything behaviour (≈ `yarn install --mode=update-lockfile`).
//
// Scenario (a mutable mock registry simulates "a newer version was published
// after the initial install"):
//   1. package.json deps {dep-a@^1.0.0}; registry exposes only dep-a@1.0.0.
//      `gjsify install` → lock pins dep-a@1.0.0.
//   2. Registry now ALSO exposes dep-a@1.1.0 (still satisfies ^1.0.0).
//      Add dep-b to package.json + `gjsify install` → dep-a STAYS 1.0.0
//      (preserved), dep-b@1.0.0 added.
//   3. `gjsify install --refresh-lockfile` → dep-a bumps to 1.1.0.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, startMockRegistry } from '../mock-registry.mjs';

/** One version's manifest fields plus the file it ships. */
function versionSpec(name, version) {
    return {
        main: 'index.js',
        dependencies: {},
        files: { 'index.js': `module.exports = ${JSON.stringify({ name, version })};\n` },
    };
}

/** Read the resolved version of `name` at the hoisted root path in the lockfile. */
function lockedVersion(projectDir, name) {
    const lock = JSON.parse(readFileSync(join(projectDir, 'gjsify-lock.json'), 'utf-8'));
    return lock.packages?.[`node_modules/${name}`]?.version;
}

describe('gjsify install — lockfile preservation', { timeout: 90_000 }, () => {
    let registry, registryUrl, projectDir, cliEntry, envForCli;

    // Mutable: when false, dep-a's packument hides 1.1.0 (only 1.0.0 visible).
    let exposeNewer = false;

    const PACKAGES = {
        'dep-a': { '1.0.0': versionSpec('dep-a', '1.0.0'), '1.1.0': versionSpec('dep-a', '1.1.0') },
        'dep-b': { '1.0.0': versionSpec('dep-b', '1.0.0') },
    };

    before(async () => {
        registry = await startMockRegistry(PACKAGES, {
            // Hiding a version in the DOCUMENT, not in the store: the tarball
            // route keeps serving 1.1.0, which is what makes step 3's
            // `--refresh-lockfile` install it the moment it becomes visible.
            // `dist-tags` is recomputed after this hook, so `latest` falls back
            // to 1.0.0 while 1.1.0 is hidden — the behaviour the hand-rolled
            // `visibleVersions()` produced.
            onPackument: (doc, { name }) => {
                if (name === 'dep-a' && !exposeNewer) delete doc.versions['1.1.0'];
            },
        });
        registryUrl = registry.url;

        projectDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-preserve-'));
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
        envForCli = { ...process.env, GJSIFY_INSTALL_BACKEND: 'native', npm_config_registry: registryUrl };

        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify(
                {
                    name: 'preserve-test',
                    version: '0.1.0',
                    type: 'commonjs',
                    private: true,
                    dependencies: { 'dep-a': '^1.0.0' },
                },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(projectDir, '.npmrc'), `registry=${registryUrl}\n`);
    });

    after(async () => {
        await registry?.close();
        if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    });

    it('initial install pins dep-a@1.0.0 (only version visible)', async () => {
        exposeNewer = false;
        const r = await runCli(cliEntry, ['install'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.equal(lockedVersion(projectDir, 'dep-a'), '1.0.0');
    });

    it('adding dep-b PRESERVES dep-a@1.0.0 even though 1.1.0 now satisfies ^1.0.0', async () => {
        // A newer dep-a is now published — a naive re-resolve would bump to it.
        exposeNewer = true;
        const pkgPath = join(projectDir, 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        pkg.dependencies['dep-b'] = '^1.0.0';
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

        const r = await runCli(cliEntry, ['install'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        assert.equal(lockedVersion(projectDir, 'dep-a'), '1.0.0', 'dep-a must NOT bump on an add (lockfile preserved)');
        assert.equal(lockedVersion(projectDir, 'dep-b'), '1.0.0', 'dep-b must be added');
    });

    it('--refresh-lockfile bumps dep-a to the newest in-range version (1.1.0)', async () => {
        exposeNewer = true;
        const r = await runCli(cliEntry, ['install', '--refresh-lockfile'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.equal(lockedVersion(projectDir, 'dep-a'), '1.1.0', '--refresh-lockfile must bump within ranges');
    });

    it('--immutable + --refresh-lockfile is rejected', async () => {
        const r = await runCli(cliEntry, ['install', '--immutable', '--refresh-lockfile'], {
            cwd: projectDir,
            env: envForCli,
        });
        assert.notEqual(r.status, 0, 'the contradictory flag combo must fail');
        assert.match(r.stderr, /incompatible/i);
    });
});
