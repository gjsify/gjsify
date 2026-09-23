// E2E test for `scripts/decide-suite-scope.mjs` — may a pull request skip an OS-suite job?
//
// THE ASYMMETRY IS THE POINT. A skip that should have run is the expensive failure here: it
// is how #1209 merged green and left the win32 leg red for eight merges. So every narrowing
// case is paired with the shape that must still run, and the incidents the workflows'
// headers name are replayed as data: a change in `@gjsify/child_process`, `@gjsify/process`,
// `@gjsify/net` or `@gjsify/cli` must run the leg. A decision that always answered `run`
// passes those and fails the skips; one that always answered `skip` fails the rest.
//
// The last block asserts the wiring against the REAL workflow files, because a decision
// nothing gates on decides nothing: each heavy job must wait for `scope` and skip only on an
// explicit `false`, and the composite action must actually call this script.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// tests/e2e/ci-suite-scope/ → monorepo root is 3 levels up.
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(MONOREPO_ROOT, 'scripts', 'decide-suite-scope.mjs');
const { decide, namedPackages, namedPaths, withImportedScripts } = await import(pathToFileURL(SCRIPT).href);

const WORKFLOWS = ['macos-suites.yml', 'windows-suites.yml', 'gtk-os-suites.yml'];
const read = (rel) => readFileSync(join(MONOREPO_ROOT, rel), 'utf8');

const MACOS = '.github/workflows/macos-suites.yml';
const macosText = read(MACOS);

/** A classifier verdict, as `gjsify affected --format=json` prints it. */
const closure = (workspaces) => ({ global: false, skipAll: false, reason: 'closure', workspaces });
const IGNORED_ONLY = { global: false, skipAll: true, reason: 'ignored-only', workspaces: [] };
const GLOBAL = { global: true, skipAll: false, reason: 'global-trigger x', workspaces: ['@gjsify/fs'] };

const onMacos = (changed, affected, extra = {}) =>
    decide({
        event: 'pull_request',
        changed,
        affected,
        packages: [],
        workflowPath: MACOS,
        workflowText: macosText,
        ...extra,
    });

describe('decide-suite-scope: what a skip must prove', () => {
    it('a docs-and-website change skips', () => {
        const v = onMacos(['website/src/content/docs/a.mdx', 'docs/b.md'], IGNORED_ONLY);
        assert.equal(v.run, false, v.reason);
    });

    it('a renderer change whose closure misses every tested package skips', () => {
        const v = onMacos(
            ['packages/web/adwaita-web/src/elements/gtk-label.ts'],
            closure(['@gjsify/adwaita-web', '@gjsify/example-dom-adwaita']),
        );
        assert.equal(v.run, false, v.reason);
    });

    for (const pkg of ['@gjsify/child_process', '@gjsify/process', '@gjsify/net', '@gjsify/cli']) {
        it(`a change reaching ${pkg} runs (the incidents in the workflow headers)`, () => {
            const v = onMacos([`packages/node/x/src/index.ts`], closure(['@gjsify/x', pkg]));
            assert.equal(v.run, true);
            assert.match(v.reason, new RegExp(pkg));
        });
    }

    it('a classifier full run runs', () => {
        assert.equal(onMacos(['packages/infra/cli/src/a.ts'], GLOBAL).run, true);
    });

    it('a manifest anywhere runs — the suites build the workspace and audit manifests', () => {
        const v = onMacos(['packages/web/adwaita-web/package.json'], closure(['@gjsify/adwaita-web']));
        assert.equal(v.run, true, v.reason);
    });

    it('a package-local build script runs', () => {
        const v = onMacos(['packages/web/adwaita-web/scripts/build-scss.mjs'], closure(['@gjsify/adwaita-web']));
        assert.equal(v.run, true, v.reason);
    });

    it('the workflow file itself runs', () => {
        assert.equal(onMacos([MACOS], IGNORED_ONLY).run, true);
    });

    it('a script the workflow runs, and an e2e suite it runs, run', () => {
        assert.equal(onMacos(['scripts/npm-install-published.mjs'], IGNORED_ONLY).run, true);
        assert.equal(onMacos(['tests/e2e/library-blueprint/fixture/a.blp'], IGNORED_ONLY).run, true);
    });

    it('a path only a COMMENT names does not claim anything', () => {
        // windows-suites.yml mentions this spec in a comment, never in a step.
        const text = read('.github/workflows/windows-suites.yml');
        assert.ok(text.includes('capabilities.spec.ts'), 'fixture premise: the comment still exists');
        assert.ok(!namedPaths(text).some((p) => p.includes('capabilities.spec.ts')));
    });

    it('an extra own-inputs pattern runs', () => {
        const v = onMacos(['flatpak/x.json'], IGNORED_ONLY, { extra: /^flatpak\// });
        assert.equal(v.run, true);
    });
});

describe('decide-suite-scope: a step script brings its helpers', () => {
    const files = {
        'scripts/report-symlink-capability.mjs': "import { probe } from './symlink-probe.mjs';\n",
        'scripts/symlink-probe.mjs': "export { deep } from './lib/deeper.mjs';\n",
        'scripts/lib/deeper.mjs': "import '../../packages/node/fs/lib/index.js';\n",
    };
    const readText = (p) => files[p];

    it('a helper only a suite-run script imports is an input, transitively', () => {
        const all = withImportedScripts(['scripts/report-symlink-capability.mjs'], readText);
        assert.ok(all.includes('scripts/symlink-probe.mjs'));
        assert.ok(all.includes('scripts/lib/deeper.mjs'));
        // Outside scripts/ is the closure's business, not this list's.
        assert.ok(!all.some((p) => p.startsWith('packages/')));
        const v = decide({
            event: 'pull_request',
            changed: ['scripts/symlink-probe.mjs'],
            affected: IGNORED_ONLY,
            packages: [],
            workflowPath: '.github/workflows/windows-suites.yml',
            workflowText: read('.github/workflows/windows-suites.yml'),
            readText,
        });
        assert.equal(v.run, true, v.reason);
    });

    it('a script nothing the suite runs imports is not an input', () => {
        const all = withImportedScripts(['scripts/report-symlink-capability.mjs'], readText);
        assert.ok(!all.includes('scripts/unrelated.mjs'));
    });
});

describe('decide-suite-scope: the diff the action feeds it', () => {
    // A pure move out of a tested package into docs/ must list the SOURCE too. With
    // git's default rename detection `--name-only` prints only `docs/x.ts`, the change
    // reads as docs-only, and the suite that would have seen `@gjsify/os` break skips.
    it("the action's git diff lists both sides of a rename", () => {
        const action = read('.github/actions/suite-scope/action.yml');
        const line = action.split('\n').find((l) => /^\s*git diff .*--name-only/.test(l));
        assert.ok(line, 'the action no longer runs a `git diff --name-only`');
        const argv = line
            .trim()
            .replace(/\s*>.*$/, '')
            .replace(/"\$BASE\.\.\.HEAD"/, 'HEAD~1...HEAD')
            .split(/\s+/);
        assert.equal(argv[0], 'git');

        const repo = mkdtempSync(join(tmpdir(), 'ci-suite-scope-rename-'));
        try {
            const git = (...a) =>
                execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...a], {
                    cwd: repo,
                    encoding: 'utf8',
                });
            mkdirSync(join(repo, 'packages/node/os/src'), { recursive: true });
            mkdirSync(join(repo, 'docs'));
            writeFileSync(join(repo, 'packages/node/os/src/x.ts'), 'export const x = 1;\n'.repeat(40));
            git('init', '-q');
            git('add', '-A');
            git('commit', '-q', '-m', 'base');
            git('mv', 'packages/node/os/src/x.ts', 'docs/x.ts');
            git('commit', '-q', '-m', 'move');
            const listed = git(...argv.slice(1))
                .split('\n')
                .filter(Boolean);
            assert.ok(listed.includes('packages/node/os/src/x.ts'), `listed only: ${listed.join(', ')}`);
            assert.ok(listed.includes('docs/x.ts'));
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });
});

describe('decide-suite-scope: every unknown fails open', () => {
    it('a non-PR event runs', () => {
        for (const event of ['push', 'schedule', 'workflow_dispatch']) {
            assert.equal(
                decide({
                    event,
                    changed: ['docs/a.md'],
                    affected: IGNORED_ONLY,
                    packages: [],
                    workflowPath: MACOS,
                    workflowText: macosText,
                }).run,
                true,
            );
        }
    });

    it('an unreadable diff runs', () => {
        assert.equal(onMacos(undefined, IGNORED_ONLY).run, true);
        assert.equal(onMacos([], IGNORED_ONLY).run, true);
    });

    it('a missing or malformed classifier verdict runs', () => {
        assert.equal(onMacos(['docs/a.md'], undefined).run, true);
        assert.equal(onMacos(['docs/a.md'], { reason: 'x' }).run, true);
    });
});

describe('decide-suite-scope: the tested set is read off the workflow', () => {
    it('macos-suites names the Node-pillar packages it runs', () => {
        const names = namedPackages(macosText);
        for (const p of ['@gjsify/child_process', '@gjsify/process', '@gjsify/os', '@gjsify/net', '@gjsify/cli']) {
            assert.ok(names.includes(p), `${p} missing from ${names.join(' ')}`);
        }
    });

    it('gtk-os-suites names its layer and claims node-gi', () => {
        const text = read('.github/workflows/gtk-os-suites.yml');
        assert.ok(namedPackages(text).includes('@gjsify/gtk-host'));
        const v = decide({
            event: 'pull_request',
            changed: ['packages/node-gi/node-gi/src/value.cc'],
            affected: IGNORED_ONLY,
            packages: [],
            workflowPath: '.github/workflows/gtk-os-suites.yml',
            workflowText: text,
        });
        assert.equal(v.run, true, v.reason);
    });
});

describe('decide-suite-scope: the wiring in the real workflows', () => {
    const action = read('.github/actions/suite-scope/action.yml');

    it('the composite action calls this script', () => {
        assert.match(action, /node scripts\/decide-suite-scope\.mjs/);
    });

    for (const wf of WORKFLOWS) {
        it(`${wf}: every job except scope waits for it and skips only on an explicit false`, () => {
            const text = read(`.github/workflows/${wf}`);
            const jobsAt = text.indexOf('\njobs:\n');
            assert.ok(jobsAt > 0);
            const body = text.slice(jobsAt);
            const keys = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
            assert.ok(keys.includes('scope'), `${wf} has no scope job`);
            assert.match(body, /uses: \.\/\.github\/actions\/suite-scope/);
            for (const job of keys.filter((k) => k !== 'scope')) {
                const start = body.indexOf(`\n  ${job}:\n`);
                const next =
                    keys
                        .map((k) => body.indexOf(`\n  ${k}:\n`))
                        .filter((i) => i > start)
                        .sort((a, b) => a - b)[0] ?? body.length;
                const block = body.slice(start, next);
                assert.match(block, /\n {4}needs: scope\n/, `${wf}:${job} does not wait for scope`);
                assert.match(
                    block,
                    /\n {4}if: \$\{\{ !cancelled\(\) && needs\.scope\.outputs\.run != 'false' \}\}\n/,
                    `${wf}:${job} gate`,
                );
            }
        });
    }
});
