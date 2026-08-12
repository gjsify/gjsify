// E2E test for `gjsify install --immutable` (Phase D.6).
//
// Verifies CI-mode behaviour:
//   - Lockfile MUST exist (no implicit resolve).
//   - Drift between `package.json` and `gjsify-lock.json#requested`
//     surfaces a concrete error naming the added/removed deps.
//   - When in sync: install reads the lockfile verbatim, populates
//     `node_modules/`, and does NOT rewrite the lockfile bytes (the
//     guarantee CI depends on).
//   - `--immutable` is incompatible with `<pkg>` args and `--global`.
//
// Uses the shared npm harness (`../mock-registry.mjs`). We start clean each test
// run, perform one initial seeding install (without --immutable) to get
// a fresh lockfile, then exercise the immutable-mode behaviours against
// it.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, startMockRegistry } from '../mock-registry.mjs';

describe('gjsify install --immutable (Phase D.6)', { timeout: 90_000 }, () => {
    let registry, cliEntry, envForCli;

    const PACKAGES = {
        'leaf-dep': { '1.0.0': { dependencies: {} } },
        'mid-dep': { '2.1.0': { dependencies: { 'leaf-dep': '^1.0.0' } } },
    };

    before(async () => {
        registry = await startMockRegistry(PACKAGES);

        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
        envForCli = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registry.url,
        };
    });

    after(async () => {
        await registry?.close();
    });

    /** Build a fresh project directory pre-seeded with a lockfile by running
     *  one regular (non-immutable) install. Returns the absolute project path. */
    async function seedProject({ dep = 'mid-dep', range = '^2.0.0' } = {}) {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-immutable-'));
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                {
                    name: 'immutable-test',
                    version: '0.1.0',
                    type: 'module',
                    private: true,
                    dependencies: { [dep]: range },
                },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(dir, '.npmrc'), `registry=${registry.url}\n`);
        const r = await runCli(cliEntry, ['install'], { cwd: dir, env: envForCli });
        assert.equal(r.status, 0, `seed install failed: ${r.stderr}\n${r.stdout}`);
        assert.ok(existsSync(join(dir, 'gjsify-lock.json')), 'seed install must produce a lockfile');
        return dir;
    }

    it('errors when no lockfile is present', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-immutable-nolock-'));
        try {
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify(
                    {
                        name: 't',
                        version: '0.1.0',
                        type: 'module',
                        private: true,
                        dependencies: { 'leaf-dep': '^1.0.0' },
                    },
                    null,
                    2,
                ) + '\n',
            );
            writeFileSync(join(dir, '.npmrc'), `registry=${registry.url}\n`);

            const r = await runCli(cliEntry, ['install', '--immutable'], { cwd: dir, env: envForCli });
            assert.notEqual(r.status, 0, 'expected failure when lockfile missing');
            assert.match(r.stdout + r.stderr, /--immutable requires .*gjsify-lock\.json/i);
            // No node_modules side-effect when --immutable rejects.
            assert.ok(
                !existsSync(join(dir, 'node_modules', 'leaf-dep')),
                'must not install anything when --immutable lockfile-missing error fires',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('errors when package.json has added a dep the lockfile does not pin', async () => {
        const dir = await seedProject({ dep: 'mid-dep', range: '^2.0.0' });
        try {
            // Add `leaf-dep` as an extra dep, do NOT refresh the lockfile.
            const pkgPath = join(dir, 'package.json');
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            pkg.dependencies['leaf-dep'] = '^1.0.0';
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

            const r = await runCli(cliEntry, ['install', '--immutable'], { cwd: dir, env: envForCli });
            assert.notEqual(r.status, 0, 'expected failure on lockfile drift');
            const combined = r.stdout + r.stderr;
            assert.match(combined, /stale|drift/i);
            // Diff listing should call out the added spec by name.
            assert.match(combined, /leaf-dep@\^1\.0\.0/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('succeeds when lockfile is in sync, populates node_modules, does NOT rewrite the lockfile', async () => {
        const dir = await seedProject({ dep: 'mid-dep', range: '^2.0.0' });
        try {
            // Capture lockfile bytes BEFORE the immutable install.
            const lockPath = join(dir, 'gjsify-lock.json');
            const before = readFileSync(lockPath);

            // Blow away node_modules so we are testing a real reinstall path,
            // not a no-op.
            rmSync(join(dir, 'node_modules'), { recursive: true, force: true });

            const r = await runCli(cliEntry, ['install', '--immutable'], { cwd: dir, env: envForCli });
            assert.equal(r.status, 0, `--immutable install failed: ${r.stderr}\n${r.stdout}`);

            // Direct + transitive deps materialised from the lockfile.
            for (const name of ['mid-dep', 'leaf-dep']) {
                assert.ok(
                    existsSync(join(dir, 'node_modules', name, 'package.json')),
                    `node_modules/${name}/package.json missing`,
                );
            }

            // Lockfile bytes unchanged — the CI byte-stability guarantee.
            const after = readFileSync(lockPath);
            assert.deepEqual(before, after, '--immutable must not rewrite gjsify-lock.json');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('rejects --immutable with <pkg> arguments', async () => {
        const dir = await seedProject();
        try {
            const r = await runCli(cliEntry, ['install', '--immutable', 'leaf-dep'], { cwd: dir, env: envForCli });
            assert.notEqual(r.status, 0);
            assert.match(r.stdout + r.stderr, /--immutable does not accept package arguments/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('rejects --immutable combined with --global', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-immutable-global-'));
        try {
            const r = await runCli(cliEntry, ['install', '--immutable', '--global'], { cwd: dir, env: envForCli });
            assert.notEqual(r.status, 0);
            assert.match(r.stdout + r.stderr, /--immutable is incompatible with --global/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('--immutable works at workspace-root (D.3 + D.6 interaction)', async () => {
        // Synthetic 2-workspace monorepo, one of which depends on a registry dep.
        const root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-immutable-ws-'));
        try {
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify(
                    {
                        name: 'immutable-ws',
                        version: '0.0.0',
                        private: true,
                        type: 'module',
                        workspaces: ['packages/*'],
                    },
                    null,
                    2,
                ) + '\n',
            );
            writeFileSync(join(root, '.npmrc'), `registry=${registry.url}\n`);

            mkdirSync(join(root, 'packages', 'app'), { recursive: true });
            writeFileSync(
                join(root, 'packages', 'app', 'package.json'),
                JSON.stringify(
                    {
                        name: '@imm/app',
                        version: '0.1.0',
                        type: 'module',
                        dependencies: { 'leaf-dep': '^1.0.0' },
                    },
                    null,
                    2,
                ) + '\n',
            );

            // Seed: regular workspace install → produces a lockfile.
            const seed = await runCli(cliEntry, ['install'], { cwd: root, env: envForCli });
            assert.equal(seed.status, 0, `seed: ${seed.stderr}\n${seed.stdout}`);
            const lockPath = join(root, 'gjsify-lock.json');
            assert.ok(existsSync(lockPath), 'seed must write a workspace lockfile');
            const before = readFileSync(lockPath);

            // Blow away node_modules + run immutable install.
            rmSync(join(root, 'node_modules'), { recursive: true, force: true });
            const r = await runCli(cliEntry, ['install', '--immutable'], { cwd: root, env: envForCli });
            assert.equal(r.status, 0, `--immutable ws install failed: ${r.stderr}\n${r.stdout}`);
            assert.ok(
                existsSync(join(root, 'node_modules', 'leaf-dep', 'package.json')),
                'leaf-dep must be reinstalled from lockfile',
            );

            // Lockfile unchanged.
            const after = readFileSync(lockPath);
            assert.deepEqual(before, after, 'workspace --immutable must not rewrite gjsify-lock.json');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
