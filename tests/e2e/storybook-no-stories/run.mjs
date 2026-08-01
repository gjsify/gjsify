// E2E regression test: `gjsify storybook` in a project with NO *.story.ts
// files must report the failure ONCE and exit 1 — under GJS too.
//
// The bug: the no-stories branch ended in a bare `process.exit(1)`. Under GJS
// `process.exit()` is DEFERRED (no atexit; the GLib main loop may still be
// armed), so the call RETURNED, execution fell through past the `if` block,
// printed "Found 0 story file(s) …" and went on into the build — and the
// deferred exit never carried its code:
//
//     $ bunx @gjsify/cli storybook   → one message, exit 1
//     $ gjsify storybook             → BOTH messages, exit 0
//
// A command that reports a failure and exits 0 is worse than a crash: any
// script or CI step wrapping it reads success. Fixed with `return
// process.exit(1)` in commands/storybook.ts; the same class is now linted
// repo-wide by `gjsify/deferred-process-exit` (see tests/e2e/oxc-plugin).
//
// This test boots the committed `dist/cli.gjs.mjs` under `gjs` in a scratch
// project (package.json + empty src/) and asserts: exit code 1, the actionable
// no-stories message (pointing at `gjsify showcase adwaita-storybook`), and NO
// "Found 0 story file(s)" fall-through line. Skips cleanly when `gjs` is not
// on PATH (e.g. a Node-only CI leg).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_GJS_BUNDLE = fileURLToPath(new URL('../../../packages/infra/cli/dist/cli.gjs.mjs', import.meta.url));

function onPath(bin) {
    try {
        return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
    } catch {
        return false;
    }
}

const HAVE_GJS = onPath('gjs');

function runGjs(args, cwd, timeoutMs = 60_000) {
    return new Promise((resolve) => {
        const child = spawn('gjs', ['-m', CLI_GJS_BUNDLE, ...args], {
            cwd,
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
            try {
                child.kill('SIGKILL');
            } catch {
                /* already gone */
            }
        }, timeoutMs);
        child.on('close', (code) => {
            clearTimeout(kill);
            resolve({ status: code, stdout, stderr, timedOut });
        });
    });
}

describe('storybook: no stories found exits 1 under GJS', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-storybook-no-stories-'));
        writeFileSync(
            join(tmpDir, 'package.json'),
            JSON.stringify({ name: 'e2e-storybook-empty', type: 'module', private: true }, null, 4) + '\n',
        );
        mkdirSync(join(tmpDir, 'src'));
    });

    after(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('prints ONE actionable message and exits 1 (no fall-through into the build)', { skip: !HAVE_GJS }, async () => {
        const res = await runGjs(['storybook'], tmpDir);
        assert.equal(res.timedOut, false, 'gjsify storybook must terminate (deferred exit must fire)');

        // The failure is reported once, with the pointer at the curated
        // showcase for users who wanted to LOOK at a storybook.
        assert.match(res.stderr, /No \*\.story\.ts files found under src/);
        assert.match(res.stderr, /gjsify showcase adwaita-storybook/);

        // The fall-through line the deferred exit used to allow — the handler
        // must never reach it in the no-stories case.
        const all = res.stdout + res.stderr;
        assert.doesNotMatch(all, /Found 0 story file\(s\)/, `fall-through past the no-stories guard:\n${all}`);

        // And the requested exit code must not be lost.
        assert.equal(
            res.status,
            1,
            `expected exit 1, got ${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
        );
    });
});
