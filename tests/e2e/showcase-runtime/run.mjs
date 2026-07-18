// E2E for the runtime selector `gjsify run --runtime <gjs|node|bun|deno>`
// (the generalization of `gjsify storybook --runtime`).
//
// Exercises the CLI wiring end-to-end WITHOUT a display or the node-gi addon:
// the fixtures are trivial `--app node`-shaped bundles (plain `console.log`, no
// `gi://`), so node/bun/deno run them directly. Covers:
//   - a runtime NOT in the example's `gjsify.example.runtimes` → clean error
//   - a supported runtime → the bundle runs on it (and reports which runtime)
//   - `--runtime` on a non-file target → clean "needs a bundle FILE" error
//   - bun/deno self-skip when not on PATH
//
// Invokes the CLI Node entry (`packages/infra/cli/lib/index.js`) via node, the
// same pattern as `tests/e2e/run-command`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;

function onPath(cmd) {
    try {
        return spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 15_000 }).status === 0;
    } catch {
        return false;
    }
}

function runCli(args, { cwd, timeoutMs = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliEntry, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => (stdout += c));
        child.stderr.on('data', (c) => (stderr += c));
        const kill = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            } catch {}
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

describe('gjsify run --runtime', { timeout: 120_000 }, () => {
    let dir;

    before(() => {
        dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-showcase-runtime-'));
        mkdirSync(join(dir, 'dist'), { recursive: true });
        // A trivial `--app node`-shaped bundle: prints which runtime it ran on.
        writeFileSync(
            join(dir, 'dist', 'app.node.mjs'),
            "const rt = typeof Bun !== 'undefined' ? 'bun' : typeof Deno !== 'undefined' ? 'deno' : 'node';\n" +
                "console.log('ran-on:' + rt);\n",
        );
    });

    after(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    function writePkg(runtimes) {
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                { name: '@gjsify/example-e2e-runtime', private: true, gjsify: { example: { runtimes } } },
                null,
                2,
            ) + '\n',
        );
    }

    it('rejects a runtime the example does not declare with a clean error', async () => {
        writePkg(['gjs']);
        const r = await runCli(['run', '--runtime', 'node', './dist/app.node.mjs'], { cwd: dir });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /does not support --runtime node/);
        assert.match(r.stderr, /Declared runtimes: gjs/);
    });

    it('runs the bundle on node when declared', async () => {
        writePkg(['gjs', 'node', 'bun', 'deno']);
        const r = await runCli(['run', '--runtime', 'node', './dist/app.node.mjs'], { cwd: dir });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /ran-on:node/);
    });

    for (const rt of ['bun', 'deno']) {
        it(`runs the SAME node bundle on ${rt} (or self-skips)`, async (t) => {
            if (!onPath(rt)) {
                t.diagnostic(`${rt} not on PATH — skipped`);
                return;
            }
            writePkg(['gjs', 'node', 'bun', 'deno']);
            const r = await runCli(['run', '--runtime', rt, './dist/app.node.mjs'], { cwd: dir });
            assert.equal(r.status, 0, r.stderr);
            assert.match(r.stdout, new RegExp(`ran-on:${rt}`));
        });
    }

    it('errors when --runtime is given a non-file target', async () => {
        writePkg(['gjs', 'node']);
        const r = await runCli(['run', '--runtime', 'node', 'somescriptname'], { cwd: dir });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /needs a bundle FILE/);
    });

    it('permits any runtime when the example declares none', async () => {
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'no-decl', private: true }, null, 2) + '\n');
        const r = await runCli(['run', '--runtime', 'node', './dist/app.node.mjs'], { cwd: dir });
        assert.equal(r.status, 0, r.stderr);
        assert.match(r.stdout, /ran-on:node/);
    });
});
