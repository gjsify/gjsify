// E2E test for the `.githooks/post-rewrite` hook that WARNS when a history
// rewrite may have staled a committed GJS bundle.
//
// The failure being closed (measured, PR #897): the only conflicting file in a
// rebase was `packages/infra/cli/dist/cli.gjs.mjs` — a derived artifact — so it
// was resolved by taking one side and rebuilding. The rebased tree then carried
// `main`'s source changes while the committed bundle had been built against the
// OLD base, so the artifact no longer reproduced from its source. Nothing local
// saw it: tsc / lint / format / audit-runtimes / 1597 unit tests all stayed
// green because none of them executes the emitted GJS bundle, and the only
// thing that does (`scripts/verify-committed-bundles.mjs`, ~9 min) runs in
// `main.yml`'s build job — after the push. `.githooks/pre-commit` structurally
// cannot help: it triggers on STAGED paths and a rebase stages nothing.
//
// So these tests DRIVE A REAL REBASE / `--amend` and assert on the hook's
// output. Grepping the hook's text would prove nothing about whether git
// actually invokes it, whether the stdin pair format is read correctly, or
// whether the two bases are derived from the right commits — which is the
// entire mechanism.
//
// The workspace closure oracle is stubbed as a fake `gjs` on PATH plus a
// placeholder `dist/affected.gjs.mjs`, so the hook takes its REAL preferred
// code path (`gjs -m <classifier> --changed-from-stdin --format=globs`) against
// canned answers. The canned answers are not invented: they mirror the four
// cases measured against the real committed classifier, and the last test in
// this file re-measures them so the stub cannot drift away from reality.

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const HOOK_SOURCE = join(REPO_ROOT, '.githooks', 'post-rewrite');
const REAL_CLASSIFIER = join(REPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'affected.gjs.mjs');

/**
 * Stub classifier. Reads a newline-separated file list on stdin and prints the
 * affected workspace names, one per line — the `--format=globs` contract.
 *
 * The mapping reproduces what the REAL committed classifier answers (measured;
 * re-asserted by the last test in this file):
 *   packages/node/fs/**            → @gjsify/cli IS affected  (fs is in the CLI closure)
 *   packages/infra/tsc/src/**      → @gjsify/tsc AND @gjsify/cli
 *   packages/dom/canvas2d-core/**  → a closure that does NOT contain @gjsify/cli
 *   docs/**.md, website/**         → ignored-only, empty output
 */
const GJS_STUB = `#!/usr/bin/env bash
# Fake gjs. Argv shape: gjs -m <bundle> --changed-from-stdin --format=globs
files="$(cat)"
out=""
if echo "$files" | grep -qE '^packages/(node/fs|infra/cli/src|infra/resolve-npm)/'; then
    out="$out@gjsify/cli\\n"
fi
if echo "$files" | grep -qE '^packages/infra/tsc/src/'; then
    out="$out@gjsify/tsc\\n@gjsify/cli\\n"
fi
if echo "$files" | grep -qE '^packages/dom/canvas2d-core/'; then
    out="$out@gjsify/canvas2d-core\\n@gjsify/example-dom-canvas2d-text\\n"
fi
printf "%b" "$out" | grep -v '^$' | sort -u
exit 0
`;

/**
 * Minimum repository skeleton the hook walks:
 *   - a real `git init` repo with `core.hooksPath = .githooks`
 *   - `.githooks/post-rewrite` copied from the hook under test
 *   - `scripts/verify-committed-bundles.mjs` (the hook's "am I in gjsify" marker)
 *   - the three committed bundles it discovers via `git ls-tree`
 *   - `packages/infra/{cli,tsc}/package.json` so `owner_of` resolves a name
 *   - a `gjs` stub on PATH (via `stub-bin/`)
 *   - a `main` branch to rebase onto, plus a `feat` branch
 */
function setupRepo(parent, { withClassifier = true } = {}) {
    const root = mkdtempSync(join(parent, 'post-rewrite-'));
    execFileSync('git', ['init', '-q', '-b', 'main', root], { stdio: 'pipe' });
    execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', root, 'config', 'user.name', 'test']);
    execFileSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false']);
    execFileSync('git', ['-C', root, 'config', 'core.hooksPath', '.githooks']);

    const write = (rel, content) => {
        const abs = join(root, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
        return abs;
    };

    mkdirSync(join(root, '.githooks'), { recursive: true });
    cpSync(HOOK_SOURCE, join(root, '.githooks', 'post-rewrite'));
    chmodSync(join(root, '.githooks', 'post-rewrite'), 0o755);

    // The marker that tells the hook it is inside the gjsify workspace.
    write('scripts/verify-committed-bundles.mjs', '// stand-in for the real verifier\n');

    // Committed bundles — discovered by the hook from `git ls-tree` via the
    // `.gjs.mjs` + `dist/` component rule.
    write('packages/infra/cli/dist/cli.gjs.mjs', '// committed cli bundle v1\n');
    write('packages/infra/cli/dist/affected.gjs.mjs', '// committed affected bundle v1\n');
    write('packages/infra/tsc/dist/tsc.gjs.mjs', '// committed tsc bundle v1\n');
    // NOT a committed bundle: no `dist/` component. Must never be picked up.
    write('docs/poc/tla-microtask-draining.gjs.mjs', '// hand-written sample\n');

    write('packages/infra/cli/package.json', JSON.stringify({ name: '@gjsify/cli', version: '0.0.0' }, null, 4));
    write('packages/infra/tsc/package.json', JSON.stringify({ name: '@gjsify/tsc', version: '0.0.0' }, null, 4));

    // Sources used by the tests.
    write('packages/node/fs/src/index.ts', 'export const fs = 1;\n');
    write('packages/infra/cli/src/index.ts', 'export const cli = 1;\n');
    write('packages/infra/tsc/src/index.ts', "export const TYPESCRIPT_VERSION = '0';\n");
    write('packages/dom/canvas2d-core/src/index.ts', 'export const c2d = 1;\n');
    write('docs/notes.md', '# notes\n');
    write('README.md', '# root\n');

    // `gjs` stub. Placed in `stub-bin/` which the test prepends to PATH, so the
    // hook's `command -v gjs` finds it instead of any real gjs.
    const stubBin = join(root, 'stub-bin');
    mkdirSync(stubBin, { recursive: true });
    const gjsPath = join(stubBin, 'gjs');
    writeFileSync(gjsPath, GJS_STUB);
    chmodSync(gjsPath, 0o755);

    execFileSync('git', ['-C', root, 'add', '-A']);
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'initial', '--no-verify']);

    if (!withClassifier) {
        // Remove the classifier bundle so the oracle ladder has to fall through.
        execFileSync('git', ['-C', root, 'rm', '-q', 'packages/infra/cli/dist/affected.gjs.mjs']);
        execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'drop classifier', '--no-verify']);
    }

    execFileSync('git', ['-C', root, 'branch', 'feat']);
    return { root, stubBin };
}

/** Commit `changes` ({ relPath: content }) on the current branch. */
function commitChange(root, message, changes) {
    for (const [rel, content] of Object.entries(changes)) {
        const abs = join(root, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
    }
    execFileSync('git', ['-C', root, 'add', '-A']);
    execFileSync('git', ['-C', root, 'commit', '-q', '-m', message, '--no-verify']);
}

function checkout(root, ref) {
    execFileSync('git', ['-C', root, 'checkout', '-q', ref]);
}

/**
 * The change set of a branch that edited `@gjsify/cli` source and rebuilt its
 * bundles — i.e. what `.githooks/pre-commit` actually stages: BOTH
 * `dist/cli.gjs.mjs` and `dist/affected.gjs.mjs`. Committing only one of the two
 * is itself a staleness this hook reports (see the sibling-bundle test), so the
 * realistic fixture has to include both or every negative test picks up that
 * true positive instead of the case it means to check.
 */
function cliRebuilt(note = '') {
    const suffix = note ? ` (${note})` : '';
    return {
        'packages/infra/cli/src/index.ts': 'export const cli = 2;\n',
        'packages/infra/cli/dist/cli.gjs.mjs': `// committed cli bundle v2${suffix}\n`,
        'packages/infra/cli/dist/affected.gjs.mjs': `// committed affected bundle v2${suffix}\n`,
    };
}

/**
 * Run a real `git rebase <onto>`; return its combined output. The hook writes to
 * stderr, so both streams are captured.
 */
function rebase(root, stubBin, onto, envOverrides = {}) {
    const r = spawnSync('git', ['-C', root, 'rebase', onto], {
        encoding: 'utf-8',
        env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}`, ...envOverrides },
    });
    assert.equal(r.status, 0, `rebase failed (the hook must never break it): ${r.stderr}`);
    return `${r.stdout}${r.stderr}`;
}

function amend(root, stubBin, message, changes = {}) {
    for (const [rel, content] of Object.entries(changes)) {
        const abs = join(root, rel);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, content);
    }
    execFileSync('git', ['-C', root, 'add', '-A']);
    const r = spawnSync('git', ['-C', root, 'commit', '-q', '--amend', '--no-verify', '-m', message], {
        encoding: 'utf-8',
        env: { ...process.env, PATH: `${stubBin}:${process.env.PATH}` },
    });
    assert.equal(r.status, 0, `amend failed: ${r.stderr}`);
    return `${r.stdout}${r.stderr}`;
}

describe('git post-rewrite hook — committed-bundle staleness after a rewrite', { timeout: 3 * 60 * 1000 }, () => {
    let parent;

    before(() => {
        parent = mkdtempSync(join(tmpdir(), 'gjsify-e2e-post-rewrite-'));
    });

    after(() => {
        rmSync(parent, { recursive: true, force: true });
    });

    it('REBASED-UNDER: warns when a rebase moves closure source under a committed bundle (the #897 case)', () => {
        const { root, stubBin } = setupRepo(parent);

        // main advances with a change to source the CLI bundle inlines.
        commitChange(root, 'main: touch @gjsify/fs', {
            'packages/node/fs/src/index.ts': 'export const fs = 2;\n',
        });

        // The branch rebuilt + committed the bundle against the OLD base.
        checkout(root, 'feat');
        commitChange(root, 'feat: rebuild cli bundles', cliRebuilt('built on the OLD base'));

        const out = rebase(root, stubBin, 'main');

        assert.match(out, /a committed GJS bundle may now be STALE/, `expected a warning, got:\n${out}`);
        assert.match(out, /REBASED-UNDER/, `expected the REBASED-UNDER verdict, got:\n${out}`);
        assert.match(out, /packages\/infra\/cli\/dist\/cli\.gjs\.mjs/);
        // The exact command a human must run, and the reason not to rebuild here.
        assert.match(out, /node scripts\/verify-committed-bundles\.mjs/);
        assert.match(out, /does NOT rebuild/);
        // Provenance of the verdict must be stated.
        assert.match(out, /affected classifier/);
        // The rewrite itself still succeeded.
        assert.equal(
            execFileSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim(),
            'feat',
        );
    });

    it('does NOT warn when the rebase moves only source OUTSIDE the bundle closure', () => {
        // Same shape as the #897 case in every respect except one: the base
        // delta is a workspace the CLI bundle does not inline. This is the test
        // that keeps the hook from crying wolf on every rebase — without it, a
        // "warn on any rebase that touched packages/" implementation passes the
        // positive test above just as well.
        const { root, stubBin } = setupRepo(parent);

        commitChange(root, 'main: touch canvas2d-core', {
            'packages/dom/canvas2d-core/src/index.ts': 'export const c2d = 2;\n',
        });

        checkout(root, 'feat');
        commitChange(root, 'feat: rebuild cli bundles', cliRebuilt());

        const out = rebase(root, stubBin, 'main');
        assert.doesNotMatch(out, /a committed GJS bundle may now be STALE/, `unexpected warning:\n${out}`);
    });

    it('does NOT warn when the rebase moves only ignored files (docs/README)', () => {
        const { root, stubBin } = setupRepo(parent);

        commitChange(root, 'main: docs only', { 'docs/notes.md': '# notes v2\n', 'README.md': '# root v2\n' });

        checkout(root, 'feat');
        commitChange(root, 'feat: rebuild cli bundles', cliRebuilt());

        const out = rebase(root, stubBin, 'main');
        assert.doesNotMatch(out, /a committed GJS bundle may now be STALE/, `unexpected warning:\n${out}`);
    });

    it('does NOT warn for a rebase of a branch that touches nothing bundle-related', () => {
        const { root, stubBin } = setupRepo(parent);

        commitChange(root, 'main: touch @gjsify/fs', {
            'packages/node/fs/src/index.ts': 'export const fs = 2;\n',
        });

        // The branch does not commit any bundle, so after the rebase it simply
        // carries main's (fresh) bundles. Nothing to warn about — and this is
        // the common case, so a warning here would train the hook away.
        checkout(root, 'feat');
        commitChange(root, 'feat: docs', { 'docs/notes.md': '# branch notes\n' });

        const out = rebase(root, stubBin, 'main');
        assert.doesNotMatch(out, /a committed GJS bundle may now be STALE/, `unexpected warning:\n${out}`);
    });

    it('NOT-REBUILT: warns when the branch changes closure source without committing the bundle', () => {
        // This is the shape `pre-commit` misses: `packages/node/fs/` is not on
        // its four-path trigger list, so nothing rebuilt or complained, yet the
        // CLI bundle inlines @gjsify/fs.
        const { root, stubBin } = setupRepo(parent);

        checkout(root, 'feat');
        commitChange(root, 'feat: change @gjsify/fs', {
            'packages/node/fs/src/index.ts': 'export const fs = 9;\n',
        });

        const out = amend(root, stubBin, 'feat: change @gjsify/fs (amended)');

        assert.match(out, /a committed GJS bundle may now be STALE/, `expected a warning, got:\n${out}`);
        assert.match(out, /NOT-REBUILT/, `expected the NOT-REBUILT verdict, got:\n${out}`);
        assert.match(out, /packages\/infra\/cli\/dist\/cli\.gjs\.mjs/);
        assert.match(out, /packages\/infra\/cli\/dist\/affected\.gjs\.mjs/);
        // @gjsify/tsc is not downstream of @gjsify/fs, so its bundle stays quiet.
        assert.doesNotMatch(out, /packages\/infra\/tsc\/dist\/tsc\.gjs\.mjs/);
    });

    it('NOT-REBUILT: names the SIBLING bundle when only one of a pair was rebuilt', () => {
        // `pre-commit` rebuilds `dist/cli.gjs.mjs` AND `dist/affected.gjs.mjs`
        // from the same `src/`, precisely so the dedicated classifier cannot
        // drift from the affected logic. Rebuild one by hand and the other is
        // silently stale — the per-artifact verdict catches that, where a
        // per-workspace one would not.
        const { root, stubBin } = setupRepo(parent);

        checkout(root, 'feat');
        commitChange(root, 'feat: rebuild only cli.gjs.mjs', {
            'packages/infra/cli/src/index.ts': 'export const cli = 2;\n',
            'packages/infra/cli/dist/cli.gjs.mjs': '// committed cli bundle v2\n',
        });

        const out = amend(root, stubBin, 'feat: rebuild only cli.gjs.mjs (amended)');
        assert.match(out, /NOT-REBUILT/, `expected the NOT-REBUILT verdict, got:\n${out}`);
        assert.match(out, /packages\/infra\/cli\/dist\/affected\.gjs\.mjs/);
        // The one that WAS rebuilt must not be listed as not-rebuilt.
        const notRebuiltBlock = out.slice(out.indexOf('NOT-REBUILT'));
        assert.doesNotMatch(
            notRebuiltBlock.slice(0, notRebuiltBlock.indexOf('This hook does NOT rebuild')),
            /cli\.gjs\.mjs/,
            `the rebuilt bundle was listed as not-rebuilt:\n${out}`,
        );
    });

    it('an --amend that only rewords is silent (no tree change, no moved base)', () => {
        const { root, stubBin } = setupRepo(parent);
        checkout(root, 'feat');
        commitChange(root, 'feat: docs', { 'docs/notes.md': '# branch notes\n' });

        const out = amend(root, stubBin, 'feat: docs (reworded)');
        assert.doesNotMatch(out, /a committed GJS bundle may now be STALE/, `unexpected warning:\n${out}`);
    });

    it('never picks up a .gjs.mjs outside a dist/ directory', () => {
        // `docs/poc/tla-microtask-draining.gjs.mjs` is a hand-written sample, not
        // a build output. The hook's discovery rule must match the verifier's
        // (`.gjs.mjs` AND a `dist/` path component).
        const { root, stubBin } = setupRepo(parent);

        commitChange(root, 'main: touch @gjsify/fs', {
            'packages/node/fs/src/index.ts': 'export const fs = 2;\n',
        });

        checkout(root, 'feat');
        commitChange(root, 'feat: edit the poc sample', {
            'docs/poc/tla-microtask-draining.gjs.mjs': '// sample v2\n',
        });

        const out = rebase(root, stubBin, 'main');
        assert.doesNotMatch(out, /tla-microtask-draining/, `poc sample treated as a bundle:\n${out}`);
        assert.doesNotMatch(out, /a committed GJS bundle may now be STALE/, `unexpected warning:\n${out}`);
    });

    it('SKIP_GJSIFY_HOOKS=1 suppresses the warning', () => {
        const { root, stubBin } = setupRepo(parent);

        commitChange(root, 'main: touch @gjsify/fs', {
            'packages/node/fs/src/index.ts': 'export const fs = 2;\n',
        });
        checkout(root, 'feat');
        commitChange(root, 'feat: rebuild cli bundles', cliRebuilt());

        const out = rebase(root, stubBin, 'main', { SKIP_GJSIFY_HOOKS: '1' });
        assert.doesNotMatch(out, /a committed GJS bundle may now be STALE/, `unexpected warning:\n${out}`);
    });

    it('is silent outside the gjsify workspace (no verify-committed-bundles.mjs marker)', () => {
        const { root, stubBin } = setupRepo(parent);
        commitChange(root, 'main: touch @gjsify/fs', {
            'packages/node/fs/src/index.ts': 'export const fs = 2;\n',
        });
        checkout(root, 'feat');
        commitChange(root, 'feat: rebuild cli bundles', cliRebuilt());
        // Drop the marker: a `core.hooksPath` inherited from a global config must
        // not make this hook talk about bundles in somebody else's repo.
        execFileSync('git', ['-C', root, 'rm', '-q', 'scripts/verify-committed-bundles.mjs']);
        execFileSync('git', ['-C', root, 'commit', '-q', '-m', 'drop marker', '--no-verify']);

        const out = rebase(root, stubBin, 'main');
        assert.doesNotMatch(out, /a committed GJS bundle may now be STALE/, `unexpected warning:\n${out}`);
    });

    it('falls back to the path-prefix scan when NO closure oracle is reachable, and says so', () => {
        // The hook is best-effort: with no `gjs` + committed classifier and no
        // `gjsify` CLI it must still answer, using `pre-commit`'s four-path list
        // — and it must NAME that weaker basis, because silence from an
        // under-approximating scan would otherwise read as "all clear".
        //
        // Driven by invoking the hook directly with a PATH that contains only
        // the tools the hook itself uses. Shadowing cannot produce ABSENCE, so a
        // sanitized PATH is the only way to reach this branch; a real `git
        // rebase` is not needed here because the previous tests already prove
        // git invokes the hook with the right stdin.
        const { root } = setupRepo(parent, { withClassifier: false });

        commitChange(root, 'main: touch resolve-npm', {
            'packages/infra/resolve-npm/lib/globals-map.mjs': 'export const M = 2;\n',
        });
        checkout(root, 'feat');
        commitChange(root, 'feat: rebuild cli bundles', cliRebuilt());

        const oldTip = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
        // Rebase with hooks off, then replay the hook by hand over the real pairs.
        const reb = spawnSync('git', ['-C', root, 'rebase', 'main'], {
            encoding: 'utf-8',
            env: { ...process.env, SKIP_GJSIFY_HOOKS: '1' },
        });
        assert.equal(reb.status, 0, `rebase failed: ${reb.stderr}`);
        const newTip = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();

        // A PATH holding only what the hook execs — notably no gjs, no gjsify.
        const sanitized = join(root, 'sanitized-bin');
        mkdirSync(sanitized, { recursive: true });
        for (const tool of ['bash', 'env', 'git', 'grep', 'sed', 'head', 'wc', 'dirname', 'mktemp', 'rm', 'cat']) {
            const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf-8' }).stdout.trim();
            assert.ok(found, `test prerequisite missing from PATH: ${tool}`);
            symlinkSync(found, join(sanitized, tool));
        }
        // Probe with the SYMLINKED bash and an absolute path: a bare `sh` would
        // not be resolvable under the sanitized PATH, and spawn failing silently
        // yields `stdout === undefined` rather than a verdict.
        const sanitizedBash = join(sanitized, 'bash');
        assert.equal(
            spawnSync(sanitizedBash, ['-c', 'command -v gjs; command -v gjsify'], {
                encoding: 'utf-8',
                env: { PATH: sanitized },
            }).stdout.trim(),
            '',
            'sanitized PATH still exposes gjs/gjsify — the fallback branch would not be reached',
        );

        const r = spawnSync(sanitizedBash, [join(root, '.githooks', 'post-rewrite'), 'rebase'], {
            cwd: root,
            input: `${oldTip} ${newTip}\n`,
            encoding: 'utf-8',
            env: { PATH: sanitized, HOME: root },
        });
        assert.equal(r.status, 0, `hook exited non-zero: ${r.stderr}`);
        const out = `${r.stdout}${r.stderr}`;
        assert.match(out, /a committed GJS bundle may now be STALE/, `expected a warning, got:\n${out}`);
        assert.match(out, /NO closure oracle was reachable/, `fallback basis not disclosed:\n${out}`);
        assert.match(out, /UNDER-approximates/, `fallback weakness not disclosed:\n${out}`);
    });

    it('the real committed classifier still discriminates the way this hook assumes', () => {
        // The design rests on ONE property of `dist/affected.gjs.mjs`: a change
        // to a workspace in the CLI bundle's closure yields `@gjsify/cli`, and a
        // change outside it does not. If that ever stops holding, the hook
        // silently becomes either a wolf-crier or blind — and the stub above
        // would keep passing. So measure the real thing.
        if (!existsSync(REAL_CLASSIFIER)) {
            assert.fail(`committed classifier missing at ${REAL_CLASSIFIER}`);
        }
        const gjs = spawnSync('sh', ['-c', 'command -v gjs'], { encoding: 'utf-8' }).stdout.trim();
        if (!gjs) {
            // Deliberately not a silent skip of the whole suite: everything else
            // above is hermetic and still ran.
            console.log('[post-rewrite e2e] no gjs on PATH — skipping the real-classifier cross-check');
            return;
        }

        const classify = (files) => {
            const r = spawnSync(gjs, ['-m', REAL_CLASSIFIER, '--changed-from-stdin', '--format=globs'], {
                cwd: REPO_ROOT,
                input: `${files.join('\n')}\n`,
                encoding: 'utf-8',
            });
            assert.equal(r.status, 0, `classifier failed: ${r.stderr}`);
            return r.stdout.split('\n').filter(Boolean);
        };

        assert.ok(
            classify(['packages/node/fs/src/index.ts']).includes('@gjsify/cli'),
            'a @gjsify/fs change no longer reaches @gjsify/cli — the hook would go blind',
        );
        assert.ok(
            !classify(['packages/dom/canvas2d-core/src/index.ts']).includes('@gjsify/cli'),
            'a canvas2d-core change now reaches @gjsify/cli — the hook would cry wolf',
        );
        assert.deepEqual(classify(['website/src/pages/index.astro']), [], 'website/** is no longer ignored');
        assert.ok(
            classify(['packages/infra/tsc/src/index.ts']).includes('@gjsify/tsc'),
            'a @gjsify/tsc source change no longer reaches @gjsify/tsc',
        );
    });

    it('is wired: enumerated by install-git-hooks.mjs and registered in test:e2e', () => {
        // Two wiring facts that fail SILENTLY if they regress, which is why they
        // are asserted rather than trusted:
        //   * `scripts/install-git-hooks.mjs` enumerates the hook set explicitly
        //     (a glob would have shipped nothing), so a hook missing from
        //     EXPECTED_HOOKS is installed but never announced or checked for.
        //   * `scripts/e2e-shard.mjs` parses `package.json#scripts.test:e2e`
        //     instead of globbing `tests/e2e/*`, so an unregistered suite NEVER
        //     RUNS in CI. That has already happened once in this repo.
        assert.ok(existsSync(HOOK_SOURCE), '.githooks/post-rewrite missing');

        const installer = readFileSync(join(REPO_ROOT, 'scripts', 'install-git-hooks.mjs'), 'utf-8');
        assert.match(
            installer,
            /EXPECTED_HOOKS\s*=\s*\[[^\]]*'post-rewrite'/,
            'post-rewrite is not in install-git-hooks.mjs EXPECTED_HOOKS',
        );

        const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
        assert.match(
            pkg.scripts['test:e2e'],
            /tests\/e2e\/git-hooks-post-rewrite-bundle-guard\/run\.mjs/,
            'this suite is not in package.json#scripts.test:e2e — it would never run in CI',
        );
    });
});
