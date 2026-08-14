// E2E test for the `.githooks/pre-commit` hook that auto-rebuilds + auto-stages
// `packages/infra/cli/dist/affected.gjs.mjs` when the source it is bundled from
// changes.
//
// ADR 0002 untracked `cli.gjs.mjs` and `tsc.gjs.mjs`, and the hook shrank with
// them. The one artifact left is the one whose staleness FAILS OPEN: the CI
// `changes` job boots the classifier before any install and it gates every other
// job, so a stale copy does not error — it classifies today's PR with an older
// commit's tables and the run looks green while having skipped work.
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
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const INSTALL_SCRIPT = join(REPO_ROOT, 'scripts', 'install-git-hooks.mjs');
const CLOSURE_SCRIPT = join(REPO_ROOT, 'scripts', 'affected-bundle-closure.mjs');

/**
 * EVERY hook `install-git-hooks.mjs` expects — READ FROM THE INSTALLER, never
 * restated here.
 *
 * The installer treats a missing member of its `EXPECTED_HOOKS` as a hard error
 * ("the workspace tree is incomplete", `process.exit(1)`), so a fixture that lays
 * down only `pre-commit` breaks the install test the moment the hook SET grows.
 * That is what adding `post-rewrite` did: this suite went red in CI while BOTH
 * hook suites passed in isolation, because the coupling is between the
 * installer's expectations and this fixture — not between the hooks. The
 * installer's own comment says "Add new hooks here", and nothing told the fixture.
 *
 * Derived, so the next hook needs no edit in this file. A parse failure THROWS: a
 * reader that silently fell back to `['pre-commit']` would restore exactly the
 * drift it exists to prevent.
 */
const EXPECTED_HOOKS = (() => {
    const src = readFileSync(INSTALL_SCRIPT, 'utf-8');
    const block = src.match(/EXPECTED_HOOKS\s*=\s*\[([^\]]*)\]/);
    if (!block) {
        throw new Error(
            `[git-hooks-cli-bundle-staleness] could not read EXPECTED_HOOKS from ${INSTALL_SCRIPT}. ` +
                `The declaration moved or changed shape — update this reader; do NOT hardcode the hook list.`,
        );
    }
    const names = [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
    if (!names.length) {
        throw new Error(`[git-hooks-cli-bundle-staleness] EXPECTED_HOOKS parsed to an empty list`);
    }
    return names;
})();

/**
 * Lay down the minimum repository skeleton the hook walks:
 *   - `.git` (real, via `git init`)
 *   - `.githooks/*` — every hook in the installer's EXPECTED_HOOKS, copied from
 *     the real workspace hooks (`pre-commit` is the one under test here; the rest
 *     are present because the install test runs the real installer, which refuses
 *     an incomplete hooks dir)
 *   - `packages/infra/cli/src/index.ts` + `dist/affected.gjs.mjs`
 *   - `node_modules/.bin/gjsify` — synthetic stub recording its argv to a log
 *   - `scripts/affected-bundle-closure.mjs` — THE REAL SCRIPT, plus enough
 *     `package.json` manifests for its walk to have something to walk
 *
 * The stub is wired into PATH via `node_modules/.bin` so the hook's resolver
 * picks it up first.
 *
 * The manifests are what make these tests test the CLOSURE. Without them the
 * walk finds no `@gjsify/cli`, the hook takes its four-path fallback, and every
 * assertion here still passes — the fallback names `cli/src` too. That is not a
 * hypothetical: the fixture had no manifests when the closure trigger landed, so
 * the closure walk was never once exercised by this suite (#1149). Any package
 * added below has to be REACHABLE from `@gjsify/cli`'s dependencies, or it is
 * outside the closure and the hook is right to ignore it.
 *
 * `closureScript` picks which of the three states the hook must survive:
 *   'real'    — the shipped script (the normal case)
 *   'missing' — no `scripts/` at all, which the hook's existence guard catches
 *   'broken'  — present but exits non-zero, which ONLY the `|| true` on the
 *               command substitution catches, because under `set -e` a failing
 *               substitution in an assignment aborts the shell
 *
 * The last two are separate states on purpose. Both guards produce the same
 * fallback, so a single test passes with either one removed and pins neither —
 * measured, both A/B breaks stayed green until this split.
 */
function setupSyntheticRepo(parent, { closureScript = 'real' } = {}) {
    const root = mkdtempSync(join(parent, 'gh-hooks-'));
    // Init git WITHOUT global hook-path inheritance (otherwise the parent
    // workspace's core.hooksPath setting would leak in).
    execFileSync('git', ['init', '-q', '-b', 'main', root], { stdio: 'pipe' });
    execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'test']);
    execFileSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false']);

    // Workspace tree the hook expects. ALL expected hooks are laid down, not just
    // `pre-commit`: the install test below runs the real installer, which refuses
    // an incomplete `.githooks/`. Copying the real hooks rather than writing stubs
    // keeps the fixture honest — and is safe for the other tests here, which only
    // ever `git commit` (a `post-rewrite` hook fires on rebase / --amend, neither
    // of which this suite performs).
    mkdirSync(join(root, '.githooks'), { recursive: true });
    for (const hook of EXPECTED_HOOKS) {
        const source = join(REPO_ROOT, '.githooks', hook);
        if (!existsSync(source)) {
            throw new Error(
                `[git-hooks-cli-bundle-staleness] install-git-hooks.mjs expects ${hook} but ` +
                    `${source} does not exist — the workspace tree really is incomplete.`,
            );
        }
        cpSync(source, join(root, '.githooks', hook));
        chmodSync(join(root, '.githooks', hook), 0o755);
    }
    execFileSync('git', ['-C', root, 'config', 'core.hooksPath', '.githooks']);

    mkdirSync(join(root, 'packages', 'infra', 'cli', 'src'), { recursive: true });
    mkdirSync(join(root, 'packages', 'infra', 'cli', 'dist'), { recursive: true });
    writeFileSync(join(root, 'packages', 'infra', 'cli', 'src', 'index.ts'), `export const v = 1;\n`);
    writeFileSync(join(root, 'packages', 'infra', 'cli', 'dist', 'affected.gjs.mjs'), `// initial affected bundle\n`);

    // Manifests for the closure walk. `semver` is the interesting one: it is a
    // dependency of the CLI and therefore inlined into the bundle, and it is NOT
    // one of the four paths the hook falls back to — so a test that fires on it
    // can only be passing through the closure.
    const manifest = (dir, name, deps) => {
        mkdirSync(join(root, dir, 'src'), { recursive: true });
        writeFileSync(join(root, dir, 'package.json'), `${JSON.stringify({ name, dependencies: deps }, null, 2)}\n`);
    };
    manifest('packages/infra/cli', '@gjsify/cli', {
        '@gjsify/semver': '*',
        '@gjsify/rolldown-plugin-gjsify': '*',
    });
    manifest('packages/infra/semver', '@gjsify/semver', {});
    manifest('packages/infra/rolldown-plugin-gjsify', '@gjsify/rolldown-plugin-gjsify', {});
    // Outside the closure: nothing depends on it. Present so a trigger that fired
    // on all of `packages/` — the failure mode of widening the list — is visible.
    manifest('packages/web/unrelated', '@gjsify/unrelated', {});

    if (closureScript !== 'missing') {
        mkdirSync(join(root, 'scripts'), { recursive: true });
        const dest = join(root, 'scripts', 'affected-bundle-closure.mjs');
        if (closureScript === 'broken') {
            // Stands in for any way the walk can fail on a real host: an unparsable
            // manifest, a git call that errors, a rename this fixture has not caught
            // up with. What matters is the exit code, not the reason.
            writeFileSync(dest, `process.stderr.write('synthetic closure failure\\n');\nprocess.exit(1);\n`);
        } else {
            cpSync(CLOSURE_SCRIPT, dest);
        }
    }

    // The build pipeline the CLI bundle INLINES. A resolver change here is
    // silently absent from `dist/affected.gjs.mjs` until it is rebuilt, so the hook
    // treats it exactly like `cli/src/`.
    mkdirSync(join(root, 'packages', 'infra', 'rolldown-plugin-gjsify', 'src', 'plugins'), { recursive: true });
    writeFileSync(
        join(root, 'packages', 'infra', 'rolldown-plugin-gjsify', 'src', 'plugins', 'alias.ts'),
        `export const aliasPlugin = () => ({ name: 'gjsify-alias' });\n`,
    );

    // Synthetic `gjsify` stub on PATH. Records its argv to a log + REWRITES
    // the appropriate `dist/<bundle>.gjs.mjs` so we can assert the hook
    // re-stages the new content (instead of the stale committed bytes).
    mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
    const logPath = join(root, '.gjsify-stub.log');
    // Argv shape: gjsify workspace <pkg> <script>
    // So $1=workspace, $2=<pkg>, $3=<script>.
    const stub = `#!/usr/bin/env bash
echo "$@" >> "${logPath}"
if [ "$1" = "workspace" ] && [ "$2" = "@gjsify/cli" ] && [ "$3" = "build:affected-bundle" ]; then
    echo "// rebuilt affected bundle $(date +%s%N)" > "${root}/packages/infra/cli/dist/affected.gjs.mjs"
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

/**
 * Everything the hook printed, from BOTH streams.
 *
 * Measured: `git commit` forwards a hook's stdout to git's own STDERR, so
 * `result.stdout` is empty for every line the hook echoes. An assertion written
 * against `result.stdout` therefore passes no matter what the hook said — a
 * vacuous green. Which stream git picks is git's business and could change; the
 * hook only promises to say the thing, so assert over the union.
 */
function hookOutput(result) {
    return `${result.stdout ?? ''}${result.stderr ?? ''}`;
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

describe('git pre-commit hook — affected.gjs.mjs staleness', { timeout: 2 * 60 * 1000 }, () => {
    let parent;

    before(() => {
        parent = mkdtempSync(join(tmpdir(), 'gjsify-e2e-githooks-'));
    });

    after(() => {
        // force:true already makes a missing dir a no-op — any other failure
        // (EACCES) should fail the suite loudly, not vanish.
        rmSync(parent, { recursive: true, force: true });
    });

    it('is a no-op for unrelated staged changes', () => {
        const { root, logPath } = setupSyntheticRepo(parent);
        writeFileSync(join(root, 'README.md'), '# unrelated\n');
        execFileSync('git', ['-C', root, 'add', 'README.md']);

        const result = runHook(root);
        assert.equal(result.status, 0, `hook failed: ${result.stderr}`);
        assert.deepEqual(readLog(logPath), [], `hook should not have invoked gjsify, got: ${hookOutput(result)}`);
    });

    it('auto-rebuilds + auto-stages dist/affected.gjs.mjs when packages/infra/cli/src/ changes', () => {
        const { root, logPath } = setupSyntheticRepo(parent);
        const initialBundle = readFileSync(join(root, 'packages/infra/cli/dist/affected.gjs.mjs'), 'utf-8');

        writeFileSync(join(root, 'packages/infra/cli/src/index.ts'), `export const v = 2;\n`);
        execFileSync('git', ['-C', root, 'add', 'packages/infra/cli/src/index.ts']);

        const result = runHook(root);
        assert.equal(result.status, 0, `hook failed: ${result.stderr}`);

        const invocations = readLog(logPath);
        // Two gjsify calls — `build` (the lib/ the bundle is made from), then
        // `build:affected-bundle`. `build:gjs-bundle` left this sequence with
        // ADR 0002: `cli.gjs.mjs` is no longer committed, so there is nothing
        // for the hook to re-stage.
        assert.equal(invocations.length, 2, `expected 2 gjsify invocations, got: ${invocations.join(' / ')}`);
        // `--with-dependencies` is asserted, not incidental. The bundle is built
        // from the CLI's `lib/` AND its dependencies', and nothing forces those to
        // be current — without the flag the hook rebuilt against a stale
        // resolve-npm/rolldown-plugin-gjsify and staged a bundle CI could not
        // reproduce (#1093). Pinning the exact command is what stops that being
        // dropped again by someone simplifying the line.
        //
        // `--cached` is pinned for a narrower reason, stated so nobody reads it
        // as the fix for #1100 — measured, it is not: with CLI source edited,
        // which is the only state that FIRES this hook, it saves 336 s → 304 s.
        // What it saves is the RE-RUN over unchanged sources (`--amend`, a retry
        // after a rejected message): 336 s → 2.5 s. Pinned because that is a
        // silent property — dropping the flag breaks no assertion, it just makes
        // every amend slow again.
        assert.equal(invocations[0], 'workspace @gjsify/cli build --with-dependencies --cached');
        assert.equal(invocations[1], 'workspace @gjsify/cli build:affected-bundle');

        // The rebuilt bundle must be in the just-recorded commit.
        const filesInCommit = execFileSync(
            'git',
            ['-C', root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
            { encoding: 'utf-8' },
        )
            .trim()
            .split('\n');
        assert.ok(
            filesInCommit.includes('packages/infra/cli/dist/affected.gjs.mjs'),
            `dist/affected.gjs.mjs not in commit; saw: ${filesInCommit.join(', ')}`,
        );
        assert.ok(
            filesInCommit.includes('packages/infra/cli/src/index.ts'),
            `src/index.ts not in commit; saw: ${filesInCommit.join(', ')}`,
        );

        const finalBundle = readFileSync(join(root, 'packages/infra/cli/dist/affected.gjs.mjs'), 'utf-8');
        assert.notEqual(finalBundle, initialBundle, 'cli bundle was not refreshed by the rebuild');
    });

    it('auto-rebuilds when packages/infra/rolldown-plugin-gjsify/src/ changes', () => {
        // The committed `dist/affected.gjs.mjs` inlines the whole build pipeline, and
        // `node_modules/.bin/gjsify` prefers that bundle over the workspace
        // `lib/` whenever `gjs` is on PATH. Without this trigger a resolver fix
        // (the `aliasPlugin` virtual-module scoping guard is the case that
        // surfaced it) appears to change nothing at all locally — no error, just
        // the old behaviour — and every e2e booting the bundle keeps exercising
        // the stale pipeline.
        const { root, logPath } = setupSyntheticRepo(parent);
        const initialBundle = readFileSync(join(root, 'packages/infra/cli/dist/affected.gjs.mjs'), 'utf-8');

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
            'workspace @gjsify/cli build --with-dependencies --cached',
            'workspace @gjsify/cli build:affected-bundle',
        ]);

        // The rebuild is only half the property — the refreshed bundle has to be
        // IN the commit the hook just let through, or the next checkout carries
        // the stale bytes anyway.
        const filesInCommit = execFileSync(
            'git',
            ['-C', root, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'],
            { encoding: 'utf-8' },
        )
            .trim()
            .split('\n');
        assert.ok(
            filesInCommit.includes('packages/infra/cli/dist/affected.gjs.mjs'),
            `dist/affected.gjs.mjs not in commit; saw: ${filesInCommit.join(', ')}`,
        );
        assert.notEqual(
            readFileSync(join(root, 'packages/infra/cli/dist/affected.gjs.mjs'), 'utf-8'),
            initialBundle,
            'affected bundle was not refreshed by the rebuild',
        );
    });

    it('fires for a closure package the four-path fallback never named', () => {
        // The whole point of #1149. `packages/infra/semver` is inlined into the
        // bundle because the CLI depends on it, and the old hand-listed trigger did
        // not name it — so this commit used to go out with a stale bundle and cost a
        // CI round-trip. If the closure walk ever silently stops working, the
        // fallback takes over and THIS is the test that goes red; the `cli/src` ones
        // would stay green, because the fallback names that path too.
        const { root, logPath } = setupSyntheticRepo(parent);

        const depSrc = 'packages/infra/semver/src/index.ts';
        writeFileSync(join(root, depSrc), `export const parse = (v) => v;\n`);
        execFileSync('git', ['-C', root, 'add', depSrc]);

        const result = runHook(root);
        assert.equal(result.status, 0, `hook failed: ${result.stderr}`);
        assert.ok(
            !hookOutput(result).includes('falling back'),
            `the hook fell back instead of walking the closure: ${hookOutput(result)}`,
        );
        assert.deepEqual(readLog(logPath), [
            'workspace @gjsify/cli build --with-dependencies --cached',
            'workspace @gjsify/cli build:affected-bundle',
        ]);
    });

    it('stays silent for a package OUTSIDE the closure', () => {
        // The other half of the same property, and the risk in widening a trigger:
        // firing on all of `packages/` would make every commit pay a 300 s rebuild.
        // Nothing depends on `@gjsify/unrelated`, so it is not in the bundle.
        const { root, logPath } = setupSyntheticRepo(parent);

        const outside = 'packages/web/unrelated/src/index.ts';
        writeFileSync(join(root, outside), `export const x = 1;\n`);
        execFileSync('git', ['-C', root, 'add', outside]);

        const result = runHook(root);
        assert.equal(result.status, 0, `hook failed: ${result.stderr}`);
        assert.deepEqual(readLog(logPath), [], `hook rebuilt for a non-closure package: ${hookOutput(result)}`);
    });

    it('falls back to the four known inputs — and still commits — when the closure cannot be computed', () => {
        // The fallback was written for this case and was UNREACHABLE in it: under
        // `set -e`, the failing command substitution aborted the hook, so a tree
        // without the script could not commit at all. The fixture reproduces that
        // tree by omitting the script, which is why this test exists rather than a
        // comment claiming the branch works.
        // The REASON is asserted per state, not just the fact of falling back. The
        // `|| true` alone keeps the commit alive in both states, so an assertion on
        // the announcement text is what distinguishes the named guard from the
        // catch-all — without it, deleting the existence check changes nothing
        // observable and the message quietly degrades to the generic one.
        const expectedReason = { missing: 'not found', broken: 'produced no paths' };

        for (const closureScript of ['missing', 'broken']) {
            const { root, logPath } = setupSyntheticRepo(parent, { closureScript });

            writeFileSync(join(root, 'packages/infra/cli/src/index.ts'), `export const v = 5;\n`);
            execFileSync('git', ['-C', root, 'add', 'packages/infra/cli/src/index.ts']);

            const result = runHook(root);
            assert.equal(result.status, 0, `[${closureScript}] hook failed instead of falling back: ${result.stderr}`);
            assert.ok(
                hookOutput(result).includes('could not compute the affected-bundle closure'),
                `[${closureScript}] the fallback did not announce itself: ${hookOutput(result)}`,
            );
            assert.ok(
                hookOutput(result).includes(expectedReason[closureScript]),
                `[${closureScript}] expected the reason to name "${expectedReason[closureScript]}": ${hookOutput(result)}`,
            );
            // Degraded, not disabled: the four known inputs still fire.
            assert.deepEqual(
                readLog(logPath),
                [
                    'workspace @gjsify/cli build --with-dependencies --cached',
                    'workspace @gjsify/cli build:affected-bundle',
                ],
                `[${closureScript}] the fallback did not rebuild`,
            );
        }
    });

    it('skips the rebuild when SKIP_GJSIFY_HOOKS=1', () => {
        const { root, logPath } = setupSyntheticRepo(parent);
        const initialBundle = readFileSync(join(root, 'packages/infra/cli/dist/affected.gjs.mjs'), 'utf-8');

        writeFileSync(join(root, 'packages/infra/cli/src/index.ts'), `export const v = 3;\n`);
        execFileSync('git', ['-C', root, 'add', 'packages/infra/cli/src/index.ts']);

        const result = runHook(root, { SKIP_GJSIFY_HOOKS: '1' });
        assert.equal(result.status, 0, `hook failed: ${result.stderr}`);
        assert.deepEqual(readLog(logPath), [], 'SKIP_GJSIFY_HOOKS=1 should suppress rebuild');

        const finalBundle = readFileSync(join(root, 'packages/infra/cli/dist/affected.gjs.mjs'), 'utf-8');
        assert.equal(finalBundle, initialBundle, 'cli bundle should not have been refreshed under SKIP_GJSIFY_HOOKS=1');
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
