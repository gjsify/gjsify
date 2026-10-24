// E2E regression test: a referenced Worker keeps the process alive on gjs
// (repo issue #2339), and its drain quits the process on Node parity.
//
// The fixture app is the repro verbatim: a CLI script whose entry module has
// NO top-level await spawns an echo Worker and posts to it. Under gjs, nothing
// drives the default main context after such an entry settles — measured with
// an armed 100 ms timer under plain `gjs -m`, which never fired before the
// process quit 0 — so everything the issue needs rides on exactly two seams:
//
//   1. `Worker` construction must ARM a loop while a child is alive
//      (`@gjsify/utils/main-loop` `acquireMainLoop()`), so the reads and the
//      echo round trip get dispatched at all;
//   2. the round trip's end (child exit / `terminate()` / `unref()`) must
//      RELEASE that hold, because GLib's `loop.run()` blocks until `quit()` —
//      there is no "run until no sources remain" for the parked hook to exit
//      on, so without the release a keep-alive fix would park the process
//      forever instead of exiting 0 like Node.
//
// `spawn-gjs-teardown` guards the same contract from the CLI's own
// `child_process` side; this suite guards the `worker_threads` side of the
// same shape. Fixture lives in `mkdtemp` UNDER the checkout so the monorepo's
// `node_modules` resolves the `node:` → `@gjsify/*` substitutions up the
// parent chain (building from a fixture outside the checkout is by design
// unresolvable — see `unresolved-workspace-import`).
//
// The echo worker is a plain file on disk next to the bundle: the child
// spawns `gjs -m <file>` for it and imports `node:worker_threads` bare from
// the registry env the `gjsify run` invocation provides. Bundling worker
// entries into the app itself is the separate #2338 gap — not exercised here.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasCommand, e2eSkipReason, MONOREPO_ROOT } from '../helpers.mjs';

const CLI = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const WORKER_LIB = join(MONOREPO_ROOT, 'packages', 'node', 'worker_threads', 'lib', 'esm', 'index.js');

/** The fixture can only build with `@gjsify/*` resolvable up the parent chain — inside the checkout it is. */

const RE_APP = `import { Worker } from 'node:worker_threads';
const w = new Worker(new URL('./echo-worker.mjs', import.meta.url));
w.on('message', (m) => { console.log('got', m); w.terminate(); });
w.postMessage('hi');
`;

const RE_APP_UNREF = `import { Worker } from 'node:worker_threads';
const w = new Worker(new URL('./echo-worker.mjs', import.meta.url));
w.unref();
w.postMessage('hi');
console.log('posted');
`;

const ECHO = `// Dual-path echo worker — the repo's canonical worker-fixture shape: the GJS child gets parentPort from the bootstrap's published __gjsify_worker_context (a raw gjs -m child cannot resolve a bare node: specifier), Node imports the real module.
const ctx = globalThis.__gjsify_worker_context;
let parentPort;
if (ctx) {
    parentPort = ctx.parentPort;
} else {
    parentPort = (await import('node:worker_threads')).parentPort;
}
parentPort.on('message', (m) => parentPort.postMessage(m));
`;

function build(projectDir, entry, app, outfile) {
    const res = spawnSync('node', [CLI, 'build', `src/${entry}`, '--app', app, '--outfile', `dist/${outfile}`], {
        cwd: projectDir,
        encoding: 'utf8',
        timeout: 5 * 60 * 1000,
        env: { ...process.env, GJSIFY_BUILD_CACHE: '0' },
    });
    return {
        status: res.status,
        output: `${res.stdout ?? ''}${res.stderr ?? ''}`,
        bundle: join(projectDir, 'dist', outfile),
    };
}

/** Run a built bundle with a SIGKILL backstop — timedOut is the parking hang this suite guards against. */
function runBundle(cmd, args, port) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const child = spawn(cmd, args, {
            cwd: port.projectDir,
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
        }, port.timeoutMs ?? 20_000);
        child.on('close', (code) => {
            clearTimeout(kill);
            resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

let projectDir;

// Precondition declaration per tests/AGENTS.md: this suite needs a working
// gjs and the built CLI + worker packages (cheap to rebuild, but the leap
// from "repo checked out" to "built" is exactly what a red-on-missing host
// must not silently skip).
const skip = e2eSkipReason('worker-keepalive', [
    ['gjs on PATH', hasCommand('gjs')],
    ['the built CLI node entry', existsSync(CLI)],
    ['the built @gjsify/worker_threads lib', existsSync(WORKER_LIB)],
]);

describe('worker_threads keep-alive E2E', { timeout: 10 * 60 * 1000 }, () => {
    before(() => {
        if (skip) return;
        mkdirSync(join(MONOREPO_ROOT, '.gjsify-cache'), { recursive: true });
        // Under the gitignored cache root, never under `tests/e2e/`: the shard
        // discovery walks `tests/e2e/*/` and a leftover fixture dir must not
        // look like a suite. Up-chain `node_modules` resolution from here
        // reaches the monorepo's workspace links the same way a consumer
        // reaching installed `@gjsify/*` does (see `unresolved-workspace-import`
        // for the no-`node_modules`-anywhere negative of the same resolver).
        projectDir = mkdtempSync(join(MONOREPO_ROOT, '.gjsify-cache', 'worker-keepalive-tmp-'));
        mkdirSync(join(projectDir, 'src'));
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify(
                { name: 'worker-keepalive-fixture', version: '0.0.0', type: 'module', private: true },
                null,
                2,
            ),
        );
        writeFileSync(join(projectDir, 'src', 'app.mjs'), RE_APP);
        writeFileSync(join(projectDir, 'src', 'app-unref.mjs'), RE_APP_UNREF);
        writeFileSync(join(projectDir, 'src', 'echo-worker.mjs'), ECHO);
    });

    after(() => {
        if (projectDir && !process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(projectDir, { recursive: true, force: true });
    });

    async function gjsRun(srcFile, outfile) {
        const built = build(projectDir, srcFile, 'gjs', outfile);
        assert.equal(built.status, 0, `build failed:\n${built.output}`);
        // The echo worker is a runtime FILE next to the bundle (the child
        // spawns `gjs -m <path>` for the URL target) — not a bundled entry,
        // which is #2338's own gap.
        copyFileSync(join(projectDir, 'src', 'echo-worker.mjs'), join(projectDir, 'dist', 'echo-worker.mjs'));
        return runBundle('gjs', ['-m', built.bundle], { projectDir });
    }

    async function nodeRun(srcFile, outfile) {
        const built = build(projectDir, srcFile, 'node', outfile);
        assert.equal(built.status, 0, `build failed:\n${built.output}`);
        copyFileSync(join(projectDir, 'src', 'echo-worker.mjs'), join(projectDir, 'dist', 'echo-worker.mjs'));
        return runBundle('node', [built.bundle], { projectDir });
    }

    it('gjs: a referenced worker keeps the process alive until the round trip drains', { skip }, async () => {
        const res = await gjsRun('app.mjs', 'app.gjs.mjs');
        assert.equal(res.timedOut, false, `parked past the SIGKILL backstop:\n${res.stdout}\n${res.stderr}`);
        assert.equal(res.code, 0, `exit code ${res.code}:\n${res.stdout}\n${res.stderr}`);
        assert.match(res.stdout, /got hi/, `the echo never landed:\n${res.stdout}\n${res.stderr}`);
        // The drain must not be a slow leak of the whole runtime either.
        assert.ok(res.ms < 15_000, `drained only after ${res.ms} ms`);
    });

    it('node: the same app behaves the same', { skip }, async () => {
        const res = await nodeRun('app.mjs', 'app.node.mjs');
        assert.equal(res.timedOut, false, `parked past the SIGKILL backstop:\n${res.stdout}\n${res.stderr}`);
        assert.equal(res.code, 0, `exit code ${res.code}:\n${res.stdout}\n${res.stderr}`);
        assert.match(res.stdout, /got hi/, `the echo never landed:\n${res.stdout}\n${res.stderr}`);
    });

    it('gjs: unref releases the hold — the process exits promptly instead of parking', { skip }, async () => {
        const res = await gjsRun('app-unref.mjs', 'app-unref.gjs.mjs');
        assert.equal(
            res.timedOut,
            false,
            `parked past the SIGKILL backstop after unref:\n${res.stdout}\n${res.stderr}`,
        );
        assert.equal(res.code, 0, `exit code ${res.code}:\n${res.stdout}\n${res.stderr}`);
        assert.match(res.stdout, /posted/, `the entry never even posted:\n${res.stdout}\n${res.stderr}`);
    });

    it('node: unref does not park either', { skip }, async () => {
        const res = await nodeRun('app-unref.mjs', 'app-unref.node.mjs');
        assert.equal(
            res.timedOut,
            false,
            `parked past the SIGKILL backstop after unref:\n${res.stdout}\n${res.stderr}`,
        );
        assert.equal(res.code, 0, `exit code ${res.code}:\n${res.stdout}\n${res.stderr}`);
        assert.match(res.stdout, /posted/, `the entry never even posted:\n${res.stdout}\n${res.stderr}`);
    });
});
