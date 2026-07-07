// E2E test for workspace-aware `gjsify install` (Phase D.3).
//
// Creates a synthetic monorepo with a root + 3 workspaces, points the
// install backend at an in-process mock npm registry for the external
// deps, and asserts that:
//   - all external deps land in the root `node_modules/`
//   - each workspace's `workspace:` deps become relative symlinks into
//     its own `node_modules/` pointing at the sibling workspace dir
//   - the `gjsify-lock.json` is written at the root
//   - cycle / missing-workspace cases surface clean errors

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    mkdtempSync,
    rmSync,
    existsSync,
    writeFileSync,
    mkdirSync,
    lstatSync,
    readFileSync,
    readlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const BLOCK = 512;

function tarHeader(name, size, type = '0') {
    const buf = Buffer.alloc(BLOCK);
    buf.write(name, 0, Math.min(name.length, 100));
    buf.write('0000644', 100, 7);
    buf[107] = 0;
    buf.write('0000000', 108, 7);
    buf[115] = 0;
    buf.write('0000000', 116, 7);
    buf[123] = 0;
    buf.write(size.toString(8).padStart(11, '0'), 124, 11);
    buf[135] = 0;
    buf.write('0'.repeat(11), 136, 11);
    buf[147] = 0;
    buf.fill(0x20, 148, 156);
    buf.write(type, 156, 1);
    buf.write('ustar\0', 257, 6);
    buf.write('00', 263, 2);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += buf[i];
    buf.write(sum.toString(8).padStart(6, '0'), 148, 6);
    buf[154] = 0;
    buf[155] = 0x20;
    return buf;
}

function buildPackageTar(pkgJson) {
    const body = Buffer.from(JSON.stringify(pkgJson, null, 2) + '\n');
    const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
    body.copy(padded);
    return Buffer.concat([
        tarHeader('package/', 0, '5'),
        tarHeader('package/package.json', body.length),
        padded,
        Buffer.alloc(BLOCK * 2),
    ]);
}

function sriSha512(bytes) {
    return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

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

describe('gjsify install — workspace-aware (Phase D.3)', { timeout: 60_000 }, () => {
    let server, registryUrl, root, cliEntry, envForCli;
    // When true, the mock registry 404s every tarball download — used to
    // simulate an install whose download/extract phase fails mid-way.
    let failTarballs = false;

    const PACKAGES = {
        'lib-ext': { versions: { '4.5.0': { dependencies: {} } } },
        'mid-ext': { versions: { '2.0.0': { dependencies: { 'lib-ext': '^4.0.0' } } } },
    };

    before(async () => {
        const index = {};
        for (const [name, info] of Object.entries(PACKAGES)) {
            index[name] = { name, 'dist-tags': {}, versions: {} };
            let last = '';
            for (const [version, body] of Object.entries(info.versions)) {
                const tar = buildPackageTar({ name, version, ...body });
                const tgz = gzipSync(tar);
                index[name].versions[version] = {
                    name,
                    version,
                    dependencies: body.dependencies ?? {},
                    dist: { tarball: `__BASE__/-/${name}/${version}.tgz`, integrity: sriSha512(tgz) },
                    _tgz: tgz,
                };
                last = version;
            }
            index[name]['dist-tags'].latest = last;
        }

        server = createServer((req, res) => {
            try {
                const url = req.url ?? '';
                const tarMatch = url.match(/^\/-\/([^/]+)\/([^/]+)\.tgz$/);
                if (tarMatch) {
                    const v = index[tarMatch[1]]?.versions[tarMatch[2]];
                    if (!v || failTarballs) {
                        res.writeHead(404).end('not found');
                        return;
                    }
                    res.writeHead(200, { 'content-type': 'application/octet-stream' });
                    res.end(v._tgz);
                    return;
                }
                const pkgName = decodeURIComponent(url.replace(/^\//, ''));
                const p = index[pkgName];
                if (!p) {
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

        root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ws-install-'));
        cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
        envForCli = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registryUrl,
            // Isolate the gjsify tarball/packument cache — the `failTarballs`
            // tests below must actually hit the mock registry, not a warm
            // user-level cache.
            XDG_CACHE_HOME: mkdtempSync(join(tmpdir(), 'gjsify-e2e-ws-cache-')),
        };

        // Root + 3 workspaces.
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify(
                {
                    name: 'monorepo-root',
                    version: '0.0.0',
                    private: true,
                    type: 'module',
                    workspaces: ['packages/*'],
                },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(root, '.npmrc'), `registry=${registryUrl}\n`);

        // utils — leaf workspace, no deps.
        mkdirSync(join(root, 'packages', 'utils'), { recursive: true });
        writeFileSync(
            join(root, 'packages', 'utils', 'package.json'),
            JSON.stringify(
                {
                    name: '@scope/utils',
                    version: '1.2.3',
                    type: 'module',
                },
                null,
                2,
            ) + '\n',
        );

        // core — depends on utils (workspace) and lib-ext (registry).
        mkdirSync(join(root, 'packages', 'core'), { recursive: true });
        writeFileSync(
            join(root, 'packages', 'core', 'package.json'),
            JSON.stringify(
                {
                    name: '@scope/core',
                    version: '0.5.0',
                    type: 'module',
                    dependencies: { '@scope/utils': 'workspace:^', 'lib-ext': '^4.5.0' },
                },
                null,
                2,
            ) + '\n',
        );

        // app — depends on core (workspace) and mid-ext (registry, which pulls lib-ext transitively).
        mkdirSync(join(root, 'packages', 'app'), { recursive: true });
        writeFileSync(
            join(root, 'packages', 'app', 'package.json'),
            JSON.stringify(
                {
                    name: '@scope/app',
                    version: '0.1.0',
                    type: 'module',
                    dependencies: { '@scope/core': 'workspace:^', 'mid-ext': '^2.0.0' },
                },
                null,
                2,
            ) + '\n',
        );

        // tools — declares both a Node `bin` and a GJS `gjsify.bin` (the
        // @gjsify/cli dual-entry shape). Install must write a runner shim
        // for it into the root `node_modules/.bin/`.
        mkdirSync(join(root, 'packages', 'tools'), { recursive: true });
        writeFileSync(
            join(root, 'packages', 'tools', 'package.json'),
            JSON.stringify(
                {
                    name: '@scope/tools',
                    version: '0.9.0',
                    type: 'module',
                    bin: { toolbin: './lib/cli.js' },
                    gjsify: { bin: { toolbin: './dist/cli.gjs.mjs' } },
                },
                null,
                2,
            ) + '\n',
        );
    });

    after(() => {
        if (server) server.close();
        if (root) rmSync(root, { recursive: true, force: true });
        if (envForCli?.XDG_CACHE_HOME) rmSync(envForCli.XDG_CACHE_HOME, { recursive: true, force: true });
    });

    it('discovers workspaces + installs external deps at root', async () => {
        const r = await runCli(cliEntry, ['install', '--verbose'], { cwd: root, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        // External deps land at root node_modules/.
        for (const name of ['lib-ext', 'mid-ext']) {
            assert.ok(
                existsSync(join(root, 'node_modules', name, 'package.json')),
                `node_modules/${name}/package.json missing`,
            );
        }

        // Lockfile written at root.
        assert.ok(existsSync(join(root, 'gjsify-lock.json')), 'gjsify-lock.json missing');
    });

    it('symlinks workspace deps into each workspace node_modules/', async () => {
        const coreUtils = join(root, 'packages', 'core', 'node_modules', '@scope', 'utils');
        const appCore = join(root, 'packages', 'app', 'node_modules', '@scope', 'core');

        for (const linkPath of [coreUtils, appCore]) {
            const stat = lstatSync(linkPath);
            assert.ok(stat.isSymbolicLink(), `${linkPath} must be a symbolic link`);
        }

        // Symlinks should be relative + resolve to the sibling workspace.
        const coreUtilsTarget = readlinkSync(coreUtils);
        assert.ok(!coreUtilsTarget.startsWith('/'), 'symlink should be relative for portability');
        const resolvedCoreUtils = resolve(join(root, 'packages', 'core', 'node_modules', '@scope'), coreUtilsTarget);
        assert.equal(
            resolvedCoreUtils,
            join(root, 'packages', 'utils'),
            `expected core's @scope/utils symlink to resolve to packages/utils, got ${resolvedCoreUtils}`,
        );
    });

    it('logs workspace + external + symlink counts', async () => {
        const r = await runCli(cliEntry, ['install'], { cwd: root, env: envForCli });
        assert.equal(r.status, 0, `re-install failed: ${r.stderr}`);
        // Re-installing must be idempotent: same symlink counts, no errors.
        assert.match(
            r.stdout,
            /workspace\(s\),\s+\d+\s+external dep spec\(s\),\s+\d+\s+workspace symlink\(s\)/,
            `expected summary line, got: ${r.stdout}`,
        );
    });

    it('resolves the workspace root when run (no-args) from a child', async () => {
        // npm/yarn/pnpm behaviour: `install` inside a workspace member installs
        // the whole workspace from the root. Run from packages/core (a child) —
        // it must walk up to the root, not treat the child as its own project
        // (which would try to resolve the `workspace:` sibling from the registry).
        const child = join(root, 'packages', 'core');
        const r = await runCli(cliEntry, ['install', '--verbose'], { cwd: child, env: envForCli });
        assert.equal(r.status, 0, `child install failed: ${r.stderr}\n${r.stdout}`);
        // Announces the redirect to the resolved root.
        assert.match(
            r.stdout + r.stderr,
            /resolved workspace root .* installing the workspace/i,
            `expected a workspace-root redirect log, got: ${r.stdout}\n${r.stderr}`,
        );
        // Produces a ROOT-level install: external dep hoisted to root, lockfile at root.
        assert.ok(existsSync(join(root, 'gjsify-lock.json')), 'root gjsify-lock.json missing after child install');
        assert.ok(
            existsSync(join(root, 'node_modules', 'lib-ext', 'package.json')),
            'external dep must land at the ROOT node_modules after a child install',
        );
        // The child's workspace sibling resolves via the wired symlink (not a registry fetch).
        const coreUtils = join(child, 'node_modules', '@scope', 'utils');
        assert.ok(
            existsSync(coreUtils) && lstatSync(coreUtils).isSymbolicLink(),
            'child install must wire the workspace symlink to the sibling',
        );
    });

    it('refuses workspace: refs pointing at unknown workspaces', async () => {
        const orphanRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ws-orphan-'));
        try {
            writeFileSync(
                join(orphanRoot, 'package.json'),
                JSON.stringify(
                    {
                        name: 'orphan-root',
                        version: '0.0.0',
                        private: true,
                        type: 'module',
                        workspaces: ['packages/*'],
                    },
                    null,
                    2,
                ) + '\n',
            );
            mkdirSync(join(orphanRoot, 'packages', 'consumer'), { recursive: true });
            writeFileSync(
                join(orphanRoot, 'packages', 'consumer', 'package.json'),
                JSON.stringify(
                    {
                        name: 'consumer',
                        version: '0.1.0',
                        type: 'module',
                        // References a workspace that doesn't exist:
                        dependencies: { '@nowhere/sibling': 'workspace:^' },
                    },
                    null,
                    2,
                ) + '\n',
            );

            const r = await runCli(cliEntry, ['install'], { cwd: orphanRoot, env: envForCli });
            assert.notEqual(r.status, 0, 'expected failure for orphan workspace ref');
            const combined = r.stdout + r.stderr;
            assert.match(
                combined,
                /@nowhere\/sibling|no workspace with that name/i,
                `error should mention the missing workspace, got: ${combined}`,
            );
        } finally {
            rmSync(orphanRoot, { recursive: true, force: true });
        }
    });

    // ---- bin-shim regeneration (regression: stale/missing .bin/ shims) ----
    //
    // Bin shims are derived artifacts: every install — including --immutable
    // on an already-materialized tree — must regenerate them, and they must
    // be written BEFORE the download/extract phase so a failed install can
    // never leave the workspace without its runner shim.

    it('writes a shim for workspace-declared bins into node_modules/.bin/', async () => {
        const shim = join(root, 'node_modules', '.bin', 'toolbin');
        assert.ok(existsSync(shim), 'node_modules/.bin/toolbin missing after install');
        const content = readFileSync(shim, 'utf-8');
        assert.match(content, /^#!\/bin\/sh\n/, 'shim must be a shell script');
        assert.ok(content.includes(join(root, 'packages', 'tools')), 'shim must point at the workspace location');
    });

    it('regenerates a stale shim on re-install (incl. --immutable)', async () => {
        const shim = join(root, 'node_modules', '.bin', 'toolbin');
        // Simulate a shim written by an older CLI whose template has since
        // changed — the mtime/content must NOT survive a re-install.
        writeFileSync(shim, '#!/bin/sh\necho STALE-SHIM-CONTENT\n', { mode: 0o755 });

        const r = await runCli(cliEntry, ['install', '--immutable'], { cwd: root, env: envForCli });
        assert.equal(r.status, 0, `install --immutable failed: ${r.stderr}\n${r.stdout}`);

        const content = readFileSync(shim, 'utf-8');
        assert.ok(
            !content.includes('STALE-SHIM-CONTENT'),
            'stale shim content must be regenerated by install --immutable',
        );
        assert.ok(content.includes(join(root, 'packages', 'tools')), 'regenerated shim must point at the workspace');
    });

    it('recreates a deleted shim on install --immutable', async () => {
        const shim = join(root, 'node_modules', '.bin', 'toolbin');
        rmSync(shim, { force: true });

        const r = await runCli(cliEntry, ['install', '--immutable'], { cwd: root, env: envForCli });
        assert.equal(r.status, 0, `install --immutable failed after shim removal: ${r.stderr}\n${r.stdout}`);
        assert.ok(existsSync(shim), 'deleted node_modules/.bin/toolbin must be recreated');
    });

    it('writes shims before the download phase — a failed install keeps them', async () => {
        // Fresh monorepo + fresh cache so the tarball download actually hits
        // the (now failing) mock registry instead of a warm cache.
        const failRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ws-binfail-'));
        const failCache = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ws-binfail-cache-'));
        try {
            writeFileSync(
                join(failRoot, 'package.json'),
                JSON.stringify(
                    {
                        name: 'binfail-root',
                        version: '0.0.0',
                        private: true,
                        type: 'module',
                        workspaces: ['packages/*'],
                    },
                    null,
                    2,
                ) + '\n',
            );
            writeFileSync(join(failRoot, '.npmrc'), `registry=${registryUrl}\n`);
            mkdirSync(join(failRoot, 'packages', 'tools'), { recursive: true });
            writeFileSync(
                join(failRoot, 'packages', 'tools', 'package.json'),
                JSON.stringify(
                    {
                        name: '@scope/tools',
                        version: '0.9.0',
                        type: 'module',
                        bin: { toolbin: './lib/cli.js' },
                        dependencies: { 'lib-ext': '^4.5.0' },
                    },
                    null,
                    2,
                ) + '\n',
            );

            failTarballs = true;
            const r = await runCli(cliEntry, ['install'], {
                cwd: failRoot,
                env: { ...envForCli, XDG_CACHE_HOME: failCache },
            });
            assert.notEqual(r.status, 0, 'install must fail when every tarball download 404s');

            const shim = join(failRoot, 'node_modules', '.bin', 'toolbin');
            assert.ok(
                existsSync(shim),
                'bin shim must exist even though the install failed mid-download (early shim write)',
            );
        } finally {
            failTarballs = false;
            rmSync(failRoot, { recursive: true, force: true });
            rmSync(failCache, { recursive: true, force: true });
        }
    });

    it('wires workspace symlinks before the download phase — a failed install keeps them', async () => {
        // Regression: workspace↔workspace symlinks used to be materialised only
        // at the TAIL of the install, after the external download/extract. A
        // failed/interrupted external phase then left the tree with NO
        // workspace symlinks, so a workspace's dependency on a sibling
        // workspace failed to resolve even though every package was on disk.
        // They are now wired up-front (like the bin shims), so they survive a
        // failed external fetch.
        const failRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ws-symfail-'));
        const failCache = mkdtempSync(join(tmpdir(), 'gjsify-e2e-ws-symfail-cache-'));
        try {
            writeFileSync(
                join(failRoot, 'package.json'),
                JSON.stringify(
                    {
                        name: 'symfail-root',
                        version: '0.0.0',
                        private: true,
                        type: 'module',
                        workspaces: ['packages/*'],
                    },
                    null,
                    2,
                ) + '\n',
            );
            writeFileSync(join(failRoot, '.npmrc'), `registry=${registryUrl}\n`);
            // A leaf workspace with no external deps — the symlink target.
            mkdirSync(join(failRoot, 'packages', 'lib'), { recursive: true });
            writeFileSync(
                join(failRoot, 'packages', 'lib', 'package.json'),
                JSON.stringify({ name: '@scope/lib', version: '1.0.0', type: 'module' }, null, 2) + '\n',
            );
            // A workspace that depends on the sibling workspace AND an external
            // dep — so the (failing) download phase is reached after the early
            // symlink wiring.
            mkdirSync(join(failRoot, 'packages', 'app'), { recursive: true });
            writeFileSync(
                join(failRoot, 'packages', 'app', 'package.json'),
                JSON.stringify(
                    {
                        name: '@scope/app',
                        version: '1.0.0',
                        type: 'module',
                        dependencies: { '@scope/lib': 'workspace:^', 'lib-ext': '^4.5.0' },
                    },
                    null,
                    2,
                ) + '\n',
            );

            failTarballs = true;
            const r = await runCli(cliEntry, ['install'], {
                cwd: failRoot,
                env: { ...envForCli, XDG_CACHE_HOME: failCache },
            });
            assert.notEqual(r.status, 0, 'install must fail when the external tarball download 404s');

            // The workspace→workspace symlink must exist despite the failed
            // external phase (early wiring).
            const appLib = join(failRoot, 'packages', 'app', 'node_modules', '@scope', 'lib');
            assert.ok(
                existsSync(appLib) && lstatSync(appLib).isSymbolicLink(),
                'packages/app/node_modules/@scope/lib symlink must exist after a failed install (early wiring)',
            );
            // And the root hoist of the workspace package.
            const rootLib = join(failRoot, 'node_modules', '@scope', 'lib');
            assert.ok(
                existsSync(rootLib) && lstatSync(rootLib).isSymbolicLink(),
                'root node_modules/@scope/lib hoist must exist after a failed install (early wiring)',
            );
        } finally {
            failTarballs = false;
            rmSync(failRoot, { recursive: true, force: true });
            rmSync(failCache, { recursive: true, force: true });
        }
    });
});
