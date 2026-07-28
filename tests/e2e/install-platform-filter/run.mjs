// E2E test for the install-time `os`/`cpu`/`libc` host filter.
//
// A cold `gjsify install` of this repo materialised 1597 packages / 5.02 GB, of
// which 192 packages / 3.84 GB — 76 % of the bytes — declared an `os`/`cpu`/
// `libc` that excludes the host: seven ~240 MB `@anthropic-ai/claude-agent-sdk-*`
// siblings, six `@pagefind/*`, and the `@rolldown` / `@oxlint` / `@oxfmt` /
// `@img/sharp` / `@deltachat` binding sets. npm, yarn and pnpm place none of
// them. Because the extract queue is alphabetical, the biggest foreign binaries
// also came FIRST, which is what made the install look wedged at "9 of 1597".
//
// The design under test: record `os`/`cpu`/`libc` for EVERY platform in
// `gjsify-lock.json` at resolve time (so one lockfile serves a macOS laptop and
// a Linux CI runner), and filter at MATERIALISATION time. This suite pins the
// three behaviours that are easy to get subtly wrong:
//
//   1. an entry the host excludes is skipped, and nothing of it is written;
//   2. an entry that cannot be CLASSIFIED — an older lockfile with no platform
//      metadata — is installed, never guessed at and dropped;
//   3. a REQUIRED excluded dependency is an EBADPLATFORM error, matching npm
//      (npm silently omits an optional one and throws for a required one).
//
// Everything runs against an in-process registry, so the fixtures declare
// `!<host os>` rather than a hard-coded platform name — the assertions hold on
// any machine this suite runs on.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, platform as hostPlatform } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

/** Minimal ustar archive holding a single `package/package.json`. */
function buildPackageTar(pkgJson) {
    const BLOCK = 512;
    const body = Buffer.from(JSON.stringify(pkgJson, null, 2) + '\n');
    function header(name, size, type = '0') {
        const buf = Buffer.alloc(BLOCK);
        buf.write(name, 0, 100);
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
    const dirHeader = header('package/', 0, '5');
    const fileHeader = header('package/package.json', body.length);
    const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
    body.copy(padded);
    const trailer = Buffer.alloc(BLOCK * 2);
    return Buffer.concat([dirHeader, fileHeader, padded, trailer]);
}

function sriSha512(bytes) {
    return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function runCli(cliEntry, args, { cwd, env, timeoutMs = 60_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliEntry, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (c) => (stdout += c));
        child.stderr.on('data', (c) => (stderr += c));
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

// The whole fixture set. Each entry becomes one package in the in-process
// registry; `platform` is spliced into its packument version record verbatim.
const FOREIGN_OS = `!${hostPlatform()}`;
const PACKAGES = {
    // Declares nothing — must always install.
    'portable-dep': { version: '1.0.0', platform: {} },
    // Excluded by `os`. Reached ONLY through optionalDependencies → skipped.
    'foreign-binding': { version: '1.0.0', platform: { os: [FOREIGN_OS] } },
    // Excluded by `cpu` the same way (a second axis, same verdict).
    'foreign-arch-binding': { version: '1.0.0', platform: { cpu: ['nonexistent-arch'] } },
    // Host-compatible sibling of the above — the one that MUST land.
    'native-binding': { version: '1.0.0', platform: { os: [hostPlatform()] } },
    // The parent that fans out to all four, npm-binding-package style.
    'fanout': {
        version: '1.0.0',
        platform: {},
        dependencies: { 'portable-dep': '^1.0.0' },
        optionalDependencies: {
            'foreign-binding': '^1.0.0',
            'foreign-arch-binding': '^1.0.0',
            'native-binding': '^1.0.0',
        },
    },
    // Excluded by `os` but pulled in as a REQUIRED dependency → hard error.
    'requires-foreign': {
        version: '1.0.0',
        platform: {},
        dependencies: { 'foreign-binding': '^1.0.0' },
    },
};

function startRegistry() {
    const tarballs = new Map();
    const integrities = new Map();
    for (const [name, spec] of Object.entries(PACKAGES)) {
        const tgz = gzipSync(
            buildPackageTar({
                name,
                version: spec.version,
                ...(spec.dependencies ? { dependencies: spec.dependencies } : {}),
                ...(spec.optionalDependencies ? { optionalDependencies: spec.optionalDependencies } : {}),
                ...spec.platform,
            }),
        );
        tarballs.set(name, tgz);
        integrities.set(name, sriSha512(tgz));
    }

    const server = createServer((req, res) => {
        const url = req.url ?? '';
        const tarMatch = /^\/-\/([^/]+)\/([^/]+)\.tgz$/.exec(url);
        if (tarMatch) {
            const body = tarballs.get(decodeURIComponent(tarMatch[1]));
            if (!body) return void res.writeHead(404).end('not found');
            res.writeHead(200, { 'content-type': 'application/octet-stream' });
            return void res.end(body);
        }
        const name = decodeURIComponent(url.replace(/^\//, ''));
        const spec = PACKAGES[name];
        if (!spec) return void res.writeHead(404).end('not found');
        const base = `http://127.0.0.1:${server.address().port}`;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
            JSON.stringify({
                name,
                'dist-tags': { latest: spec.version },
                versions: {
                    [spec.version]: {
                        name,
                        version: spec.version,
                        dependencies: spec.dependencies ?? {},
                        optionalDependencies: spec.optionalDependencies ?? {},
                        ...spec.platform,
                        dist: {
                            tarball: `${base}/-/${encodeURIComponent(name)}/${spec.version}.tgz`,
                            integrity: integrities.get(name),
                        },
                    },
                },
            }),
        );
    });
    return server;
}

describe('gjsify install — host-platform filter', { timeout: 180_000 }, () => {
    let server, registryUrl, cliEntry;

    before(async () => {
        server = startRegistry();
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        registryUrl = `http://127.0.0.1:${server.address().port}/`;
        cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
    });

    after(() => {
        if (server) server.close();
    });

    const withProject = async (deps, fn, { extraFiles = {} } = {}) => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-platform-'));
        try {
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify(
                    { name: 'platform-test', version: '0.1.0', type: 'module', private: true, ...deps },
                    null,
                    2,
                ) + '\n',
            );
            writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);
            for (const [file, content] of Object.entries(extraFiles)) {
                writeFileSync(join(dir, file), content);
            }
            await fn(dir);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    };

    const install = (dir, args = []) =>
        runCli(cliEntry, ['install', ...args], {
            cwd: dir,
            env: {
                ...process.env,
                GJSIFY_INSTALL_BACKEND: 'native',
                npm_config_registry: registryUrl,
                GJSIFY_NO_VERSION_SKEW_WARNING: '1',
                // Keep the shared XDG caches out of the way of a real install.
                XDG_CACHE_HOME: join(dir, '.cache'),
            },
        });

    it('skips an optional dependency the host cannot run, and installs its compatible sibling', async () => {
        await withProject({ dependencies: { fanout: '^1.0.0' } }, async (dir) => {
            const r = await install(dir);
            assert.equal(r.status, 0, `install failed: ${r.stdout}${r.stderr}`);

            const nm = join(dir, 'node_modules');
            assert.ok(existsSync(join(nm, 'fanout', 'package.json')), 'the requesting package must install');
            assert.ok(existsSync(join(nm, 'portable-dep', 'package.json')), 'a portable dep must install');
            assert.ok(existsSync(join(nm, 'native-binding', 'package.json')), 'the host-compatible binding must install');

            // The excluded ones must leave NOTHING behind — not even an empty
            // directory, which is what a "skip the tarball but keep the path"
            // implementation would produce.
            assert.ok(!existsSync(join(nm, 'foreign-binding')), 'an os-excluded optional dep must not be materialised');
            assert.ok(
                !existsSync(join(nm, 'foreign-arch-binding')),
                'a cpu-excluded optional dep must not be materialised',
            );
        });
    });

    it('records every platform in the lockfile, including the ones it did not install', async () => {
        await withProject({ dependencies: { fanout: '^1.0.0' } }, async (dir) => {
            const r = await install(dir);
            assert.equal(r.status, 0, `install failed: ${r.stdout}${r.stderr}`);

            const lock = JSON.parse(readFileSync(join(dir, 'gjsify-lock.json'), 'utf-8'));
            // HOST-INDEPENDENCE is the core of the design: filtering during the
            // resolve would make gjsify-lock.json a function of whoever ran it.
            assert.ok(
                lock.packages['node_modules/foreign-binding'],
                'the lockfile must still pin a package this host skipped',
            );
            assert.deepEqual(lock.packages['node_modules/foreign-binding'].os, [FOREIGN_OS]);
            assert.equal(lock.packages['node_modules/foreign-binding'].optional, true);
            assert.deepEqual(lock.packages['node_modules/foreign-arch-binding'].cpu, ['nonexistent-arch']);
            // A portable package records no platform keys at all …
            assert.equal(lock.packages['node_modules/portable-dep'].os, undefined);
            assert.equal(lock.packages['node_modules/portable-dep'].cpu, undefined);
            // … and is required, so it carries no `optional` marker.
            assert.equal(lock.packages['node_modules/portable-dep'].optional, undefined);
            // The marker that makes an absent `os` mean "declares none" rather
            // than "this lockfile predates the feature".
            assert.equal(typeof lock.platformMetadata, 'number');
        });
    });

    it('installs from that lockfile under --immutable without rewriting it', async () => {
        await withProject({ dependencies: { fanout: '^1.0.0' } }, async (dir) => {
            assert.equal((await install(dir)).status, 0);
            const lockPath = join(dir, 'gjsify-lock.json');
            const before = readFileSync(lockPath, 'utf-8');
            rmSync(join(dir, 'node_modules'), { recursive: true, force: true });

            const r = await install(dir, ['--immutable']);
            assert.equal(r.status, 0, `--immutable install failed: ${r.stdout}${r.stderr}`);
            // Skipping entries must not read as lockfile drift…
            assert.equal(readFileSync(lockPath, 'utf-8'), before, '--immutable must not rewrite the lockfile');
            // …and must produce the same tree as the non-frozen install.
            assert.ok(existsSync(join(dir, 'node_modules', 'native-binding', 'package.json')));
            assert.ok(!existsSync(join(dir, 'node_modules', 'foreign-binding')));
        });
    });

    it('installs everything from a lockfile that predates platform metadata', async () => {
        await withProject({ dependencies: { fanout: '^1.0.0' } }, async (dir) => {
            assert.equal((await install(dir)).status, 0);
            const lockPath = join(dir, 'gjsify-lock.json');
            const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));

            // Rewind the lockfile to the pre-feature shape: no top-level
            // marker, no per-entry platform fields. Every entry is now
            // UNCLASSIFIABLE, and an unclassifiable entry must be installed —
            // silently dropping it would be dropping a package we merely failed
            // to describe.
            delete lock.platformMetadata;
            for (const entry of Object.values(lock.packages)) {
                delete entry.os;
                delete entry.cpu;
                delete entry.libc;
                delete entry.optional;
            }
            writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
            rmSync(join(dir, 'node_modules'), { recursive: true, force: true });

            const r = await install(dir, ['--immutable']);
            assert.equal(r.status, 0, `--immutable install failed: ${r.stdout}${r.stderr}`);
            assert.ok(
                existsSync(join(dir, 'node_modules', 'foreign-binding', 'package.json')),
                'an entry with no recorded platform must be installed, not skipped',
            );
        });
    });

    it('re-resolves a pre-metadata lockfile in place, preserving the pinned versions', async () => {
        await withProject({ dependencies: { fanout: '^1.0.0' } }, async (dir) => {
            assert.equal((await install(dir)).status, 0);
            const lockPath = join(dir, 'gjsify-lock.json');
            const original = JSON.parse(readFileSync(lockPath, 'utf-8'));

            delete original.platformMetadata;
            for (const entry of Object.values(original.packages)) {
                delete entry.os;
                delete entry.cpu;
                delete entry.libc;
                delete entry.optional;
            }
            writeFileSync(lockPath, JSON.stringify(original, null, 2) + '\n');
            rmSync(join(dir, 'node_modules'), { recursive: true, force: true });

            // A plain (non-frozen) install migrates it — that is the upgrade
            // path for every existing consumer, and it must not churn versions.
            const r = await install(dir);
            assert.equal(r.status, 0, `install failed: ${r.stdout}${r.stderr}`);
            const migrated = JSON.parse(readFileSync(lockPath, 'utf-8'));
            assert.equal(typeof migrated.platformMetadata, 'number');
            assert.deepEqual(
                Object.keys(migrated.packages).sort(),
                Object.keys(original.packages).sort(),
                'the migration must not add or drop entries',
            );
            for (const [path, entry] of Object.entries(migrated.packages)) {
                assert.equal(entry.version, original.packages[path].version, `${path} version must be preserved`);
            }
            assert.ok(!existsSync(join(dir, 'node_modules', 'foreign-binding')), 'and it must now filter');
        });
    });

    it('fails with EBADPLATFORM when a REQUIRED dependency excludes the host', async () => {
        await withProject({ dependencies: { 'requires-foreign': '^1.0.0' } }, async (dir) => {
            const r = await install(dir);
            assert.notEqual(r.status, 0, `expected a non-zero exit; stdout=${r.stdout} stderr=${r.stderr}`);
            const out = r.stdout + r.stderr;
            assert.match(out, /EBADPLATFORM/, `expected an EBADPLATFORM error, got: ${out}`);
            assert.match(out, /foreign-binding/, `the error must name the offending package, got: ${out}`);
            // Silently skipping it would leave a tree that only breaks later,
            // at whatever `import 'foreign-binding'` runs first.
            assert.ok(
                !existsSync(join(dir, 'node_modules', 'requires-foreign', 'package.json')) ||
                    !existsSync(join(dir, 'node_modules', 'foreign-binding')),
                'a required platform mismatch must not silently produce a half-tree',
            );
        });
    });

    it('installs a foreign package anyway under GJSIFY_INSTALL_PLATFORM_CHECK=0', async () => {
        await withProject({ dependencies: { fanout: '^1.0.0' } }, async (dir) => {
            const r = await runCli(cliEntry, ['install'], {
                cwd: dir,
                env: {
                    ...process.env,
                    GJSIFY_INSTALL_BACKEND: 'native',
                    npm_config_registry: registryUrl,
                    GJSIFY_NO_VERSION_SKEW_WARNING: '1',
                    XDG_CACHE_HOME: join(dir, '.cache'),
                    GJSIFY_INSTALL_PLATFORM_CHECK: '0',
                },
            });
            assert.equal(r.status, 0, `install failed: ${r.stdout}${r.stderr}`);
            assert.ok(
                existsSync(join(dir, 'node_modules', 'foreign-binding', 'package.json')),
                'the escape hatch must restore the pre-filter behaviour',
            );
        });
    });
});
