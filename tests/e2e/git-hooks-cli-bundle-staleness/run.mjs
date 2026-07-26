// E2E test for the `.githooks/pre-commit` hook that auto-rebuilds + auto-stages
// the committed `@gjsify/{cli,tsc}` GJS bundles when their `src/` trees change.
//
// The hook is what removes the recurring foot-gun: contributors who edit
// `packages/infra/{cli,tsc}/src/` without rebuilding the bundle would otherwise
// land red CI runs against the bundle-freshness check in
// `.github/workflows/main.yml`.
//
// We don't run the actual `gjsify workspace ... build` chain here — that
// requires the full installed workspace and is exercised separately by every
// other PR that touches CLI source. Instead we install a synthetic stub `gjsify`
// on PATH that records its invocations to a side-channel file, so we can
// assert the hook calls the right command sequence for each staged-change
// pattern. The hook's bash logic (detect → invoke → re-stage) is what we're
// validating, not the bundle build itself.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const HOOK_SOURCE = join(REPO_ROOT, '.githooks', 'pre-commit');
const INSTALL_SCRIPT = join(REPO_ROOT, 'scripts', 'install-git-hooks.mjs');

/**
 * Lay down the minimum repository skeleton the hook walks:
 *   - `.git` (real, via `git init`)
 *   - `.githooks/pre-commit` (copied from the actual workspace hook under test)
 *   - `packages/infra/cli/src/index.ts` + `dist/cli.gjs.mjs`
 *   - `packages/infra/tsc/src/index.ts` + `dist/tsc.gjs.mjs`
 *   - `node_modules/.bin/gjsify` — synthetic stub recording its argv to a log
 *
 * The stub is wired into PATH via `node_modules/.bin` so the hook's resolver
 * picks it up first.
 */
function setupSyntheticRepo(parent) {
    const root = mkdtempSync(join(parent, 'gh-hooks-'));
    // Init git WITHOUT global hook-path inheritance (otherwise the parent
    // workspace's core.hooksPath setting would leak in).
    execFileSync('git', ['init', '-q', '-b', 'main', root], { stdio: 'pipe' });
    execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'test']);
    execFileSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false']);

    // Workspace tree the hook expects.
    mkdirSync(join(root, '.githooks'), { recursive: true });
    cpSync(HOOK_SOURCE, join(root, '.githooks', 'pre-commit'));
    chmodSync(join(root, '.githooks', 'pre-commit'), 0o755);
    execFileSync('git', ['-C', root, 'config', 'core.hooksPath', '.githooks']);

    mkdirSync(join(root, 'packages', 'infra', 'cli', 'src'), { recursive: true });
    mkdirSync(join(root, 'packages', 'infra', 'cli', 'dist'), { recursive: true });
    writeFileSync(join(root, 'packages', 'infra', 'cli', 'src', 'index.ts'), `export const v = 1;\n`);
    writeFileSync(join(root, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs'), `// initial cli bundle\n`);
    writeFileSync(
        join(root, 'packages', 'infra', 'cli', 'dist', 'affected.gjs.mjs'),
        `// initial affected bundle\n`,
    );

    // The build pipeline the CLI bundle INLINES. A resolver change here is
    // silently absent from `dist/cli.gjs.mjs` until it is rebuilt, so the hook
    // treats it exactly like `cli/src/`.
    mkdirSync(join(root, 'packages', 'infra', 'rolldown-plugin-gjsify', 'src', 'plugins'), { recursive: true });
    writeFileSync(
        join(root, 'packages', 'infra', 'rolldown-plugin-gjsify', 'src', 'plugins', 'alias.ts'),
        `export const aliasPlugin = () => ({ name: 'gjsify-alias' });\n`,
    );

    mkdirSync(join(root, 'packages', 'infra', 'tsc', 'src'), { recursive: true });
    mkdirSync(join(root, 'packages', 'infra', 'tsc', 'dist'), { recursive: true });
    writeFileSync(
        join(root, 'packages', 'infra', 'tsc', 'src', 'index.ts'),
        `export const TYPESCRIPT_VERSION = '0';\n`,
    );
    writeFileSync(join(root, 'packages', 'infra', 'tsc', 'dist', 'tsc.gjs.mjs'), `// initial tsc bundle\n`);

    // Synthetic `gjsify` stub on PATH. Records its argv to a log + REWRITES
    // the appropriate `dist/<bundle>.gjs.mjs` so we can assert the hook
    // re-stages the new content (instead of the stale committed bytes).
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
    const logPath = join(root, '.gjsify-stub.log');
    // Argv shape: gjsify workspace <pkg> <script>
    // So $1=workspace, $2=<pkg>, $3=<script>.
    const stub = `#!/usr/bin/env bash
echo "$@" >> "${logPath}"
if [ "$1" = "workspace" ] && [ "$2" = "@gjsify/cli" ] && [ "$3" = "build:gjs-bundle" ]; then
    echo "// rebuilt cli bundle $(date +%s%N)" > "${root}/packages/infra/cli/dist/cli.gjs.mjs"
fi
if [ "$1" = "workspace" ] && [ "$2" = "@gjsify/cli" ] && [ "$3" = "build:affected-bundle" ]; then
    echo "// rebuilt affected bundle $(date +%s%N)" > "${root}/packages/infra/cli/dist/affected.gjs.mjs"
fi
if [ "$1" = "workspace" ] && [ "$2" = "@gjsify/tsc" ] && [ "$3" = "build" ]; then
    echo "// rebuilt tsc bundle $(date +%s%N)" > "${root}/packages/infra/tsc/dist/tsc.gjs.mjs"
fi
exit 0
`;
    const stubPath = join(root, 'node_modules', '.bin', 'gjsify');
    writeFileSync(stubPath, stub);
    chmodSync(stubPath, 0o755);

    // Seed the initial commit so the staged-change detection has a baseline.
    execFileSync('git', ['-C', root, 'add', '-A']);
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'initial', '--no-verify']);

    return { root, stubPath, logPath };
}

function readLog(logPath) {
    try {
        return readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

function runHook(root, envOverrides = {}) {
    // Run as `git commit` rather than directly invoking the hook — this
    // confirms `core.hooksPath = .githooks` is honoured AND that the hook
    // resolves the repo root via `git rev-parse` correctly.
    return spawnSync('git', ['-C', root, 'commit', '-q', '-m', 'hook-test'], {
        encoding: 'utf-8',
        env: { ...process.env, PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH}`, ...envOverrides },
    });
}

describe('git pre-commit hook — CLI/tsc bundle staleness', { timeout: 2 * 60 * 1000 }, () => {
    let parent;

    before(() => {
        parent = mkdtempSync(join(tmpdir(), 'gjsify-e2e-githooks-'));
    });

    after(() => {
        try {
            rmSync(parent, { recursive: true, force: true });
        } catch {}
    });

    it('is a no-op for unrelated staged changes', () => {
        const { root, logPath } = setupSyntheticRepo(parent);
        writeFileSync(join(root, 'README.md'), '# unrelated\n');
        execFileSync('git', ['-C', root, 'add', 'README.md']);

        const result = runHook(root);
        assert.equal(result.status, 0, `hook failed: ${result.stderr}`);
        assert.deepEqual(readLog(logPath), [], `hook should not have invoked gjsify, got: ${result.stdout}`);
    });

    it('auto-rebuilds + auto-stages dist/cli.gjs.mjs when packages/infra/cli/src/ changes', () => {
        const { root, logPath } = setupSyntheticRepo(parent);
        const initialBundle = readFileSync(join(root, 'packages/infra/cli/dist/cli.gjs.mjs'), 'utf-8');

        writeFileSync(join(root, 'packages/infra/cli/src/index.ts'), `export const v = 2;\n`);
        execFileSync('git', ['-C', root, 'add', 'packages/infra/cli/src/index.ts']);

        const result = runHook(root);
        assert.equal(result.status, 0, `hook failed: ${result.stderr}`);

        const invocations = readLog(logPath);
        // Three gjsify calls — `workspace @gjsify/cli build`, then
        // `build:gjs-bundle` (cli.gjs.mjs), then `build:affected-bundle`
        // (the dedicated Soup-free classifier bundle).
        assert.equal(invocations.length, 3, `expected 3 gjsify invocations, got: ${invocations.join(' / ')}`);
        assert.equal(invocations[0], 'workspace @gjsify/cli build');
        assert.equal(invocations[1], 'workspace @gjsify/cli build:gjs-bundle');
        assert.equal(invocations[2], 'workspace @gjsify/cli build:affected-bundle');

        // The rebuilt bundle must be in the just-recorded commit.
        const filesInCommit = execFileSync(
            'git',
            ['-C', root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
            { encoding: 'utf-8' },
        )
            .trim()
            .split('\n');
        assert.ok(
            filesInCommit.includes('packages/infra/cli/dist/cli.gjs.mjs'),
            `dist/cli.gjs.mjs not in commit; saw: ${filesInCommit.join(', ')}`,
        );
        assert.ok(
            filesInCommit.includes('packages/infra/cli/dist/affected.gjs.mjs'),
            `dist/affected.gjs.mjs not in commit; saw: ${filesInCommit.join(', ')}`,
        );
        assert.ok(
            filesInCommit.includes('packages/infra/cli/src/index.ts'),
            `src/index.ts not in commit; saw: ${filesInCommit.join(', ')}`,
        );

        const finalBundle = readFileSync(join(root, 'packages/infra/cli/dist/cli.gjs.mjs'), 'utf-8');
        assert.notEqual(finalBundle, initialBundle, 'cli bundle was not refreshed by the rebuild');
    });

    it('auto-rebuilds when packages/infra/rolldown-plugin-gjsify/src/ changes', () => {
        // The committed `dist/cli.gjs.mjs` inlines the whole build pipeline, and
        // `node_modules/.bin/gjsify` prefers that bundle over the workspace
        // `lib/` whenever `gjs` is on PATH. Without this trigger a resolver fix
        // (the `aliasPlugin` virtual-module scoping guard is the case that
        // surfaced it) appears to change nothing at all locally — no error, just
        // the old behaviour — and every e2e booting the bundle keeps exercising
        // the stale pipeline.
        const { root, logPath } = setupSyntheticRepo(parent);
        const initialBundle = readFileSync(join(root, 'packages/infra/cli/dist/cli.gjs.mjs'), 'utf-8');

        const pluginSrc = 'packages/infra/rolldown-plugin-gjsify/src/plugins/alias.ts';
        writeFileSync(
            join(root, pluginSrc),
            `export const aliasPlugin = () => ({ name: 'gjsify-alias', resolveId: () => null });\n`,
        );
        execFileSync('git', ['-C', root, 'add', pluginSrc]);

        const result = runHook(root);
        assert.equal(result.status, 0, `hook failed: ${result.stderr}`);

        const invocations = readLog(logPath);
        assert.deepEqual(invocations, [
            'workspace @gjsify/cli build',
            'workspace @gjsify/cli build:gjs-bundle',
            'workspace @gjsify/cli build:affected-bundle',
        ]);

        const filesInCommit = execFileSync(
            'git',
            ['-C', root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
            { encoding: 'utf-8' },
        )
            .trim()
            .split('\n');
        assert.ok(
            filesInCommit.includes('packages/infra/cli/dist/cli.gjs.mjs'),
            `dist/cli.gjs.mjs not in commit; saw: ${filesInCommit.join(', ')}`,
        );
        assert.notEqual(
            readFileSync(join(root, 'packages/infra/cli/dist/cli.gjs.mjs'), 'utf-8'),
            initialBundle,
            'cli bundle was not refreshed by the rebuild',
        );
    });

    it('skips the rebuild when SKIP_GJSIFY_HOOKS=1', () => {
        const { root, logPath } = setupSyntheticRepo(parent);
        const initialBundle = readFileSync(join(root, 'packages/infra/cli/dist/cli.gjs.mjs'), 'utf-8');

        writeFileSync(join(root, 'packages/infra/cli/src/index.ts'), `export const v = 3;\n`);
        execFileSync('git', ['-C', root, 'add', 'packages/infra/cli/src/index.ts']);

        const result = runHook(root, { SKIP_GJSIFY_HOOKS: '1' });
        assert.equal(result.status, 0, `hook failed: ${result.stderr}`);
        assert.deepEqual(readLog(logPath), [], 'SKIP_GJSIFY_HOOKS=1 should suppress rebuild');

        const finalBundle = readFileSync(join(root, 'packages/infra/cli/dist/cli.gjs.mjs'), 'utf-8');
        assert.equal(finalBundle, initialBundle, 'cli bundle should not have been refreshed under SKIP_GJSIFY_HOOKS=1');
    });

    it('auto-rebuilds + auto-stages dist/tsc.gjs.mjs when packages/infra/tsc/src/ changes', () => {
        const { root, logPath } = setupSyntheticRepo(parent);
        const initialBundle = readFileSync(join(root, 'packages/infra/tsc/dist/tsc.gjs.mjs'), 'utf-8');

        writeFileSync(join(root, 'packages/infra/tsc/src/index.ts'), `export const TYPESCRIPT_VERSION = '5.9.4';\n`);
        execFileSync('git', ['-C', root, 'add', 'packages/infra/tsc/src/index.ts']);

        const result = runHook(root);
        assert.equal(result.status, 0, `hook failed: ${result.stderr}`);

        const invocations = readLog(logPath);
        // tsc has only a single build step (no separate :gjs-bundle phase).
        assert.equal(invocations.length, 1, `expected 1 gjsify invocation, got: ${invocations.join(' / ')}`);
        assert.equal(invocations[0], 'workspace @gjsify/tsc build');

        const filesInCommit = execFileSync(
            'git',
            ['-C', root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
            { encoding: 'utf-8' },
        )
            .trim()
            .split('\n');
        assert.ok(
            filesInCommit.includes('packages/infra/tsc/dist/tsc.gjs.mjs'),
            `dist/tsc.gjs.mjs not in commit; saw: ${filesInCommit.join(', ')}`,
        );

        const finalBundle = readFileSync(join(root, 'packages/infra/tsc/dist/tsc.gjs.mjs'), 'utf-8');
        assert.notEqual(finalBundle, initialBundle, 'tsc bundle was not refreshed by the rebuild');
    });

    it('honours `git commit --no-verify` (skips the hook entirely)', () => {
        const { root, logPath } = setupSyntheticRepo(parent);
        writeFileSync(join(root, 'packages/infra/cli/src/index.ts'), `export const v = 4;\n`);
        execFileSync('git', ['-C', root, 'add', 'packages/infra/cli/src/index.ts']);

        const result = spawnSync('git', ['-C', root, 'commit', '-q', '--no-verify', '-m', 'bypass'], {
            encoding: 'utf-8',
            env: process.env,
        });
        assert.equal(result.status, 0, `git commit --no-verify failed: ${result.stderr}`);
        assert.deepEqual(readLog(logPath), [], '--no-verify should skip the hook');
    });

    it('install-git-hooks.mjs sets core.hooksPath to .githooks (idempotent)', () => {
        const { root } = setupSyntheticRepo(parent);
        // Reset core.hooksPath so we can observe the install script setting it.
        execFileSync('git', ['-C', root, 'config', '--unset', 'core.hooksPath']);

        // Lay the script down at the expected path within the synthetic root
        // (the script resolves its hooksDir relative to its own location).
        mkdirSync(join(root, 'scripts'), { recursive: true });
        cpSync(INSTALL_SCRIPT, join(root, 'scripts', 'install-git-hooks.mjs'));

        const first = spawnSync(process.execPath, [join(root, 'scripts', 'install-git-hooks.mjs'), '--quiet'], {
            cwd: root,
            encoding: 'utf-8',
        });
        assert.equal(first.status, 0, `first install failed: ${first.stderr}`);
        const after1 = execFileSync('git', ['-C', root, 'config', '--get', 'core.hooksPath'], {
            encoding: 'utf-8',
        }).trim();
        assert.equal(after1, '.githooks');

        // Re-running is a no-op (idempotent).
        const second = spawnSync(process.execPath, [join(root, 'scripts', 'install-git-hooks.mjs'), '--quiet'], {
            cwd: root,
            encoding: 'utf-8',
        });
        assert.equal(second.status, 0, `second install failed: ${second.stderr}`);

        // --uninstall reverts.
        const uninstall = spawnSync(
            process.execPath,
            [join(root, 'scripts', 'install-git-hooks.mjs'), '--uninstall', '--quiet'],
            { cwd: root, encoding: 'utf-8' },
        );
        assert.equal(uninstall.status, 0, `uninstall failed: ${uninstall.stderr}`);
        const afterUninstall = spawnSync('git', ['-C', root, 'config', '--get', 'core.hooksPath'], {
            encoding: 'utf-8',
        });
        assert.equal(afterUninstall.status, 1, 'core.hooksPath should be unset after --uninstall');
    });
});
