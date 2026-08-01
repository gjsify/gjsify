// E2E test for `gjsify install` OS/CPU/LIBC FILTERING.
//
// The defect: the resolver placed every optionalDependency a packument listed
// and never read the version's `os`/`cpu`/`libc`. Measured on a cold tree of
// this workspace: 183 foreign-platform packages / 3361 MB plus 9 musl-only
// packages / 308 MB — 3.67 GB of a 5.6 GB node_modules that npm would never
// have written.
//
// WHAT THIS ASSERTS IS THE FILTERING, NEVER THE HOST. Every run passes an
// explicit `--os/--cpu/--libc` (npm's config keys), so one Linux/glibc machine
// exercises the musl, arm64 and darwin branches and the expectations are fixed
// values rather than "whatever this runner happens to be". A fixture that read
// the host could only ever cover one of the five variants below.
//
// Offline: an in-process HTTP registry serves the packuments + tarballs, like
// its neighbours `native-install/` and `install-lock-preserve/` (whose tar
// helpers and `runCli` shape this reuses). `XDG_CACHE_HOME` is redirected into
// the temp dir so the packument/tarball caches are per-run and the user's real
// cache is neither read nor written.
//
// Four properties, one per requirement:
//   (a) a foreign-platform optional dep is RECORDED in the lockfile but not
//       extracted — the lockfile stays portable;
//   (b) `--libc=musl` and `--libc=glibc` select DIFFERENT variants from the
//       SAME lockfile (copied between projects, installed with --immutable);
//   (c) an incompatible REQUIRED dep FAILS (EBADPLATFORM), and `--force`
//       installs it anyway;
//   (d) `libc` only exists in the FULL packument, so the resolver must escalate
//       — and only for platform-declaring packages on a linux target.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// ----- tar helpers (ustar v0) — same shape as install-lock-preserve/run.mjs ---
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
            // ChildProcess.kill with a known signal never throws — failure to
            // deliver just means the process already exited.
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

/**
 * The published corpus. `libc` is deliberately NOT part of what the abbreviated
 * packument will report (see `wirePackument`) — that mirrors the live registry:
 * `lightningcss-linux-x64-musl@1.33.0` returns `{os,cpu}` under the corgi accept
 * header and `{os,cpu,libc}` under `application/json`.
 */
const CORPUS = {
    'plat-app': {
        '1.0.0': {
            optionalDependencies: {
                'plat-bin-linux-x64-gnu': '^1.0.0',
                'plat-bin-linux-x64-musl': '^1.0.0',
                'plat-bin-darwin-arm64': '^1.0.0',
            },
        },
    },
    'plat-bin-linux-x64-gnu': { '1.0.0': { os: ['linux'], cpu: ['x64'], libc: ['glibc'] } },
    'plat-bin-linux-x64-musl': { '1.0.0': { os: ['linux'], cpu: ['x64'], libc: ['musl'] } },
    'plat-bin-darwin-arm64': { '1.0.0': { os: ['darwin'], cpu: ['arm64'] } },
    // A REQUIRED dependency no linux host can run — property (c).
    'win-only': { '1.0.0': { os: ['win32'] } },
};

function buildIndex() {
    const index = {};
    for (const [name, versions] of Object.entries(CORPUS)) {
        index[name] = {};
        for (const [version, meta] of Object.entries(versions)) {
            const pkgJson = {
                name,
                version,
                main: 'index.js',
                dependencies: meta.dependencies ?? {},
                optionalDependencies: meta.optionalDependencies ?? {},
                ...(meta.os ? { os: meta.os } : {}),
                ...(meta.cpu ? { cpu: meta.cpu } : {}),
                ...(meta.libc ? { libc: meta.libc } : {}),
            };
            const tgz = gzipSync(
                buildPackageTar({
                    'package.json': JSON.stringify(pkgJson),
                    'index.js': `module.exports = ${JSON.stringify({ name, version })};\n`,
                }),
            );
            index[name][version] = { ...meta, tgz, integrity: sriSha512(tgz) };
        }
    }
    return index;
}

describe('gjsify install — os/cpu/libc filtering', { timeout: 180_000 }, () => {
    let server, registryUrl, cliEntry, tmpRoot, baseEnv;
    const index = buildIndex();
    /** Which document shapes were requested per package name, for property (d). */
    let requestedShapes;

    function wirePackument(name, shape, baseUrl) {
        const versions = {};
        for (const [version, entry] of Object.entries(index[name])) {
            versions[version] = {
                name,
                version,
                dependencies: entry.dependencies ?? {},
                optionalDependencies: entry.optionalDependencies ?? {},
                ...(entry.os ? { os: entry.os } : {}),
                ...(entry.cpu ? { cpu: entry.cpu } : {}),
                // THE POINT OF THIS FIXTURE: libc is served ONLY in the full
                // document. A resolver that trusts the abbreviated one judges
                // every musl-only package installable on glibc.
                ...(shape === 'full' && entry.libc ? { libc: entry.libc } : {}),
                dist: { tarball: `${baseUrl}/-/${name}/${version}.tgz`, integrity: entry.integrity },
            };
        }
        const names = Object.keys(versions);
        return { name, 'dist-tags': { latest: names[names.length - 1] }, versions };
    }

    before(async () => {
        server = createServer((req, res) => {
            try {
                const url = req.url ?? '';
                const tarMatch = url.match(/^\/-\/([^/]+)\/([^/]+)\.tgz$/);
                if (tarMatch) {
                    const entry = index[tarMatch[1]]?.[tarMatch[2]];
                    if (!entry) return void res.writeHead(404).end('not found');
                    res.writeHead(200, { 'content-type': 'application/octet-stream' });
                    return void res.end(entry.tgz);
                }
                const name = decodeURIComponent(url.replace(/^\//, ''));
                if (!index[name]) return void res.writeHead(404).end('not found');

                const accept = String(req.headers.accept ?? '');
                const shape = accept.includes('application/vnd.npm.install-v1+json') ? 'corgi' : 'full';
                let shapes = requestedShapes.get(name);
                if (!shapes) {
                    shapes = new Set();
                    requestedShapes.set(name, shapes);
                }
                shapes.add(shape);

                // ONE ETag for BOTH shapes — not laziness, this is what the npm
                // registry does: its ETag derives from the CouchDB document
                // `_rev`, which is a property of the package, not of the
                // representation. So a metadata cache that does not key on the
                // shape sends a corgi ETag on a full request, gets a 304, and
                // serves the abbreviated body — losing `libc` while reporting a
                // cache hit. That is the failure this fixture pins.
                const etag = `"rev-1-${name}"`;
                if (req.headers['if-none-match'] === etag) {
                    return void res.writeHead(304, { etag }).end();
                }
                const baseUrl = `http://127.0.0.1:${server.address().port}`;
                res.writeHead(200, { 'content-type': 'application/json', etag });
                res.end(JSON.stringify(wirePackument(name, shape, baseUrl)));
            } catch (e) {
                res.writeHead(500).end(String(e));
            }
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        registryUrl = `http://127.0.0.1:${server.address().port}/`;

        tmpRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-platform-'));
        cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
        baseEnv = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registryUrl,
            // Per-run caches: the packument cache is load-bearing here (property
            // d), and the user's real cache must not leak into or out of the run.
            XDG_CACHE_HOME: join(tmpRoot, 'cache'),
            GJSIFY_NO_VERSION_SKEW_WARNING: '1',
            // The ambient environment must not decide the target — every case
            // passes its own flags.
            npm_config_os: '',
            npm_config_cpu: '',
            npm_config_libc: '',
            npm_config_force: '',
        };
        requestedShapes = new Map();
    });

    after(() => {
        if (server) server.close();
        if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
    });

    /** A throwaway project declaring `deps`, in its own prefix. */
    function project(name, deps) {
        const dir = join(tmpRoot, name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify({ name, version: '0.1.0', private: true, type: 'commonjs', ...deps }, null, 2) + '\n',
        );
        writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);
        return dir;
    }

    const installed = (dir, pkg) => existsSync(join(dir, 'node_modules', pkg, 'package.json'));
    const lockOf = (dir) => JSON.parse(readFileSync(join(dir, 'gjsify-lock.json'), 'utf-8'));

    it('(a) records the foreign-platform optional deps but installs only the matching one', async () => {
        const dir = project('glibc-target', { dependencies: { 'plat-app': '^1.0.0' } });
        const r = await runCli(cliEntry, ['install', '--os=linux', '--cpu=x64', '--libc=glibc', '--verbose'], {
            cwd: dir,
            env: baseEnv,
        });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        const lock = lockOf(dir);
        assert.equal(lock.lockfileVersion, 3, 'platform fields need lockfile v3');

        // RESOLVED for every platform: all four packages are pinned, with their
        // declarations recorded, so this file installs correctly on any host.
        for (const pkg of [
            'plat-app',
            'plat-bin-linux-x64-gnu',
            'plat-bin-linux-x64-musl',
            'plat-bin-darwin-arm64',
        ]) {
            assert.ok(lock.packages[`node_modules/${pkg}`], `lockfile must pin ${pkg} regardless of the target`);
        }
        assert.deepEqual(lock.packages['node_modules/plat-bin-darwin-arm64'].os, ['darwin']);
        assert.deepEqual(lock.packages['node_modules/plat-bin-darwin-arm64'].cpu, ['arm64']);
        assert.equal(lock.packages['node_modules/plat-bin-darwin-arm64'].optional, true);
        // libc reached the lockfile, which is only possible via the full document.
        assert.deepEqual(lock.packages['node_modules/plat-bin-linux-x64-musl'].libc, ['musl']);
        assert.deepEqual(lock.packages['node_modules/plat-bin-linux-x64-gnu'].libc, ['glibc']);
        // A package with no platform declaration carries no platform fields.
        assert.equal(lock.packages['node_modules/plat-app'].os, undefined);
        assert.equal(lock.packages['node_modules/plat-app'].libc, undefined);

        // INSTALLED for one: only the glibc variant is on disk.
        assert.ok(installed(dir, 'plat-app'), 'the app itself must install');
        assert.ok(installed(dir, 'plat-bin-linux-x64-gnu'), 'the matching variant must install');
        assert.equal(installed(dir, 'plat-bin-linux-x64-musl'), false, 'a musl-only package must not be extracted');
        assert.equal(installed(dir, 'plat-bin-darwin-arm64'), false, 'a darwin-only package must not be extracted');

        // The skip is recoverable from the verbose log with npm's payload shape.
        assert.match(r.stderr, /platform-skip: plat-bin-darwin-arm64@1\.0\.0/);
        assert.match(r.stderr, /current=\{"os":"linux","cpu":"x64","libc":"glibc"\}/);
    });

    it('(d) escalates to the full packument ONLY for platform-declaring packages', async () => {
        // Set by the run above. `plat-app` declares no os/cpu, so its abbreviated
        // document is final — npm re-fetches every dependency in full, we
        // deliberately do not (same outcome, ~190 of 1597 packages here).
        assert.deepEqual([...requestedShapes.get('plat-app')], ['corgi'], 'no escalation without a declaration');
        assert.ok(requestedShapes.get('plat-bin-linux-x64-musl').has('full'), 'a declaring package must escalate');
        assert.ok(requestedShapes.get('plat-bin-darwin-arm64').has('full'));
    });

    it('(d) a re-resolve keeps libc — the metadata cache keys the two shapes apart', async () => {
        // Second resolve over a WARM packument cache, with the registry answering
        // 304 to both shapes under one ETag. A shape-blind cache serves the
        // abbreviated body to the escalated read, `libc` vanishes, and the musl
        // variant lands on disk — a wrong answer that looks like a cache hit.
        const dir = join(tmpRoot, 'glibc-target');
        const r = await runCli(
            cliEntry,
            ['install', '--refresh-lockfile', '--os=linux', '--cpu=x64', '--libc=glibc', '--verbose'],
            { cwd: dir, env: baseEnv },
        );
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.match(r.stderr, /packument-cache-hit: plat-bin-linux-x64-musl \(full, 304/);
        const lock = lockOf(dir);
        assert.deepEqual(lock.packages['node_modules/plat-bin-linux-x64-musl'].libc, ['musl']);
        assert.equal(installed(dir, 'plat-bin-linux-x64-musl'), false);
    });

    it('(b) the SAME lockfile installs the musl variant under --libc=musl', async () => {
        // Portability, end to end: the lockfile resolved on the glibc target above
        // is copied verbatim (as a commit would) and installed with --immutable,
        // which consumes it without re-resolving. The verdict is recomputed for
        // THIS target, so the selected variant flips.
        const dir = project('musl-target', { dependencies: { 'plat-app': '^1.0.0' } });
        copyFileSync(join(tmpRoot, 'glibc-target', 'gjsify-lock.json'), join(dir, 'gjsify-lock.json'));
        const r = await runCli(
            cliEntry,
            ['install', '--immutable', '--os=linux', '--cpu=x64', '--libc=musl', '--verbose'],
            { cwd: dir, env: baseEnv },
        );
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.ok(installed(dir, 'plat-bin-linux-x64-musl'), '--libc=musl must select the musl variant');
        assert.equal(installed(dir, 'plat-bin-linux-x64-gnu'), false, 'the glibc variant must now be inert');
        assert.equal(installed(dir, 'plat-bin-darwin-arm64'), false);
        // --immutable must not rewrite the file it was handed.
        assert.deepEqual(lockOf(dir), lockOf(join(tmpRoot, 'glibc-target')));
    });

    it('(b) a darwin/arm64 target selects the darwin variant and never escalates', async () => {
        const dir = project('darwin-target', { dependencies: { 'plat-app': '^1.0.0' } });
        requestedShapes = new Map();
        const r = await runCli(cliEntry, ['install', '--os=darwin', '--cpu=arm64', '--verbose'], {
            cwd: dir,
            env: baseEnv,
        });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.ok(installed(dir, 'plat-bin-darwin-arm64'), 'the darwin variant must install');
        assert.equal(installed(dir, 'plat-bin-linux-x64-gnu'), false);
        assert.equal(installed(dir, 'plat-bin-linux-x64-musl'), false);
        // libc is meaningless off linux (npm returns undefined there), so a
        // second full-document fetch could not change any verdict.
        for (const [name, shapes] of requestedShapes) {
            assert.equal(shapes.has('full'), false, `${name} must not escalate on a non-linux target`);
        }
        // Both linux variants are still pinned — the lockfile is target-agnostic.
        const lock = lockOf(dir);
        assert.ok(lock.packages['node_modules/plat-bin-linux-x64-musl']);
        assert.ok(lock.packages['node_modules/plat-bin-linux-x64-gnu']);
    });

    it('(c) an incompatible REQUIRED dependency fails with EBADPLATFORM', async () => {
        const dir = project('required-mismatch', { dependencies: { 'win-only': '^1.0.0' } });
        const r = await runCli(cliEntry, ['install', '--os=linux', '--cpu=x64', '--libc=glibc'], {
            cwd: dir,
            env: baseEnv,
        });
        assert.notEqual(r.status, 0, 'a required dep the target cannot run must fail the install');
        const output = `${r.stderr}${r.stdout}`;
        assert.match(output, /Unsupported platform for win-only@1\.0\.0/);
        assert.match(output, /win32/, 'the message must name what was required');
        assert.equal(installed(dir, 'win-only'), false);
    });

    it('(c) --force installs an incompatible REQUIRED dependency anyway', async () => {
        const dir = project('required-forced', { dependencies: { 'win-only': '^1.0.0' } });
        const args = ['install', '--force', '--os=linux', '--cpu=x64', '--libc=glibc', '--verbose'];
        const r = await runCli(cliEntry, args, { cwd: dir, env: baseEnv });
        assert.equal(r.status, 0, `--force must bypass the check: ${r.stderr}\n${r.stdout}`);
        assert.ok(installed(dir, 'win-only'), '--force must install the incompatible required dep');
    });

    it('(c) an incompatible OPTIONAL top-level dep is skipped, not fatal', async () => {
        // The `optionalDependencies: { fsevents }` shape: npm leaves it out on
        // linux and installs fine. The specs reaching the backend are flat
        // strings, so the KIND travels beside them — get that wrong and this
        // install fails instead of thinning.
        const dir = project('optional-mismatch', { optionalDependencies: { 'win-only': '^1.0.0' } });
        const r = await runCli(cliEntry, ['install', '--os=linux', '--cpu=x64', '--libc=glibc', '--verbose'], {
            cwd: dir,
            env: baseEnv,
        });
        assert.equal(r.status, 0, `an optional platform mismatch must not fail: ${r.stderr}\n${r.stdout}`);
        assert.equal(installed(dir, 'win-only'), false);
        const lock = lockOf(dir);
        assert.equal(lock.packages['node_modules/win-only'].optional, true, 'it must still be pinned, as optional');
    });

    it('reads the same target from the npm_config_* env keys', async () => {
        // The flags ARE npm config keys; `npm_config_libc=musl gjsify install` is
        // the same input as `--libc=musl`. Pinned because that equivalence is
        // what lets the flags be a thin wrapper rather than a second mechanism.
        const dir = project('env-target', { dependencies: { 'plat-app': '^1.0.0' } });
        const r = await runCli(cliEntry, ['install', '--verbose'], {
            cwd: dir,
            env: { ...baseEnv, npm_config_os: 'linux', npm_config_cpu: 'x64', npm_config_libc: 'musl' },
        });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.ok(installed(dir, 'plat-bin-linux-x64-musl'));
        assert.equal(installed(dir, 'plat-bin-linux-x64-gnu'), false);
    });
});
