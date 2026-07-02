// E2E test for the content-hash per-package build cache (ADR 0006 phase 1):
// `gjsify foreach <script> --cached` / `gjsify workspace <name> <script>
// --cached`.
//
// Scaffolds a tiny monorepo (mkdtemp, hermetic):
//   @test/a — leaf package
//   @test/b — depends on @test/a (workspace:^)
//   @test/c — independent
//   @test/d — NO build script, but a committed lib/ (must never be touched)
// Each `build` script writes a unique marker (timestamp+random) into lib/, so
// "did the build actually run?" is observable from the marker content.
//
// Asserts the ADR invariants: (1) cold cache runs every build; (2) a second
// run hits for all (markers byte-identical, log says hit); (3) editing A's
// src re-runs A AND its dependent B but NOT C; (4) a package without the
// script is skipped untouched; plus growth bounding (≤ 2 keys per package),
// restore-after-delete, the GJSIFY_BUILD_CACHE env toggle and the
// `gjsify workspace --cached` path.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

function runCli(cliEntry, args, { cwd, env, timeoutMs = 60_000 } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliEntry, ...args], {
            cwd,
            // Hermetic: never inherit a build-cache toggle from the outer
            // environment; individual tests opt in explicitly.
            env: { ...process.env, GJSIFY_BUILD_CACHE: '', ...env },
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

describe('gjsify build cache (--cached, ADR 0006 phase 1)', { timeout: 300_000 }, () => {
    let root, cliEntry;

    const pkgDir = (dir) => join(root, 'packages', dir);
    const marker = (dir) => {
        const p = join(pkgDir(dir), 'lib', 'marker.txt');
        return existsSync(p) ? readFileSync(p, 'utf-8') : null;
    };
    const markers = () => ({ a: marker('a'), b: marker('b'), c: marker('c') });
    const cacheRoot = () => join(root, 'node_modules', '.cache', 'gjsify', 'build');
    const cacheDirFor = (prefix) => {
        if (!existsSync(cacheRoot())) return null;
        const match = readdirSync(cacheRoot()).filter((d) => d.startsWith(prefix));
        return match.length === 1 ? join(cacheRoot(), match[0]) : null;
    };

    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-build-cache-'));
        cliEntry = new URL('../../../packages/infra/cli/lib/index.js', import.meta.url).pathname;

        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify(
                {
                    name: 'build-cache-monorepo',
                    version: '0.0.0',
                    private: true,
                    type: 'module',
                    workspaces: ['packages/*'],
                },
                null,
                2,
            ) + '\n',
        );

        // `build` writes a unique marker into lib/ — marker equality across
        // runs proves the script did NOT re-run (or that the cache restored
        // the same bytes, which is the observable contract either way).
        const buildScript =
            "node -e \"const fs=require('fs');fs.mkdirSync('lib',{recursive:true});fs.writeFileSync('lib/marker.txt',Date.now()+':'+Math.random())\"";
        const workspaces = [
            { dir: 'a', name: '@test/a', deps: {}, build: true },
            { dir: 'b', name: '@test/b', deps: { '@test/a': 'workspace:^' }, build: true },
            { dir: 'c', name: '@test/c', deps: {}, build: true },
            // d has NO build script — the safety rule says the cache must
            // never touch it, including its "committed" lib/.
            { dir: 'd', name: '@test/d', deps: {}, build: false },
        ];
        for (const w of workspaces) {
            mkdirSync(join(pkgDir(w.dir), 'src'), { recursive: true });
            writeFileSync(join(pkgDir(w.dir), 'src', 'index.ts'), `export const who = '${w.name}';\n`);
            writeFileSync(
                join(pkgDir(w.dir), 'package.json'),
                JSON.stringify(
                    {
                        name: w.name,
                        version: '0.0.1',
                        type: 'module',
                        private: false,
                        dependencies: w.deps,
                        scripts: w.build ? { build: buildScript } : { echo: 'node -e ""' },
                    },
                    null,
                    2,
                ) + '\n',
            );
        }
        mkdirSync(join(pkgDir('d'), 'lib'), { recursive: true });
        writeFileSync(join(pkgDir('d'), 'lib', 'precious.txt'), 'committed no-build lib — hands off\n');
    });

    after(() => {
        if (root) rmSync(root, { recursive: true, force: true });
    });

    let coldMarkers;

    it('(1) cold cache: first --cached run builds every package (all misses)', async () => {
        const r = await runCli(cliEntry, ['foreach', 'build', '--cached'], { cwd: root });
        assert.equal(r.status, 0, `foreach failed: ${r.stderr}\n${r.stdout}`);
        coldMarkers = markers();
        for (const [k, v] of Object.entries(coldMarkers)) {
            assert.ok(v, `packages/${k}/lib/marker.txt missing — build did not run`);
        }
        for (const name of ['@test/a', '@test/b', '@test/c']) {
            assert.match(
                r.stderr,
                new RegExp(`\\[gjsify build-cache\\] ${name}: miss`),
                `expected miss log for ${name}`,
            );
            assert.match(
                r.stderr,
                new RegExp(`\\[gjsify build-cache\\] ${name}: stored`),
                `expected store log for ${name}`,
            );
        }
        // d (no build script) is filtered out entirely — untouched.
        assert.ok(!r.stderr.includes('@test/d'), '@test/d must not appear in cache logs');
    });

    it('(2) warm cache: second run hits for all, markers unchanged', async () => {
        const r = await runCli(cliEntry, ['foreach', 'build', '--cached'], { cwd: root });
        assert.equal(r.status, 0, `foreach failed: ${r.stderr}`);
        for (const name of ['@test/a', '@test/b', '@test/c']) {
            assert.match(r.stderr, new RegExp(`\\[gjsify build-cache\\] ${name}: hit`), `expected hit log for ${name}`);
        }
        assert.deepEqual(markers(), coldMarkers, 'cache hit must leave the built markers byte-identical');
    });

    it('(2b) hit restores outputs after they were deleted', async () => {
        rmSync(join(pkgDir('c'), 'lib'), { recursive: true, force: true });
        const r = await runCli(cliEntry, ['foreach', 'build', '--cached'], { cwd: root });
        assert.equal(r.status, 0, `foreach failed: ${r.stderr}`);
        assert.match(
            r.stderr,
            /\[gjsify build-cache\] @test\/c: hit .* restored lib/,
            'expected a restoring hit for @test/c',
        );
        assert.equal(marker('c'), coldMarkers.c, 'restored marker must be the stored bytes, not a rebuild');
    });

    it("(3) editing A's src re-runs A AND its dependent B, but not C", async () => {
        writeFileSync(join(pkgDir('a'), 'src', 'index.ts'), "export const who = '@test/a edited';\n");
        const r = await runCli(cliEntry, ['foreach', 'build', '--cached'], { cwd: root });
        assert.equal(r.status, 0, `foreach failed: ${r.stderr}`);
        const now = markers();
        assert.notEqual(now.a, coldMarkers.a, 'A must rebuild after its src changed');
        assert.notEqual(now.b, coldMarkers.b, 'B depends on A — must rebuild too');
        assert.equal(now.c, coldMarkers.c, 'C is unrelated — must stay cached');
        assert.match(r.stderr, /\[gjsify build-cache\] @test\/a: miss/);
        assert.match(r.stderr, /\[gjsify build-cache\] @test\/b: miss/);
        assert.match(r.stderr, /\[gjsify build-cache\] @test\/c: hit/);
        coldMarkers = now;
    });

    it('(4) a package without the script is skipped untouched (no cache entry, committed lib intact)', async () => {
        assert.equal(
            readFileSync(join(pkgDir('d'), 'lib', 'precious.txt'), 'utf-8'),
            'committed no-build lib — hands off\n',
            "d's committed lib/ was modified",
        );
        assert.ok(!existsSync(join(pkgDir('d'), 'lib', 'marker.txt')), 'd must not gain build outputs');
        assert.equal(cacheDirFor('test-d-'), null, 'no cache dir may exist for @test/d');
    });

    it('(5) growth is bounded: at most 2 keys per package', async () => {
        // Two more distinct input states → 4 keys seen in total for A.
        for (const edit of ['v3', 'v4']) {
            writeFileSync(join(pkgDir('a'), 'src', 'index.ts'), `export const who = '${edit}';\n`);
            const r = await runCli(cliEntry, ['foreach', 'build', '--cached'], { cwd: root });
            assert.equal(r.status, 0, `foreach failed: ${r.stderr}`);
        }
        const dir = cacheDirFor('test-a-');
        assert.ok(dir, 'cache dir for @test/a missing');
        const keys = readdirSync(dir);
        assert.ok(keys.length <= 2, `expected <= 2 cached keys for @test/a, got ${keys.length}: ${keys.join(', ')}`);
    });

    it('(6) GJSIFY_BUILD_CACHE=1 enables the cache without the flag; --no-cached overrides', async () => {
        const hit = await runCli(cliEntry, ['foreach', 'build'], { cwd: root, env: { GJSIFY_BUILD_CACHE: '1' } });
        assert.equal(hit.status, 0, `foreach failed: ${hit.stderr}`);
        assert.match(hit.stderr, /\[gjsify build-cache\] @test\/a: hit/, 'env toggle must enable the cache');
        const before = markers();
        const off = await runCli(cliEntry, ['foreach', 'build', '--no-cached'], {
            cwd: root,
            env: { GJSIFY_BUILD_CACHE: '1' },
        });
        assert.equal(off.status, 0, `foreach failed: ${off.stderr}`);
        assert.ok(!off.stderr.includes('[gjsify build-cache]'), '--no-cached must win over the env toggle');
        assert.notEqual(markers().a, before.a, '--no-cached must actually re-run the builds');
        // Re-store the current state for the tests below.
        const restore = await runCli(cliEntry, ['foreach', 'build', '--cached'], { cwd: root });
        assert.equal(restore.status, 0);
    });

    it('(7) gjsify workspace <name> <script> --cached hits the same cache', async () => {
        const r = await runCli(cliEntry, ['workspace', '@test/b', 'build', '--cached'], { cwd: root });
        assert.equal(r.status, 0, `workspace failed: ${r.stderr}`);
        assert.match(
            r.stderr,
            /\[gjsify build-cache\] @test\/b: hit/,
            'workspace --cached must hit the foreach-stored entry',
        );
    });

    it('(8) --cached with --exec is rejected', async () => {
        const r = await runCli(cliEntry, ['foreach', '--cached', '--exec', '--', 'node', '-e', ''], { cwd: root });
        assert.notEqual(r.status, 0, 'expected non-zero exit for --cached --exec');
        assert.match(r.stdout + r.stderr, /--cached only applies to script mode/i);
    });
});
