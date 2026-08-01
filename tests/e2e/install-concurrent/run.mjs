// E2E guard for ADR 0001 step 2 — concurrent `gjsify install` safety.
//
// Historical failure shape: 5+ concurrent installs (native backend, shared
// XDG tarball/packument cache) could hang at 0% CPU or corrupt each other's
// trees; same-prefix installs interleaved `rmSync` + extract on the same
// destination dirs and tore the lockfile. The fixes under test:
//
//   - per-prefix cross-process install lock
//     (`node_modules/.gjsify-install-lock/`, mkdir-exclusive, stale-stealing)
//   - atomic tmp+rename writes for the shared XDG caches + gjsify-lock.json
//
// Cases:
//   1. N=6 DIFFERENT projects installing concurrently against ONE shared
//      XDG_CACHE_HOME — all must exit 0 with correct trees (cache-write soak;
//      different prefixes must NOT serialize on each other).
//   2. Re-install after a dep-range change, again 6-wide concurrent — the
//      historical "hangs after a range change" shape. (The historical hang
//      itself was never reproduced deterministically; this is the soak guard.)
//   3. M=5 concurrent installs into the SAME project — the per-prefix lock
//      must serialize them; every process exits 0 and the final tree +
//      lockfile are intact, with no leftover lock dir.
//   4. A lock held by a DEAD pid is stolen (crash recovery).
//   5. A lock held by a LIVE pid is waited on (the waiting notice is
//      printed), and the install completes once the lock is released.
//
// Parallel-safe within the e2e batch: everything lives under its own
// mkdtemp, the mock registry listens on port 0, XDG/HOME are redirected into
// the fixture, and the npm-cacache interop is disabled (hermetic env).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// ----- tar helpers (ustar v0, same pattern as install-workspace-source-safety) -----
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
function buildPackageTar(files) {
    const parts = [tarHeader('package/', 0, '5')];
    for (const [name, content] of Object.entries(files)) {
        const body = Buffer.from(content);
        const padded = Buffer.alloc(Math.ceil(body.length / BLOCK) * BLOCK);
        body.copy(padded);
        parts.push(tarHeader(`package/${name}`, body.length), padded);
    }
    parts.push(Buffer.alloc(BLOCK * 2));
    return Buffer.concat(parts);
}
function sriSha512(bytes) {
    return `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
}

function runCli(cliEntry, args, { cwd, env, timeoutMs = 120_000 } = {}) {
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
            // ChildProcess.kill with a known signal never throws — failure
            // to deliver just returns false (the process already exited).
            child.kill('SIGKILL');
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

// Mock registry graph: alpha depends on beta (transitive dep exercised);
// gamma has two versions so a dep-range change forces a real re-resolve.
const PACKAGES = {
    alpha: {
        '1.0.0': { dependencies: { beta: '^1.0.0' } },
    },
    beta: {
        '1.2.3': { dependencies: {} },
    },
    gamma: {
        '1.0.0': { dependencies: {} },
        '1.5.0': { dependencies: {} },
    },
};

function makeRegistry() {
    const index = {};
    for (const [name, versions] of Object.entries(PACKAGES)) {
        index[name] = { name, 'dist-tags': {}, versions: {} };
        let last = '';
        for (const [version, body] of Object.entries(versions)) {
            const tgz = gzipSync(
                buildPackageTar({
                    'package.json': JSON.stringify({
                        name,
                        version,
                        main: 'index.js',
                        dependencies: body.dependencies,
                    }),
                    'index.js': `module.exports = { name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)} };\n`,
                }),
            );
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

    const server = createServer((req, res) => {
        try {
            const url = req.url ?? '';
            const tarMatch = url.match(/^\/-\/([^/]+)\/([^/]+)\.tgz$/);
            if (tarMatch) {
                const v = index[tarMatch[1]]?.versions[tarMatch[2]];
                if (!v) {
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
    return server;
}

function installedVersion(projectDir, name) {
    const manifest = join(projectDir, 'node_modules', name, 'package.json');
    assert.ok(existsSync(manifest), `${manifest} missing after install`);
    return JSON.parse(readFileSync(manifest, 'utf-8')).version;
}

function assertNoLeftoverLock(projectDir) {
    assert.ok(
        !existsSync(join(projectDir, 'node_modules', '.gjsify-install-lock')),
        `install lock dir must be released after a successful install (${projectDir})`,
    );
}

/** Wait for a freshly-spawned no-op process to exit, returning its (dead) pid. */
function deadPid() {
    return new Promise((resolveP, reject) => {
        const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
        child.on('exit', () => resolveP(child.pid));
        child.on('error', reject);
    });
}

describe('gjsify install — concurrent installs (per-prefix lock + atomic shared caches)', { timeout: 300_000 }, () => {
    let server, registryUrl, fixtureRoot, cliEntry, envBase;
    const N_PROJECTS = 6;
    const projects = [];

    before(async () => {
        server = makeRegistry();
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        registryUrl = `http://127.0.0.1:${server.address().port}/`;
        cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;

        fixtureRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-concurrent-'));
        const sharedXdgCache = join(fixtureRoot, 'xdg-cache');
        const homeDir = join(fixtureRoot, 'home');
        mkdirSync(sharedXdgCache, { recursive: true });
        mkdirSync(homeDir, { recursive: true });

        envBase = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registryUrl,
            // ONE shared cache for every concurrent install — the soak target.
            XDG_CACHE_HOME: sharedXdgCache,
            // Hermetic: no user ~/.npmrc, no npm-cacache interop.
            HOME: homeDir,
            GJSIFY_NPM_CACHE: '0',
        };

        for (let i = 0; i < N_PROJECTS; i++) {
            const dir = join(fixtureRoot, 'projects', `proj-${i}`);
            mkdirSync(dir, { recursive: true });
            writeFileSync(
                join(dir, 'package.json'),
                JSON.stringify(
                    {
                        name: `proj-${i}`,
                        version: '0.0.0',
                        private: true,
                        dependencies: { alpha: '^1.0.0', gamma: '~1.0.0' },
                    },
                    null,
                    2,
                ) + '\n',
            );
            writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);
            projects.push(dir);
        }
    });

    after(() => {
        if (server) server.close();
        if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
    });

    it('6 projects sharing one XDG cache install concurrently, all exit 0', async () => {
        const results = await Promise.all(
            projects.map((dir) => runCli(cliEntry, ['install'], { cwd: dir, env: envBase })),
        );
        for (const [i, r] of results.entries()) {
            assert.equal(r.status, 0, `install in proj-${i} failed:\n${r.stderr}\n${r.stdout}`);
        }
        for (const dir of projects) {
            assert.equal(installedVersion(dir, 'alpha'), '1.0.0');
            assert.equal(installedVersion(dir, 'beta'), '1.2.3', 'transitive dep must materialize');
            assert.equal(installedVersion(dir, 'gamma'), '1.0.0', '~1.0.0 must pick 1.0.0, not 1.5.0');
            const lock = JSON.parse(readFileSync(join(dir, 'gjsify-lock.json'), 'utf-8'));
            assert.equal(lock.lockfileVersion, 2, 'lockfile must be valid v2 JSON (no torn writes)');
            assertNoLeftoverLock(dir);
        }
    });

    it('re-install after a dep-range change, 6-wide concurrent (historical hang shape)', async () => {
        // Widen gamma's range in every project so the next install MUST
        // re-resolve (lockfile `requested` set changes) — the exact shape the
        // historical 0%-CPU hang was reported against.
        for (const dir of projects) {
            const pkgPath = join(dir, 'package.json');
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
            pkg.dependencies.gamma = '^1.4.0';
            writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        }
        const results = await Promise.all(
            projects.map((dir) => runCli(cliEntry, ['install'], { cwd: dir, env: envBase })),
        );
        for (const [i, r] of results.entries()) {
            assert.equal(r.status, 0, `re-install in proj-${i} failed:\n${r.stderr}\n${r.stdout}`);
        }
        for (const dir of projects) {
            assert.equal(installedVersion(dir, 'gamma'), '1.5.0', 'range change must re-resolve gamma');
            assert.equal(installedVersion(dir, 'beta'), '1.2.3', 'untouched dep must keep its pinned version');
            assertNoLeftoverLock(dir);
        }
    });

    it('5 concurrent installs into the SAME project serialize and all exit 0', async () => {
        const dir = join(fixtureRoot, 'projects', 'contended');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                { name: 'contended', version: '0.0.0', private: true, dependencies: { alpha: '^1.0.0' } },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);

        const results = await Promise.all(
            Array.from({ length: 5 }, () => runCli(cliEntry, ['install'], { cwd: dir, env: envBase })),
        );
        for (const [i, r] of results.entries()) {
            assert.equal(r.status, 0, `same-prefix install #${i} failed:\n${r.stderr}\n${r.stdout}`);
        }
        assert.equal(installedVersion(dir, 'alpha'), '1.0.0');
        assert.equal(installedVersion(dir, 'beta'), '1.2.3');
        const lock = JSON.parse(readFileSync(join(dir, 'gjsify-lock.json'), 'utf-8'));
        assert.ok(lock.packages['node_modules/alpha'], 'lockfile must pin alpha (no torn write)');
        assertNoLeftoverLock(dir);
    });

    it('steals a lock left behind by a dead process', async () => {
        const dir = join(fixtureRoot, 'projects', 'stale-lock');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                { name: 'stale-lock', version: '0.0.0', private: true, dependencies: { beta: '^1.0.0' } },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);

        // Fabricate the crash residue: a lock dir owned by a pid that no
        // longer exists (a just-exited child process).
        const pid = await deadPid();
        const lockDir = join(dir, 'node_modules', '.gjsify-install-lock');
        mkdirSync(lockDir, { recursive: true });
        writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid, nonce: 'crashed', startedAt: Date.now() }));

        const r = await runCli(cliEntry, ['install'], { cwd: dir, env: envBase });
        assert.equal(r.status, 0, `install must steal the dead-pid lock and proceed:\n${r.stderr}\n${r.stdout}`);
        assert.match(r.stderr, /removed stale install lock/, `expected the stale-steal notice:\n${r.stderr}`);
        assert.equal(installedVersion(dir, 'beta'), '1.2.3');
        assertNoLeftoverLock(dir);
    });

    it('waits for a lock held by a live process and proceeds on release', async () => {
        const dir = join(fixtureRoot, 'projects', 'held-lock');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                { name: 'held-lock', version: '0.0.0', private: true, dependencies: { beta: '^1.0.0' } },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(dir, '.npmrc'), `registry=${registryUrl}\n`);

        // Hold the lock as THIS (alive) test-runner process, then release it
        // after 2s while the install is blocked on it.
        const lockDir = join(dir, 'node_modules', '.gjsify-install-lock');
        mkdirSync(lockDir, { recursive: true });
        writeFileSync(
            join(lockDir, 'owner.json'),
            JSON.stringify({ pid: process.pid, nonce: 'held-by-test', startedAt: Date.now() }),
        );
        const releaseTimer = setTimeout(() => rmSync(lockDir, { recursive: true, force: true }), 2_000);

        const r = await runCli(cliEntry, ['install'], { cwd: dir, env: envBase });
        clearTimeout(releaseTimer);
        assert.equal(r.status, 0, `install must complete after the lock is released:\n${r.stderr}\n${r.stdout}`);
        assert.match(
            r.stderr,
            /waiting for a concurrent install/,
            `expected the lock-wait notice while the live lock was held:\n${r.stderr}`,
        );
        assert.equal(installedVersion(dir, 'beta'), '1.2.3');
        assertNoLeftoverLock(dir);
    });
});
