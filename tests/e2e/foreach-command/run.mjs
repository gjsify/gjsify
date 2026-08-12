// E2E test for `gjsify foreach` + `gjsify workspace <name>` (Phase D.4).
//
// Builds a synthetic monorepo with 3 workspaces, each with a tiny `echo`
// script that writes its workspace name to a unique file. Then drives
// the foreach command in sequential / parallel / topological modes and
// the workspace shortcut, asserting on the resulting filesystem state +
// the prefixed stdout.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../mock-registry.mjs';

describe('gjsify foreach + workspace (Phase D.4)', { timeout: 60_000 }, () => {
    let root, cliEntry;

    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-foreach-'));
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));

        // Root manifest declaring 3 packages/*.
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify(
                {
                    name: 'foreach-monorepo',
                    version: '0.0.0',
                    private: true,
                    type: 'module',
                    workspaces: ['packages/*'],
                },
                null,
                2,
            ) + '\n',
        );

        // Each workspace has the same `mark` script that touches a unique
        // file at <root>/marks/<name>. We also seed a `dependencies`
        // workspace ref from `app` → `core` → `utils` so `--topological`
        // has order to enforce.
        mkdirSync(join(root, 'marks'), { recursive: true });

        // Fixtures for the process-TREE kill test: `spawn-tree.cjs` (run as
        // utils' `treecheck` script) spawns a DETACHED grandchild and then
        // sleeps 30s itself. The grandchild records its PID immediately and
        // would write a survived-marker after 30s. `detached: true` puts the
        // grandchild in its own process group/session, so it survives BOTH a
        // naive direct-child kill AND a process-group kill — only a real
        // descendant walk (PPID-based) reaches it.
        writeFileSync(
            join(root, 'grandchild.cjs'),
            [
                "const { writeFileSync } = require('fs');",
                "const { join } = require('path');",
                "writeFileSync(join(__dirname, 'marks', 'grandchild.pid'), String(process.pid));",
                'setTimeout(() => {',
                "    writeFileSync(join(__dirname, 'marks', 'grandchild-survived.txt'), '');",
                '}, 30000);',
                '',
            ].join('\n'),
        );
        writeFileSync(
            join(root, 'spawn-tree.cjs'),
            [
                "const { spawn } = require('child_process');",
                "const { join } = require('path');",
                "spawn(process.execPath, [join(__dirname, 'grandchild.cjs')], {",
                '    detached: true,',
                "    stdio: 'ignore',",
                '}).unref();',
                '// Keep the middle process alive so the kill arrives while the',
                '// npm → sh → node chain is fully in flight.',
                'setTimeout(() => {}, 30000);',
                '',
            ].join('\n'),
        );
        const workspaces = [
            { dir: 'utils', name: '@test/utils', deps: {} },
            { dir: 'core', name: '@test/core', deps: { '@test/utils': 'workspace:^' } },
            { dir: 'app', name: '@test/app', deps: { '@test/core': 'workspace:^' } },
        ];
        for (const w of workspaces) {
            const safeName = w.name.replace('/', '-');
            const markPath = join(root, 'marks', `${safeName}.txt`).replace(/'/g, "\\'");
            const survivedPath = join(root, 'marks', 'survived.txt').replace(/'/g, "\\'");
            mkdirSync(join(root, 'packages', w.dir), { recursive: true });
            // `killcheck` exists only on utils + app, so script-mode filtering
            // drops core → both selected workspaces are dep-free and start
            // concurrently under -tp. utils sleeps 30s then writes a marker;
            // app fails after 500ms. Fail-fast must KILL the sleeper (issue
            // #497) — asserted via elapsed time + the absent marker.
            const killcheck =
                w.dir === 'utils'
                    ? `node -e "setTimeout(() => require('fs').writeFileSync('${survivedPath}', ''), 30000)"`
                    : w.dir === 'app'
                      ? `node -e "setTimeout(() => process.exit(1), 500)"`
                      : undefined;
            // `treecheck` mirrors `killcheck` but utils' sleeper spawns a
            // detached GRANDCHILD (see spawn-tree.cjs) — the fail-fast kill
            // must take down the whole process tree, not just the direct
            // `npm run` child. The failer (app) waits for the grandchild's
            // PID file before exiting 1 — a fixed delay raced on slow CI
            // runners: if the kill fires BEFORE the grandchild spawned, the
            // TERM-time snapshot can't contain it and once its parent dies
            // it reparents to init where no fresh walk can reach it (the
            // inherent tree-kill TOCTOU window; observed on the 2-core
            // Fedora runners). 20s safety cap so a broken fixture still
            // terminates.
            const pidFileForFailer = join(root, 'marks', 'grandchild.pid');
            const treecheck =
                w.dir === 'utils'
                    ? `node ${join(root, 'spawn-tree.cjs')}`
                    : w.dir === 'app'
                      ? `node -e "const fs=require('fs');const t0=Date.now();(function w(){if(fs.existsSync('${pidFileForFailer}')||Date.now()-t0>20000)process.exit(1);setTimeout(w,100)})()"`
                      : undefined;
            writeFileSync(
                join(root, 'packages', w.dir, 'package.json'),
                JSON.stringify(
                    {
                        name: w.name,
                        version: '0.0.1',
                        type: 'module',
                        private: false,
                        dependencies: w.deps,
                        scripts: {
                            // `node -e ...` so the test doesn't depend on shell semantics.
                            mark: `node -e "require('fs').writeFileSync('${markPath}', new Date().toISOString())"`,
                            fail: `node -e "process.exit(1)"`,
                            echo: `node -e "console.log('${w.name}')"`,
                            ...(killcheck ? { killcheck } : {}),
                            ...(treecheck ? { treecheck } : {}),
                        },
                    },
                    null,
                    2,
                ) + '\n',
            );
        }
    });

    after(() => {
        if (root) rmSync(root, { recursive: true, force: true });
    });

    it('foreach <script> runs the script in every matching workspace', async () => {
        const r = await runCli(cliEntry, ['foreach', 'mark'], { cwd: root });
        assert.equal(r.status, 0, `foreach failed: ${r.stderr}\n${r.stdout}`);
        // All 3 marks must exist.
        for (const name of ['@test-utils', '@test-core', '@test-app']) {
            assert.ok(
                existsSync(join(root, 'marks', `${name}.txt`)),
                `marks/${name}.txt missing — foreach skipped a workspace`,
            );
        }
    });

    it('foreach --include filters to matching workspaces', async () => {
        rmSync(join(root, 'marks'), { recursive: true, force: true });
        mkdirSync(join(root, 'marks'), { recursive: true });
        const r = await runCli(cliEntry, ['foreach', 'mark', '--include', '@test/utils'], { cwd: root });
        assert.equal(r.status, 0);
        assert.ok(existsSync(join(root, 'marks', '@test-utils.txt')), 'utils mark missing');
        assert.ok(!existsSync(join(root, 'marks', '@test-core.txt')), 'core mark should be skipped');
    });

    // ── zero-match --include is FATAL (repo task #75) ───────────────────
    // The CI classifier's filter used to arrive with its shell quotes glued
    // to each package name, so every pattern matched nothing and foreach
    // printed one line and exited 0 — a build that did nothing was
    // indistinguishable from a build that succeeded, and that silence is why
    // the quoting bug survived on every selective PR run.

    it('foreach --include that matches nothing FAILS (never a silent 0)', async () => {
        const r = await runCli(cliEntry, ['foreach', 'mark', '--include', '@test/nope'], { cwd: root });
        assert.notEqual(r.status, 0, 'a filter matching zero workspaces must not exit 0');
        assert.match(r.stdout + r.stderr, /--include matched no workspace/i);
        assert.match(r.stdout + r.stderr, /@test\/nope/);
    });

    it('foreach --include with quotes IN the value fails and names the cause', async () => {
        // Verbatim reproduction of the CI bug: `--include '@test/utils'` where
        // the apostrophes are part of the argument, not shell syntax.
        const r = await runCli(cliEntry, ['foreach', 'mark', '--include', "'@test/utils'"], { cwd: root });
        assert.notEqual(r.status, 0, 'a quoted-in-value filter must not exit 0');
        const out = r.stdout + r.stderr;
        assert.match(out, /--include matched no workspace/i);
        assert.match(out, /the QUOTES are part of the value/);
    });

    it('foreach --include failure names ALL bad patterns, even beside good ones', async () => {
        const r = await runCli(cliEntry, ['foreach', 'mark', '--include', '@test/utils', '--include', '@test/ghost'], {
            cwd: root,
        });
        assert.notEqual(r.status, 0, 'one bad pattern must fail the whole run');
        assert.match(r.stdout + r.stderr, /@test\/ghost/);
    });

    it('foreach --include glob that matches is fine (no false positive)', async () => {
        rmSync(join(root, 'marks'), { recursive: true, force: true });
        mkdirSync(join(root, 'marks'), { recursive: true });
        const r = await runCli(cliEntry, ['foreach', 'mark', '--include', '@test/*'], { cwd: root });
        assert.equal(r.status, 0, `glob include should succeed: ${r.stderr}`);
        assert.ok(existsSync(join(root, 'marks', '@test-utils.txt')));
    });

    it('an EMPTY final selection is still exit 0 (shard / exclude / no script)', async () => {
        // The include matched; --exclude then removed everything. Legitimate —
        // this is the case the fatal rule must NOT swallow, or every small
        // sharded CI job would go red.
        const r = await runCli(cliEntry, ['foreach', 'mark', '--include', '@test/utils', '--exclude', '@test/utils'], {
            cwd: root,
        });
        assert.equal(r.status, 0, `narrowing to empty must stay a clean no-op: ${r.stderr}`);
        assert.match(r.stdout + r.stderr, /no workspaces match/i);
    });

    it('foreach --exclude removes matching workspaces', async () => {
        rmSync(join(root, 'marks'), { recursive: true, force: true });
        mkdirSync(join(root, 'marks'), { recursive: true });
        const r = await runCli(cliEntry, ['foreach', 'mark', '--exclude', '@test/app'], { cwd: root });
        assert.equal(r.status, 0);
        assert.ok(existsSync(join(root, 'marks', '@test-utils.txt')));
        assert.ok(existsSync(join(root, 'marks', '@test-core.txt')));
        assert.ok(!existsSync(join(root, 'marks', '@test-app.txt')), 'app should be excluded');
    });

    // `--with-dependencies` — the third thing a selection can mean (#1080).
    //
    // `--include` FILTERS and `--topological` only ORDERS what was already
    // selected, so "and everything these need" had no spelling at all. CI's
    // selective build therefore rebuilt only the changed closure and trusted
    // every dependency's restored `lib/` — and a build cache can be complete
    // without being current, so one cancelled build on `main` made later PRs
    // fail with compiler errors naming a package they never touched.

    it('foreach --with-dependencies pulls in what the selection depends on', async () => {
        rmSync(join(root, 'marks'), { recursive: true, force: true });
        mkdirSync(join(root, 'marks'), { recursive: true });
        // app → core → utils. Selecting app alone is exactly the case that
        // silently trusted a stale core/lib and utils/lib.
        const r = await runCli(
            cliEntry,
            ['foreach', 'mark', '--include', '@test/app', '--with-dependencies', '--topological'],
            { cwd: root },
        );
        assert.equal(r.status, 0, `with-dependencies failed: ${r.stderr}`);
        assert.ok(existsSync(join(root, 'marks', '@test-app.txt')), 'app mark missing');
        assert.ok(existsSync(join(root, 'marks', '@test-core.txt')), 'core (direct dep) missing');
        assert.ok(existsSync(join(root, 'marks', '@test-utils.txt')), 'utils (transitive dep) missing');
    });

    it('foreach without --with-dependencies still selects only the filter', async () => {
        // The A/B for the test above: the flag has to be what adds them.
        rmSync(join(root, 'marks'), { recursive: true, force: true });
        mkdirSync(join(root, 'marks'), { recursive: true });
        const r = await runCli(cliEntry, ['foreach', 'mark', '--include', '@test/app'], { cwd: root });
        assert.equal(r.status, 0, `include-only failed: ${r.stderr}`);
        assert.ok(existsSync(join(root, 'marks', '@test-app.txt')));
        assert.ok(!existsSync(join(root, 'marks', '@test-core.txt')), 'core must NOT be selected without the flag');
    });

    it('foreach --with-dependencies re-applies --exclude', async () => {
        // Order is the whole design. The expansion runs AFTER the filter, so it
        // cannot walk out through a package the caller removed — and a dependency
        // that IS excluded must not be smuggled back in by the expansion. In CI
        // that ordering is the difference between 5 extra packages and 56:
        // `@gjsify/website` is excluded there and prod-depends every showcase.
        rmSync(join(root, 'marks'), { recursive: true, force: true });
        mkdirSync(join(root, 'marks'), { recursive: true });
        const r = await runCli(
            cliEntry,
            ['foreach', 'mark', '--include', '@test/app', '--with-dependencies', '--exclude', '@test/utils'],
            { cwd: root },
        );
        assert.equal(r.status, 0, `with-dependencies + exclude failed: ${r.stderr}`);
        assert.ok(existsSync(join(root, 'marks', '@test-app.txt')));
        assert.ok(existsSync(join(root, 'marks', '@test-core.txt')));
        assert.ok(!existsSync(join(root, 'marks', '@test-utils.txt')), 'an excluded dependency must stay excluded');
    });

    it('foreach --parallel prefixes stdout with [<workspace-name>]', async () => {
        const r = await runCli(cliEntry, ['foreach', 'echo', '--parallel'], { cwd: root });
        assert.equal(r.status, 0, `parallel failed: ${r.stderr}`);
        assert.match(r.stdout, /\[@test\/utils\]/);
        assert.match(r.stdout, /\[@test\/core\]/);
        assert.match(r.stdout, /\[@test\/app\]/);
    });

    it('foreach --topological orders deps before dependents', async () => {
        // `echo` is enough: assert utils-line appears before app-line in
        // the combined output (sequential topological run).
        const r = await runCli(cliEntry, ['foreach', 'echo', '--topological'], { cwd: root });
        assert.equal(r.status, 0);
        const idxUtils = r.stdout.indexOf('@test/utils');
        const idxCore = r.stdout.indexOf('@test/core');
        const idxApp = r.stdout.indexOf('@test/app');
        assert.ok(idxUtils < idxCore, `expected utils before core, got utils=${idxUtils} core=${idxCore}`);
        assert.ok(idxCore < idxApp, `expected core before app, got core=${idxCore} app=${idxApp}`);
    });

    // The release sweep depends on this specific edge kind, not just on
    // `dependencies`. `npm:publish` runs `gjsify foreach --topological --exec --
    // gjsify publish`, and the ONLY thing that keeps a platform child ahead of
    // its bridge is that `optionalDependencies` count as topological edges. If
    // they ever stopped counting, the sweep would silently go back to publishing
    // a bridge whose exact-pinned siblings do not exist yet — and npm skips an
    // unresolvable optional dependency in silence, so the broken install looks
    // like a success. Measured before the flag was added: 60 of the 60
    // platform-sibling edges published parent-first.
    it('foreach --topological counts optionalDependencies as edges', async () => {
        const optRoot = mkdtempSync(join(tmpdir(), 'gjsify-e2e-foreach-opt-'));
        try {
            writeFileSync(
                join(optRoot, 'package.json'),
                `${JSON.stringify({ name: 'opt-monorepo', version: '0.0.0', private: true, workspaces: ['packages/*'] }, null, 2)}\n`,
            );
            // `bridge` sorts BEFORE both children alphabetically, so an unordered
            // (discovery-order) sweep publishes it first — exactly the measured
            // 0.27.0 order. Only the optionalDependencies edges can invert that.
            const pkgs = [
                {
                    dir: 'bridge',
                    name: '@opt/bridge',
                    optionalDependencies: { '@opt/child-a': 'workspace:*', '@opt/child-b': 'workspace:*' },
                },
                { dir: 'child-a', name: '@opt/child-a' },
                { dir: 'child-b', name: '@opt/child-b' },
            ];
            for (const p of pkgs) {
                mkdirSync(join(optRoot, 'packages', p.dir), { recursive: true });
                writeFileSync(
                    join(optRoot, 'packages', p.dir, 'package.json'),
                    `${JSON.stringify(
                        {
                            name: p.name,
                            version: '0.0.1',
                            ...(p.optionalDependencies ? { optionalDependencies: p.optionalDependencies } : {}),
                            scripts: { echo: `node -e "console.log('${p.name}')"` },
                        },
                        null,
                        2,
                    )}\n`,
                );
            }
            const r = await runCli(cliEntry, ['foreach', 'echo', '--topological'], { cwd: optRoot });
            assert.equal(r.status, 0, `topological run failed: ${r.stderr}`);
            const idxBridge = r.stdout.indexOf('@opt/bridge');
            const idxA = r.stdout.indexOf('@opt/child-a');
            const idxB = r.stdout.indexOf('@opt/child-b');
            assert.ok(idxA !== -1 && idxB !== -1 && idxBridge !== -1, `missing output: ${r.stdout}`);
            assert.ok(
                idxA < idxBridge && idxB < idxBridge,
                `an optionalDependencies target must run BEFORE its dependent, got child-a=${idxA} child-b=${idxB} bridge=${idxBridge}`,
            );
        } finally {
            rmSync(optRoot, { recursive: true, force: true });
        }
    });

    it('foreach surfaces non-zero exit codes', async () => {
        const r = await runCli(cliEntry, ['foreach', 'fail'], { cwd: root });
        assert.notEqual(r.status, 0, 'expected failure for `fail` script');
    });

    it('foreach --shard runs a deterministic disjoint slice; union = full set', async () => {
        // 3 workspaces, sorted by name: @test/app, @test/core, @test/utils.
        // Round-robin N=3 → shard 1=app, 2=core, 3=utils. Each shard marks
        // exactly its slice; the union across all shards is the full set.
        const expected = { 1: '@test-app', 2: '@test-core', 3: '@test-utils' };
        const seen = new Set();
        for (const i of [1, 2, 3]) {
            rmSync(join(root, 'marks'), { recursive: true, force: true });
            mkdirSync(join(root, 'marks'), { recursive: true });
            const r = await runCli(cliEntry, ['foreach', 'mark', '--shard', `${i}/3`], { cwd: root });
            assert.equal(r.status, 0, `shard ${i}/3 failed: ${r.stderr}`);
            const present = ['@test-utils', '@test-core', '@test-app'].filter((n) =>
                existsSync(join(root, 'marks', `${n}.txt`)),
            );
            assert.deepEqual(present, [expected[i]], `shard ${i}/3 marked ${JSON.stringify(present)}`);
            present.forEach((n) => seen.add(n));
        }
        assert.deepEqual(
            [...seen].sort(),
            ['@test-app', '@test-core', '@test-utils'],
            'union of all shards must equal the full set (disjoint + complete)',
        );
    });

    it('foreach --shard rejects an out-of-range / malformed index', async () => {
        const oor = await runCli(cliEntry, ['foreach', 'mark', '--shard', '4/3'], { cwd: root });
        assert.notEqual(oor.status, 0, 'expected non-zero exit for shard 4/3');
        assert.match(oor.stdout + oor.stderr, /invalid --shard/i);
        const bad = await runCli(cliEntry, ['foreach', 'mark', '--shard', 'nope'], { cwd: root });
        assert.notEqual(bad.status, 0, 'expected non-zero exit for malformed shard');
        assert.match(bad.stdout + bad.stderr, /invalid --shard/i);
    });

    it('foreach -tp fail-fast kills in-flight siblings instead of waiting (issue #497)', async () => {
        rmSync(join(root, 'marks'), { recursive: true, force: true });
        mkdirSync(join(root, 'marks'), { recursive: true });
        const started = Date.now();
        const r = await runCli(cliEntry, ['foreach', 'killcheck', '--topological', '--parallel'], {
            cwd: root,
            timeoutMs: 45_000,
        });
        const elapsed = Date.now() - started;
        assert.notEqual(r.status, 0, 'expected failure for `killcheck` run');
        // The sleeper runs 30s; fail-fast + kill must end the run shortly
        // after app's 500ms failure (SIGTERM + bounded drain ≪ 15s).
        assert.ok(elapsed < 15_000, `foreach waited on a killed sibling: ${elapsed}ms`);
        assert.ok(!existsSync(join(root, 'marks', 'survived.txt')), 'sleeper survived the fail-fast kill');
    });

    it('foreach -tp fail-fast kills GRANDCHILDREN too (process-tree kill)', async () => {
        rmSync(join(root, 'marks'), { recursive: true, force: true });
        mkdirSync(join(root, 'marks'), { recursive: true });
        const started = Date.now();
        const r = await runCli(cliEntry, ['foreach', 'treecheck', '--topological', '--parallel'], {
            cwd: root,
            timeoutMs: 45_000,
        });
        const elapsed = Date.now() - started;
        assert.notEqual(r.status, 0, 'expected failure for `treecheck` run');
        // app fails after 1s; SIGTERM + bounded drain must end the run well
        // below the sleeper's 30s.
        assert.ok(elapsed < 20_000, `foreach waited on a killed sibling tree: ${elapsed}ms`);
        // The grandchild recorded its PID before the kill — it must have
        // actually spawned for this test to prove anything.
        const pidFile = join(root, 'marks', 'grandchild.pid');
        assert.ok(existsSync(pidFile), 'grandchild never spawned — fixture broken');
        const grandchildPid = Number(readFileSync(pidFile, 'utf-8').trim());
        assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0, 'bad grandchild pid');
        // The grandchild is detached (own process group) — a naive
        // direct-child kill or even a process-group kill would leave it
        // alive for 30s. Poll for its death via /proc state, NOT
        // `kill(pid, 0)`: in the CI container PID 1 is not an init that
        // reaps orphans, so the killed (reparented) grandchild lingers as
        // a ZOMBIE — for which signal-0 still succeeds. State 'Z'/'X'
        // counts as dead; a vanished /proc entry too.
        const isAlive = (pid) => {
            try {
                const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
                const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
                return state !== 'Z' && state !== 'X';
            } catch {
                return false;
            }
        };
        const deadline = Date.now() + 10_000;
        let alive = true;
        while (alive && Date.now() < deadline) {
            if (isAlive(grandchildPid)) {
                await new Promise((res) => setTimeout(res, 200));
            } else {
                alive = false;
            }
        }
        assert.ok(!alive, `detached grandchild (pid ${grandchildPid}) survived the fail-fast tree kill`);
        assert.ok(
            !existsSync(join(root, 'marks', 'grandchild-survived.txt')),
            'grandchild survived long enough to write its marker',
        );
        assert.ok(!existsSync(join(root, 'marks', 'survived.txt')), 'sleeper middle process survived the kill');
    });

    it("workspace <name> <script> runs only that workspace's script", async () => {
        rmSync(join(root, 'marks'), { recursive: true, force: true });
        mkdirSync(join(root, 'marks'), { recursive: true });
        const r = await runCli(cliEntry, ['workspace', '@test/core', 'mark'], { cwd: root });
        assert.equal(r.status, 0, `workspace failed: ${r.stderr}`);
        assert.ok(existsSync(join(root, 'marks', '@test-core.txt')));
        assert.ok(!existsSync(join(root, 'marks', '@test-utils.txt')));
        assert.ok(!existsSync(join(root, 'marks', '@test-app.txt')));
    });

    it('workspace <name> errors clearly when workspace does not exist', async () => {
        const r = await runCli(cliEntry, ['workspace', '@nonexistent/foo', 'mark'], { cwd: root });
        assert.notEqual(r.status, 0);
        const combined = r.stdout + r.stderr;
        assert.match(combined, /no workspace named/i);
    });
});
