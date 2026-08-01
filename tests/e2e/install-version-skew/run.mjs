// E2E test for `gjsify install`'s CLI/workspace version-skew warning.
//
// Running a gjsify CLI that is out of step with the @gjsify/cli the workspace
// pins is the documented root cause of two hard-to-diagnose failures: the
// install stalls (a mismatched CLI discards the lock → full re-resolve → a
// wedge-prone extract) and silent-wrong-builds (stale CLI, stale bundle
// semantics). `warnOnCliVersionSkew` (install.ts) surfaces the mismatch as a
// single actionable line BEFORE the heavy install, pointing at `gjsify
// self-update`. This test drives the real install command against a workspace
// whose `node_modules/@gjsify/cli/package.json` pins a different version.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

function runCli(cliEntry, args, { cwd, env, timeoutMs = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliEntry, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => (stdout += c));
        child.stderr.on('data', (c) => (stderr += c));
        const kill = setTimeout(() => {
            // ChildProcess.kill with a known signal never throws — failure
            // to deliver just returns false (the process already exited).
            child.kill('SIGKILL');
        }, timeoutMs);
        child.on('close', (code) => {
            clearTimeout(kill);
            resolve({ status: code, stdout, stderr });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

// A dependency-free workspace pinning @gjsify/cli at `pinnedVersion` under
// node_modules — so the install itself is a no-op ("nothing to do") and the
// test isolates the skew-warning behavior.
function makeWorkspace(pinnedVersion) {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-version-skew-'));
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'skew-consumer', version: '1.0.0', type: 'module', private: true }, null, 2) + '\n',
    );
    const cliDir = join(dir, 'node_modules', '@gjsify', 'cli');
    mkdirSync(cliDir, { recursive: true });
    writeFileSync(join(cliDir, 'package.json'), JSON.stringify({ name: '@gjsify/cli', version: pinnedVersion }) + '\n');
    return dir;
}

describe('gjsify install — CLI/workspace version-skew warning', { timeout: 60_000 }, () => {
    let cliEntry, runningVersion;

    before(() => {
        cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
        runningVersion = JSON.parse(
            readFileSync(new URL('../../../packages/infra/cli/package.json', import.meta.url), 'utf-8'),
        ).version;
    });

    it('warns when the pinned @gjsify/cli differs from the running CLI', async () => {
        const dir = makeWorkspace('0.0.1-test-mismatch');
        try {
            const r = await runCli(cliEntry, ['install'], {
                cwd: dir,
                env: { ...process.env, GJSIFY_INSTALL_BACKEND: 'native' },
            });
            const combined = r.stdout + r.stderr;
            assert.match(combined, /version skew/i, `expected a skew warning, got: ${combined}`);
            assert.match(combined, /0\.0\.1-test-mismatch/, 'warning must name the pinned version');
            assert.match(
                combined,
                new RegExp(runningVersion.replace(/\./g, '\\.')),
                'warning must name the running version',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('suppresses the warning under GJSIFY_NO_VERSION_SKEW_WARNING=1', async () => {
        const dir = makeWorkspace('0.0.1-test-mismatch');
        try {
            const r = await runCli(cliEntry, ['install'], {
                cwd: dir,
                env: { ...process.env, GJSIFY_INSTALL_BACKEND: 'native', GJSIFY_NO_VERSION_SKEW_WARNING: '1' },
            });
            assert.doesNotMatch(r.stdout + r.stderr, /version skew/i, 'skew warning must be suppressed');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('does not warn when the pinned version matches the running CLI', async () => {
        const dir = makeWorkspace(runningVersion);
        try {
            const r = await runCli(cliEntry, ['install'], {
                cwd: dir,
                env: { ...process.env, GJSIFY_INSTALL_BACKEND: 'native' },
            });
            assert.doesNotMatch(r.stdout + r.stderr, /version skew/i, 'no skew warning when versions match');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
