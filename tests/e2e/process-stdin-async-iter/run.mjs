// E2E regression test: `for await (const chunk of process.stdin)` works on GJS
// (lotse#13). Node's stdin is a Readable and so async-iterable; gjsify's
// `ProcessReadStream` was a bare EventEmitter and threw "process.stdin is not
// iterable". The fixture reads piped stdin to its end, the idiom every
// "read all of stdin" CLI uses.
//
// Fixture lives in `mkdtemp` UNDER the checkout so the monorepo's `node_modules`
// resolves the `node:` -> `@gjsify/*` substitutions up the parent chain.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasCommand, e2eSkipReason, MONOREPO_ROOT } from '../helpers.mjs';

const CLI = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const PROCESS_LIB = join(MONOREPO_ROOT, 'packages', 'node', 'process', 'lib', 'esm', 'index.js');

const APP = `const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const text = Buffer.concat(chunks).toString('utf8');
console.log('read', JSON.stringify(text));
`;

const APP_ENCODING = `process.stdin.setEncoding('utf8');
let text = '';
for await (const chunk of process.stdin) text += chunk;
console.log('read', JSON.stringify(text));
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

/** Run a bundle with `input` piped to stdin and a SIGKILL backstop. */
function runBundle(cmd, args, cwd, input) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
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
        child.stdin.end(input);
    });
}

let projectDir;

const skip = e2eSkipReason('process-stdin-async-iter', [
    ['gjs on PATH', hasCommand('gjs')],
    ['the built CLI node entry', existsSync(CLI)],
    ['the built @gjsify/process lib', existsSync(PROCESS_LIB)],
]);

describe('process.stdin async iteration E2E', { timeout: 10 * 60 * 1000 }, () => {
    before(() => {
        if (skip) return;
        mkdirSync(join(MONOREPO_ROOT, '.gjsify-cache'), { recursive: true });
        projectDir = mkdtempSync(join(MONOREPO_ROOT, '.gjsify-cache', 'process-stdin-async-iter-tmp-'));
        mkdirSync(join(projectDir, 'src'));
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify({ name: 'stdin-async-iter-fixture', version: '0.0.0', type: 'module', private: true }),
        );
        writeFileSync(join(projectDir, 'src', 'app.mjs'), APP);
        writeFileSync(join(projectDir, 'src', 'encoding.mjs'), APP_ENCODING);
    });

    after(() => {
        if (projectDir && !process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(projectDir, { recursive: true, force: true });
    });

    for (const app of ['gjs', 'node']) {
        for (const [name, expected] of [
            ['app', 'héllo\nwörld\n'],
            ['encoding', 'héllo\nwörld\n'],
        ]) {
            it(`${app}: for await over piped stdin (${name})`, { skip }, async () => {
                const built = build(projectDir, `${name}.mjs`, app, `${name}.${app}.mjs`);
                assert.equal(built.status, 0, `build failed:\n${built.output}`);
                const res = await runBundle(
                    app === 'gjs' ? 'gjs' : 'node',
                    app === 'gjs' ? ['-m', built.bundle] : [built.bundle],
                    projectDir,
                    expected,
                );
                assert.equal(res.timedOut, false, `parked past the SIGKILL backstop:\n${res.stdout}\n${res.stderr}`);
                assert.equal(res.code, 0, `exit code ${res.code}:\n${res.stdout}\n${res.stderr}`);
                assert.ok(
                    res.stdout.includes(`read ${JSON.stringify(expected)}`),
                    `unexpected output:\n${res.stdout}\n${res.stderr}`,
                );
            });
        }
    }
});
