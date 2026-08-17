// E2E test for Phase F.8 — `gjsify uninstall -g <pkg>`.
//
// Exercises the symmetric inverse of `gjsify install -g`:
//   - install a package globally → verify tree + bin landed
//   - uninstall the package → verify tree + bin removed
//   - uninstall non-existing package → exit non-zero with clear msg
//   - --dry-run leaves the filesystem alone
//
// Uses the shared in-process mock registry, tests/e2e/mock-registry.mjs.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, startMockRegistry } from '../mock-registry.mjs';

describe('Phase F.8 — gjsify uninstall -g', { timeout: 60_000 }, () => {
    let registry, registryUrl, tmpRoot, cliEntry, envForCli;

    const PACKAGES = {
        'demo-tool': {
            '1.0.0': {
                dependencies: {},
                bin: { 'demo-tool': './bin.js' },
                files: { 'bin.js': '#!/usr/bin/env node\nconsole.log("hi from demo-tool");\n' },
            },
        },
    };

    before(async () => {
        registry = await startMockRegistry(PACKAGES);
        registryUrl = registry.url;

        tmpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-uninstall-'));
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
        envForCli = {
            ...process.env,
            GJSIFY_GLOBAL_PREFIX: join(tmpRoot, 'global'),
            GJSIFY_GLOBAL_BIN_DIR: join(tmpRoot, 'bin'),
            npm_config_registry: registryUrl,
        };
    });

    after(async () => {
        await registry?.close();
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('installs then uninstalls a package globally', async () => {
        const installRes = await runCli(cliEntry, ['install', '-g', 'demo-tool'], { env: envForCli });
        assert.equal(installRes.status, 0, `install failed:\n${installRes.stderr}\n${installRes.stdout}`);
        const pkgDir = join(tmpRoot, 'global', 'node_modules', 'demo-tool');
        const binPath = join(tmpRoot, 'bin', 'demo-tool');
        assert.ok(existsSync(pkgDir), 'package tree not created');
        assert.ok(existsSync(binPath), 'bin shim not created');

        const uninstallRes = await runCli(cliEntry, ['uninstall', '-g', 'demo-tool'], { env: envForCli });
        assert.equal(uninstallRes.status, 0, `uninstall failed:\n${uninstallRes.stderr}\n${uninstallRes.stdout}`);
        assert.equal(existsSync(pkgDir), false, 'package tree not removed');
        assert.equal(existsSync(binPath), false, 'bin shim not removed');
    });

    it('--dry-run leaves the filesystem untouched', async () => {
        const installRes = await runCli(cliEntry, ['install', '-g', 'demo-tool'], { env: envForCli });
        assert.equal(installRes.status, 0, `install failed:\n${installRes.stderr}`);
        const pkgDir = join(tmpRoot, 'global', 'node_modules', 'demo-tool');
        const binPath = join(tmpRoot, 'bin', 'demo-tool');

        const dryRes = await runCli(cliEntry, ['uninstall', '-g', 'demo-tool', '--dry-run'], { env: envForCli });
        assert.equal(dryRes.status, 0, `dry-run failed:\n${dryRes.stderr}`);
        assert.match(dryRes.stdout, /would remove/, 'expected "would remove" in dry-run output');
        assert.ok(existsSync(pkgDir), 'package tree should still exist after dry-run');
        assert.ok(existsSync(binPath), 'bin shim should still exist after dry-run');

        // Clean up for next test.
        await runCli(cliEntry, ['uninstall', '-g', 'demo-tool'], { env: envForCli });
    });

    it('exits non-zero on uninstall of a not-installed package', async () => {
        const r = await runCli(cliEntry, ['uninstall', '-g', 'never-installed-xyz'], { env: envForCli });
        assert.notEqual(r.status, 0, 'expected non-zero exit when nothing was removed');
        assert.match(r.stderr + r.stdout, /not installed/, 'expected "not installed" warning');
    });

    it('refuses uninstall without --global', async () => {
        const r = await runCli(cliEntry, ['uninstall', 'demo-tool'], { env: envForCli });
        assert.notEqual(r.status, 0, 'expected non-zero exit without --global');
        assert.match(r.stderr, /only supports --global/, 'expected explanation message');
    });
});
