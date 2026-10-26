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

// Node keeps the process for work the entry still has pending after a child closed:
// a top-level await (AFTER_AWAIT), a timer armed from the close callback (TIMER_AFTER_CLOSE),
// one armed BEFORE the spawn (TIMER_BEFORE), and a TCP round trip to a local server (NET_AFTER_CLOSE; `net`, since `http` needs the soup bridge typelib).
// PLAIN_TIMER is the control: no child, so no counted hold, and it must still exit by itself
// (a timer with NO top-level await is dropped by gjs at module settle, with or without this fix).
const APP_AFTER_AWAIT = `import { spawn } from 'node:child_process';
const c = spawn('true');
await new Promise((r) => c.on('close', r));
console.log('closed');
await new Promise((r) => setTimeout(r, 300));
console.log('after');
`;

const APP_TIMER_AFTER_CLOSE = `import { exec } from 'node:child_process';
exec('true', () => {
  console.log('closed');
  setTimeout(() => console.log('later'), 500);
});
`;

const APP_TIMER_BEFORE = `import { spawn } from 'node:child_process';
setTimeout(() => console.log('timer'), 400);
const c = spawn('true');
c.on('close', () => console.log('closed'));
`;

const APP_NET_AFTER_CLOSE = `import { spawn } from 'node:child_process';
import net from 'node:net';
const server = net.createServer((sock) => sock.end('pong'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const c = spawn('true');
await new Promise((r) => c.on('close', r));
console.log('closed');
const body = await new Promise((resolve, reject) => {
  let b = '';
  const sock = net.connect(server.address().port, '127.0.0.1');
  sock.setEncoding('utf8');
  sock.on('data', (d) => { b += d; });
  sock.on('end', () => resolve(b));
  sock.on('error', reject);
});
console.log('body', body);
server.close();
// net parks the loop for good (uncounted ensureMainLoop, a known limit), so end explicitly
process.exit(0);
`;

const APP_PLAIN_TIMER = `await new Promise((r) => setTimeout(r, 100));
console.log('fired');
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
        writeFileSync(join(projectDir, 'src', 'after-await.mjs'), APP_AFTER_AWAIT);
        writeFileSync(join(projectDir, 'src', 'timer-after-close.mjs'), APP_TIMER_AFTER_CLOSE);
        writeFileSync(join(projectDir, 'src', 'timer-before.mjs'), APP_TIMER_BEFORE);
        writeFileSync(join(projectDir, 'src', 'net-after-close.mjs'), APP_NET_AFTER_CLOSE);
        writeFileSync(join(projectDir, 'src', 'plain-timer.mjs'), APP_PLAIN_TIMER);
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

        it(`${app}: a pending top-level await survives the child's close`, { skip }, async () => {
            const res = await run(app, 'after-await');
            assert.match(res.stdout, /closed\nafter/);
        });

        it(`${app}: a timer armed from the close callback still fires`, { skip }, async () => {
            const res = await run(app, 'timer-after-close');
            assert.match(res.stdout, /closed\nlater/);
        });

        it(`${app}: a timer armed before the spawn still fires`, { skip }, async () => {
            const res = await run(app, 'timer-before');
            assert.match(res.stdout, /closed\ntimer/);
        });

        it(`${app}: a socket round trip after the close completes`, { skip }, async () => {
            const res = await run(app, 'net-after-close');
            assert.match(res.stdout, /closed\nbody pong/);
        });

        it(`${app}: a plain timer script (no child) fires and exits`, { skip }, async () => {
            const res = await run(app, 'plain-timer');
            assert.match(res.stdout, /fired/);
        });
    }
});
