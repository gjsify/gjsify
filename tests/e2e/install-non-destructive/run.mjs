// E2E guard for ADR 0001 — `gjsify install` is non-destructive.
//
// The invariant (docs/adr/0001-install-clean-separation.md): an install
// mutates ONLY `node_modules/`, `gjsify-lock.json`, the XDG cache/global
// prefix, and — for `install <pkg>` — `package.json`. It NEVER deletes or
// overwrites build artifacts (`lib/`, `dist/`, committed bundles) or any
// git-tracked file outside that lockfile/manifest set. Cleaning is a separate,
// explicit command — never an install side effect.
//
// This is the BROAD invariant guard. It is complementary to
// `install-workspace-source-safety` (which pins the one narrow data-loss bug of
// extracting a published tarball over a same-named workspace's SOURCE). Here we
// commit real build artifacts (`lib/`, `dist/`) into a git repo and assert,
// after every install mode, that `git status --porcelain` shows no change to a
// tracked file the mode is not allowed to touch:
//
//   - `gjsify install`            → allowed to touch: nothing (lock already matches)
//   - `gjsify install --immutable`→ allowed to touch: nothing (frozen)
//   - `gjsify install <pkg>`      → allowed to touch: package.json + gjsify-lock.json
//   - workspace `gjsify install`  → allowed to touch: nothing (a package's lib/ survives)
//
// Because the invariant is (as of ADR 0001) an ENFORCED property rather than an
// aspiration, this suite PASSES on current `gjsify` and would FAIL the moment an
// install regressed into deleting/overwriting a committed artifact.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCli, startMockRegistry } from '../mock-registry.mjs';

// Two independent registry packages, each a trivial CJS module. `@fixture/dep`
// is the baseline dependency committed into every fixture; `@fixture/other` is
// the package the add-package (`install <pkg>`) mode pulls in.
const PACKAGES = {
    '@fixture/dep': {
        '1.0.0': {
            main: 'index.js',
            dependencies: {},
            files: { 'index.js': 'module.exports = "@fixture/dep";\n' },
        },
    },
    '@fixture/other': {
        '1.0.0': {
            main: 'index.js',
            dependencies: {},
            files: { 'index.js': 'module.exports = "@fixture/other";\n' },
        },
    },
};

// Committed build-artifact markers — if an install deletes or rewrites either,
// the marker changes and git surfaces it.
const LIB_MARKER = '// built artifact — must survive install\nmodule.exports = 42;\n';
const DIST_MARKER = '#!/usr/bin/env -S gjs -m\n// committed bundle — must survive install\n';
const SRC_MARKER = 'export const SRC = "source-preserved";\n';

function git(root, args, env) {
    return execFileSync('git', args, {
        cwd: root,
        env,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

// `git status --porcelain=v1` → array of { code, path } for every non-clean
// tracked/untracked-non-ignored entry. node_modules and the caches are
// gitignored, so they never appear here.
function porcelain(root, env) {
    const out = git(root, ['status', '--porcelain=v1'], env);
    return out
        .split('\n')
        .filter(Boolean)
        .map((line) => ({ code: line.slice(0, 2), path: line.slice(3).replace(/^"|"$/g, '') }));
}

// The build-artifact/source markers for a package rooted at `base` — the fixture
// root for the single-package case, `packages/a` for the workspace case.
function markerChecks(base, prefix = '') {
    return [
        [join(base, 'lib', 'index.js'), LIB_MARKER, `${prefix}lib/index.js (build artifact)`],
        [join(base, 'dist', 'bundle.mjs'), DIST_MARKER, `${prefix}dist/bundle.mjs (committed bundle)`],
        [join(base, 'src', 'index.ts'), SRC_MARKER, `${prefix}src/index.ts (source)`],
    ];
}

function assertMarkers(checks) {
    for (const [p, want, label] of checks) {
        assert.ok(existsSync(p), `${label} must still exist after install`);
        assert.equal(readFileSync(p, 'utf-8'), want, `${label} contents must be untouched`);
    }
}

describe('gjsify install — non-destructive (ADR 0001)', { timeout: 120_000 }, () => {
    let registry, registryUrl, cliEntry, baseEnv;
    const roots = [];

    before(async () => {
        registry = await startMockRegistry(PACKAGES);
        registryUrl = registry.url;
        cliEntry = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));
    });

    after(async () => {
        await registry?.close();
        for (const r of roots) rmSync(r, { recursive: true, force: true });
    });

    // Scaffold a git repo with committed build artifacts, run a first install
    // so a real lockfile + node_modules exist, then commit everything except
    // the gitignored node_modules/caches. Returns { root, env }. After this the
    // working tree is CLEAN (porcelain empty) — the baseline every mode is
    // measured against.
    function scaffoldCommitted(prefix, { workspace = false } = {}) {
        const root = mkdtempSync(join(tmpdir(), prefix));
        roots.push(root);
        const env = {
            ...process.env,
            GJSIFY_INSTALL_BACKEND: 'native',
            npm_config_registry: registryUrl,
            GJSIFY_INSTALL_CONCURRENCY: '1',
            // Keep all caches/global state OUT of the fixture working tree.
            XDG_CACHE_HOME: join(root, '.xdg-cache'),
            XDG_DATA_HOME: join(root, '.xdg-data'),
            XDG_STATE_HOME: join(root, '.xdg-state'),
            // Deterministic, hermetic git identity.
            GIT_AUTHOR_NAME: 'e2e',
            GIT_AUTHOR_EMAIL: 'e2e@example.com',
            GIT_COMMITTER_NAME: 'e2e',
            GIT_COMMITTER_EMAIL: 'e2e@example.com',
            HOME: root,
        };

        writeFileSync(
            join(root, '.gitignore'),
            ['node_modules/', '.xdg-cache/', '.xdg-data/', '.xdg-state/', ''].join('\n'),
        );
        writeFileSync(join(root, '.npmrc'), `registry=${registryUrl}\n`);

        if (workspace) {
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify(
                    { name: 'root', version: '0.0.0', private: true, type: 'module', workspaces: ['packages/*'] },
                    null,
                    2,
                ) + '\n',
            );
            // A workspace package carrying a committed build artifact.
            mkdirSync(join(root, 'packages', 'a', 'src'), { recursive: true });
            mkdirSync(join(root, 'packages', 'a', 'lib'), { recursive: true });
            mkdirSync(join(root, 'packages', 'a', 'dist'), { recursive: true });
            writeFileSync(
                join(root, 'packages', 'a', 'package.json'),
                JSON.stringify(
                    {
                        name: '@fixture/a',
                        version: '1.0.0',
                        type: 'module',
                        dependencies: { '@fixture/dep': '^1.0.0' },
                    },
                    null,
                    2,
                ) + '\n',
            );
            writeFileSync(join(root, 'packages', 'a', 'src', 'index.ts'), SRC_MARKER);
            writeFileSync(join(root, 'packages', 'a', 'lib', 'index.js'), LIB_MARKER);
            writeFileSync(join(root, 'packages', 'a', 'dist', 'bundle.mjs'), DIST_MARKER);
        } else {
            mkdirSync(join(root, 'src'), { recursive: true });
            mkdirSync(join(root, 'lib'), { recursive: true });
            mkdirSync(join(root, 'dist'), { recursive: true });
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify(
                    {
                        name: '@fixture/app',
                        version: '1.0.0',
                        type: 'module',
                        dependencies: { '@fixture/dep': '^1.0.0' },
                    },
                    null,
                    2,
                ) + '\n',
            );
            writeFileSync(join(root, 'src', 'index.ts'), SRC_MARKER);
            writeFileSync(join(root, 'lib', 'index.js'), LIB_MARKER);
            writeFileSync(join(root, 'dist', 'bundle.mjs'), DIST_MARKER);
        }

        return { root, env };
    }

    async function seedInstallAndCommit(root, env) {
        const seed = await runCli(cliEntry, ['install'], { timeoutMs: 60_000, cwd: root, env });
        assert.equal(seed.status, 0, `seed install failed: ${seed.stderr}\n${seed.stdout}`);
        assert.ok(existsSync(join(root, 'gjsify-lock.json')), 'seed install must produce a lockfile');
        git(root, ['init', '-q'], env);
        git(root, ['add', '-A'], env);
        git(root, ['commit', '-q', '-m', 'fixture'], env);
        // Baseline must be clean — node_modules + caches are gitignored.
        assert.deepEqual(porcelain(root, env), [], 'fixture working tree must be clean after commit');
    }

    it('re-install touches no tracked file', async () => {
        const { root, env } = scaffoldCommitted('gjsify-e2e-nondestr-reinstall-');
        await seedInstallAndCommit(root, env);

        const r = await runCli(cliEntry, ['install'], { timeoutMs: 60_000, cwd: root, env });
        assert.equal(r.status, 0, `install failed: ${r.stderr}\n${r.stdout}`);

        assertMarkers(markerChecks(root));
        assert.deepEqual(
            porcelain(root, env),
            [],
            'a re-install with an up-to-date lockfile must not modify ANY tracked file',
        );
    });

    it('--immutable touches no tracked file', async () => {
        const { root, env } = scaffoldCommitted('gjsify-e2e-nondestr-immutable-');
        await seedInstallAndCommit(root, env);

        const r = await runCli(cliEntry, ['install', '--immutable'], { timeoutMs: 60_000, cwd: root, env });
        assert.equal(r.status, 0, `--immutable install failed: ${r.stderr}\n${r.stdout}`);

        assertMarkers(markerChecks(root));
        assert.deepEqual(porcelain(root, env), [], 'a frozen --immutable install must not modify ANY tracked file');
    });

    it('add-package touches only package.json + lockfile, never build artifacts', async () => {
        const { root, env } = scaffoldCommitted('gjsify-e2e-nondestr-add-');
        await seedInstallAndCommit(root, env);

        const r = await runCli(cliEntry, ['install', '@fixture/other@^1.0.0'], { timeoutMs: 60_000, cwd: root, env });
        assert.equal(r.status, 0, `add-package install failed: ${r.stderr}\n${r.stdout}`);

        // Build artifacts + source are untouched...
        assertMarkers(markerChecks(root));
        // ...and the ONLY tracked changes are the manifest + lockfile.
        const changed = porcelain(root, env)
            .map((e) => e.path)
            .sort();
        assert.deepEqual(
            changed,
            ['gjsify-lock.json', 'package.json'],
            `add-package may only touch package.json + gjsify-lock.json; saw: ${changed.join(', ')}`,
        );
        // The new dep really landed in the manifest.
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
        assert.ok(pkg.dependencies['@fixture/other'], 'the added dep must be recorded in package.json');
    });

    it('workspace install preserves a package’s committed build artifacts', async () => {
        const { root, env } = scaffoldCommitted('gjsify-e2e-nondestr-workspace-', { workspace: true });
        await seedInstallAndCommit(root, env);

        const r = await runCli(cliEntry, ['install'], { timeoutMs: 60_000, cwd: root, env });
        assert.equal(r.status, 0, `workspace install failed: ${r.stderr}\n${r.stdout}`);

        assertMarkers(markerChecks(join(root, 'packages', 'a'), 'packages/a/'));
        assert.deepEqual(
            porcelain(root, env),
            [],
            'a workspace install must not modify ANY tracked file (incl. a package’s committed lib/dist)',
        );
    });
});
