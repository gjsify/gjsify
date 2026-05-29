// E2E test for `gjsify upgrade`.
//
// Strategy: stand up a mock npm registry in-process via `http.createServer()`,
// generate packuments for a few synthetic packages, point `gjsify upgrade
// --latest --dry-run` at the project via `--cwd`, set `npm_config_registry`
// to our mock, and assert the candidate table shape + dry-run skip + actual
// write-back behavior on a non-dry-run pass.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
import { createServer } from 'node:http';
import { writeFileSync, readFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CLI_ENTRY = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');

describe('CLI upgrade E2E', { timeout: 2 * 60 * 1000 }, () => {
    let tmpDir;
    let registryServer;
    let registryUrl;

    /** Build a minimal packument body matching @gjsify/npm-registry's schema. */
    function packument(name, versions, latest) {
        const versionMap = {};
        for (const v of versions) {
            versionMap[v] = {
                name,
                version: v,
                dist: { tarball: `${registryUrl}/${name}/-/${name}-${v}.tgz`, shasum: 'deadbeef' },
            };
        }
        return JSON.stringify({
            name,
            'dist-tags': { latest },
            versions: versionMap,
        });
    }

    before(async () => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-upgrade-'));
        if (!existsSync(CLI_ENTRY)) {
            throw new Error(`CLI entry not built: ${CLI_ENTRY}`);
        }

        registryServer = createServer((req, res) => {
            // Decode the packument lookup: /<name> or /@scope/<name>
            const path = decodeURIComponent(req.url ?? '/');
            // Strip leading slash + trailing query.
            const name = path.replace(/^\//, '').split('?')[0] ?? '';
            switch (name) {
                case 'lib-a':
                    res.setHeader('content-type', 'application/json');
                    res.end(packument('lib-a', ['1.0.0', '1.1.0', '1.2.3', '2.0.0'], '2.0.0'));
                    return;
                case 'lib-b':
                    res.setHeader('content-type', 'application/json');
                    res.end(packument('lib-b', ['0.4.0', '0.5.0'], '0.5.0'));
                    return;
                case 'lib-c':
                    res.setHeader('content-type', 'application/json');
                    res.end(packument('lib-c', ['3.2.0', '3.2.1'], '3.2.1'));
                    return;
                case 'lib-uptodate':
                    res.setHeader('content-type', 'application/json');
                    res.end(packument('lib-uptodate', ['9.9.9'], '9.9.9'));
                    return;
                default:
                    res.statusCode = 404;
                    res.end('{}');
                    return;
            }
        });
        await new Promise((resolve) => registryServer.listen(0, '127.0.0.1', resolve));
        const addr = registryServer.address();
        registryUrl = `http://127.0.0.1:${addr.port}`;
    });

    after(() => {
        registryServer?.close();
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
    async function runCli(args, opts = {}) {
        const { stdout } = await execFileAsync('node', [CLI_ENTRY, 'upgrade', ...args], {
            timeout: opts.timeout ?? 30 * 1000,
            cwd: opts.cwd,
            env: { ...process.env, npm_config_registry: registryUrl, ...opts.env },
            encoding: 'utf8',
        });
        return stdout;
    }

    it('--latest --dry-run reports candidates without writing', async () => {
        const dir = scaffold('dry-run-project');
        const before = readFileSync(join(dir, 'package.json'), 'utf-8');
        const out = await runCli(['--latest', '--dry-run'], { cwd: dir });
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
        await runCli(['--latest'], { cwd: dir });
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
        const out = await runCli(['--patch'], { cwd: dir });
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
        await runCli(['--minor'], { cwd: dir });
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
        await runCli(['--latest', '--filter', 'lib-a,lib-c'], { cwd: dir });
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
        const out = await runCli(['--latest', '--dry-run'], { cwd: dir });
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
        const out = await runCli([], { cwd: dir });
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
        const out = await runCli(['--latest', '--dry-run'], { cwd: root });
        // 3 unique deps (lib-a, lib-b, lib-c) across 4 workspaces (root + 3 children)
        assert.match(out, /checking 3 unique deps across 4 workspace/);
        // lib-a should show fan=3 (alpha + beta + gamma)
        assert.match(out, /lib-a/);
        // Inconsistency flag should be present
        assert.match(out, /⚠/);
    });

    it('workspace mode: --check exits non-zero on inconsistency', async () => {
        const root = scaffoldMonorepo('mono-check-fail');
        await assert.rejects(
            runCli(['--check'], { cwd: root }),
            (err) => {
                assert.equal(err.code, 1);
                assert.match(err.stderr ?? '', /lib-a/);
                assert.match(err.stderr ?? '', /declared at inconsistent ranges/);
                return true;
            },
        );
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
        const out = await runCli(['--check'], { cwd: root });
        assert.match(out, /gjsify upgrade --check: OK/);
    });

    it('workspace mode: --align fixes inconsistencies offline', async () => {
        const root = scaffoldMonorepo('mono-align');
        const out = await runCli(['--align'], { cwd: root });
        // lib-a was ^1.0.0 (alpha, beta) + ^0.9.0 (gamma) → align to highest = ^1.0.0
        assert.match(out, /aligning 1 inconsistent dep/);
        assert.match(out, /lib-a/);
        const gamma = JSON.parse(
            readFileSync(join(root, 'packages', 'gamma', 'package.json'), 'utf-8'),
        );
        assert.equal(gamma.dependencies['lib-a'], '^1.0.0');
    });

    it('workspace mode: --workspace filter restricts to one package', async () => {
        const root = scaffoldMonorepo('mono-filter');
        const out = await runCli(['--latest', '--dry-run', '-p', '@m/alpha'], { cwd: root });
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
        const out = await runCli(['--check', '--exclude-workspace', '@m/gamma'], { cwd: root });
        assert.match(out, /gjsify upgrade --check: OK/);
    });

    it('workspace mode: --exclude-workspace glob pattern matches multiple', async () => {
        // Excluding ALL of '@m/*' leaves only the root workspace (which has no
        // deps). `--check` should report nothing to check.
        const root = scaffoldMonorepo('mono-exclude-glob');
        const out = await runCli(['--check', '--exclude-workspace', '@m/*'], { cwd: root });
        // With every child workspace excluded, root has no external deps to check
        assert.match(out, /no external npm dependencies/);
    });
});
