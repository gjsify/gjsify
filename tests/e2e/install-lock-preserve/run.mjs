// E2E test for `gjsify install` LOCKFILE PRESERVATION (the npm/yarn/pnpm
// default that gjsify was missing).
//
// Before the fix, any resolve that had to run (e.g. adding one package) went
// through a FULL re-resolution that bumped every `^`-range to the newest
// registry match — silently churning unrelated transitive deps. The fix: a
// resolve seeds itself with the versions already pinned in the lockfile, so an
// add only moves the genuinely new/changed deps. `--refresh-lockfile` opts back
// into the bump-everything behaviour (≈ `yarn install --mode=update-lockfile`).
//
// Scenario (a mutable mock registry simulates "a newer version was published
// after the initial install"):
//   1. package.json deps {dep-a@^1.0.0}; registry exposes only dep-a@1.0.0.
//      `gjsify install` → lock pins dep-a@1.0.0.
//   2. Registry now ALSO exposes dep-a@1.1.0 (still satisfies ^1.0.0).
//      Add dep-b to package.json + `gjsify install` → dep-a STAYS 1.0.0
//      (preserved), dep-b@1.0.0 added.
//   3. `gjsify install --refresh-lockfile` → dep-a bumps to 1.1.0.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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

/** A package version entry's prebuilt tarball + integrity. */
function versionEntry(name, version, dependencies = {}) {
    const files = {
        'package.json': JSON.stringify({ name, version, main: 'index.js', dependencies }),
        'index.js': `module.exports = ${JSON.stringify({ name, version })};\n`,
    };
    const tgz = gzipSync(buildPackageTar(files));
    return { name, version, dependencies, tgz, integrity: sriSha512(tgz) };
}

/** Read the resolved version of `name` at the hoisted root path in the lockfile. */
function lockedVersion(projectDir, name) {
    const lock = JSON.parse(readFileSync(join(projectDir, 'gjsify-lock.json'), 'utf-8'));
    return lock.packages?.[`node_modules/${name}`]?.version;
}

describe('gjsify install — lockfile preservation', { timeout: 90_000 }, () => {
    let server, registryUrl, projectDir, cliEntry, envForCli;

    // Mutable: when false, dep-a's packument hides 1.1.0 (only 1.0.0 visible).
    let exposeNewer = false;

    const ALL = {
        'dep-a': {
            '1.0.0': versionEntry('dep-a', '1.0.0'),
            '1.1.0': versionEntry('dep-a', '1.1.0'),
        },
        'dep-b': {
            '1.0.0': versionEntry('dep-b', '1.0.0'),
        },
    };

    function visibleVersions(name) {
        if (name === 'dep-a' && !exposeNewer) {
            return { '1.0.0': ALL['dep-a']['1.0.0'] };
        }
        return ALL[name];
    }

    before(async () => {
        server = createServer((req, res) => {
            try {
                const url = req.url ?? '';
                const tarMatch = url.match(/^\/-\/([^/]+)\/([^/]+)\.tgz$/);
                if (tarMatch) {
                    const v = ALL[tarMatch[1]]?.[tarMatch[2]];
                    if (!v) return void res.writeHead(404).end('not found');
                    res.writeHead(200, { 'content-type': 'application/octet-stream' });
                    return void res.end(v.tgz);
                }
                const name = decodeURIComponent(url.replace(/^\//, ''));
                const versions = visibleVersions(name);
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

        projectDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-preserve-'));
        cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
        envForCli = { ...process.env, GJSIFY_INSTALL_BACKEND: 'native', npm_config_registry: registryUrl };

        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify(
                { name: 'preserve-test', version: '0.1.0', type: 'commonjs', private: true, dependencies: { 'dep-a': '^1.0.0' } },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(projectDir, '.npmrc'), `registry=${registryUrl}\n`);
    });

    after(() => {
        if (server) server.close();
        if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    });

    it('initial install pins dep-a@1.0.0 (only version visible)', async () => {
        exposeNewer = false;
        const r = await runCli(cliEntry, ['install'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.equal(lockedVersion(projectDir, 'dep-a'), '1.0.0');
    });

    it('adding dep-b PRESERVES dep-a@1.0.0 even though 1.1.0 now satisfies ^1.0.0', async () => {
        // A newer dep-a is now published — a naive re-resolve would bump to it.
        exposeNewer = true;
        const pkgPath = join(projectDir, 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        pkg.dependencies['dep-b'] = '^1.0.0';
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

        const r = await runCli(cliEntry, ['install'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        assert.equal(lockedVersion(projectDir, 'dep-a'), '1.0.0', 'dep-a must NOT bump on an add (lockfile preserved)');
        assert.equal(lockedVersion(projectDir, 'dep-b'), '1.0.0', 'dep-b must be added');
    });

    it('--refresh-lockfile bumps dep-a to the newest in-range version (1.1.0)', async () => {
        exposeNewer = true;
        const r = await runCli(cliEntry, ['install', '--refresh-lockfile'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        assert.equal(lockedVersion(projectDir, 'dep-a'), '1.1.0', '--refresh-lockfile must bump within ranges');
    });

    it('--immutable + --refresh-lockfile is rejected', async () => {
        const r = await runCli(cliEntry, ['install', '--immutable', '--refresh-lockfile'], {
            cwd: projectDir,
            env: envForCli,
        });
        assert.notEqual(r.status, 0, 'the contradictory flag combo must fail');
        assert.match(r.stderr, /incompatible/i);
    });
});
