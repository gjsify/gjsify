// E2E for the `storybook` conformance rule — `gjsify.storybook` names a story
// directory that exists and holds at least one story.
//
// WHY THIS SUITE EXISTS, and why it drives the rule through `createContext`
// rather than through `audit-runtimes --check`: the rule is `scope: 'portable'`,
// which is a claim that it is correct in ANY consumer's tree, not just this one.
// Running it only against this repository would leave that claim untested — and
// this is the one `gjsify.*` field the repo genuinely shares with downstream
// consumers today (buchhaltung declares a nested `src/frontends/desktop/widgets`;
// pixel-rpg/map-editor declares the block with no `stories` key at all and
// relies on the `src` default). Both of those shapes are fixtures below.
//
// Synthetic roots in a tmpdir, never this checkout: a fixture that reads repo
// state is a fixture that goes red when unrelated work lands, and the same
// mistake is written up at `tests/e2e/prebuild-declaration-invariant`'s header
// after it red-lined `main` for hours.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');

const { createContext, storybookRule, countStoryFiles } = await import(
    `file://${join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'index.mjs')}`
);

let tmp;

/** A workspace root with `packages/*`. */
function makeRoot(name) {
    const root = join(tmp, name);
    mkdirSync(join(root, 'packages'), { recursive: true });
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: `${name}-root`, private: true, workspaces: ['packages/*'] }, null, 2),
    );
    return root;
}

/** Write `packages/<dir>/package.json` plus any files (path → contents). */
function addPackage(root, dir, pkg, files = {}) {
    const pkgDir = join(root, 'packages', dir);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify(pkg, null, 2));
    for (const [rel, contents] of Object.entries(files)) {
        const abs = join(pkgDir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, contents);
    }
    return pkgDir;
}

/** Run the rule over a synthetic root and return its findings. */
function run(root) {
    const ctx = createContext({ root, discoveryRoots: ['packages'] });
    return storybookRule.run(ctx);
}

const STORY = 'export const Basic = () => {};\n';

describe('storybook declaration invariant', { timeout: 5 * 60 * 1000 }, () => {
    before(() => {
        tmp = mkdtempSync(join(tmpdir(), 'gjsify-e2e-storybook-decl-'));
    });

    after(() => {
        rmSync(tmp, { recursive: true, force: true });
    });

    it('passes a declared directory that holds a story', () => {
        const root = makeRoot('ok');
        addPackage(
            root,
            'widgets',
            { name: '@fixture/widgets', gjsify: { storybook: { stories: 'stories', globals: 'auto' } } },
            { 'stories/button.story.ts': STORY },
        );
        const { failures } = run(root);
        assert.deepEqual(failures, []);
    });

    it('FAILS a declared directory that does not exist — the typo this rule exists for', () => {
        const root = makeRoot('typo');
        addPackage(
            root,
            'widgets',
            { name: '@fixture/widgets', gjsify: { storybook: { stories: 'storeis' } } },
            { 'stories/button.story.ts': STORY },
        );
        const { failures } = run(root);
        assert.equal(failures.length, 1, `expected exactly one finding, got:\n${failures.join('\n')}`);
        // The message must name BOTH the declared value and the resolved path:
        // a reader with only one of them cannot tell a typo from a moved file.
        assert.match(failures[0], /storeis/);
        assert.match(failures[0], /packages\/widgets/);
    });

    it('FAILS a directory that exists but holds no story', () => {
        const root = makeRoot('empty');
        addPackage(
            root,
            'widgets',
            { name: '@fixture/widgets', gjsify: { storybook: { stories: 'stories' } } },
            { 'stories/README.md': '# not a story\n' },
        );
        const { failures } = run(root);
        assert.equal(failures.length, 1, `expected exactly one finding, got:\n${failures.join('\n')}`);
        assert.match(failures[0], /no `\*\.story/);
    });

    it('accepts an absent `stories` key and falls back to `src`', () => {
        // The pixel-rpg/map-editor shape. An absent key is a legal declaration,
        // not a missing one — reporting it would break a consumer that is right.
        const root = makeRoot('default-src');
        addPackage(
            root,
            'widgets',
            { name: '@fixture/widgets', gjsify: { storybook: { applicationId: 'org.fixture.Sb' } } },
            { 'src/button.story.ts': STORY },
        );
        const { failures } = run(root);
        assert.deepEqual(failures, []);
    });

    it('accepts a nested multi-segment path', () => {
        // The buchhaltung shape: `src/frontends/desktop/widgets`.
        const root = makeRoot('nested');
        addPackage(
            root,
            'app',
            { name: '@fixture/app', gjsify: { storybook: { stories: 'src/frontends/desktop/widgets' } } },
            { 'src/frontends/desktop/widgets/list.story.ts': STORY },
        );
        const { failures } = run(root);
        assert.deepEqual(failures, []);
    });

    it('ignores a package that declares no storybook block at all', () => {
        const root = makeRoot('undeclared');
        addPackage(root, 'plain', { name: '@fixture/plain', gjsify: { tier: 1 } });
        const { failures, stats } = run(root);
        assert.deepEqual(failures, []);
        assert.equal(stats.declared, 0);
    });

    it('FAILS a non-string member', () => {
        const root = makeRoot('wrong-type');
        addPackage(
            root,
            'widgets',
            { name: '@fixture/widgets', gjsify: { storybook: { stories: 'stories', title: 42 } } },
            { 'stories/button.story.ts': STORY },
        );
        const { failures } = run(root);
        assert.equal(failures.length, 1, `expected exactly one finding, got:\n${failures.join('\n')}`);
        assert.match(failures[0], /`gjsify\.storybook\.title` must be a string/);
    });

    it('counts stories the way the CLI globs them', () => {
        // The rule and `findStoryFiles` in commands/storybook.ts must agree, or
        // the rule passes a directory the command then rejects — which is the
        // failure it exists to prevent. Same extensions, same skips.
        const root = makeRoot('glob');
        const pkgDir = addPackage(
            root,
            'widgets',
            { name: '@fixture/widgets', gjsify: { storybook: {} } },
            {
                'src/a.story.ts': STORY,
                'src/nested/b.story.mjs': STORY,
                'src/c.ts': STORY,
                'src/.hidden/d.story.ts': STORY,
                'src/node_modules/e.story.ts': STORY,
            },
        );
        assert.equal(countStoryFiles(join(pkgDir, 'src')), 2);
    });
});
