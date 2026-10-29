// E2E regression test: async `fs` work started after a child process has
// closed still completes on gjs, instead of the process exiting 0 under it.
//
// THE INCIDENT. Learn6502's translations generator ran `xgettext` through
// `execFile`, then walked the tree with fast-glob, whose `stat`/`lstat` are the
// callback API on Gio's `query_info_async`. It printed "Found xgettext" and
// exited 0 with no output written; the release job then failed on a missing
// locale directory. Since #2388 a child holds the loop (`acquireMainLoop`) and
// drops the hold one macrotask after `close`. The drain found the loop running
// — gjs 1.88.1 enters the hook's `run()` on the first job drain, while a
// top-level await is still pending — saw no counted hold, timer or request,
// and exited. `readdir` survived because it resolves without a Gio callback.
//
// The fix counts each pending Gio async call in `@gjsify/fs` as an active
// request (`trackRequest`, `@gjsify/utils/main-loop`), Node's libuv model.
// Each case below exited 0 with no output before it.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasCommand, e2eSkipReason, MONOREPO_ROOT } from '../helpers.mjs';

const CLI = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const FS_LIB = join(MONOREPO_ROOT, 'packages', 'node', 'fs', 'lib', 'esm', 'index.js');

const APPS = {
    // Top-level await, promise API.
    'tla-promises.mjs': `import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
await new Promise((r) => execFile('true', r));
const s = await stat('.');
console.log('stat ok', s.isDirectory());
`,
    // Top-level await, callback API — fast-glob's shape.
    'tla-callback.mjs': `import { execFile } from 'node:child_process';
import { stat } from 'node:fs';
await new Promise((r) => execFile('true', r));
const s = await new Promise((r, j) => stat('.', (e, st) => (e ? j(e) : r(st))));
console.log('stat ok', s.isDirectory());
`,
    // No top-level await: the entry has long settled when the stat starts.
    'settled-callback.mjs': `import { execFile } from 'node:child_process';
import { stat } from 'node:fs';
execFile('true', () => {
    stat('.', (e, s) => {
        if (e) throw e;
        stat('..', () => console.log('stat ok', s.isDirectory()));
    });
});
`,
};

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

/** Run a bundle with a SIGKILL backstop: a fix that parks instead of exiting is a failure too. */
function runBundle(cmd, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => (stdout += c));
        child.stderr.on('data', (c) => (stderr += c));
        let timedOut = false;
        const kill = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, 20_000);
        child.on('close', (code) => {
            clearTimeout(kill);
            resolve({ code, stdout, stderr, timedOut });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

let projectDir;

const skip = e2eSkipReason('child-then-fs', [
    ['gjs on PATH', hasCommand('gjs')],
    ['the built CLI node entry', existsSync(CLI)],
    ['the built @gjsify/fs lib', existsSync(FS_LIB)],
]);

describe('fs after a child process E2E', { timeout: 10 * 60 * 1000 }, () => {
    before(() => {
        if (skip) return;
        mkdirSync(join(MONOREPO_ROOT, '.gjsify-cache'), { recursive: true });
        projectDir = mkdtempSync(join(MONOREPO_ROOT, '.gjsify-cache', 'child-then-fs-tmp-'));
        mkdirSync(join(projectDir, 'src'));
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify({ name: 'child-then-fs-fixture', version: '0.0.0', type: 'module', private: true }),
        );
        for (const [name, src] of Object.entries(APPS)) writeFileSync(join(projectDir, 'src', name), src);
    });

    after(() => {
        if (projectDir && !process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(projectDir, { recursive: true, force: true });
    });

    for (const name of Object.keys(APPS)) {
        it(`gjs: ${name} finishes its stat and exits 0`, { skip }, async () => {
            const outfile = name.replace(/\.mjs$/, '.gjs.mjs');
            const built = build(projectDir, name, 'gjs', outfile);
            assert.equal(built.status, 0, `build failed:\n${built.output}`);
            const res = await runBundle('gjs', ['-m', built.bundle], projectDir);
            assert.equal(res.timedOut, false, `parked past the SIGKILL backstop:\n${res.stdout}\n${res.stderr}`);
            assert.equal(res.code, 0, `exit code ${res.code}:\n${res.stdout}\n${res.stderr}`);
            assert.match(res.stdout, /stat ok true/, `exited before the stat landed:\n${res.stdout}\n${res.stderr}`);
        });
    }

    it('node: the callback app behaves the same', { skip }, async () => {
        const built = build(projectDir, 'settled-callback.mjs', 'node', 'settled-callback.node.mjs');
        assert.equal(built.status, 0, `build failed:\n${built.output}`);
        const res = await runBundle('node', [built.bundle], projectDir);
        assert.equal(res.code, 0, `exit code ${res.code}:\n${res.stdout}\n${res.stderr}`);
        assert.match(res.stdout, /stat ok true/);
    });
});
