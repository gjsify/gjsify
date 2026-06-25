// E2E test for `gjsify install` INCREMENTAL EXTRACTION (the npm/yarn/pnpm
// "unchanged node" default that the native backend was missing).
//
// Before the fix, EVERY resolved node was unconditionally `rmSync`-ed and
// re-extracted on every install — even the ones already correctly on disk at
// the right version. On a large workspace (2000+ packages) the second install
// re-extracts the whole tree: each `.tgz` gunzip routes through GJS's
// Gio.ZlibDecompressor on the single GLib main loop, so a warm re-install that
// should be a near-no-op instead churned for many minutes with no output (the
// observed "downloading N package(s)" → 25-min silence hang). The over-broad
// "download N package(s)" count was the whole closure, not the new subtree.
//
// The fix: `extractOne` reads `<dest>/package.json` first and SKIPS the
// rm + re-extract when name+version already match (npm's "unchanged"
// semantics). Only the genuinely new/changed subtree is written.
//
// This test proves the skip by dropping a SENTINEL marker file inside each
// extracted package after install #1. A re-extract `rmSync`s the package dir,
// which would delete the marker; if the marker survives a second install, the
// package was correctly skipped. We then add a new dep and assert:
//   - the new package IS extracted (no marker — fresh),
//   - the unchanged packages are NOT re-extracted (markers survive),
//   - GJSIFY_INSTALL_FORCE_EXTRACT=1 re-extracts everything (markers gone).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// ----- tar helpers (ustar v0, a single package.json entry) -----
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
function versionEntry(name, version, dependencies = {}) {
    const files = {
        'package.json': JSON.stringify({ name, version, main: 'index.js', dependencies }),
        'index.js': `module.exports = ${JSON.stringify({ name, version })};\n`,
    };
    const tgz = gzipSync(buildPackageTar(files));
    return { name, version, dependencies, tgz, integrity: sriSha512(tgz) };
}

/** Run the CLI under Node without blocking the in-process mock-registry loop. */
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

const MARKER = '.gjsify-e2e-marker';

/** Drop a sentinel marker into each extracted package dir. A re-extract
 *  `rmSync`s the dir and removes the marker — its survival proves a skip. */
function markPackages(projectDir, names) {
    for (const name of names) {
        const dir = join(projectDir, 'node_modules', name);
        if (existsSync(dir)) writeFileSync(join(dir, MARKER), 'x');
    }
}
function markerSurvives(projectDir, name) {
    return existsSync(join(projectDir, 'node_modules', name, MARKER));
}

describe('gjsify install — incremental extraction (skip already-extracted)', { timeout: 120_000 }, () => {
    let server, registryUrl, projectDir, cliEntry, envForCli, cacheDir;

    // root → mid → leaf ; root → leaf (so leaf is shared, mid + leaf are
    // transitive). After install #1 all three are on disk. Adding `extra`
    // (a fresh standalone dep) must re-extract ONLY `extra`, leaving root /
    // mid / leaf untouched.
    const ALL = {
        leaf: { '1.0.0': versionEntry('leaf', '1.0.0') },
        mid: { '1.0.0': versionEntry('mid', '1.0.0', { leaf: '^1.0.0' }) },
        root: { '1.0.0': versionEntry('root', '1.0.0', { mid: '^1.0.0', leaf: '^1.0.0' }) },
        extra: { '1.0.0': versionEntry('extra', '1.0.0') },
    };

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
                const versions = ALL[name];
                if (!versions) return void res.writeHead(404).end('not found');
                const baseUrl = `http://127.0.0.1:${server.address().port}`;
                const verNames = Object.keys(versions);
                const wire = { name, 'dist-tags': { latest: verNames[verNames.length - 1] }, versions: {} };
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

        projectDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-incremental-'));
        // Per-run cache root so a developer's warm ~/.cache doesn't change the
        // network behaviour, and so the suite stays parallel-safe.
        cacheDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-incremental-cache-'));
        cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;
        envForCli = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registryUrl,
            XDG_CACHE_HOME: cacheDir,
            // Don't read a co-developer's npm cacache during the test.
            GJSIFY_NPM_CACHE: '0',
        };

        writeFileSync(
            join(projectDir, 'package.json'),
            JSON.stringify(
                {
                    name: 'incremental-test',
                    version: '0.1.0',
                    type: 'commonjs',
                    private: true,
                    dependencies: { root: '^1.0.0' },
                },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(join(projectDir, '.npmrc'), `registry=${registryUrl}\n`);
    });

    after(() => {
        if (server) server.close();
        if (projectDir) rmSync(projectDir, { recursive: true, force: true });
        if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
    });

    it('initial install extracts the full tree', async () => {
        const r = await runCli(cliEntry, ['install'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        for (const name of ['root', 'mid', 'leaf']) {
            assert.ok(
                existsSync(join(projectDir, 'node_modules', name, 'package.json')),
                `node_modules/${name}/package.json missing after initial install`,
            );
        }
        // Seed sentinels into the already-correct packages.
        markPackages(projectDir, ['root', 'mid', 'leaf']);
    });

    it('adding a dep re-extracts ONLY the new subtree (unchanged nodes skipped)', async () => {
        const pkgPath = join(projectDir, 'package.json');
        const pkg = JSON.parse((await import('node:fs')).readFileSync(pkgPath, 'utf-8'));
        pkg.dependencies.extra = '^1.0.0';
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

        const r = await runCli(cliEntry, ['install'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        // The unchanged packages must NOT have been re-extracted — their
        // sentinel markers must survive. This is the core regression guard:
        // before the fix, every node was rm-ed + re-extracted, deleting them.
        for (const name of ['root', 'mid', 'leaf']) {
            assert.ok(
                markerSurvives(projectDir, name),
                `node_modules/${name} was re-extracted (marker gone) — incremental skip is broken`,
            );
        }
        // The genuinely-new dep must be on disk (fresh extract, no marker).
        assert.ok(
            existsSync(join(projectDir, 'node_modules', 'extra', 'package.json')),
            'the newly-added `extra` package was not installed',
        );
        assert.ok(!markerSurvives(projectDir, 'extra'), 'extra should be freshly extracted (no marker)');
    });

    it('a plain re-install of an unchanged tree extracts nothing', async () => {
        // No package.json change → the lockfile matches the request → the
        // resolver is skipped entirely, and every node is already on disk, so
        // the extract phase is a full no-op. Re-mark `extra` first so all four
        // packages carry a sentinel.
        markPackages(projectDir, ['extra']);
        const r = await runCli(cliEntry, ['install'], { cwd: projectDir, env: envForCli });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        for (const name of ['root', 'mid', 'leaf', 'extra']) {
            assert.ok(
                markerSurvives(projectDir, name),
                `node_modules/${name} was re-extracted on a no-change re-install (marker gone)`,
            );
        }
    });

    it('GJSIFY_INSTALL_FORCE_EXTRACT=1 re-extracts everything', async () => {
        // Markers are present from the previous test. A forced extract rm-s
        // every package dir, so all sentinels must be GONE afterwards — proves
        // the skip is an opt-out fast-path, not an unconditional bypass.
        const r = await runCli(cliEntry, ['install'], {
            cwd: projectDir,
            env: { ...envForCli, GJSIFY_INSTALL_FORCE_EXTRACT: '1' },
        });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);
        for (const name of ['root', 'mid', 'leaf', 'extra']) {
            assert.ok(
                !markerSurvives(projectDir, name),
                `node_modules/${name} kept its marker under FORCE_EXTRACT (force re-extract is broken)`,
            );
            assert.ok(
                existsSync(join(projectDir, 'node_modules', name, 'package.json')),
                `node_modules/${name} missing after forced re-extract`,
            );
        }
    });
});
