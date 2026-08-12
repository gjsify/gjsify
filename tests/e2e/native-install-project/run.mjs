// E2E test for `gjsify install <pkg>` (project-local, native backend).
//
// The Phase D.1 wire-up of the `install` command: previously project-local
// installs delegated to `npm install` via subprocess. Now they route
// through `installPackagesNative` (`@gjsify/{semver,npm-registry,tar}`),
// edit package.json with the resolved version, and write a lockfile.
//
// In-process HTTP mock registry mirrors the dlx-version-pin test harness.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCKFILE_VERSION } from '../helpers.mjs';
import { runCli, startMockRegistry } from '../mock-registry.mjs';

describe('gjsify install <pkg> — project-local native (Phase D.1)', { timeout: 60_000 }, () => {
    let registry, projectDir, cliEntry, envForCli;

    const PACKAGES = {
        'leaf-dep': { '1.0.0': { dependencies: {} } },
        'mid-dep': { '2.1.0': { dependencies: { 'leaf-dep': '^1.0.0' } } },
        'top-pkg': { '0.5.0': { dependencies: { 'mid-dep': '^2.0.0' } } },
    };

    before(async () => {
        registry = await startMockRegistry(PACKAGES);

        projectDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-install-project-'));
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
        envForCli = {
            ...process.env,
            // Native backend is the default; force it here to make the test
            // explicit and robust against changes to the default.
            GJSIFY_INSTALL_BACKEND: 'native',
            // Mock registry — both via the env var and via `.npmrc`.
            npm_config_registry: registry.url,
        };

        // Project package.json: clean slate, no deps yet.
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify(
                {
                    name: 'install-test',
                    version: '0.1.0',
                    type: 'module',
                    private: true,
                },
                null,
                2,
            ) + '\n',
        );
        // Pin registry per project so the native backend's npmrc-loader picks it up.
        writeFileSync(join(projectDir, '.npmrc'), `registry=${registry.url}\n`);
    });

    after(async () => {
        await registry?.close();
        if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    });

    function readPkgJson() {
        return JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
    }

    it('installs a top-level package into node_modules and updates package.json', async () => {
        const r = await runCli(cliEntry, ['install', 'top-pkg'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        // node_modules populated with top-pkg + transitive deps.
        for (const name of ['top-pkg', 'mid-dep', 'leaf-dep']) {
            assert.ok(
                existsSync(join(projectDir, 'node_modules', name, 'package.json')),
                `node_modules/${name}/package.json missing`,
            );
        }

        // package.json gained a `dependencies.top-pkg` entry with the
        // resolved-version range `^0.5.0`.
        const pkg = readPkgJson();
        assert.equal(pkg.dependencies?.['top-pkg'], '^0.5.0', `expected ^0.5.0, got ${pkg.dependencies?.['top-pkg']}`);
    });

    it('honors explicit version specs (top-pkg@^0.5.0)', async () => {
        const r = await runCli(cliEntry, ['install', 'mid-dep@^2.0.0'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}`);
        const pkg = readPkgJson();
        // Explicit range preserved verbatim — does NOT get rewritten to
        // `^2.1.0` (the installed version).
        assert.equal(
            pkg.dependencies?.['mid-dep'],
            '^2.0.0',
            `expected explicit range to be preserved, got ${pkg.dependencies?.['mid-dep']}`,
        );
    });

    it('--save-dev moves the new entry to devDependencies', async () => {
        const r = await runCli(cliEntry, ['install', 'leaf-dep', '--save-dev'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}`);
        const pkg = readPkgJson();
        assert.equal(pkg.devDependencies?.['leaf-dep'], '^1.0.0');
        assert.equal(
            pkg.dependencies?.['leaf-dep'],
            undefined,
            'leaf-dep must not appear in both `dependencies` and `devDependencies`',
        );
    });

    it('writes gjsify-lock.json for reproducible reinstall', async () => {
        const lockPath = join(projectDir, 'gjsify-lock.json');
        assert.ok(existsSync(lockPath), 'gjsify-lock.json missing after install');
        const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
        // Packages keyed by install path since Phase D.7b, so nested
        // `node_modules/` entries (introduced for version-conflict resolution)
        // coexist with hoisted root entries in the same map. v3 since the
        // platform filter added the per-entry `os`/`cpu`/`libc` + `optional`.
        assert.equal(lock.lockfileVersion, LOCKFILE_VERSION, 'lockfile must be the version the writer records');
        const topEntry = lock.packages['node_modules/top-pkg'];
        assert.ok(topEntry, 'lockfile must pin top-pkg at node_modules/top-pkg');
        assert.match(topEntry.integrity, /^sha512-/);
    });

    // Note: a previous revision asserted that workspace-root install FAILS
    // with a Phase-D.3 marker. D.3 wired the workspace-aware path, so the
    // workspace coverage lives in `tests/e2e/workspace-install/run.mjs` now.

    it('detects Yarn PnP and errors with actionable guidance (no broken npm-backend tip)', async () => {
        const pnpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-install-pnp-'));
        try {
            writeFileSync(
                join(pnpRoot, 'package.json'),
                JSON.stringify(
                    {
                        name: 'pnp-test',
                        version: '0.0.1',
                        type: 'module',
                        private: true,
                    },
                    null,
                    2,
                ) + '\n',
            );
            writeFileSync(join(pnpRoot, '.pnp.cjs'), '// PnP marker\n');

            const r = await runCli(cliEntry, ['install', 'leaf-dep'], { cwd: pnpRoot, env: envForCli });
            assert.notEqual(r.status, 0, 'PnP-marked project should error');
            const combined = r.stdout + r.stderr;
            assert.match(combined, /Yarn PnP|\.pnp\.cjs/i, `expected error to mention PnP, got: ${combined}`);
            // Both real fixes must be spelled out: remove the residue, or switch
            // yarn to the node_modules linker.
            assert.match(
                combined,
                /rm -f \.pnp\.cjs/,
                `expected error to suggest removing the PnP residue, got: ${combined}`,
            );
            assert.match(
                combined,
                /nodeLinker: node-modules/,
                `expected error to mention the node-modules linker option, got: ${combined}`,
            );
            // Must NOT *recommend* the npm backend: it fails on `workspace:` specs
            // (EUNSUPPORTEDPROTOCOL), the second wall workspace repos hit. (The
            // unrelated `--backend` flag help text yargs auto-prints on error may
            // still name the env var — we only forbid the `=npm` recommendation.)
            assert.doesNotMatch(
                combined,
                /GJSIFY_INSTALL_BACKEND=npm/,
                `error should no longer recommend setting GJSIFY_INSTALL_BACKEND=npm, got: ${combined}`,
            );
        } finally {
            rmSync(pnpRoot, { recursive: true, force: true });
        }
    });
});
