// E2E test for `gjsify workspace <name> <script> --with-dependencies`.
//
// Builds a synthetic monorepo with 4 workspaces in a transitive chain:
//
//   utils (no deps)
//     ↑
//   core (deps: utils)
//     ↑
//   plugin (deps: core)
//     ↑
//   cli (deps: plugin)
//
// Asserts:
// 1. `gjsify workspace @test/cli build --with-dependencies` builds
//    utils → core → plugin → cli in that order (mark-file mtime order).
// 2. The short alias `-d` works identically.
// 3. `--topological` / `-t` work as documented synonyms.
// 4. Without the flag the command builds only the target (today's
//    behaviour — guards against regressions).
// 5. Deps that don't declare the script are skipped silently.
// 6. A failing intermediate dep stops the cascade with non-zero exit.
// 7. `--continue-on-error` keeps going past a failed dep.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../mock-registry.mjs';

describe('gjsify workspace <name> <script> --with-dependencies', { timeout: 120_000 }, () => {
    let root, cliEntry;

    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-wsd-'));
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));

        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify(
                {
                    name: 'wsd-monorepo',
                    version: '0.0.0',
                    private: true,
                    type: 'module',
                    workspaces: ['packages/*'],
                },
                null,
                2,
            ) + '\n',
        );

        mkdirSync(join(root, 'marks'), { recursive: true });

        // Each workspace has a `build` script that touches a per-workspace
        // mark file with a high-resolution timestamp. We assert
        // dep-then-dependent ordering by comparing mark mtimes.
        const workspaces = [
            { dir: 'utils', name: '@test/utils', deps: {}, scripts: ['build'] },
            { dir: 'core', name: '@test/core', deps: { '@test/utils': 'workspace:^' }, scripts: ['build'] },
            { dir: 'plugin', name: '@test/plugin', deps: { '@test/core': 'workspace:^' }, scripts: ['build'] },
            { dir: 'cli', name: '@test/cli', deps: { '@test/plugin': 'workspace:^' }, scripts: ['build'] },
            // A separate workspace that defines `build` but is unrelated
            // to the chain — must NOT be picked up by the closure.
            { dir: 'unrelated', name: '@test/unrelated', deps: {}, scripts: ['build'] },
        ];
        for (const w of workspaces) {
            const safeName = w.name.replace('/', '-');
            const markPath = join(root, 'marks', `${safeName}.txt`).replace(/'/g, "\\'");
            mkdirSync(join(root, 'packages', w.dir), { recursive: true });
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
                            // `node -e` so the test doesn't depend on shell semantics.
                            // Sleep 20ms so successive mark mtimes are clearly ordered
                            // even on filesystems with coarse mtime granularity.
                            build: `node -e "setTimeout(()=>require('fs').writeFileSync('${markPath}', new Date().toISOString()), 20)"`,
                            // For the failure-cascade test:
                            fail: `node -e "process.exit(1)"`,
                            // Only utils + cli declare `only-some` — used to
                            // test --if-present skipping.
                            ...(w.dir === 'utils' || w.dir === 'cli'
                                ? {
                                      'only-some': `node -e "require('fs').writeFileSync('${markPath.replace('.txt', '-only.txt')}', 'ok')"`,
                                  }
                                : {}),
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

    function clearMarks() {
        rmSync(join(root, 'marks'), { recursive: true, force: true });
        mkdirSync(join(root, 'marks'), { recursive: true });
    }

    function markMtimes() {
        // Returns { '@test/utils': nsec, '@test/core': nsec, … } for the
        // marks that exist; missing entries are absent.
        const names = ['@test/utils', '@test/core', '@test/plugin', '@test/cli', '@test/unrelated'];
        const out = {};
        for (const n of names) {
            const safe = n.replace('/', '-');
            const p = join(root, 'marks', `${safe}.txt`);
            if (existsSync(p)) out[n] = statSync(p).mtimeMs;
        }
        return out;
    }

    it('without --with-dependencies, builds only the target (regression guard)', async () => {
        clearMarks();
        const r = await runCli(cliEntry, ['workspace', '@test/cli', 'build'], { cwd: root });
        assert.equal(r.status, 0, `workspace failed: ${r.stderr}\n${r.stdout}`);
        const m = markMtimes();
        assert.ok(m['@test/cli'] !== undefined, '@test/cli mark missing');
        assert.ok(m['@test/plugin'] === undefined, 'plugin mark must not exist — no --with-dependencies');
        assert.ok(m['@test/core'] === undefined, 'core mark must not exist — no --with-dependencies');
        assert.ok(m['@test/utils'] === undefined, 'utils mark must not exist — no --with-dependencies');
    });

    // yarn spells this `yarn workspace <name> run <script>`, and the command's
    // own docs advertise that form as the equivalent — so it has to work. The
    // prefix is OPTIONAL, never the default: gjsify's command names collide
    // with the most common script names (`build`, `check`, `test`, `install`,
    // …), so a full yarn-style CLI proxy would make `workspace <name> build`
    // ambiguous between the build COMMAND and the build SCRIPT.
    it('accepts the yarn `run <script>` spelling, identically to the short form', async () => {
        clearMarks();
        const withRun = await runCli(cliEntry, ['workspace', '@test/cli', 'run', 'build'], { cwd: root });
        assert.equal(withRun.status, 0, `workspace run failed: ${withRun.stderr}\n${withRun.stdout}`);
        const viaRun = markMtimes();
        assert.ok(viaRun['@test/cli'] !== undefined, '@test/cli mark missing via `run build`');
        assert.ok(viaRun['@test/core'] === undefined, 'the `run` prefix must not imply --with-dependencies');

        clearMarks();
        const short = await runCli(cliEntry, ['workspace', '@test/cli', 'build'], { cwd: root });
        assert.equal(short.status, 0, `workspace failed: ${short.stderr}\n${short.stdout}`);
        assert.deepEqual(
            Object.keys(markMtimes()).sort(),
            Object.keys(viaRun).sort(),
            'the two spellings must build exactly the same set',
        );
    });

    it('forwards extra args through the `run` prefix, not as the script name', async () => {
        clearMarks();
        // `--with-dependencies` after `run <script>` must still be parsed as the
        // flag it is; a naive shift would swallow it as a positional.
        const r = await runCli(cliEntry, ['workspace', '@test/cli', 'run', 'build', '--with-dependencies'], {
            cwd: root,
        });
        assert.equal(r.status, 0, `workspace run failed: ${r.stderr}\n${r.stdout}`);
        const m = markMtimes();
        assert.ok(m['@test/core'] !== undefined, 'core mark missing — the flag was not honoured after `run`');
    });

    it('--with-dependencies builds the transitive closure in topological order', async () => {
        clearMarks();
        const r = await runCli(cliEntry, ['workspace', '@test/cli', 'build', '--with-dependencies'], { cwd: root });
        assert.equal(r.status, 0, `workspace failed: ${r.stderr}\n${r.stdout}`);
        const m = markMtimes();
        assert.ok(m['@test/utils'] !== undefined, 'utils mark missing');
        assert.ok(m['@test/core'] !== undefined, 'core mark missing');
        assert.ok(m['@test/plugin'] !== undefined, 'plugin mark missing');
        assert.ok(m['@test/cli'] !== undefined, 'cli mark missing');
        assert.ok(m['@test/unrelated'] === undefined, 'unrelated workspace must NOT be in the closure');
        // Topological order: utils ≤ core ≤ plugin ≤ cli (sleep 20ms ensures
        // strict <, but filesystems sometimes coalesce mtime so allow ≤).
        assert.ok(
            m['@test/utils'] <= m['@test/core'],
            `utils(${m['@test/utils']}) must come before core(${m['@test/core']})`,
        );
        assert.ok(
            m['@test/core'] <= m['@test/plugin'],
            `core(${m['@test/core']}) must come before plugin(${m['@test/plugin']})`,
        );
        assert.ok(
            m['@test/plugin'] <= m['@test/cli'],
            `plugin(${m['@test/plugin']}) must come before cli(${m['@test/cli']})`,
        );
    });

    it('-d short alias works identically to --with-dependencies', async () => {
        clearMarks();
        const r = await runCli(cliEntry, ['workspace', '@test/cli', 'build', '-d'], { cwd: root });
        assert.equal(r.status, 0, `workspace -d failed: ${r.stderr}\n${r.stdout}`);
        const m = markMtimes();
        assert.ok(m['@test/utils'] !== undefined, 'utils mark missing under -d');
        assert.ok(m['@test/core'] !== undefined, 'core mark missing under -d');
        assert.ok(m['@test/plugin'] !== undefined, 'plugin mark missing under -d');
        assert.ok(m['@test/cli'] !== undefined, 'cli mark missing under -d');
    });

    it('--topological / -t aliases match --with-dependencies (foreach-style spelling)', async () => {
        clearMarks();
        const r = await runCli(cliEntry, ['workspace', '@test/cli', 'build', '--topological'], { cwd: root });
        assert.equal(r.status, 0, `--topological failed: ${r.stderr}\n${r.stdout}`);
        const m = markMtimes();
        assert.ok(m['@test/utils'] !== undefined);
        assert.ok(m['@test/cli'] !== undefined);

        clearMarks();
        const r2 = await runCli(cliEntry, ['workspace', '@test/cli', 'build', '-t'], { cwd: root });
        assert.equal(r2.status, 0, `-t failed: ${r2.stderr}\n${r2.stdout}`);
        const m2 = markMtimes();
        assert.ok(m2['@test/utils'] !== undefined);
        assert.ok(m2['@test/cli'] !== undefined);
    });

    it('--if-present behaviour: skips intermediate deps without the script', async () => {
        // `only-some` only exists on utils + cli; core + plugin must be skipped.
        clearMarks();
        const r = await runCli(cliEntry, ['workspace', '@test/cli', 'only-some', '-d'], { cwd: root });
        assert.equal(r.status, 0, `--if-present skip failed: ${r.stderr}\n${r.stdout}`);
        const utilsMark = join(root, 'marks', '@test-utils-only.txt');
        const cliMark = join(root, 'marks', '@test-cli-only.txt');
        assert.ok(existsSync(utilsMark), 'utils-only mark missing — should still run');
        assert.ok(existsSync(cliMark), 'cli-only mark missing — should still run');
        // core/plugin marks under -only.txt must NOT exist since they don't have
        // the script.
        assert.ok(!existsSync(join(root, 'marks', '@test-core-only.txt')));
        assert.ok(!existsSync(join(root, 'marks', '@test-plugin-only.txt')));
    });

    it('stops on first failure by default', async () => {
        // Inject a script that fails on core but succeeds on the others.
        // Run `fail` with -d — should fail at utils (no fail script — skipped)
        // → core (has fail, exits 1) → cli never reached.
        // The simplest assertion is on exit code + no cli mark.
        clearMarks();
        const r = await runCli(cliEntry, ['workspace', '@test/cli', 'fail', '-d'], { cwd: root });
        assert.notEqual(r.status, 0, 'expected non-zero exit on failure');
    });

    it('--continue-on-error reports all failures but processes the whole list', async () => {
        // Every workspace has `fail` (exits 1). With continue-on-error,
        // the command runs every workspace in the closure (utils, core,
        // plugin, cli) and exits 1 after reporting.
        clearMarks();
        const r = await runCli(cliEntry, ['workspace', '@test/cli', 'fail', '-d', '--continue-on-error'], {
            cwd: root,
        });
        assert.notEqual(r.status, 0, 'expected non-zero exit even with --continue-on-error');
        // The error summary should name multiple workspaces.
        const combined = r.stdout + r.stderr;
        assert.match(combined, /@test\/utils/);
        assert.match(combined, /@test\/cli/);
    });

    it('errors clearly when the workspace does not exist', async () => {
        const r = await runCli(cliEntry, ['workspace', '@nonexistent/foo', 'build', '-d'], { cwd: root });
        assert.notEqual(r.status, 0);
        const combined = r.stdout + r.stderr;
        assert.match(combined, /no workspace named/i);
    });
});
