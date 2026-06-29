// E2E regression for the data-loss bug "gjsify install deletes workspace
// source files" (see pixel-rpg/map-editor brief
// `docs/reports/gjsify-install-deletes-workspace-sources.md`).
//
// Repro shape: a monorepo with a PUBLISHABLE workspace (`@fixture/lib`, real
// `version`, `"files": ["dist"]`, `src/index.ts`) and a consumer workspace
// that depends on it. The same package name also exists on the (mock) npm
// registry. The native install backend used to route the workspace package
// into its fetch/extract queue and `rmSync` + drop the published tarball over
// the workspace's OWN source directory — wiping `src/**` (it ships only
// `files`). Private workspaces (no npm tarball) were skipped, which is why
// they survived in the original report.
//
// Two reference shapes are tested, both of which were destructive on the old
// code path:
//   1. `"@fixture/lib": "workspace:^"` — the canonical workspace protocol.
//   2. `"@fixture/lib": "^9.0.0"` — a plain semver range whose name still
//      matches a local workspace (yarn/npm resolve this to the local package
//      first; the native backend used to fetch the same-named npm package).
//
// To surface the destructive path deterministically under Node (where
// `rmSync` on a symlink only removes the link, unlike GJS's Gio-backed fs
// which follows it), the test pre-seeds the root-hoist symlink that a prior
// install leaves behind. On the OLD code, install replaces that symlink with
// a real directory holding the published `dist/` tarball — the workspace is
// no longer linked and (under GJS) its source is deleted. On the FIXED code,
// the workspace package is symlinked, never fetched, and the source survives.
//
// Assertions (must FAIL on the pre-fix CLI, PASS after the fix):
//   - `packages/lib/src/index.ts` still exists with its original contents.
//   - `node_modules/@fixture/lib` (root) is a SYMLINK to packages/lib, not a
//     real directory holding the published tarball.
//   - the consumer's `node_modules/@fixture/lib` is a SYMLINK to packages/lib.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
    mkdtempSync,
    rmSync,
    existsSync,
    writeFileSync,
    readFileSync,
    mkdirSync,
    lstatSync,
    readlinkSync,
    symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
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

function buildTar(files) {
    const parts = [tarHeader('package/', 0, '5')];
    for (const [fname, content] of Object.entries(files)) {
        const body = Buffer.from(content);
        const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
        body.copy(padded);
        parts.push(tarHeader('package/' + fname, body.length), padded);
    }
    parts.push(Buffer.alloc(BLOCK * 2));
    return Buffer.concat(parts);
}

function sriSha512(bytes) {
    return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function runCli(cliEntry, args, { cwd, env, timeoutMs = 30_000 } = {}) {
    return new Promise((resolveP, reject) => {
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
            resolveP({ status: code, stdout, stderr });
        });
        child.on('error', (e) => {
            clearTimeout(kill);
            reject(e);
        });
    });
}

const SOURCE_MARKER = 'export const SOURCE = "WORKSPACE_SOURCE_PRESERVED";\n';

// Publishes `@fixture/lib@9.9.9` whose tarball ships ONLY `dist/` (per its
// `files` field) — i.e. the published artifact lacks `src/`, exactly the
// shape that makes the over-extract destructive. Also publishes an external
// `@fixture/app@1.0.0` that DEPENDS on `@fixture/lib@^9.0.0` — used to drive
// the transitive case where the same-named workspace must NOT be fetched even
// though a registry consumer pulls it into the resolved tree.
function makeRegistry() {
    const libTar = gzipSync(
        buildTar({
            'package.json': JSON.stringify({ name: '@fixture/lib', version: '9.9.9', main: 'dist/index.js' }),
            'dist/index.js': 'module.exports = "PUBLISHED_TARBALL";\n',
        }),
    );
    const appTar = gzipSync(
        buildTar({
            'package.json': JSON.stringify({
                name: '@fixture/app',
                version: '1.0.0',
                main: 'index.js',
                dependencies: { '@fixture/lib': '^9.0.0' },
            }),
            'index.js': 'module.exports = require("@fixture/lib");\n',
        }),
    );
    const libSri = sriSha512(libTar);
    const appSri = sriSha512(appTar);
    const index = {
        '@fixture/lib': {
            name: '@fixture/lib',
            'dist-tags': { latest: '9.9.9' },
            versions: {
                '9.9.9': {
                    name: '@fixture/lib',
                    version: '9.9.9',
                    dependencies: {},
                    dist: { tarball: '__BASE__/-/lib/9.9.9.tgz', integrity: libSri },
                    _tgz: libTar,
                },
            },
        },
        '@fixture/app': {
            name: '@fixture/app',
            'dist-tags': { latest: '1.0.0' },
            versions: {
                '1.0.0': {
                    name: '@fixture/app',
                    version: '1.0.0',
                    dependencies: { '@fixture/lib': '^9.0.0' },
                    dist: { tarball: '__BASE__/-/app/1.0.0.tgz', integrity: appSri },
                    _tgz: appTar,
                },
            },
        },
    };
    const server = createServer((req, res) => {
        try {
            const url = req.url ?? '';
            if (/^\/-\/lib\/9\.9\.9\.tgz$/.test(url)) {
                res.writeHead(200, { 'content-type': 'application/octet-stream' });
                res.end(libTar);
                return;
            }
            if (/^\/-\/app\/1\.0\.0\.tgz$/.test(url)) {
                res.writeHead(200, { 'content-type': 'application/octet-stream' });
                res.end(appTar);
                return;
            }
            const pkgName = decodeURIComponent(url.replace(/^\//, ''));
            const p = index[pkgName];
            if (!p) {
                res.writeHead(404).end('not found');
                return;
            }
            const base = `http://127.0.0.1:${server.address().port}`;
            const wire = JSON.parse(JSON.stringify(p, (k, v) => (k === '_tgz' ? undefined : v)));
            for (const v of Object.values(wire.versions)) {
                v.dist.tarball = v.dist.tarball.replace('__BASE__', base);
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify(wire));
        } catch (e) {
            res.writeHead(500).end(String(e));
        }
    });
    // Expose the integrity values so the --immutable test can hand-craft a
    // lockfile that pins the same-named workspace as a registry entry.
    server.__fixtures = { libSri, appSri };
    return server;
}

// Scaffold a fixture monorepo. `consumerSpec` is the version spec the consumer
// uses for `@fixture/lib` (`workspace:^` or `^9.0.0`). `preseedRootSymlink`
// recreates the root-hoist symlink a prior install would leave, which is the
// condition under which the old backend would extract over (and, on GJS,
// delete) the workspace source.
function scaffold(root, registryUrl, consumerSpec, { preseedRootSymlink } = {}) {
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify(
            { name: 'monorepo-root', version: '0.0.0', private: true, type: 'module', workspaces: ['packages/*'] },
            null,
            2,
        ) + '\n',
    );
    writeFileSync(join(root, '.npmrc'), `registry=${registryUrl}\n`);

    // PUBLISHABLE workspace: real name + version + files + src.
    mkdirSync(join(root, 'packages', 'lib', 'src'), { recursive: true });
    writeFileSync(
        join(root, 'packages', 'lib', 'package.json'),
        JSON.stringify(
            {
                name: '@fixture/lib',
                version: '9.9.9',
                type: 'module',
                files: ['dist'],
                main: 'dist/index.js',
                exports: { '.': './src/index.ts' },
            },
            null,
            2,
        ) + '\n',
    );
    writeFileSync(join(root, 'packages', 'lib', 'src', 'index.ts'), SOURCE_MARKER);

    // Consumer workspace depending on the publishable workspace.
    mkdirSync(join(root, 'packages', 'consumer'), { recursive: true });
    writeFileSync(
        join(root, 'packages', 'consumer', 'package.json'),
        JSON.stringify(
            {
                name: '@fixture/consumer',
                version: '0.0.1',
                type: 'module',
                dependencies: { '@fixture/lib': consumerSpec },
            },
            null,
            2,
        ) + '\n',
    );

    if (preseedRootSymlink) {
        const scopeDir = join(root, 'node_modules', '@fixture');
        mkdirSync(scopeDir, { recursive: true });
        symlinkSync(relative(scopeDir, join(root, 'packages', 'lib')), join(scopeDir, 'lib'));
    }
}

function assertSourcePreserved(root) {
    const srcPath = join(root, 'packages', 'lib', 'src', 'index.ts');
    assert.ok(existsSync(srcPath), 'packages/lib/src/index.ts must still exist after install (data-loss regression)');
    assert.equal(
        readFileSync(srcPath, 'utf-8'),
        SOURCE_MARKER,
        'packages/lib/src/index.ts contents must be untouched',
    );
}

function assertWorkspaceSymlink(linkPath, root, label) {
    const stat = lstatSync(linkPath);
    assert.ok(
        stat.isSymbolicLink(),
        `${label} must be a SYMLINK to the workspace (not a real dir holding the published tarball)`,
    );
    const resolved = resolve(join(linkPath, '..'), readlinkSync(linkPath));
    assert.equal(resolved, join(root, 'packages', 'lib'), `${label} must resolve to packages/lib`);
}

describe('gjsify install — never fetch/extract over workspace sources', { timeout: 90_000 }, () => {
    let server, registryUrl, cliEntry, envForCli;
    const roots = [];

    before(async () => {
        server = makeRegistry();
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        registryUrl = `http://127.0.0.1:${server.address().port}/`;
        cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
        envForCli = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registryUrl,
            GJSIFY_INSTALL_CONCURRENCY: '1',
        };
    });

    after(() => {
        if (server) server.close();
        for (const r of roots) rmSync(r, { recursive: true, force: true });
    });

    it('preserves source for a workspace:^ dep (same name exists on npm)', async () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-wssafe-ws-'));
        roots.push(root);
        scaffold(root, registryUrl, 'workspace:^');

        const r = await runCli(cliEntry, ['install', '--verbose'], { cwd: root, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        assertSourcePreserved(root);
        // No fetch of @fixture/lib — it must be symlinked, not downloaded.
        assert.doesNotMatch(
            r.stderr,
            /fetch: @fixture\/lib/,
            `@fixture/lib must NOT be fetched from the registry; verbose log shows a fetch:\n${r.stderr}`,
        );
        assertWorkspaceSymlink(
            join(root, 'packages', 'consumer', 'node_modules', '@fixture', 'lib'),
            root,
            "consumer's node_modules/@fixture/lib",
        );
    });

    it('preserves source for a plain-semver dep matching a workspace name', async () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-wssafe-plain-'));
        roots.push(root);
        // Plain `^9.0.0` whose name matches a workspace — must resolve to the
        // local workspace, never the same-named npm package.
        scaffold(root, registryUrl, '^9.0.0');

        const r = await runCli(cliEntry, ['install', '--verbose'], { cwd: root, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        assertSourcePreserved(root);
        assert.doesNotMatch(
            r.stderr,
            /fetch: @fixture\/lib/,
            `@fixture/lib must NOT be fetched even via a plain semver range:\n${r.stderr}`,
        );
        assertWorkspaceSymlink(
            join(root, 'packages', 'consumer', 'node_modules', '@fixture', 'lib'),
            root,
            "consumer's node_modules/@fixture/lib",
        );
    });

    it('keeps the root workspace symlink intact across a re-install (destructive path)', async () => {
        // Pre-seed the root-hoist symlink a prior install leaves behind. On the
        // pre-fix code, install replaces it with a real directory holding the
        // published tarball (and on GJS deletes the source through it). After
        // the fix the symlink survives and the source is preserved.
        const root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-wssafe-reinstall-'));
        roots.push(root);
        scaffold(root, registryUrl, '^9.0.0', { preseedRootSymlink: true });

        const r = await runCli(cliEntry, ['install', '--verbose'], { cwd: root, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        assertSourcePreserved(root);
        assertWorkspaceSymlink(join(root, 'node_modules', '@fixture', 'lib'), root, 'root node_modules/@fixture/lib');
    });

    // The two cases above are DIRECT workspace deps — caught by the
    // workspace-symlink routing before the fetch queue is built. The two below
    // are the TRANSITIVE / lockfile shapes (ts-for-gir #432): the same-named
    // workspace is pulled into the resolved tree by an EXTERNAL consumer or by
    // a pre-existing lockfile entry, bypassing that routing. The native backend
    // must still never fetch/extract it over the workspace symlink.

    it('does not fetch a same-named workspace pulled in by an external dep', async () => {
        // Consumer depends on the EXTERNAL `@fixture/app`, which depends on
        // `@fixture/lib@^9.0.0`. `@fixture/lib` is ALSO a local workspace, so the
        // resolver must skip the registry version (the workspace symlink wins)
        // instead of fetching it and extracting over the source.
        const root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-wssafe-transitive-'));
        roots.push(root);
        scaffold(root, registryUrl, 'workspace:^');
        // Add the external consumer dep alongside the workspace lib.
        const consumerPkgPath = join(root, 'packages', 'consumer', 'package.json');
        const consumerPkg = JSON.parse(readFileSync(consumerPkgPath, 'utf-8'));
        consumerPkg.dependencies['@fixture/app'] = '^1.0.0';
        writeFileSync(consumerPkgPath, JSON.stringify(consumerPkg, null, 2) + '\n');

        const r = await runCli(cliEntry, ['install', '--verbose'], { cwd: root, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        assertSourcePreserved(root);
        assert.match(r.stderr, /fetch: @fixture\/app/, `@fixture/app (a real external dep) must be fetched:\n${r.stderr}`);
        assert.doesNotMatch(
            r.stderr,
            /fetch: @fixture\/lib/,
            `@fixture/lib must NOT be fetched even when an external dep pulls it in:\n${r.stderr}`,
        );
        assertWorkspaceSymlink(join(root, 'node_modules', '@fixture', 'lib'), root, 'root node_modules/@fixture/lib');
        // The resolve must not have written the workspace name into the lockfile.
        const lock = JSON.parse(readFileSync(join(root, 'gjsify-lock.json'), 'utf-8'));
        assert.ok(
            !Object.keys(lock.packages).some((p) => p.endsWith('node_modules/@fixture/lib')),
            `the workspace @fixture/lib must not appear as a registry entry in the lockfile: ${Object.keys(lock.packages).join(', ')}`,
        );
    });

    it('--immutable skips a stale lockfile registry entry for a workspace name', async () => {
        // Simulate a lockfile written by an older gjsify (before the resolve
        // skip): it pins the same-named workspace `@fixture/lib` as a REGISTRY
        // entry. Under --immutable the backend builds nodes straight from the
        // lockfile (no resolve), so this is the exact ts-for-gir #432 CI shape:
        // node_modules/@fixture/lib is a workspace symlink, and the lock tells
        // the backend to extract the published tarball over it.
        const root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-wssafe-immutable-'));
        roots.push(root);
        scaffold(root, registryUrl, 'workspace:^', { preseedRootSymlink: true });
        // Consumer also has a real external dep so the lockfile is non-empty and
        // its `requested` set matches the live install (no drift error).
        const consumerPkgPath = join(root, 'packages', 'consumer', 'package.json');
        const consumerPkg = JSON.parse(readFileSync(consumerPkgPath, 'utf-8'));
        consumerPkg.dependencies['@fixture/app'] = '^1.0.0';
        writeFileSync(consumerPkgPath, JSON.stringify(consumerPkg, null, 2) + '\n');

        const { libSri, appSri } = server.__fixtures;
        const staleLock = {
            lockfileVersion: 2,
            requested: ['@fixture/app@^1.0.0'],
            packages: {
                'node_modules/@fixture/app': {
                    version: '1.0.0',
                    resolved: `${registryUrl}-/app/1.0.0.tgz`,
                    integrity: appSri,
                    dependencies: { '@fixture/lib': '^9.0.0' },
                },
                // The stale, destructive entry: a registry pin for a name that
                // is actually a local workspace.
                'node_modules/@fixture/lib': {
                    version: '9.9.9',
                    resolved: `${registryUrl}-/lib/9.9.9.tgz`,
                    integrity: libSri,
                    dependencies: {},
                },
            },
        };
        writeFileSync(join(root, 'gjsify-lock.json'), JSON.stringify(staleLock, null, 2) + '\n');

        const r = await runCli(cliEntry, ['install', '--immutable', '--verbose'], { cwd: root, env: envForCli });
        assert.equal(r.status, 0, `--immutable install failed: ${r.stderr}\n${r.stdout}`);
        assert.doesNotMatch(
            r.stderr,
            /refusing to extract/,
            `the data-loss guard must not fire — the workspace name must be filtered out:\n${r.stderr}`,
        );

        assertSourcePreserved(root);
        assert.doesNotMatch(
            r.stderr,
            /fetch: @fixture\/lib/,
            `@fixture/lib must NOT be fetched under --immutable despite the lockfile entry:\n${r.stderr}`,
        );
        assertWorkspaceSymlink(join(root, 'node_modules', '@fixture', 'lib'), root, 'root node_modules/@fixture/lib');
    });
});
