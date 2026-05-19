// E2E test for `gjsify flatpak release` — the orchestrator that chains
// init + check + tag + sync-flathub.
//
// Focus: --dry-run only. The real chain would invoke each sub-command
// (init/check/sync-flathub) end-to-end, which their own e2e suites cover.
// Here we verify the orchestrator picks up the right steps in the right
// order and surfaces the right flags forward.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    writeFileSync,
    mkdirSync,
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

describe('CLI flatpak release E2E', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-flatpak-release-'));
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        }
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('--dry-run prints the full chain plan without running any sub-command', () => {
        const dir = join(tmpDir, 'plan');
        scaffold(dir, { appId: 'org.example.ReleasePlan' });

        const out = runCli(['flatpak', 'release', 'v0.6.6', '--dry-run'], { cwd: dir });

        assert.match(out, /starting release of v0\.6\.6/);
        assert.match(out, /init: node .* flatpak init --force/);
        assert.match(out, /check: node .* flatpak check/);
        assert.match(out, /tag: git tag v0\.6\.6.*git push origin v0\.6\.6/);
        assert.match(out, /sync: node .* flatpak sync-flathub --version v0\.6\.6/);
    });

    it('--dry-run --skip-init --skip-check --skip-tag prints sync-only plan', () => {
        const dir = join(tmpDir, 'plan-min');
        scaffold(dir, { appId: 'org.example.ReleaseMin' });

        const out = runCli(
            ['flatpak', 'release', 'v0.7.0', '--dry-run', '--skip-init', '--skip-check', '--skip-tag'],
            { cwd: dir },
        );

        assert.doesNotMatch(out, /init:/);
        assert.doesNotMatch(out, /check:/);
        assert.doesNotMatch(out, /git tag/);
        assert.match(out, /sync: node .* flatpak sync-flathub --version v0\.7\.0/);
    });

    it('forwards --flathub-repo to the sync-flathub step', () => {
        const dir = join(tmpDir, 'forward-repo');
        scaffold(dir, { appId: 'org.example.ReleaseRepo' });

        const out = runCli(
            ['flatpak', 'release', 'v0.5.0', '--dry-run', '--flathub-repo', 'flathub/org.example.ReleaseRepo'],
            { cwd: dir },
        );

        assert.match(out, /flatpak sync-flathub.*--flathub-repo flathub\/org\.example\.ReleaseRepo/);
    });

    it('errors with missing <version> positional', () => {
        const dir = join(tmpDir, 'no-version');
        scaffold(dir, { appId: 'org.example.ReleaseNoVer' });

        let exitCode = 0;
        let err = '';
        try {
            runCli(['flatpak', 'release'], { cwd: dir });
        } catch (e) {
            exitCode = e.status ?? -1;
            err = `${e.stdout ?? ''}${e.stderr ?? ''}`;
        }
        assert.notStrictEqual(exitCode, 0);
        // yargs surfaces the required-positional error in stderr
        assert.match(err, /version/);
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
