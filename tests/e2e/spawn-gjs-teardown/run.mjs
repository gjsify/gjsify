// E2E regression test: the GJS teardown contract of `utils/spawn.ts`.
//
// Under GJS, `@gjsify/child_process`'s ASYNC `spawn()` calls `ensureMainLoop()`,
// which arms a GJS main-loop hook (`GLib.MainLoop.runAsync()`). GJS's
// `eval_module` runs that hook once the entry module's top-level await settles,
// entering a blocking `g_main_loop_run()` that nothing ever quits — GJS has no
// atexit hook, and only `process.exit()` tears it down (its `exitProcess`
// idle-schedules `imports.system.exit()` and then drives the default main
// context until it fires, so the syscall runs from inside a dispatch).
//
// So a CLI command that async-spawns a child and then RETURNS NORMALLY parks at
// 0% CPU *after* the child has already exited and been reaped. The symptom — a
// live parent, no children, blocked in `poll` — looks exactly like a lost
// `wait_async` exit callback, which is how it was historically misdiagnosed.
// (Instrumenting the exit handler shows it firing with the correct code; the
// parent then parks on its way out.)
//
// `spawnToCompletion` encodes this as the required `completion` option:
//   - `'exit'`   → the command terminates the process itself → streaming async
//                  spawn stays available (foreach / workspace / check / flatpak)
//   - `'return'` → the command returns → blocking `spawnSync` under GJS (oxc
//                  lint/format/fix, the npm install fallback)
//
// This suite boots the committed `dist/cli.gjs.mjs` under `gjs` and asserts that
// BOTH contracts terminate promptly on a CLEAN (exit-code-0) child — the case
// that hangs, since a non-zero code already exits via `gjsExit`.
//
// Parallel-safe: per-run `mkdtemp`, no fixed ports, no global install dirs.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLI_GJS_BUNDLE = fileURLToPath(new URL('../../../packages/infra/cli/dist/cli.gjs.mjs', import.meta.url));
const REPO_OXLINTRC = fileURLToPath(new URL('../../../.oxlintrc.json', import.meta.url));

function onPath(bin) {
    try {
        return spawnSync(bin, ['--version'], { stdio: 'ignore' }).status === 0;
    } catch {
        return false;
    }
}

/**
 * Run the committed GJS CLI bundle under `gjs`. Resolves with `timedOut: true`
 * when the process had to be SIGKILLed — which is precisely the hang this
 * suite guards against.
 */
function runGjsCli(args, { cwd = REPO_ROOT, timeoutMs = 40_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn('gjs', ['-m', CLI_GJS_BUNDLE, ...args], {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => {
            stdout += c;
        });
        child.stderr.on('data', (c) => {
            stderr += c;
        });
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
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

const cleanupDirs = [];

function makeWorkspace(marker) {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-spawn-teardown-'));
    cleanupDirs.push(root);
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'spawn-teardown-root', private: true, workspaces: ['packages/*'] }, null, 2),
    );
    for (const name of ['alpha', 'beta']) {
        const dir = join(root, 'packages', name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name: `@spawn-teardown/${name}`, version: '0.0.0', private: true }, null, 2),
        );
    }
    return { root, marker };
}

describe('spawn teardown contract under the GJS bundle', { timeout: 180_000 }, () => {
    after(() => {
        for (const d of cleanupDirs) {
            try {
                rmSync(d, { recursive: true, force: true });
            } catch {
                /* best effort */
            }
        }
    });

    it("completion:'exit' — foreach streams child output and still terminates", async (t) => {
        if (!onPath('gjs')) {
            t.skip('needs gjs on PATH');
            return;
        }
        const marker = 'spawn-teardown-exit-marker';
        const { root } = makeWorkspace(marker);

        const r = await runGjsCli(['foreach', '--include', '@spawn-teardown/*', '--exec', '--', '/bin/echo', marker], {
            cwd: root,
        });

        assert.equal(
            r.timedOut,
            false,
            `gjsify foreach parked after its children exited — the GJS main loop armed by ` +
                `spawn() was never quit.\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
        );
        const combined = r.stdout + r.stderr;
        // Streaming must survive: the async path is what makes foreach's
        // per-workspace output (and its parallelism) possible at all.
        assert.match(combined, new RegExp(marker), `child output was not forwarded:\n${combined}`);
        assert.equal(r.status, 0, `expected exit 0, got ${r.status}:\n${combined}`);
    });

    it("completion:'return' — lint terminates on a CLEAN file (exit code 0)", async (t) => {
        // The clean case is the one that hangs: a non-zero oxlint code already
        // leaves via `setOxcExitCode` → `gjsExit`, which quits regardless.
        if (!onPath('gjs') || !onPath('node')) {
            t.skip('needs both gjs and node on PATH');
            return;
        }
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-spawn-teardown-lint-'));
        cleanupDirs.push(dir);
        const clean = join(dir, 'clean.ts');
        writeFileSync(clean, 'export const answer = 42;\n');

        const r = await runGjsCli(['lint', '--config-path', REPO_OXLINTRC, clean]);

        assert.equal(
            r.timedOut,
            false,
            `gjsify lint parked after oxlint exited cleanly — a completion:'return' caller ` +
                `must not leave a GJS main loop armed.\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`,
        );
        assert.equal(r.status, 0, `expected clean exit 0, got ${r.status}:\n${r.stdout}${r.stderr}`);
    });

    it("completion:'return' — lint still forwards diagnostics and a non-zero code", async (t) => {
        if (!onPath('gjs') || !onPath('node')) {
            t.skip('needs both gjs and node on PATH');
            return;
        }
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-spawn-teardown-bad-'));
        cleanupDirs.push(dir);
        const bad = join(dir, 'bad.ts');
        // `no-const-assign` is a correctness=error rule in the repo config.
        writeFileSync(bad, 'const x = 1;\nx = 2;\n');

        const r = await runGjsCli(['lint', '--config-path', REPO_OXLINTRC, bad]);

        assert.equal(r.timedOut, false, `gjsify lint hung on an error file.\n${r.stdout}${r.stderr}`);
        const combined = r.stdout + r.stderr;
        // The blocking path CAPTURES the child's stdio and re-emits it; this is
        // the regression guard for that re-emit being dropped.
        assert.match(combined, /no-const-assign/, `oxlint diagnostics were not forwarded:\n${combined}`);
        assert.notEqual(r.status, 0, `an error-level finding must exit non-zero, got ${r.status}`);
    });
});
