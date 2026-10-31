// E2E: `new Worker(new URL('./w.mts', import.meta.url))` through the built CLI (#2338, part 1).
//
// A bundle is one file, so a worker script it names must be built as a file of its own and the
// URL pointed at it. Unit specs cover detection and naming; only a CLI run shows that the
// nested builds happen (the native engine has no `emitFile`), that a worker spawned from a
// worker is followed, and that the result RUNS — the load is the claim, so the leg runs the
// bundle before it reads any bytes.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MONOREPO_ROOT, e2eSkipReason, hasCommand } from '../helpers.mjs';

const cliEntry = join(MONOREPO_ROOT, 'packages/infra/cli/lib/index.js');
const fixture = fileURLToPath(new URL('./fixture/main.mts', import.meta.url));

let outDir;

describe(
    'worker-url — a Worker script named by URL is emitted beside the bundle',
    { skip: e2eSkipReason('worker-url', [['a gjs host', hasCommand('gjs')]]), timeout: 10 * 60 * 1000 },
    () => {
        before(() => {
            outDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-worker-url-'));
        });

        after(() => {
            rmSync(outDir, { recursive: true, force: true });
        });

        it('emits the worker and its nested worker, rewrites both URLs, and runs on Node', () => {
            const outfile = join(outDir, 'main.mjs');
            execFileSync(
                process.execPath,
                [cliEntry, 'build', fixture, '--app', 'node', '--outfile', outfile, '--no-minify'],
                { cwd: MONOREPO_ROOT, stdio: 'pipe', timeout: 5 * 60 * 1000 },
            );

            const files = readdirSync(outDir).sort();
            assert.ok(files.includes('outer.worker.mjs'), `outer worker missing: ${files}`);
            assert.ok(files.includes('inner.worker.mjs'), `nested worker missing: ${files}`);

            assert.match(readFileSync(outfile, 'utf-8'), /new URL\("\.\/outer\.worker\.mjs", import\.meta\.url\)/);
            assert.match(readFileSync(join(outDir, 'outer.worker.mjs'), 'utf-8'), /inner\.worker\.mjs/);
            assert.ok(!existsSync(join(outDir, 'main.worker.mjs')), 'the entry is not a worker');

            const out = execFileSync(process.execPath, [outfile], { encoding: 'utf-8', timeout: 60 * 1000 });
            assert.match(out, /WORKER_URL_REPLY=outer>inner/);
        });

        it('runs the --app gjs bundle under gjs with its nested worker', () => {
            const outfile = join(outDir, 'gjs', 'main.mjs');
            execFileSync(
                process.execPath,
                [cliEntry, 'build', fixture, '--app', 'gjs', '--outfile', outfile, '--no-minify'],
                { cwd: MONOREPO_ROOT, stdio: 'pipe', timeout: 5 * 60 * 1000 },
            );
            const files = readdirSync(join(outDir, 'gjs'));
            assert.ok(files.includes('outer.worker.mjs') && files.includes('inner.worker.mjs'), `${files}`);

            const out = execFileSync('gjs', ['-m', outfile], { encoding: 'utf-8', timeout: 60 * 1000 });
            assert.match(out, /WORKER_URL_REPLY=outer>inner/);
        });
    },
);
