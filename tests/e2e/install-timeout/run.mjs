// E2E test for `gjsify install --timeout <ms>` (per-fetch + overall timeouts).
//
// Validates the install hang fix end-to-end:
//   - A registry that accepts the TCP connection but never finishes the
//     response body used to hang `gjsify install` indefinitely (an
//     observed 10+ min Ss-state stall on a real session).
//   - With the fix, every fetch has a per-request timeout (default 30s,
//     overridable via opts.timeoutMs in @gjsify/npm-registry), and the
//     install command has an overall wall-clock budget via --timeout
//     (default 5 min). A persistent slow-CDN failure surfaces as a
//     clean non-zero exit with a clear "install timed out" message.
//
// The mock registry below accepts the GET, writes a partial response
// (so the user's TCP-level connect succeeds), then never finishes.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runCli(cliEntry, args, { cwd, env, timeoutMs = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliEntry, ...args], {
            cwd,
            env,
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
        const kill = setTimeout(() => {
            // ChildProcess.kill with a known signal never throws — failure
            // to deliver just returns false (the process already exited).
            child.kill('SIGKILL');
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

describe('gjsify install --timeout — slow-registry safety net', { timeout: 60_000 }, () => {
    let server, registryUrl, cliEntry, envForCli;
    const liveSockets = new Set();

    before(async () => {
        // Slow registry: writes partial headers then never finishes the body.
        // From a TCP/HTTP perspective this is a valid response that simply
        // never closes — the exact "reachable but slow" pathology that the
        // per-request timeout exists to guard against.
        server = createServer((req, res) => {
            liveSockets.add(req.socket);
            req.socket.on('close', () => liveSockets.delete(req.socket));
            // Write partial headers + a few bytes of body, then hang.
            res.writeHead(200, { 'content-type': 'application/json' });
            res.write('{"name":"');
            // Intentionally never call res.end() — the response stays open
            // until the client aborts or the process dies.
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        registryUrl = `http://127.0.0.1:${server.address().port}/`;

        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
        envForCli = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registryUrl,
        };
    });

    after(() => {
        // Yank any still-open sockets so the test process exits cleanly.
        for (const s of liveSockets) {
            // net.Socket.destroy() never throws — errors surface on the
            // socket's 'error' event, not synchronously.
            s.destroy();
        }
        if (server) server.close();
    });

    it('exits non-zero with a clear "timed out" message when the registry never responds', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-install-timeout-'));
        try {
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify(
                    {
                        name: 'timeout-test',
                        version: '0.1.0',
                        type: 'module',
                        private: true,
                        dependencies: { 'leaf-dep': '^1.0.0' },
                    },
                    null,
                    2,
                ) + '\n',
            );
            writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);

            // --timeout 800 caps the OVERALL install budget at 0.8s. The
            // per-request timeout inside @gjsify/npm-registry is unset here
            // so it defaults to 30s — but with retries=3 (default), three
            // back-to-back never-responding fetches would normally take 30s
            // * 4 = 2 minutes. The overall --timeout fires first and aborts
            // every in-flight fetch.
            const t0 = Date.now();
            const r = await runCli(cliEntry, ['install', '--timeout', '800'], {
                cwd: dir,
                env: envForCli,
                timeoutMs: 30_000,
            });
            const elapsed = Date.now() - t0;

            assert.notEqual(r.status, 0, `expected non-zero exit; stdout=${r.stdout} stderr=${r.stderr}`);
            const combined = r.stdout + r.stderr;
            assert.match(
                combined,
                /timed out|RegistryTimeoutError/i,
                `expected a clear timeout message, got: ${combined}`,
            );
            // Must NOT block for the full 30s/2-min default — overall budget
            // pulls the plug long before that. 10s = generous ceiling that
            // catches a regression to the old hang behavior.
            assert.ok(elapsed < 10_000, `install took ${elapsed}ms — overall --timeout did not fire`);
            // node_modules must not have been populated with the bad install.
            assert.ok(
                !existsSync(join(dir, 'node_modules', 'leaf-dep')),
                'must not install anything when the install times out',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
