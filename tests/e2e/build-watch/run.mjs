// E2E test for `gjsify build --watch`.
//
// Spawns the locally built CLI in watch mode, waits for the first build,
// modifies the source file, asserts the second build picks up the change,
// then SIGINTs and verifies the outfile reflects the latest source.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
    writeFileSync,
    readFileSync,
    mkdirSync,
    existsSync,
    mkdtempSync,
    rmSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

describe('CLI build --watch E2E', { timeout: 2 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-build-watch-'));
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY} — run \`yarn workspace @gjsify/cli build\``);
        }
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('rebuilds on source change and exits cleanly on SIGINT', async () => {
        const projectDir = join(tmpDir, 'watch-basic');
        mkdirSync(join(projectDir, 'src'), { recursive: true });
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify({ name: 'watch-basic', version: '1.0.0', type: 'module', private: true }, null, 2) + '\n',
            'utf-8',
        );
        const srcPath = join(projectDir, 'src', 'index.ts');
        writeFileSync(srcPath, "export const msg = 'first';\nconsole.log(msg);\n", 'utf-8');
        const outfilePath = join(projectDir, 'dist', 'out.mjs');

        const child = spawn(
            'node',
            [
                CLI_ENTRY,
                'build',
                'src/index.ts',
                '--app',
                'node',
                '--outfile',
                outfilePath,
                '--watch',
                '--no-minify',
            ],
            {
                cwd: projectDir,
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );

        let stdoutBuf = '';
        child.stdout.on('data', (chunk) => {
            stdoutBuf += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stdoutBuf += chunk.toString();
        });

        const waitForOutput = (pattern, timeoutMs) =>
            new Promise((resolve, reject) => {
                if (pattern.test(stdoutBuf)) return resolve();
                const onData = () => {
                    if (pattern.test(stdoutBuf)) {
                        cleanup();
                        resolve();
                    }
                };
                const timer = setTimeout(() => {
                    cleanup();
                    reject(new Error(`timeout waiting for ${pattern}; got: ${stdoutBuf.slice(-1000)}`));
                }, timeoutMs);
                const cleanup = () => {
                    clearTimeout(timer);
                    child.stdout.off('data', onData);
                    child.stderr.off('data', onData);
                };
                child.stdout.on('data', onData);
                child.stderr.on('data', onData);
            });

        const exited = new Promise((resolve) => {
            child.on('exit', (code, signal) => resolve({ code, signal }));
        });

        try {
            // First build
            await waitForOutput(/built in \d+ms/, 30 * 1000);
            await waitForOutput(/waiting for changes/, 5 * 1000);
            assert.ok(existsSync(outfilePath), 'outfile missing after first build');
            const firstContent = readFileSync(outfilePath, 'utf-8');
            assert.match(firstContent, /first/, 'first build should embed initial source');

            // Trigger a rebuild
            const buildCountBefore = (stdoutBuf.match(/built in \d+ms/g) || []).length;
            writeFileSync(srcPath, "export const msg = 'second-edit';\nconsole.log(msg);\n", 'utf-8');

            // Wait for the second build report
            await new Promise((resolve, reject) => {
                const onData = () => {
                    const matches = (stdoutBuf.match(/built in \d+ms/g) || []).length;
                    if (matches > buildCountBefore) {
                        cleanup();
                        resolve();
                    }
                };
                const timer = setTimeout(() => {
                    cleanup();
                    reject(new Error(`timeout waiting for second build; got: ${stdoutBuf.slice(-1000)}`));
                }, 30 * 1000);
                const cleanup = () => {
                    clearTimeout(timer);
                    child.stdout.off('data', onData);
                    child.stderr.off('data', onData);
                };
                child.stdout.on('data', onData);
                child.stderr.on('data', onData);
            });

            const secondContent = readFileSync(outfilePath, 'utf-8');
            assert.match(secondContent, /second-edit/, 'second build should embed updated source');
            assert.doesNotMatch(secondContent, /first/, 'second build should not contain stale source');
        } finally {
            child.kill('SIGINT');
            const { code, signal } = await Promise.race([
                exited,
                new Promise((resolve) =>
                    setTimeout(() => {
                        child.kill('SIGKILL');
                        resolve({ code: null, signal: 'SIGKILL' });
                    }, 10 * 1000),
                ),
            ]);
            // Accept either clean exit OR SIGINT-terminated; reject SIGKILL fallback
            assert.notEqual(signal, 'SIGKILL', `watcher did not stop after SIGINT (output: ${stdoutBuf.slice(-500)})`);
        }
    });

    it('rejects --library --watch with a clear error', async () => {
        const projectDir = join(tmpDir, 'watch-library-reject');
        mkdirSync(join(projectDir, 'src'), { recursive: true });
        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify({
                name: 'watch-library-reject',
                version: '1.0.0',
                type: 'module',
                private: true,
                main: 'lib/index.js',
                module: 'lib/index.js',
            }, null, 2) + '\n',
            'utf-8',
        );
        writeFileSync(join(projectDir, 'src', 'index.ts'), 'export const x = 1;\n', 'utf-8');

        const result = await new Promise((resolve) => {
            const child = spawn(
                'node',
                [CLI_ENTRY, 'build', 'src/index.ts', '--library', '--watch'],
                { cwd: projectDir, stdio: ['ignore', 'pipe', 'pipe'] },
            );
            let buf = '';
            child.stdout.on('data', (c) => (buf += c.toString()));
            child.stderr.on('data', (c) => (buf += c.toString()));
            child.on('exit', (code) => resolve({ code, buf }));
        });

        assert.notEqual(result.code, 0, '--library --watch should fail');
        assert.match(result.buf, /--watch is not supported with --library/);
    });
});
