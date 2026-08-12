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
import {
    mkdtempSync,
    rmSync,
    existsSync,
    writeFileSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli as runCliRaw } from '../mock-registry.mjs';

/**
 * The shared CLI runner, made HERMETIC for this suite.
 *
 * `GJSIFY_BUILD_CACHE` is blanked before each test's own `env` is layered on, so a
 * developer with the toggle exported does not silently turn the cache on for the
 * cases that assert it is OFF. It is a policy about THIS suite's subject, not a
 * property of running the CLI, which is why it lives here and not in the shared
 * runner — and why the shared runner's plain pass-through would have made
 * `env: { GJSIFY_BUILD_CACHE: '1' }` replace the whole environment, PATH included.
 */
const runCli = (cliEntry, args, { env, ...rest } = {}) =>
    runCliRaw(cliEntry, args, { ...rest, env: { ...process.env, GJSIFY_BUILD_CACHE: '', ...env } });

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
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));

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
        const r = await runCli(cliEntry, ['foreach', 'build', '--cached'], { timeoutMs: 60_000, cwd: root });
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
        const r = await runCli(cliEntry, ['foreach', 'build', '--cached'], { timeoutMs: 60_000, cwd: root });
        assert.equal(r.status, 0, `foreach failed: ${r.stderr}`);
        for (const name of ['@test/a', '@test/b', '@test/c']) {
            assert.match(r.stderr, new RegExp(`\\[gjsify build-cache\\] ${name}: hit`), `expected hit log for ${name}`);
        }
        assert.deepEqual(markers(), coldMarkers, 'cache hit must leave the built markers byte-identical');
    });

    it('(2b) hit restores outputs after they were deleted', async () => {
        rmSync(join(pkgDir('c'), 'lib'), { recursive: true, force: true });
        const r = await runCli(cliEntry, ['foreach', 'build', '--cached'], { timeoutMs: 60_000, cwd: root });
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
        const r = await runCli(cliEntry, ['foreach', 'build', '--cached'], { timeoutMs: 60_000, cwd: root });
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
            const r = await runCli(cliEntry, ['foreach', 'build', '--cached'], { timeoutMs: 60_000, cwd: root });
            assert.equal(r.status, 0, `foreach failed: ${r.stderr}`);
        }
        const dir = cacheDirFor('test-a-');
        assert.ok(dir, 'cache dir for @test/a missing');
        const keys = readdirSync(dir);
        assert.ok(keys.length <= 2, `expected <= 2 cached keys for @test/a, got ${keys.length}: ${keys.join(', ')}`);
    });

    it('(6) GJSIFY_BUILD_CACHE=1 enables the cache without the flag; --no-cached overrides', async () => {
        const hit = await runCli(cliEntry, ['foreach', 'build'], {
            timeoutMs: 60_000,
            cwd: root,
            env: { GJSIFY_BUILD_CACHE: '1' },
        });
        assert.equal(hit.status, 0, `foreach failed: ${hit.stderr}`);
        assert.match(hit.stderr, /\[gjsify build-cache\] @test\/a: hit/, 'env toggle must enable the cache');
        const before = markers();
        const off = await runCli(cliEntry, ['foreach', 'build', '--no-cached'], {
            timeoutMs: 60_000,
            cwd: root,
            env: { GJSIFY_BUILD_CACHE: '1' },
        });
        assert.equal(off.status, 0, `foreach failed: ${off.stderr}`);
        assert.ok(!off.stderr.includes('[gjsify build-cache]'), '--no-cached must win over the env toggle');
        assert.notEqual(markers().a, before.a, '--no-cached must actually re-run the builds');
        // Re-store the current state for the tests below.
        const restore = await runCli(cliEntry, ['foreach', 'build', '--cached'], { timeoutMs: 60_000, cwd: root });
        assert.equal(restore.status, 0);
    });

    it('(7) gjsify workspace <name> <script> --cached hits the same cache', async () => {
        const r = await runCli(cliEntry, ['workspace', '@test/b', 'build', '--cached'], {
            timeoutMs: 60_000,
            cwd: root,
        });
        assert.equal(r.status, 0, `workspace failed: ${r.stderr}`);
        assert.match(
            r.stderr,
            /\[gjsify build-cache\] @test\/b: hit/,
            'workspace --cached must hit the foreach-stored entry',
        );
    });

    it('(8) --cached with --exec is rejected', async () => {
        const r = await runCli(cliEntry, ['foreach', '--cached', '--exec', '--', 'node', '-e', ''], {
            timeoutMs: 60_000,
            cwd: root,
        });
        assert.notEqual(r.status, 0, 'expected non-zero exit for --cached --exec');
        assert.match(r.stdout + r.stderr, /--cached only applies to script mode/i);
    });
});

// The dual emit: `build:gjsify` (bundler → `lib/esm`) and `build:types`
// (`gjsify tsc` → `lib/types`) are two SEPARATE scripts writing into two
// sub-trees of ONE directory, `lib/`. At whole-`lib/` cache granularity both
// claimed the same output unit, so a cache HIT on either did its
// delete-then-copy over the whole tree and silently destroyed the other's
// output — and because a hit means the script never ran, nothing regenerated
// it. Measured before the fix: `build:gjsify` hitting the cache after
// `build:types` had run left the package with NO `lib/types/` at all, i.e. a
// package whose `types` entry point does not exist (the failure
// `assertTypeDeclarationsShipped` exists to catch, one step earlier).
describe('gjsify build cache — the dual emit must not clobber itself', { timeout: 300_000 }, () => {
    let root, cliEntry, pkg;

    const libTree = () => {
        const out = [];
        const walk = (dir, prefix) => {
            if (!existsSync(dir)) return;
            for (const entry of readdirSync(dir)) {
                const abs = join(dir, entry);
                if (statSync(abs).isDirectory()) walk(abs, `${prefix}${entry}/`);
                else out.push(`${prefix}${entry}`);
            }
        };
        walk(join(pkg, 'lib'), 'lib/');
        return out.sort();
    };

    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-dual-emit-'));
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify(
                {
                    name: 'dual-emit-monorepo',
                    version: '0.0.0',
                    private: true,
                    type: 'module',
                    workspaces: ['packages/*'],
                },
                null,
                2,
            ) + '\n',
        );
        pkg = join(root, 'packages', 'a');
        mkdirSync(join(pkg, 'src'), { recursive: true });
        writeFileSync(join(pkg, 'src', 'index.ts'), 'export const x = 1;\n');
        const write = (dir, file, body) =>
            `node -e "const fs=require('fs');fs.mkdirSync('lib/${dir}',{recursive:true});fs.writeFileSync('lib/${dir}/${file}','${body}')"`;
        writeFileSync(
            join(pkg, 'package.json'),
            JSON.stringify(
                {
                    name: '@test/dual',
                    version: '0.0.1',
                    type: 'module',
                    scripts: {
                        // Stand-ins for the real scripts, same output shape.
                        'build:gjsify': write('esm', 'index.js', 'export const x=1;'),
                        'build:types': write('types', 'index.d.ts', 'export declare const x: number;'),
                    },
                },
                null,
                2,
            ) + '\n',
        );
    });

    after(() => {
        if (root) rmSync(root, { recursive: true, force: true });
    });

    it('a cache HIT on build:gjsify leaves the build:types output intact', async () => {
        const run = (script) =>
            runCli(cliEntry, ['workspace', '@test/dual', script, '--cached'], { timeoutMs: 60_000, cwd: root });

        const cold = await run('build:gjsify');
        assert.equal(cold.status, 0, cold.stderr);
        assert.deepEqual(libTree(), ['lib/esm/index.js']);

        const types = await run('build:types');
        assert.equal(types.status, 0, types.stderr);
        assert.deepEqual(libTree(), ['lib/esm/index.js', 'lib/types/index.d.ts']);

        const warm = await run('build:gjsify');
        assert.equal(warm.status, 0, warm.stderr);
        assert.match(warm.stderr, /\[gjsify build-cache\] @test\/dual: hit/, 'expected a cache hit');
        assert.deepEqual(
            libTree(),
            ['lib/esm/index.js', 'lib/types/index.d.ts'],
            'the build:gjsify cache hit must not delete lib/types — the .d.ts emit belongs to build:types, ' +
                'and nothing would regenerate it (the script did not run)',
        );
    });

    it('the reverse order is symmetric: a build:types hit keeps lib/esm', async () => {
        const run = (script) =>
            runCli(cliEntry, ['workspace', '@test/dual', script, '--cached'], { timeoutMs: 60_000, cwd: root });
        rmSync(join(pkg, 'lib'), { recursive: true, force: true });
        assert.equal((await run('build:types')).status, 0);
        assert.equal((await run('build:gjsify')).status, 0);
        const warm = await run('build:types');
        assert.equal(warm.status, 0, warm.stderr);
        assert.match(warm.stderr, /\[gjsify build-cache\] @test\/dual: hit/);
        assert.deepEqual(libTree(), ['lib/esm/index.js', 'lib/types/index.d.ts']);
    });

    it('each script records ONLY its own sub-tree as a cache output', async () => {
        const r = await runCli(cliEntry, ['workspace', '@test/dual', 'build:gjsify', '--cached'], {
            timeoutMs: 60_000,
            cwd: root,
            env: { GJSIFY_BUILD_CACHE: '1' },
        });
        assert.equal(r.status, 0, r.stderr);
        // Whether it stored (miss) or restored (hit), the log names the unit
        // the entry owns — `lib/esm`, never the whole `lib`.
        assert.match(r.stderr, /@test\/dual: (stored \S+ \(lib\/esm\)|hit \S+ — (restored )?lib\/esm)/);
        assert.ok(
            !/@test\/dual: (stored \S+ \(lib\)|hit \S+ — (restored )?lib\b(?!\/))/.test(r.stderr),
            `build:gjsify must not claim the whole lib/ directory — got: ${r.stderr}`,
        );
    });
});
