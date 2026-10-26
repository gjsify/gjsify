// E2E regression test: a spawned child holds the GJS process only until it has
// closed (lotse#13). Before, `spawn()` armed the loop with the UNCOUNTED
// `ensureMainLoop()`, so the hook parked in `g_main_loop_run()` for good once the
// entry settled — even for a plain `sh -c 'echo hi'` that exited on its own —
// and a consumer had to end every command with `setTimeout(process.exit, 50)`.
//
// The fixtures are the consumer's shapes, bare:
//   - listeners: stdout/stderr listeners + `once('exit')` the entry never removes
//   - sequential: one child's `close` continuation spawns the next (the release
//     must not drain the count between them, or the second child dies unread)
//   - kill: top-level await, SIGTERM after a match, await the exit, return
//
// Fixtures live in `mkdtemp` UNDER the checkout so the monorepo's `node_modules`
// resolves the `node:` -> `@gjsify/*` substitutions up the parent chain.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasCommand, e2eSkipReason, MONOREPO_ROOT } from '../helpers.mjs';

const CLI = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const CHILD_LIB = join(MONOREPO_ROOT, 'packages', 'node', 'child_process', 'lib', 'esm', 'index.js');

const APP_LISTENERS = `import { spawn } from 'node:child_process';
const child = spawn('sh', ['-c', 'echo hi'], { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => console.log('data', JSON.stringify(c)));
child.stderr.on('data', () => undefined);
child.once('exit', (code) => console.log('exit', code));
console.log('returned');
`;

const APP_SEQUENTIAL = `import { spawn } from 'node:child_process';
function run(word) {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', 'echo ' + word], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.on('close', () => resolve(out.trim()));
  });
}
console.log('first', await run('one'));
console.log('second', await run('two'));
`;

const APP_KILL = `import { spawn } from 'node:child_process';
const child = spawn('sh', ['-c', 'echo ready; sleep 30'], { stdio: ['ignore', 'pipe', 'pipe'] });
const exited = new Promise((resolve) => child.once('exit', resolve));
await new Promise((resolve) => {
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => { if (c.includes('ready')) resolve(); });
});
child.kill('SIGTERM');
await exited;
console.log('stopped');
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

/** Run a built bundle with a SIGKILL backstop — `timedOut` is the parking hang this suite guards against. */
function runBundle(cmd, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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

const skip = e2eSkipReason('child-process-keepalive', [
    ['gjs on PATH', hasCommand('gjs')],
    ['sh on PATH', hasCommand('sh')],
    ['the built CLI node entry', existsSync(CLI)],
    ['the built @gjsify/child_process lib', existsSync(CHILD_LIB)],
]);

describe('child_process keep-alive E2E', { timeout: 10 * 60 * 1000 }, () => {
    before(() => {
        if (skip) return;
        mkdirSync(join(MONOREPO_ROOT, '.gjsify-cache'), { recursive: true });
        projectDir = mkdtempSync(join(MONOREPO_ROOT, '.gjsify-cache', 'child-process-keepalive-tmp-'));
        mkdirSync(join(projectDir, 'src'));
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify({
                name: 'child-process-keepalive-fixture',
                version: '0.0.0',
                type: 'module',
                private: true,
            }),
        );
        writeFileSync(join(projectDir, 'src', 'listeners.mjs'), APP_LISTENERS);
        writeFileSync(join(projectDir, 'src', 'sequential.mjs'), APP_SEQUENTIAL);
        writeFileSync(join(projectDir, 'src', 'kill.mjs'), APP_KILL);
    });

    after(() => {
        if (projectDir && !process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(projectDir, { recursive: true, force: true });
    });

    async function run(app, name) {
        const built = build(projectDir, `${name}.mjs`, app, `${name}.${app}.mjs`);
        assert.equal(built.status, 0, `build failed:\n${built.output}`);
        const res = await runBundle(
            app === 'gjs' ? 'gjs' : 'node',
            app === 'gjs' ? ['-m', built.bundle] : [built.bundle],
            projectDir,
        );
        assert.equal(res.timedOut, false, `parked past the SIGKILL backstop:\n${res.stdout}\n${res.stderr}`);
        assert.equal(res.code, 0, `exit code ${res.code}:\n${res.stdout}\n${res.stderr}`);
        return res;
    }

    for (const app of ['gjs', 'node']) {
        it(`${app}: a child with stdio listeners does not outlive its close`, { skip }, async () => {
            const res = await run(app, 'listeners');
            assert.match(res.stdout, /data "hi\\n"/);
            assert.match(res.stdout, /exit 0/);
        });

        it(`${app}: sequential children each run to completion`, { skip }, async () => {
            const res = await run(app, 'sequential');
            assert.match(res.stdout, /first one/);
            assert.match(res.stdout, /second two/);
        });

        it(`${app}: kill + await exit ends the process`, { skip }, async () => {
            const res = await run(app, 'kill');
            assert.match(res.stdout, /stopped/);
        });
    }
});
