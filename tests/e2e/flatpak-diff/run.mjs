// E2E test for `gjsify flatpak diff`.
//
// Uses `--against <local-file>` so the test runs offline (no network
// fetch). A stubbed `git` shim controls the resolved local tag.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    writeFileSync,
    mkdirSync,
    chmodSync,
    existsSync,
    mkdtempSync,
    rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

function runCli(args, opts = {}) {
    return execFileSync('node', [CLI_ENTRY, ...args], {
        stdio: opts.stdio ?? 'pipe',
        timeout: opts.timeout ?? 60 * 1000,
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        encoding: 'utf8',
    });
}

describe('CLI flatpak diff E2E', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-flatpak-diff-'));
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        }
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('in-sync: local tag matches flathub manifest', () => {
        const dir = join(tmpDir, 'in-sync');
        scaffold(dir, { appId: 'org.example.DiffSync' });
        const flathubPath = writeFlathubFixture(tmpDir, 'in-sync', 'org.example.DiffSync', {
            tag: 'v1.0.0',
            commit: '1111111111111111111111111111111111111111',
        });

        const out = runCli([
            'flatpak', 'diff',
            '--version', 'v1.0.0',
            '--against', flathubPath,
        ], { cwd: dir });

        assert.match(out, /flathub: tag=v1\.0\.0/);
        assert.match(out, /local:.*tag=v1\.0\.0/);
        assert.match(out, /✅ in sync \(v1\.0\.0\)/);
    });

    it('drift: local tag ahead of flathub manifest', () => {
        const dir = join(tmpDir, 'drift');
        scaffold(dir, { appId: 'org.example.DiffDrift' });
        const flathubPath = writeFlathubFixture(tmpDir, 'drift', 'org.example.DiffDrift', {
            tag: 'v0.9.0',
            commit: '2222222222222222222222222222222222222222',
        });

        let exitCode = 0;
        let out = '';
        try {
            runCli(['flatpak', 'diff', '--version', 'v1.0.0', '--against', flathubPath], {
                cwd: dir,
            });
        } catch (e) {
            exitCode = e.status ?? -1;
            out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
        }
        assert.notStrictEqual(exitCode, 0, 'drift should exit non-zero');
        assert.match(out, /❌ drift detected — flathub=v0\.9\.0 vs local=v1\.0\.0/);
        assert.match(out, /gjsify flatpak sync-flathub --version v1\.0\.0/);
    });

    it('--detail prints the full flathub source entry', () => {
        const dir = join(tmpDir, 'detail');
        scaffold(dir, { appId: 'org.example.DiffDetail' });
        const flathubPath = writeFlathubFixture(tmpDir, 'detail', 'org.example.DiffDetail', {
            tag: 'v0.5.0',
            commit: '3333333333333333333333333333333333333333',
        });

        const out = runCli(['flatpak', 'diff', '--version', 'v0.5.0', '--against', flathubPath, '--detail'], {
            cwd: dir,
        });
        assert.match(out, /flathub manifest source:/);
        assert.match(out, /"tag": "v0\.5\.0"/);
    });

    it('errors clearly when --against path missing', () => {
        const dir = join(tmpDir, 'missing-path');
        scaffold(dir, { appId: 'org.example.DiffMiss' });
        let exitCode = 0;
        let err = '';
        try {
            runCli(['flatpak', 'diff', '--version', 'v0.1.0', '--against', join(tmpDir, 'does-not-exist.json')], {
                cwd: dir,
            });
        } catch (e) {
            exitCode = e.status ?? -1;
            err = `${e.stdout ?? ''}${e.stderr ?? ''}`;
        }
        assert.notStrictEqual(exitCode, 0);
        assert.match(err, /--against path .* does not exist/);
    });
});

function scaffold(dir, { appId }) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify(
            { name: appId, version: '1.0.0', type: 'module', private: true, gjsify: { flatpak: { appId } } },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
}

function writeFlathubFixture(tmpDir, suite, appId, { tag, commit }) {
    const fixtureDir = join(tmpDir, `fixture-${suite}`);
    mkdirSync(fixtureDir, { recursive: true });
    const path = join(fixtureDir, `${appId}.json`);
    writeFileSync(
        path,
        JSON.stringify(
            {
                id: appId,
                modules: [{
                    name: appId.split('.').pop(),
                    sources: [{ type: 'git', url: `https://github.com/example/${appId}.git`, tag, commit }],
                }],
            },
            null,
            2,
        ) + '\n',
        'utf-8',
    );
    return path;
}
