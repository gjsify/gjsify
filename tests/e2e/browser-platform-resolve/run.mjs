// E2E for ADR 0032 § 9 — the BROWSER platform-file chain, over a real
// `gjsify build --app browser`.
//
// Sister suite to `desktop-platform-resolve`, and here for the same reason: the
// unit suite (`packages/infra/cli/src/platform-resolve.spec.ts`) drives the
// resolveId handler against a mock context, which proves the ORDER and the
// refusals. What it cannot prove is that the plugin is COMPOSED into the browser
// orchestrator at all — `app/browser.ts` had the chain missing entirely while
// every other target had it, and nothing in the tree said so. So this suite
// writes real variant files, runs the real CLI, and reads the emitted bundle.
//
// The chain has one rung, so there is no host-dependent vector to write and
// nothing here is conditional on the runner: the same three files resolve the
// same way on every operating system, which is itself the reason the chain has
// no OS rung (`browserSuffixChain`'s doc comment).
//
// `transform.jsx: false` on the fixture is not incidental: `gjsify build` refuses
// a JSX entry with no JSX configuration (its own gate), and these fixtures are
// about file resolution, not about JSX.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

describe('--app browser platform file resolution (ADR 0032 § 9)', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-browser-platform-resolve-');
        tmpDir = env.tmpDir;

        projectDir = join(tmpDir, 'browser-platform-resolve-project');
        const src = join(projectDir, 'src');
        mkdirSync(src, { recursive: true });

        const mod = (name, marker) => writeFileSync(join(src, name), `export const value = '${marker}';\n`);

        // The rung itself: `.web` ahead of the base file.
        mod('card.tsx', 'CARD_BASE');
        mod('card.web.tsx', 'CARD_WEB');

        // No `.web` sibling at all — the base file, and no warning about it.
        mod('plain.tsx', 'PLAIN_BASE');

        // The three refusals. A `.gtk.tsx` reaching `Adw.*` would get `{}` from
        // the browser target's empty-module redirect and throw
        // `Class extends value undefined` at load, so the base file is the honest
        // answer — loudly.
        mod('refused.tsx', 'REFUSED_BASE');
        mod('refused.gtk.tsx', 'REFUSED_GTK');
        mod('refused.desktop.tsx', 'REFUSED_DESKTOP');
        mod('refused.native.tsx', 'REFUSED_NATIVE');

        // A `.web` variant WINS over its own refused siblings rather than being
        // shadowed by the refusal probe — the probe runs only after a miss.
        mod('mixed.tsx', 'MIXED_BASE');
        mod('mixed.gtk.tsx', 'MIXED_GTK');
        mod('mixed.web.tsx', 'MIXED_WEB');

        // The property the 41 `.web.*` files already in this repository rely on:
        // imported by their FULL path, with no same-stem base file beside them.
        // The specifier's own `.web` is part of the stem, so the candidate is
        // `./story.web.web` — a miss — and the file the author named is what
        // resolves.
        mod('story.web.tsx', 'STORY_WEB_EXPLICIT');

        writeFileSync(
            join(src, 'entry.tsx'),
            [
                "import { value as card } from './card';",
                "import { value as plain } from './plain';",
                "import { value as refused } from './refused';",
                "import { value as mixed } from './mixed';",
                "import { value as story } from './story.web.js';",
                "console.log('PICKED', card, plain, refused, mixed, story);",
                '',
            ].join('\n'),
        );

        setupProject(
            projectDir,
            {
                name: 'test-browser-platform-resolve',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: { '@gjsify/cli': '^0.1.0' },
                // See the header: the CLI's JSX gate, not a property under test.
                gjsify: { bundler: { transform: { jsx: false } } },
            },
            env.tarballsDir,
            env.tarballMap,
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    let bundle = '';
    let output = '';

    it('builds', () => {
        // spawnSync, not execFileSync: the plugin's warnings go to stderr and
        // both streams are asserted below.
        const run = spawnSync(
            'npx',
            ['gjsify', 'build', 'src/entry.tsx', '--app', 'browser', '--no-minify', '--outfile', 'dist/app.js'],
            { cwd: projectDir, encoding: 'utf8', timeout: 180 * 1000 },
        );
        output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
        assert.equal(run.status, 0, `build failed:\n${output}`);
        const outPath = join(projectDir, 'dist', 'app.js');
        assert.ok(existsSync(outPath), 'dist/app.js missing');
        bundle = readFileSync(outPath, 'utf-8');
    });

    it('takes .web over the base file', () => {
        assert.ok(bundle.includes('CARD_WEB'), 'the .web variant must win');
        assert.ok(!bundle.includes('CARD_BASE'), 'the base file must not win over .web');
    });

    it('takes the base file when there is no variant', () => {
        assert.ok(bundle.includes('PLAIN_BASE'), 'the base file must be used');
    });

    // The exclusions, which look like oversights from the browser exactly as
    // `.native`/`.web` do from the desktop.
    it('falls through to the BASE file past .gtk, .desktop and .native', () => {
        assert.ok(bundle.includes('REFUSED_BASE'), 'the base file must win');
        for (const marker of ['REFUSED_GTK', 'REFUSED_DESKTOP', 'REFUSED_NATIVE']) {
            assert.ok(!bundle.includes(marker), `${marker} must never be resolved for a browser target`);
        }
    });

    it('prefers its own .web rung over a refused sibling of the same module', () => {
        assert.ok(bundle.includes('MIXED_WEB'), 'the .web variant must win');
        for (const marker of ['MIXED_BASE', 'MIXED_GTK']) {
            assert.ok(!bundle.includes(marker), `${marker} must not be in the bundle`);
        }
    });

    // An explicit `./story.web.js` import is untouched by the chain. Nothing here
    // would break if the chain reached it — there is no base file to fall back
    // to — but the resolution has to be the one the author wrote.
    it('resolves an explicit .web.js import to the file the author named', () => {
        assert.ok(bundle.includes('STORY_WEB_EXPLICIT'), 'the explicitly imported .web file must be bundled');
    });

    // Falling through is § 9's decision; falling through in silence is not.
    it('warns by name about each refused sibling it walked past', () => {
        for (const refused of ['./refused.gtk', './refused.desktop', './refused.native']) {
            assert.ok(
                output.includes(refused),
                `the build must name ${refused} as walked past.\nbuild output:\n${output}`,
            );
        }
        assert.ok(
            output.includes('ADR 0032'),
            `the warning must carry the reason, not just the file name.\nbuild output:\n${output}`,
        );
    });

    // The remedy has to name THIS chain's rung. A hardcoded `.desktop` was
    // correct while the desktop chain was the only one with a refusal list, and
    // became advice to write the file this target refuses the moment the browser
    // got one.
    it('tells the author to write .web, not the variant it just refused', () => {
        assert.ok(
            output.includes('into .web or the base file'),
            `the remedy must name the browser chain's own rung.\nbuild output:\n${output}`,
        );
        assert.ok(
            !output.includes('into a .web or .desktop variant'),
            `the remedy must not point at a refused suffix.\nbuild output:\n${output}`,
        );
    });

    // A module with no sibling at all must cost no line. A warning that fires on
    // ordinary code is a warning that gets switched off.
    it('says nothing about a module that has no variant', () => {
        assert.ok(!output.includes('./plain'), `nothing to warn about.\nbuild output:\n${output}`);
    });
});
