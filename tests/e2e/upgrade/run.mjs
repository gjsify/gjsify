// E2E test for `gjsify upgrade`.
//
// Strategy: stand up the shared in-process mock registry over a few synthetic
// packages, point `gjsify upgrade --latest --dry-run` at the project via
// `--cwd`, set `npm_config_registry` to our mock, and assert the candidate
// table shape + dry-run skip + actual write-back behavior on a non-dry-run
// pass.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { writeFileSync, readFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startMockRegistry } from '../mock-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

// Version keys with empty manifests: every case here runs a flavour of
// `upgrade`, which only reads packuments and rewrites `package.json` — no
// tarball is ever fetched, so there is nothing for a manifest to carry. The
// last key of each package is what the registry offers as `dist-tags.latest`.
const PACKAGES = {
    'lib-a': { '1.0.0': {}, '1.1.0': {}, '1.2.3': {}, '2.0.0': {} },
    'lib-b': { '0.4.0': {}, '0.5.0': {} },
    'lib-c': { '3.2.0': {}, '3.2.1': {} },
    'lib-uptodate': { '9.9.9': {} },
};

describe('CLI upgrade E2E', { timeout: 2 * 60 * 1000 }, () => {
    let tmpDir;
    let registry;

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-upgrade-'));
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        }

        registry = await startMockRegistry(PACKAGES);
    });

    after(async () => {
        await registry?.close();
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    function scaffold(name) {
        const dir = join(tmpDir, name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                {
                    name,
                    version: '1.0.0',
                    type: 'module',
                    private: true,
                    dependencies: {
                        'lib-a': '^1.0.0',
                        'lib-uptodate': '^9.9.9',
                    },
                    devDependencies: {
                        'lib-b': '~0.4.0',
                        'lib-c': '^3.2.0',
                    },
                },
                null,
                2,
            ) + '\n',
            'utf-8',
        );
        return dir;
    }

    // Async — execFileSync would block the event loop and prevent the
    // in-process mock registry server from accepting connections.
    async function runUpgrade(args, opts = {}) {
        const { stdout } = await execFileAsync('node', [CLI_ENTRY, 'upgrade', ...args], {
            timeout: opts.timeout ?? 30 * 1000,
            cwd: opts.cwd,
            env: { ...process.env, npm_config_registry: registry.url, ...opts.env },
            encoding: 'utf8',
        });
        return stdout;
    }

    it('--latest --dry-run reports candidates without writing', async () => {
        const dir = scaffold('dry-run-project');
        const before = readFileSync(join(dir, 'package.json'), 'utf-8');
        const out = await runUpgrade(['--latest', '--dry-run'], { cwd: dir });
        assert.match(out, /checking 4 unique deps across 1 workspace/);
        assert.match(out, /lib-a/);
        assert.match(out, /lib-b/);
        assert.match(out, /lib-c/);
        // lib-uptodate (9.9.9) has no newer version → not in table
        assert.doesNotMatch(out, /lib-uptodate/);
        assert.match(out, /--dry-run: would update 3 deps across 1 package\.json/);
        // Verify package.json untouched
        assert.equal(readFileSync(join(dir, 'package.json'), 'utf-8'), before);
    });

    it('--latest writes new ranges preserving the prefix', async () => {
        const dir = scaffold('latest-project');
        await runUpgrade(['--latest'], { cwd: dir });
        const after = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
        // lib-a was ^1.0.0; latest 2.0.0 → ^2.0.0
        assert.equal(after.dependencies['lib-a'], '^2.0.0');
        // lib-b was ~0.4.0; latest 0.5.0 → ~0.5.0
        assert.equal(after.devDependencies['lib-b'], '~0.5.0');
        // lib-c was ^3.2.0; latest 3.2.1 → ^3.2.1
        assert.equal(after.devDependencies['lib-c'], '^3.2.1');
        // lib-uptodate unchanged
        assert.equal(after.dependencies['lib-uptodate'], '^9.9.9');
    });

    it('--patch skips minor + major updates', async () => {
        const dir = scaffold('patch-project');
        const out = await runUpgrade(['--patch'], { cwd: dir });
        const after = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
        // lib-a (1.0.0 → 2.0.0 is major) and lib-b (0.4.0 → 0.5.0 is minor) skipped
        assert.equal(after.dependencies['lib-a'], '^1.0.0');
        assert.equal(after.devDependencies['lib-b'], '~0.4.0');
        // lib-c is a patch bump (3.2.0 → 3.2.1) → applied
        assert.equal(after.devDependencies['lib-c'], '^3.2.1');
        assert.match(out, /lib-c/);
        assert.doesNotMatch(out, /lib-a\s/);
    });

    it('--minor skips major updates', async () => {
        const dir = scaffold('minor-project');
        await runUpgrade(['--minor'], { cwd: dir });
        const after = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
        // lib-a (1.0.0 → 2.0.0 is major) skipped
        assert.equal(after.dependencies['lib-a'], '^1.0.0');
        // lib-b (0.4.0 → 0.5.0 minor) applied
        assert.equal(after.devDependencies['lib-b'], '~0.5.0');
        // lib-c (patch) applied
        assert.equal(after.devDependencies['lib-c'], '^3.2.1');
    });

    it('--filter narrows the scope by substring', async () => {
        const dir = scaffold('filter-project');
        await runUpgrade(['--latest', '--filter', 'lib-a,lib-c'], { cwd: dir });
        const after = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
        assert.equal(after.dependencies['lib-a'], '^2.0.0');
        assert.equal(after.devDependencies['lib-c'], '^3.2.1');
        // lib-b not in filter → unchanged
        assert.equal(after.devDependencies['lib-b'], '~0.4.0');
    });

    it('skips workspace: ranges entirely', async () => {
        const dir = join(tmpDir, 'workspace-project');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                {
                    name: 'workspace-project',
                    version: '1.0.0',
                    type: 'module',
                    private: true,
                    dependencies: { '@gjsify/cli': 'workspace:^', 'lib-a': '^1.0.0' },
                },
                null,
                2,
            ) + '\n',
            'utf-8',
        );
        const out = await runUpgrade(['--latest', '--dry-run'], { cwd: dir });
        // Only lib-a is checked (@gjsify/cli has workspace: range)
        assert.match(out, /checking 1 unique deps across 1 workspace/);
        assert.match(out, /lib-a/);
        assert.doesNotMatch(out, /@gjsify\/cli/);
    });

    it('exits gracefully with no external deps', async () => {
        const dir = join(tmpDir, 'empty-project');
        mkdirSync(dir, { recursive: true });
        writeFileSync(
            join(dir, 'package.json'),
            JSON.stringify(
                { name: 'empty-project', version: '1.0.0', type: 'module', private: true, dependencies: {} },
                null,
                2,
            ) + '\n',
            'utf-8',
        );
        const out = await runUpgrade([], { cwd: dir });
        assert.match(out, /no external npm dependencies/);
    });

    // ─── Workspace-mode tests ──────────────────────────────────────────

    /** Scaffold a 3-workspace monorepo with an inconsistent `lib-a` declaration. */
    function scaffoldMonorepo(rootName) {
        const root = join(tmpDir, rootName);
        mkdirSync(join(root, 'packages', 'alpha'), { recursive: true });
        mkdirSync(join(root, 'packages', 'beta'), { recursive: true });
        mkdirSync(join(root, 'packages', 'gamma'), { recursive: true });
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify(
                {
                    name: rootName,
                    version: '1.0.0',
                    private: true,
                    workspaces: ['packages/*'],
                },
                null,
                2,
            ) + '\n',
        );
        // lib-a declared at ^1.0.0 in alpha + beta, ^0.9.0 in gamma → inconsistency
        writeFileSync(
            join(root, 'packages', 'alpha', 'package.json'),
            JSON.stringify(
                {
                    name: '@m/alpha',
                    version: '1.0.0',
                    private: true,
                    dependencies: { 'lib-a': '^1.0.0', 'lib-c': '^3.2.0' },
                },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(
            join(root, 'packages', 'beta', 'package.json'),
            JSON.stringify(
                {
                    name: '@m/beta',
                    version: '1.0.0',
                    private: true,
                    dependencies: { 'lib-a': '^1.0.0', 'lib-b': '~0.4.0' },
                },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(
            join(root, 'packages', 'gamma', 'package.json'),
            JSON.stringify(
                {
                    name: '@m/gamma',
                    version: '1.0.0',
                    private: true,
                    dependencies: { 'lib-a': '^0.9.0' },
                },
                null,
                2,
            ) + '\n',
        );
        return root;
    }

    it('workspace mode: aggregates declarations across all workspaces', async () => {
        const root = scaffoldMonorepo('mono-aggregate');
        const out = await runUpgrade(['--latest', '--dry-run'], { cwd: root });
        // 3 unique deps (lib-a, lib-b, lib-c) across 4 workspaces (root + 3 children)
        assert.match(out, /checking 3 unique deps across 4 workspace/);
        // lib-a should show fan=3 (alpha + beta + gamma)
        assert.match(out, /lib-a/);
        // Inconsistency flag should be present
        assert.match(out, /⚠/);
    });

    it('workspace mode: --check exits non-zero on inconsistency', async () => {
        const root = scaffoldMonorepo('mono-check-fail');
        await assert.rejects(runUpgrade(['--check'], { cwd: root }), (err) => {
            assert.equal(err.code, 1);
            assert.match(err.stderr ?? '', /lib-a/);
            assert.match(err.stderr ?? '', /declared at inconsistent ranges/);
            return true;
        });
    });

    it('workspace mode: --check exits 0 when all consistent', async () => {
        const root = join(tmpDir, 'mono-check-ok');
        mkdirSync(join(root, 'packages', 'one'), { recursive: true });
        mkdirSync(join(root, 'packages', 'two'), { recursive: true });
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify(
                { name: 'mono-check-ok', version: '1.0.0', private: true, workspaces: ['packages/*'] },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(
            join(root, 'packages', 'one', 'package.json'),
            JSON.stringify(
                { name: '@m/one', version: '1.0.0', private: true, dependencies: { 'lib-a': '^1.0.0' } },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(
            join(root, 'packages', 'two', 'package.json'),
            JSON.stringify(
                { name: '@m/two', version: '1.0.0', private: true, dependencies: { 'lib-a': '^1.0.0' } },
                null,
                2,
            ) + '\n',
        );
        const out = await runUpgrade(['--check'], { cwd: root });
        assert.match(out, /gjsify upgrade --check: OK/);
    });

    it('workspace mode: --align fixes inconsistencies offline', async () => {
        const root = scaffoldMonorepo('mono-align');
        const out = await runUpgrade(['--align'], { cwd: root });
        // lib-a was ^1.0.0 (alpha, beta) + ^0.9.0 (gamma) → align to highest = ^1.0.0
        assert.match(out, /aligning 1 inconsistent dep/);
        assert.match(out, /lib-a/);
        const gamma = JSON.parse(readFileSync(join(root, 'packages', 'gamma', 'package.json'), 'utf-8'));
        assert.equal(gamma.dependencies['lib-a'], '^1.0.0');
    });

    it('workspace mode: --workspace filter restricts to one package', async () => {
        const root = scaffoldMonorepo('mono-filter');
        const out = await runUpgrade(['--latest', '--dry-run', '-p', '@m/alpha'], { cwd: root });
        // Only alpha's deps should be checked: lib-a, lib-c
        assert.match(out, /checking 2 unique deps across 1 workspace/);
        assert.match(out, /lib-a/);
        assert.match(out, /lib-c/);
        assert.doesNotMatch(out, /lib-b/);
    });

    it('workspace mode: --exclude-workspace skips matching packages', async () => {
        // scaffoldMonorepo declares `lib-a` inconsistently across alpha, beta, gamma.
        // Excluding gamma (which declares ^0.9.0) leaves alpha + beta which both
        // declare ^1.0.0 — `--check` should now exit 0.
        const root = scaffoldMonorepo('mono-exclude');
        const out = await runUpgrade(['--check', '--exclude-workspace', '@m/gamma'], { cwd: root });
        assert.match(out, /gjsify upgrade --check: OK/);
    });

    // ─── --exact: the gate and the repair have to agree ────────────────

    /**
     * A monorepo whose `@girs/*` declarations all AGREE on one caret range.
     *
     * Consistent, and every declaration still carries an operator — the shape
     * `--check --exact` exists to reject, and the one `--align` alone has nothing to say
     * about. Two workspaces, so a repair that only reaches one file is visible.
     */
    function scaffoldConsistentButLoose(rootName, girsRange = '^4.1.0') {
        const root = join(tmpDir, rootName);
        mkdirSync(join(root, 'packages', 'alpha'), { recursive: true });
        mkdirSync(join(root, 'packages', 'beta'), { recursive: true });
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({ name: rootName, version: '1.0.0', private: true, workspaces: ['packages/*'] }, null, 2) +
                '\n',
        );
        writeFileSync(
            join(root, 'packages', 'alpha', 'package.json'),
            JSON.stringify(
                {
                    name: '@m/alpha',
                    version: '1.0.0',
                    private: true,
                    dependencies: { '@girs/gtk-4.0': girsRange, '@girs/adw-1': girsRange, 'lib-a': '^1.0.0' },
                },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(
            join(root, 'packages', 'beta', 'package.json'),
            JSON.stringify(
                {
                    name: '@m/beta',
                    version: '1.0.0',
                    private: true,
                    dependencies: { '@girs/gtk-4.0': girsRange, 'lib-a': '^1.0.0' },
                },
                null,
                2,
            ) + '\n',
        );
        return root;
    }

    const girsOf = (root, ws) =>
        JSON.parse(readFileSync(join(root, 'packages', ws, 'package.json'), 'utf-8')).dependencies;

    // THE discriminator. `--check --exact` fails and names `--align --exact` as the fix;
    // that fix used to answer "nothing to do", because align selected on inconsistency
    // alone and this tree is perfectly consistent. Gate red → repair "done" → gate red.
    it('--exact: --align repairs exactly what --check rejects', async () => {
        const root = scaffoldConsistentButLoose('mono-exact-roundtrip');

        // 1. the gate is RED, and names the repair.
        await assert.rejects(runUpgrade(['--check', '--exact', '--filter', '@girs'], { cwd: root }), (err) => {
            assert.equal(err.code, 1);
            assert.match(err.stderr ?? '', /carry a range operator/);
            assert.match(err.stderr ?? '', /--align --exact/);
            return true;
        });

        // 2. the repair reports work and writes both files.
        const out = await runUpgrade(['--align', '--exact', '--filter', '@girs'], { cwd: root });
        assert.match(out, /pinning 2 dep\(s\)/);
        assert.match(out, /updated 2 dep\(s\) across 2 package\.json file\(s\)/);
        assert.equal(girsOf(root, 'alpha')['@girs/gtk-4.0'], '4.1.0');
        assert.equal(girsOf(root, 'alpha')['@girs/adw-1'], '4.1.0');
        assert.equal(girsOf(root, 'beta')['@girs/gtk-4.0'], '4.1.0');
        // Untouched: outside the filter.
        assert.equal(girsOf(root, 'alpha')['lib-a'], '^1.0.0');

        // 3. the gate is GREEN. Without step 3 this test would pass on a repair that
        //    wrote something the gate still rejects.
        const check = await runUpgrade(['--check', '--exact', '--filter', '@girs'], { cwd: root });
        assert.match(check, /every declaration pinned exactly/);
    });

    it('--exact: --align --dry-run announces the pin and writes nothing', async () => {
        const root = scaffoldConsistentButLoose('mono-exact-dryrun');
        const before = readFileSync(join(root, 'packages', 'alpha', 'package.json'), 'utf-8');
        const out = await runUpgrade(['--align', '--exact', '--dry-run', '--filter', '@girs'], { cwd: root });
        assert.match(out, /pinning 2 dep\(s\)/);
        assert.match(out, /→ +4\.1\.0/);
        assert.match(out, /--dry-run: no files changed/);
        assert.equal(readFileSync(join(root, 'packages', 'alpha', 'package.json'), 'utf-8'), before);
    });

    // The early return is load-bearing for plain `--align`: consistency is the whole
    // question there, and a caret is not a defect. Widening the target set for `--exact`
    // must not widen it here.
    it('--align without --exact leaves a consistent caret tree alone', async () => {
        const root = scaffoldConsistentButLoose('mono-align-plain');
        const before = readFileSync(join(root, 'packages', 'alpha', 'package.json'), 'utf-8');
        const out = await runUpgrade(['--align', '--filter', '@girs'], { cwd: root });
        assert.match(out, /nothing to do/);
        assert.doesNotMatch(out, /pinned exactly/);
        assert.equal(readFileSync(join(root, 'packages', 'alpha', 'package.json'), 'utf-8'), before);
        // …and plain `--check` agrees the tree is fine.
        const check = await runUpgrade(['--check', '--filter', '@girs'], { cwd: root });
        assert.match(check, /--check: OK/);
    });

    it('--exact: --align is a no-op on an already-pinned tree', async () => {
        const root = scaffoldConsistentButLoose('mono-exact-noop', '4.6.0');
        const out = await runUpgrade(['--align', '--exact', '--filter', '@girs'], { cwd: root });
        assert.match(out, /nothing to do/);
        assert.match(out, /every declaration pinned exactly/);
        assert.equal(girsOf(root, 'alpha')['@girs/gtk-4.0'], '4.6.0');
    });

    // A repair that quietly skips part of its job hands back a green exit on a tree the
    // gate still rejects, and the next red looks like the repair never ran.
    it('--exact: --align exits non-zero when a range names no version', async () => {
        const root = join(tmpDir, 'mono-exact-unrepairable');
        mkdirSync(join(root, 'packages', 'one'), { recursive: true });
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({ name: 'mono-x', version: '1.0.0', private: true, workspaces: ['packages/*'] }, null, 2) +
                '\n',
        );
        writeFileSync(
            join(root, 'packages', 'one', 'package.json'),
            JSON.stringify(
                { name: '@m/one', version: '1.0.0', private: true, dependencies: { 'lib-a': '^1.x' } },
                null,
                2,
            ) + '\n',
        );
        await assert.rejects(runUpgrade(['--align', '--exact'], { cwd: root }), (err) => {
            assert.equal(err.code, 1);
            assert.match(err.stderr ?? '', /left unrepaired/);
            assert.match(err.stderr ?? '', /lib-a/);
            return true;
        });
        assert.equal(
            JSON.parse(readFileSync(join(root, 'packages', 'one', 'package.json'), 'utf-8')).dependencies['lib-a'],
            '^1.x',
        );
    });

    it('workspace mode: --exclude-workspace glob pattern matches multiple', async () => {
        // Excluding ALL of '@m/*' leaves only the root workspace (which has no
        // deps). `--check` should report nothing to check.
        const root = scaffoldMonorepo('mono-exclude-glob');
        const out = await runUpgrade(['--check', '--exclude-workspace', '@m/*'], { cwd: root });
        // With every child workspace excluded, root has no external deps to check
        assert.match(out, /no external npm dependencies/);
    });
});
