// E2E test for Phase F — `install.mjs` bootstrap script.
//
// Exercises the two-stage bootstrap:
//   1. `gjs -m install.mjs` downloads the cli.gjs.mjs bundle from a
//      bootstrap URL (file:// in the test, GitHub-release in production),
//      verifies SHA-256, caches it.
//   2. Spawns `gjs -m <bundle> install -g <target>` against a mock npm
//      registry. The bundle handles the install, writes ~/.local/bin/<bin>.
//
// Validates: bundle downloaded, SHA-256 enforced, install completed,
// launcher created, and `--target @scope/x` routes to a non-default
// package successfully.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packageTar, sriSha512 } from '../mock-registry.mjs';

function sha256Hex(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

const HAS_GJS = (() => {
    try {
        const r = spawn('gjs', ['--version'], { stdio: 'ignore' });
        return new Promise((resolve) => {
            r.on('exit', (code) => resolve(code === 0));
            r.on('error', () => resolve(false));
        });
    } catch {
        return Promise.resolve(false);
    }
})();

describe('Phase F — install.mjs bootstrap', { timeout: 120_000 }, async () => {
    if (!(await HAS_GJS)) {
        it('skipped: gjs runtime not available', () => {});
        return;
    }

    let server, registryUrl, tmpRoot;
    /** Request counters for the two digest routes the retry cases use. */
    let flakyHits = 0;
    let goneHits = 0;
    // Path to the freshly-built gjs bundle we ship as the "bootstrap" asset.
    // In production this would be the GitHub-release-download URL.
    const cliBundlePath = fileURLToPath(new URL('../../../packages/infra/cli/dist/cli.gjs.mjs', import.meta.url));
    const installerPath = fileURLToPath(new URL('../../../install.mjs', import.meta.url));

    const cliBundleBytes = existsSync(cliBundlePath) ? readFileSync(cliBundlePath) : null;
    const cliBundleSha256 = cliBundleBytes ? sha256Hex(cliBundleBytes) : null;

    // Mock npm-registry index. `install -g` resolves these and lays out a fake
    // (but valid) package tree at the user-global prefix.
    //
    // `@gjsify/tsc` is here because a GLOBAL install is how the toolchain
    // reaches a Node-free host (ADR 0002): `gjsify tsc` resolves
    // `@gjsify/tsc/bundle` from two anchors, and on such a host only the second
    // one — the running CLI's own location — can answer, because the project
    // being built has no `@gjsify/tsc` of its own. That anchor works only if the
    // global install put the package BESIDE the CLI, which happens only because
    // `@gjsify/cli` declares it in `dependencies`. Modelled here; that the real
    // manifest still declares it is asserted by `tests/e2e/node-free-bootstrap`,
    // since a fixture that declares its own dependency cannot prove that half.
    const PACKAGES = {
        '@gjsify/cli': {
            versions: {
                '0.0.99-test': {
                    manifest: {
                        name: '@gjsify/cli',
                        version: '0.0.99-test',
                        dependencies: { '@gjsify/tsc': '0.0.99-test' },
                        // Pretend bin: a tiny GJS script that just prints "OK".
                        bin: { 'gjsify-test-shim': './bin.mjs' },
                        gjsify: { bin: { 'gjsify-test-shim': './bin.mjs' } },
                    },
                    files: { 'bin.mjs': '#!/usr/bin/env -S gjs -m\nprint("OK from gjsify-test-shim");\n' },
                },
            },
        },
        '@gjsify/tsc': {
            versions: {
                '0.0.99-test': {
                    manifest: {
                        name: '@gjsify/tsc',
                        version: '0.0.99-test',
                        // The subpath `gjsify tsc` resolves. A stand-in body is
                        // enough: what is under test is that the package ARRIVES
                        // and that the subpath RESOLVES, not that tsc compiles.
                        // Flat rather than the real `./dist/…` because
                        // `buildPackageTar` emits no directory header for a
                        // nested path, and the resolution under test does not
                        // care where the file sits.
                        exports: { './bundle': './tsc.gjs.mjs' },
                    },
                    files: { 'tsc.gjs.mjs': '#!/usr/bin/env -S gjs -m\nprint("stand-in tsc bundle");\n' },
                },
            },
        },
    };

    before(async () => {
        if (!cliBundleBytes) {
            throw new Error(
                `install-script test requires packages/infra/cli/dist/cli.gjs.mjs ` +
                    `to exist — run \`gjsify run build:gjs-bundle\` first.`,
            );
        }
        tmpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-install-script-'));

        // Build full packument index with tarball bytes. Real npm convention:
        //   packument URL: `${registry}/@scope/name`            (literal /)
        //   tarball URL:   `${registry}/@scope/name/-/<base>.tgz` (unscoped basename)
        const index = {};
        for (const [name, info] of Object.entries(PACKAGES)) {
            index[name] = { name, 'dist-tags': {}, versions: {} };
            let last = '';
            const unscoped = name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name;
            for (const [version, entry] of Object.entries(info.versions)) {
                const body = entry.manifest;
                const files = {
                    'package.json': JSON.stringify(body, null, 2) + '\n',
                    ...entry.files,
                };
                const tar = packageTar(files);
                const tgz = gzipSync(tar);
                const baseName = `${unscoped}-${version}.tgz`;
                index[name].versions[version] = {
                    ...body,
                    dist: { tarball: `__BASE__/${name}/-/${baseName}`, integrity: sriSha512(tgz) },
                    _tgz: tgz,
                    _baseName: baseName,
                };
                last = version;
            }
            index[name]['dist-tags'].latest = last;
        }

        // Build a route table: tarball URL → bytes
        const tarballRoutes = new Map();
        for (const [name, p] of Object.entries(index)) {
            for (const [_version, v] of Object.entries(p.versions)) {
                const routePath = `/${name}/-/${v._baseName}`;
                tarballRoutes.set(routePath, v._tgz);
            }
        }

        server = createServer((req, res) => {
            try {
                const url = req.url ?? '';
                if (process.env.GJSIFY_E2E_DEBUG) console.error(`[mock-registry] GET ${url}`);
                // Two digest routes for the retry cases at the bottom of this file. They
                // COUNT their hits, because "did it retry" and "did it stop retrying" are
                // both statements about the number of requests, which no exit code shows.
                if (url === '/flaky.sha256') {
                    flakyHits++;
                    // A DROPPED CONNECTION, not an HTTP status — the shape GitHub's release
                    // CDN produced (`HTTP/2 Error: NO_ERROR`) when this was written.
                    if (flakyHits === 1) {
                        req.socket.destroy();
                        return;
                    }
                    res.writeHead(200, { 'content-type': 'text/plain' });
                    res.end(`${cliBundleSha256}\n`);
                    return;
                }
                if (url === '/gone.sha256') {
                    goneHits++;
                    res.writeHead(404).end('not found');
                    return;
                }
                // Tarball: exact-path lookup (avoids regex pain with scoped paths)
                const tarball = tarballRoutes.get(url);
                if (tarball) {
                    res.writeHead(200, { 'content-type': 'application/octet-stream' });
                    res.end(tarball);
                    return;
                }
                // Packument: URL is `/@scope/name` (literal /, or %2F-encoded)
                const path = url.replace(/^\//, '');
                const pkgName = decodeURIComponent(path.replace(/%2[Ff]/g, '/'));
                const p = index[pkgName];
                if (!p) {
                    if (process.env.GJSIFY_E2E_DEBUG) console.error(`[mock-registry] 404 url=${url}`);
                    res.writeHead(404).end('not found');
                    return;
                }
                const baseUrl = `http://127.0.0.1:${server.address().port}`;
                const wire = JSON.parse(JSON.stringify(p, (k, v) => (k === '_tgz' ? undefined : v)));
                for (const v of Object.values(wire.versions)) {
                    v.dist.tarball = v.dist.tarball.replace('__BASE__', baseUrl);
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(wire));
            } catch (e) {
                res.writeHead(500).end(String(e));
            }
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        registryUrl = `http://127.0.0.1:${server.address().port}/`;
    });

    after(() => {
        if (server) server.close();
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    });

    function runBootstrap(args, extraEnv = {}) {
        const prefix = join(tmpRoot, 'global');
        const binDir = join(tmpRoot, 'bin');
        const cache = join(tmpRoot, 'cache');
        const sha256Path = join(tmpRoot, 'cli.gjs.mjs.sha256');
        writeFileSync(sha256Path, cliBundleSha256 + '\n');
        return new Promise((resolve, reject) => {
            const child = spawn('gjs', ['-m', installerPath, ...args], {
                env: {
                    ...process.env,
                    GJSIFY_GLOBAL_PREFIX: prefix,
                    GJSIFY_GLOBAL_BIN_DIR: binDir,
                    GJSIFY_INSTALL_BOOTSTRAP_CACHE: cache,
                    GJSIFY_INSTALL_BOOTSTRAP_URL: `file://${cliBundlePath}`,
                    GJSIFY_INSTALL_BOOTSTRAP_SHA256_URL: `file://${sha256Path}`,
                    // Isolate the CLI's own packument/tarball cache, not just
                    // the bootstrap one. Without this the run reads
                    // `~/.cache/gjsify/metadata`, where a developer machine
                    // already holds the REAL `@gjsify/cli` packument — the
                    // shadowing `tests/e2e/global-install-engine` records. CI is
                    // clean, so this fails only on the machine of whoever is
                    // working on it, which is the worst place for it to fail.
                    XDG_CACHE_HOME: cache,
                    npm_config_registry: registryUrl,
                    ...extraEnv,
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '',
                stderr = '';
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
            }, 60_000);
            child.on('close', (code) => {
                clearTimeout(kill);
                resolve({ status: code, stdout, stderr, prefix, binDir, cache });
            });
            child.on('error', (e) => {
                clearTimeout(kill);
                reject(e);
            });
        });
    }

    it('downloads bootstrap bundle and runs it (default target = @gjsify/cli)', async () => {
        const r = await runBootstrap(['--tag', '0.0.99-test']);
        assert.equal(r.status, 0, `bootstrap failed:\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
        // Bundle cached in our override path, under its CONTENT-ADDRESSED name.
        // The digest in the filename is what makes the cache reachable at all —
        // the old fixed `cli.gjs.mjs` was written and never read back, so every
        // run re-downloaded the bundle (see `resolveBootstrap` in install.mjs).
        assert.ok(
            existsSync(join(r.cache, `cli-${cliBundleSha256}.gjs.mjs`)),
            `bundle not cached under its digest; cache holds: ${readdirSync(r.cache).join(', ')}`,
        );
        // Package laid out at user prefix.
        assert.ok(
            existsSync(join(r.prefix, 'node_modules', '@gjsify', 'cli', 'package.json')),
            'package not installed at prefix',
        );
        // Bin launcher created.
        assert.ok(existsSync(join(r.binDir, 'gjsify-test-shim')), 'bin shim not created');
    });

    it('carries @gjsify/tsc into the prefix, where anchor 2 can reach it', async () => {
        // ADR 0002's toolchain half. On a Node-free host `gjsify tsc` cannot
        // resolve `@gjsify/tsc/bundle` from the project — the project has none —
        // so it falls to the second anchor, the running CLI's own location
        // (`commands/tsc.ts`). That anchor answers only if the global install
        // placed the package BESIDE the CLI. Nothing asserted that before, and
        // it is the step the whole Node-free claim rests on: without it
        // `build:infra` dies at its first entry, which is a `gjsify tsc`.
        const r = await runBootstrap(['--tag', '0.0.99-test']);
        assert.equal(r.status, 0, `bootstrap failed:\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);

        const cliDir = join(r.prefix, 'node_modules', '@gjsify', 'cli');
        assert.ok(existsSync(join(cliDir, 'package.json')), 'the CLI itself is not at the prefix');
        assert.ok(
            existsSync(join(r.prefix, 'node_modules', '@gjsify', 'tsc', 'package.json')),
            'the CLI declared @gjsify/tsc but the install did not lay it down beside it',
        );

        // Resolve exactly the way the CLI does — `createRequire` anchored at a
        // file inside the installed CLI — rather than re-deriving the path.
        // A hand-built path would still pass if `exports["./bundle"]` were
        // renamed, which is one of the two ways this can actually break.
        const anchor = pathToFileURL(join(cliDir, 'bin.mjs')).href;
        const resolved = createRequire(anchor).resolve('@gjsify/tsc/bundle');
        assert.ok(existsSync(resolved), `anchor 2 resolved to a file that is not there: ${resolved}`);
    });

    it('fails fast on SHA-256 mismatch', async () => {
        const badSha = join(tmpRoot, 'wrong.sha256');
        writeFileSync(badSha, '0000000000000000000000000000000000000000000000000000000000000000\n');
        const r = await runBootstrap([], {
            GJSIFY_INSTALL_BOOTSTRAP_SHA256_URL: `file://${badSha}`,
        });
        assert.notEqual(r.status, 0, `expected SHA-256 mismatch failure, got status=${r.status}`);
        assert.match(r.stderr + r.stdout, /SHA-256 mismatch/, 'expected error message about SHA-256 mismatch');
    });

    it('refuses to install when the digest URL is unreachable (no silent downgrade)', async () => {
        // The hole this closes: a failed `.sha256` fetch used to log
        // "skipping verification" and CARRY ON, so anyone able to break that one
        // request — a proxy, a 404, a captive portal — silently downgraded the
        // install to no verification at all, while the bundle fetch itself
        // succeeded. Opting out must be an explicit act, never a fetch failure.
        const r = await runBootstrap([], {
            GJSIFY_INSTALL_BOOTSTRAP_SHA256_URL: `file://${join(tmpRoot, 'does-not-exist.sha256')}`,
        });
        assert.notEqual(r.status, 0, `expected a hard failure, got status=${r.status}`);
        assert.match(
            r.stderr + r.stdout,
            /Refusing to install an UNVERIFIED bootstrap bundle/,
            'expected a refusal naming the unverified bundle',
        );
    });

    it('reuses the cached bundle on a second run instead of re-downloading', async () => {
        // `runBootstrap` points every invocation at the same cache dir, so the
        // first run populates it and the second must short-circuit. Guards the
        // property the old fixed-name cache could never have: being warm.
        //
        // Deliberately asserts ONLY on the bootstrap stage's own output and does
        // not require the spawned `install -g` to succeed. Caching is decided
        // before the CLI is ever spawned, so coupling this to the mock-registry
        // half would make it fail for reasons that have nothing to do with the
        // cache — which is exactly what the sibling test above does today.
        // Its OWN cache dir: the sibling tests share `runBootstrap`'s default
        // one and have already populated it, so a shared dir would make this
        // test's "first" run warm and assert nothing.
        const env = { GJSIFY_INSTALL_BOOTSTRAP_CACHE: join(tmpRoot, 'cache-warm') };
        const first = await runBootstrap(['--tag', '0.0.99-test'], env);
        assert.match(first.stdout, /Downloading bootstrap from/, 'first run did not download');
        const second = await runBootstrap(['--tag', '0.0.99-test'], env);
        assert.match(second.stdout, /Reusing verified bootstrap/, 'second run did not hit the cache');
        assert.doesNotMatch(second.stdout, /Downloading bootstrap from/, 'second run re-downloaded the bundle');
    });
    // A DROPPED CONNECTION IS A HICCUP; AN HTTP ANSWER IS AN ANSWER.
    //
    // The incident these two hold: on 2026-08-12 GitHub's release CDN dropped HTTP/2
    // connections for a stretch and took four CI jobs across two PRs with it, each dying
    // inside `gjsify-setup` before a line of the change under test ran. Measured from a
    // workstation in the same window, one `curl` in three returned "Connection died".
    // Single-shot fetching turned that into "Refusing to install an UNVERIFIED bootstrap
    // bundle" — the one message that must never be a false alarm, because the documented
    // response to it is to switch verification OFF.
    //
    // Both cases assert the REQUEST COUNT, not just the exit code: "it retried" and "it
    // stopped retrying" are statements about how many requests were made, and an exit code
    // shows neither.

    it('retries a dropped connection instead of calling the digest unfetchable', async () => {
        flakyHits = 0;
        const r = await runBootstrap(['--tag', '0.0.99-test'], {
            GJSIFY_INSTALL_BOOTSTRAP_SHA256_URL: `${registryUrl}flaky.sha256`,
        });
        const out = r.stderr + r.stdout;
        // Scoped to the FETCH, deliberately, rather than to `r.status`: whether the install
        // then completes is what the cases above hold, and hanging it here would make this
        // case fail for every unrelated reason a full install can fail for.
        assert.equal(flakyHits, 2, `expected one retry after the drop, saw ${flakyHits} request(s):\n${out}`);
        assert.doesNotMatch(
            out,
            /Refusing to install an UNVERIFIED bootstrap bundle/,
            'a single dropped connection was reported as an unverifiable digest',
        );
        assert.match(out, /retry 2\/5/, 'the retry happened but was not announced');
    });

    it('does NOT retry a 404 — the registry answered', async () => {
        goneHits = 0;
        const r = await runBootstrap([], {
            GJSIFY_INSTALL_BOOTSTRAP_SHA256_URL: `${registryUrl}gone.sha256`,
        });
        assert.notEqual(r.status, 0, 'a missing digest must still be fatal');
        assert.match(r.stderr + r.stdout, /Refusing to install an UNVERIFIED bootstrap bundle/);
        // Retrying a 404 would only delay the same answer while making a real outage look
        // like a hang — and this is the path a user is told to reach for the opt-out on.
        assert.equal(goneHits, 1, `a 404 must not be retried, saw ${goneHits} request(s)`);
    });
});
