// E2E regression test: `gjsify lint <paths>` under the GJS bundle must spawn
// oxlint on a real `node` host — NOT on `process.execPath`.
//
// The bug: `spawnOxcLauncher` used `process.execPath || 'node'` as the
// launcher. Under Node that is the node binary; under the committed GJS bundle
// `process.execPath` is the CLI bundle path itself, so `gjsify lint <file>`
// re-executed the CLI bundle with `oxlint/bin/oxlint` as its first positional
// → yargs printed the top-level command help → and the parent hung forever
// waiting on a child that never linted anything. Fixed by resolving the
// launcher via `nodeBinary()` (PATH `node` under GJS).
//
// This test boots the committed `dist/cli.gjs.mjs` under `gjs` and asserts the
// verbose launcher line names `node` (not the bundle) and that the run
// terminates without printing the top-level help. Skips cleanly when `gjs` or
// `node` is not on PATH (e.g. a Node-only CI leg).

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLI_GJS_BUNDLE = fileURLToPath(new URL('../../../packages/infra/cli/dist/cli.gjs.mjs', import.meta.url));
const REPO_OXLINTRC = fileURLToPath(new URL('../../../.oxlintrc.json', import.meta.url));
// A real repo source file with no lint findings — keeps the run fast + clean.
const TARGET = 'packages/infra/cli/src/commands/lint.ts';

function onPath(bin) {
    try {
        return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
    } catch {
        return false;
    }
}

function runGjs(args, timeoutMs = 40_000) {
    return new Promise((resolve, reject) => {
        const child = spawn('gjs', ['-m', CLI_GJS_BUNDLE, ...args], {
            cwd: REPO_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => (stdout += c));
        child.stderr.on('data', (c) => (stderr += c));
        let timedOut = false;
        const kill = setTimeout(() => {
            timedOut = true;
            // ChildProcess.kill with a known signal never throws — failure
            // to deliver just returns false (the process already exited).
            child.kill('SIGKILL');
        }, timeoutMs);
        child.on('close', (code) => {
            clearTimeout(kill);
            resolve({ status: code, stdout, stderr, timedOut });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

const cleanupDirs = [];

describe('gjsify lint under GJS — spawns oxlint on node, not the bundle', { timeout: 60_000 }, () => {
    after(() => {
        for (const d of cleanupDirs) {
            try {
                rmSync(d, { recursive: true, force: true });
            } catch {
                /* best effort */
            }
        }
    });

    it('lints a file without hanging or printing top-level help', async (t) => {
        if (!onPath('gjs') || !onPath('node')) {
            t.skip('needs both gjs and node on PATH');
            return;
        }

        const r = await runGjs(['lint', '--verbose', TARGET]);

        assert.equal(
            r.timedOut,
            false,
            `gjsify lint hung (SIGKILL after timeout).\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
        );
        const combined = r.stdout + r.stderr;
        // The verbose launcher line must name `node`, not the .mjs bundle.
        assert.match(combined, /\[gjsify oxc\] node /, `launcher must be node, got:\n${combined}`);
        assert.doesNotMatch(
            combined,
            /cli\.gjs\.mjs .*oxlint\/bin\/oxlint/,
            'launcher must not be the CLI bundle re-executing itself',
        );
        // The recursion symptom was the top-level command list ("gjsify <command>").
        assert.doesNotMatch(combined, /gjsify <command>/, 'must not print the top-level help (the recursion symptom)');
        // lint.ts is clean → oxlint exits 0.
        assert.equal(r.status, 0, `expected clean exit 0, got ${r.status}:\n${combined}`);
    });

    it('forwards oxlint diagnostics and a non-zero exit for a file with errors', async (t) => {
        if (!onPath('gjs') || !onPath('node')) {
            t.skip('needs both gjs and node on PATH');
            return;
        }
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-lint-gjs-'));
        cleanupDirs.push(dir);
        const bad = join(dir, 'bad.ts');
        // `no-const-assign` is a correctness=error rule in the repo config.
        writeFileSync(bad, 'const x = 1;\nx = 2;\n');

        const r = await runGjs(['lint', '--config-path', REPO_OXLINTRC, bad]);

        assert.equal(r.timedOut, false, `gjsify lint hung on an error file.\n${r.stdout}${r.stderr}`);
        const combined = r.stdout + r.stderr;
        // The diagnostic must reach the user — regression guard for the GJS
        // spawnSync path silently dropping the child's captured stdout/stderr.
        assert.match(combined, /no-const-assign/, `oxlint diagnostics were not forwarded:\n${combined}`);
        assert.notEqual(r.status, 0, `an error-level finding must exit non-zero, got ${r.status}`);
    });
});
