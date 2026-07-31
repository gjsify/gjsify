// E2E test for the `gjsify install` PLATFORM FILTER (npm parity).
//
// npm/pnpm/yarn/bun all prune optional dependencies whose declared `os`/`cpu`/
// `libc` cannot match the host before materialising anything (arborist:
// `#checkEngineAndPlatform` → optionalSet → inert). gjsify's native backend
// used to queue every optionalDependencies edge unconditionally — on a real
// workspace that meant ~80% of all tree bytes were darwin-*/win32-*/*-musl
// binaries fetched, cached and extracted on a linux-x64 host where they can
// never load.
//
// The invariant under test: filter at MATERIALISATION, not at resolution-
// persistence. A foreign-platform optional dep must be
//   - LOCKED   — present in gjsify-lock.json with os/cpu(+libc) + optional
//                metadata, so lockfiles stay cross-platform and --immutable
//                works for developers on other OSes, and
//   - NOT MATERIALISED — neither fetched from the registry nor extracted
//                into node_modules on a host it cannot match.
// `--no-platform-filter` is the escape hatch (mirrors npm --force bypassing
// its platform check): every locked node installs regardless of platform.
//
// Also covered: a REQUIRED foreign-platform dep still installs (the backend
// stays permissive where npm would EBADPLATFORM), and an old lockfile WITHOUT
// platform metadata upgrades in place on the next non-frozen install while
// preserving every pinned version.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// ----- tar helpers (ustar v0) -----
const BLOCK = 512;
function tarHeader(name, size, type = '0') {
    const buf = Buffer.alloc(BLOCK);
    buf.write(name, 0, Math.min(name.length, 100));
    buf.write('0000644', 100, 7);
    buf.write('0000000', 108, 7);
    buf.write('0000000', 116, 7);
    buf.write(size.toString(8).padStart(11, '0'), 124, 11);
    buf.write('0'.repeat(11), 136, 11);
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
function fileEntry(name, body) {
    const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
    body.copy(padded);
    return Buffer.concat([tarHeader(name, body.length), padded]);
}
function buildPackageTar(files) {
    const parts = [tarHeader('package/', 0, '5')];
    for (const [name, body] of Object.entries(files)) {
        parts.push(fileEntry(`package/${name}`, Buffer.from(body)));
    }
    parts.push(Buffer.alloc(BLOCK * 2));
    return Buffer.concat(parts);
}
function sriSha512(bytes) {
    return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}
function runCli(cliEntry, args, { cwd, env, timeoutMs = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliEntry, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => (stdout += c));
        child.stderr.on('data', (c) => (stderr += c));
        const kill = setTimeout(() => {
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

// The host this test runs on, and a platform that can never be it.
const HOST_OS = process.platform;
const HOST_CPU = process.arch;
const FOREIGN_OS = HOST_OS === 'darwin' ? 'linux' : 'darwin';
const FOREIGN_CPU = HOST_CPU === 'arm64' ? 'x64' : 'arm64';

/** Build a version entry; `platform` = extra manifest fields (os/cpu/libc). */
function versionEntry(name, version, { dependencies = {}, optionalDependencies = {}, platform = {} } = {}) {
    const manifest = { name, version, main: 'index.js', dependencies, optionalDependencies, ...platform };
    const files = {
        'package.json': JSON.stringify(manifest),
        'index.js': `module.exports = ${JSON.stringify({ name, version })};\n`,
    };
    const tgz = gzipSync(buildPackageTar(files));
    return { name, version, dependencies, optionalDependencies, platform, tgz, integrity: sriSha512(tgz) };
}

describe('gjsify install — platform filter', { timeout: 120_000 }, () => {
    let server, registryUrl, projectDir, cliEntry, envForCli;
    /** Every tarball path the registry served, in order. */
    const tarballRequests = [];

    const PKGS = {
        app: {
            '1.0.0': versionEntry('app', '1.0.0', {
                dependencies: { plain: '^1.0.0', 'req-foreign': '^1.0.0' },
                optionalDependencies: { 'native-foreign': '^1.0.0', 'native-here': '^1.0.0' },
            }),
        },
        plain: { '1.0.0': versionEntry('plain', '1.0.0') },
        // REQUIRED dep with a foreign platform declaration — must still install
        // (permissive where npm would EBADPLATFORM).
        'req-foreign': {
            '1.0.0': versionEntry('req-foreign', '1.0.0', { platform: { os: [FOREIGN_OS] } }),
        },
        // The npm sibling-package pattern: optional, single foreign platform.
        // Its own REQUIRED dep exercises the transitive-optional rule (the
        // whole subtree behind the optional edge is optional → also skipped
        // when IT declares a foreign platform).
        'native-foreign': {
            '1.0.0': versionEntry('native-foreign', '1.0.0', {
                dependencies: { 'foreign-helper': '^1.0.0' },
                platform: { os: [FOREIGN_OS], cpu: [FOREIGN_CPU] },
            }),
        },
        'foreign-helper': {
            '1.0.0': versionEntry('foreign-helper', '1.0.0', { platform: { os: [FOREIGN_OS] } }),
        },
        // Optional sibling matching THIS host — must be materialised.
        'native-here': {
            '1.0.0': versionEntry('native-here', '1.0.0', { platform: { os: [HOST_OS], cpu: [HOST_CPU] } }),
        },
    };

    function writeProject(dir) {
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                {
                    name: 'platform-filter-test',
                    version: '0.1.0',
                    type: 'commonjs',
                    private: true,
                    dependencies: { app: '^1.0.0' },
                },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);
    }

    before(async () => {
        server = createServer((req, res) => {
            try {
                const url = req.url ?? '';
                const tarMatch = url.match(/^\/-\/([^/]+)\/([^/]+)\.tgz$/);
                if (tarMatch) {
                    tarballRequests.push(tarMatch[1]);
                    const v = PKGS[tarMatch[1]]?.[tarMatch[2]];
                    if (!v) return void res.writeHead(404).end('not found');
                    res.writeHead(200, { 'content-type': 'application/octet-stream' });
                    return void res.end(v.tgz);
                }
                const name = decodeURIComponent(url.replace(/^\//, ''));
                const versions = PKGS[name];
                if (!versions) return void res.writeHead(404).end('not found');
                const baseUrl = `http://127.0.0.1:${server.address().port}`;
                const verNames = Object.keys(versions);
                const wire = {
                    name,
                    'dist-tags': { latest: verNames[verNames.length - 1] },
                    versions: {},
                };
                for (const [version, e] of Object.entries(versions)) {
                    wire.versions[version] = {
                        name,
                        version,
                        dependencies: e.dependencies,
                        optionalDependencies: e.optionalDependencies,
                        ...e.platform,
                        dist: { tarball: `${baseUrl}/-/${name}/${version}.tgz`, integrity: e.integrity },
                    };
                }
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify(wire));
            } catch (e) {
                res.writeHead(500).end(String(e));
            }
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        registryUrl = `http://127.0.0.1:${server.address().port}/`;

        projectDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-platfilter-'));
        cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
        envForCli = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registryUrl,
            // Isolate the content-addressable caches per run — a shared XDG
            // cache would satisfy tarball reads and hide fetch behaviour.
            XDG_CACHE_HOME: join(projectDir, '.xdg-cache'),
        };
        writeProject(projectDir);
    });

    after(() => {
        if (server) server.close();
        if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    });

    it('locks foreign-platform optional deps but does not fetch or extract them', async () => {
        tarballRequests.length = 0;
        const r = await runCli(cliEntry, ['install', '--verbose'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        const lock = JSON.parse(readFileSync(join(projectDir, 'gjsify-lock.json'), 'utf-8'));
        assert.equal(lock.platformMeta, true, 'lockfile must carry the platform-metadata marker');

        // LOCKED: the foreign entries are pinned, cross-platform, with metadata.
        const foreign = lock.packages['node_modules/native-foreign'];
        assert.ok(foreign, 'native-foreign must be IN the lockfile (cross-platform lockfiles)');
        assert.deepEqual(foreign.os, [FOREIGN_OS]);
        assert.deepEqual(foreign.cpu, [FOREIGN_CPU]);
        assert.equal(foreign.optional, true);
        const helper = lock.packages['node_modules/foreign-helper'];
        assert.ok(helper, 'foreign-helper must be IN the lockfile');
        assert.equal(helper.optional, true, 'the subtree behind an optional edge is optional');
        const here = lock.packages['node_modules/native-here'];
        assert.ok(here, 'native-here must be IN the lockfile');
        assert.equal(here.optional, true);

        // NOT MATERIALISED: no directory, no tarball request.
        assert.ok(!existsSync(join(projectDir, 'node_modules', 'native-foreign')), 'native-foreign must not extract');
        assert.ok(!existsSync(join(projectDir, 'node_modules', 'foreign-helper')), 'foreign-helper must not extract');
        assert.ok(!tarballRequests.includes('native-foreign'), 'native-foreign tarball must never be fetched');
        assert.ok(!tarballRequests.includes('foreign-helper'), 'foreign-helper tarball must never be fetched');

        // Matching-platform optional + required deps ARE materialised.
        assert.ok(existsSync(join(projectDir, 'node_modules', 'native-here')), 'native-here must extract');
        assert.ok(existsSync(join(projectDir, 'node_modules', 'plain')), 'plain must extract');
        assert.ok(
            existsSync(join(projectDir, 'node_modules', 'req-foreign')),
            'a REQUIRED foreign-platform dep still installs (permissive, unlike npm EBADPLATFORM)',
        );
        assert.equal(lock.packages['node_modules/req-foreign']?.optional, undefined);
    });

    it('--immutable from the shared lockfile also skips foreign-platform optionals', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-platfilter-imm-'));
        try {
            writeProject(dir);
            cpSync(join(projectDir, 'gjsify-lock.json'), join(dir, 'gjsify-lock.json'));
            tarballRequests.length = 0;
            const r = await runCli(cliEntry, ['install', '--immutable', '--verbose'], {
                cwd: dir,
                env: { ...envForCli, XDG_CACHE_HOME: join(dir, '.xdg-cache') },
            });
            assert.equal(r.status, 0, `--immutable install failed: ${r.stderr}\n${r.stdout}`);
            assert.ok(!existsSync(join(dir, 'node_modules', 'native-foreign')));
            assert.ok(!tarballRequests.includes('native-foreign'));
            assert.ok(existsSync(join(dir, 'node_modules', 'native-here')));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('--no-platform-filter materialises every locked node (escape hatch)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-platfilter-off-'));
        try {
            writeProject(dir);
            cpSync(join(projectDir, 'gjsify-lock.json'), join(dir, 'gjsify-lock.json'));
            const r = await runCli(cliEntry, ['install', '--immutable', '--no-platform-filter', '--verbose'], {
                cwd: dir,
                env: { ...envForCli, XDG_CACHE_HOME: join(dir, '.xdg-cache') },
            });
            assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
            assert.ok(
                existsSync(join(dir, 'node_modules', 'native-foreign')),
                '--no-platform-filter must extract the foreign optional dep',
            );
            assert.ok(existsSync(join(dir, 'node_modules', 'foreign-helper')));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('upgrades a pre-platform-metadata lockfile in place, preserving versions', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-platfilter-up-'));
        try {
            writeProject(dir);
            // Simulate a lockfile written by an older CLI: same pins, but no
            // platformMeta marker and no per-entry platform fields.
            const lock = JSON.parse(readFileSync(join(projectDir, 'gjsify-lock.json'), 'utf-8'));
            delete lock.platformMeta;
            for (const entry of Object.values(lock.packages)) {
                delete entry.os;
                delete entry.cpu;
                delete entry.libc;
                delete entry.optional;
            }
            writeFileSync(join(dir, 'gjsify-lock.json'), JSON.stringify(lock, null, 2) + '\n');

            const r = await runCli(cliEntry, ['install', '--verbose'], {
                cwd: dir,
                env: { ...envForCli, XDG_CACHE_HOME: join(dir, '.xdg-cache') },
            });
            assert.equal(r.status, 0, `upgrade install failed: ${r.stderr}\n${r.stdout}`);
            assert.match(r.stdout, /upgrading gjsify-lock\.json with platform metadata/);

            const upgraded = JSON.parse(readFileSync(join(dir, 'gjsify-lock.json'), 'utf-8'));
            assert.equal(upgraded.platformMeta, true);
            assert.deepEqual(upgraded.packages['node_modules/native-foreign']?.os, [FOREIGN_OS]);
            // Every pinned version survives the metadata backfill.
            for (const [path, entry] of Object.entries(lock.packages)) {
                assert.equal(upgraded.packages[path]?.version, entry.version, `${path} must keep its pinned version`);
            }
            // And the foreign optional still did not materialise.
            assert.ok(!existsSync(join(dir, 'node_modules', 'native-foreign')));

            // A second plain install now takes the fast lockfile-reuse path
            // (no second upgrade message).
            const r2 = await runCli(cliEntry, ['install', '--verbose'], {
                cwd: dir,
                env: { ...envForCli, XDG_CACHE_HOME: join(dir, '.xdg-cache') },
            });
            assert.equal(r2.status, 0, `re-install failed: ${r2.stderr}\n${r2.stdout}`);
            assert.doesNotMatch(r2.stdout, /upgrading gjsify-lock\.json/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
