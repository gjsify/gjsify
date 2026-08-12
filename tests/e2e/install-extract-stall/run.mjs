// E2E test for `gjsify install`'s per-extract stall guard.
//
// `extractTarball` takes no AbortSignal and no timeout of its own. Under GJS a
// dropped Gio stream close-event wedges the decompress/write forever — a
// never-settling await that the overall-install abort cannot break (it only
// aborts in-flight registry FETCHES). Historically this hung the whole install
// at 0% CPU indefinitely until the user killed it.
//
// `extractWithStallGuard` (install-backend-native.ts) now races each extract
// against a stall timer (default 120s, overridable via GJSIFY_EXTRACT_STALL_MS)
// and the overall abort signal. This test drives the real install command
// against an in-process registry that serves a genuine packument + tarball —
// so resolution + fetch succeed and we reach the extract phase — with the
// documented GJSIFY_TEST_HANG_EXTRACT=1 seam making that extract never settle.
// The stall timer must then fire and the install must exit non-zero with a
// clear "stalled" message, fast, leaving node_modules unpopulated.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { packageTar, runCli, sriSha512 } from '../mock-registry.mjs';

/** This suite's fixtures are all a bare `package.json`. */
const packageTarFor = (pkgJson) => packageTar({ 'package.json': JSON.stringify(pkgJson, null, 2) + '\n' });

describe('gjsify install — per-extract stall guard', { timeout: 60_000 }, () => {
    let server, registryUrl, cliEntry, tgz;

    before(async () => {
        const pkgJson = { name: 'leaf-dep', version: '1.0.0', dependencies: {} };
        tgz = gzipSync(packageTarFor(pkgJson));
        const integrity = sriSha512(tgz);

        server = createServer((req, res) => {
            const url = req.url ?? '';
            if (/^\/-\/leaf-dep\/1\.0\.0\.tgz$/.test(url)) {
                res.writeHead(200, { 'content-type': 'application/octet-stream' });
                res.end(tgz);
                return;
            }
            if (decodeURIComponent(url.replace(/^\//, '')) === 'leaf-dep') {
                const base = `http://127.0.0.1:${server.address().port}`;
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(
                    JSON.stringify({
                        name: 'leaf-dep',
                        'dist-tags': { latest: '1.0.0' },
                        versions: {
                            '1.0.0': {
                                name: 'leaf-dep',
                                version: '1.0.0',
                                dependencies: {},
                                dist: { tarball: `${base}/-/leaf-dep/1.0.0.tgz`, integrity },
                            },
                        },
                    }),
                );
                return;
            }
            res.writeHead(404).end('not found');
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        registryUrl = `http://127.0.0.1:${server.address().port}/`;
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
    });

    after(() => {
        if (server) server.close();
    });

    it('exits non-zero with a "stalled" message when an extract never settles', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-extract-stall-'));
        try {
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify(
                    {
                        name: 'stall-test',
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

            const t0 = Date.now();
            const r = await runCli(cliEntry, ['install'], {
                cwd: dir,
                env: {
                    ...process.env,
                    GJSIFY_INSTALL_BACKEND: 'native',
                    npm_config_registry: registryUrl,
                    // The extract that follows a successful fetch never settles...
                    GJSIFY_TEST_HANG_EXTRACT: '1',
                    // ...and the stall timer pulls the plug in ~1s (not the 120s default).
                    GJSIFY_EXTRACT_STALL_MS: '1000',
                    GJSIFY_NO_VERSION_SKEW_WARNING: '1',
                },
                timeoutMs: 30_000,
            });
            const elapsed = Date.now() - t0;

            assert.notEqual(r.status, 0, `expected non-zero exit; stdout=${r.stdout} stderr=${r.stderr}`);
            assert.match(r.stdout + r.stderr, /stalled/i, `expected a "stalled" message, got: ${r.stdout}${r.stderr}`);
            // Must not have hung: stall fires ~1s, generous 15s ceiling catches a
            // regression back to the old unbounded 0%-CPU hang.
            assert.ok(elapsed < 15_000, `install took ${elapsed}ms — extract stall guard did not fire`);
            assert.ok(
                !existsSync(join(dir, 'node_modules', 'leaf-dep', 'package.json')),
                'a stalled extract must not leave a populated package',
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
