// E2E test for `gjsify build --app node` rewriting the bare GJS built-in module
// specifiers (`system` / `gettext`) to the EXTERNAL `@gjsify/node-gi/<mod>`
// reverse-bridge shims — the third node-gi entry syntax (bare built-ins),
// alongside the `gi://` rewrite (node-gi-build) and the ambient-globals
// injection (node-gi-globals-inject).
//
// GJS exposes `system`/`gettext` as built-in ESM modules; Node has no
// equivalent, so on `--app node` they alias to `@gjsify/node-gi/system` /
// `@gjsify/node-gi/gettext`, kept EXTERNAL (resolved at runtime, never bundled —
// like `@gjsify/node-gi/gi`). The rewrite is NODE-TARGET-ONLY: a `--app gjs`
// build keeps them as bare GJS externals (the native GJS loader provides them),
// and a `--app browser` build never routes them to node-gi.
//
// Like node-gi-build / node-gi-globals-inject this needs only the gjsify CLI —
// node-gi is externalised, never resolved at build time — so it runs in CI
// without a C++ toolchain and without @gjsify/node-gi installed.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

describe('--app node bare GJS built-in modules (system/gettext) E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-node-gi-bare-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'node-gi-bare-project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        // Deliberately does NOT depend on @gjsify/node-gi — the bare modules are
        // kept external, so the BUILD must succeed without node-gi installed.
        setupProject(
            projectDir,
            {
                name: 'test-node-gi-bare',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: { '@gjsify/cli': '^0.1.0' },
            },
            tarballsDir,
            tarballMap,
        );

        // Unchanged GJS source: import the built-in `system` + `gettext` modules.
        writeFileSync(
            join(projectDir, 'src', 'app.ts'),
            [
                "import System from 'system';",
                "import Gettext from 'gettext';",
                "console.log(typeof System.exit, Gettext.gettext('hi'));",
                'System.exit(0);',
                '',
            ].join('\n'),
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    it('rewrites bare system/gettext to external @gjsify/node-gi/* on --app node', () => {
        execFileSync('npx', ['gjsify', 'build', 'src/app.ts', '--app', 'node', '--outfile', 'dist/app.mjs'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 90 * 1000,
        });

        const outPath = join(projectDir, 'dist', 'app.mjs');
        assert.ok(existsSync(outPath), 'dist/app.mjs missing');
        assert.ok(statSync(outPath).size > 0, 'dist/app.mjs is empty');

        const content = readFileSync(outPath, 'utf-8');

        // The bare specifiers are rewritten to the node-gi shims…
        assert.ok(
            content.includes('@gjsify/node-gi/system'),
            `output must import @gjsify/node-gi/system\nContext: ${snippet(content, 'system')}`,
        );
        assert.ok(
            content.includes('@gjsify/node-gi/gettext'),
            `output must import @gjsify/node-gi/gettext\nContext: ${snippet(content, 'gettext')}`,
        );
        // …as bare EXTERNAL imports (NOT bundled). If they were bundled the
        // shims' own source (e.g. the System default-export object) would appear.
        assert.ok(
            /import\s+\w+\s*from\s*['"]@gjsify\/node-gi\/system['"]/.test(content),
            `@gjsify/node-gi/system must be a bare external import\nContext: ${snippet(content, '@gjsify/node-gi/system')}`,
        );
        assert.ok(
            /import\s+\w+\s*from\s*['"]@gjsify\/node-gi\/gettext['"]/.test(content),
            `@gjsify/node-gi/gettext must be a bare external import\nContext: ${snippet(content, '@gjsify/node-gi/gettext')}`,
        );
        // The original bare `system` / `gettext` specifiers must be GONE — they
        // were rewritten, not left for Node's resolver to choke on.
        assert.ok(
            !/from\s*['"]system['"]/.test(content),
            `the bare 'system' specifier must be rewritten\nContext: ${snippet(content, 'system')}`,
        );
        assert.ok(
            !/from\s*['"]gettext['"]/.test(content),
            `the bare 'gettext' specifier must be rewritten\nContext: ${snippet(content, 'gettext')}`,
        );

        // node --check parses without resolving the externalised imports.
        execFileSync('node', ['--check', outPath], { cwd: projectDir, stdio: 'pipe', timeout: 30 * 1000 });
    });

    it('does NOT rewrite system/gettext to node-gi on --app gjs', () => {
        // On GJS, `system` / `gettext` are real built-in modules kept external by
        // the native loader — they must stay bare, NOT route to node-gi.
        execFileSync('npx', ['gjsify', 'build', 'src/app.ts', '--app', 'gjs', '--outfile', 'dist/app.gjs.js'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 90 * 1000,
        });

        const outPath = join(projectDir, 'dist', 'app.gjs.js');
        assert.ok(existsSync(outPath), 'dist/app.gjs.js missing');

        const content = readFileSync(outPath, 'utf-8');
        assert.ok(
            !content.includes('@gjsify/node-gi'),
            `a --app gjs build must NOT route system/gettext to node-gi\nContext: ${snippet(content, 'node-gi')}`,
        );
        // The GJS bundle keeps them as bare external imports.
        assert.ok(
            /from\s*['"]system['"]/.test(content),
            `--app gjs must keep 'system' as a bare GJS external\nContext: ${snippet(content, 'system')}`,
        );
        assert.ok(
            /from\s*['"]gettext['"]/.test(content),
            `--app gjs must keep 'gettext' as a bare GJS external\nContext: ${snippet(content, 'gettext')}`,
        );
    });

    it('does NOT rewrite system/gettext to node-gi on --app browser', () => {
        // The browser target has no node-gi reverse bridge — the rewrite must
        // stay off so a non-GJS build that happens to import `system`/`gettext`
        // is never hijacked to the native node-gi addon.
        execFileSync('npx', ['gjsify', 'build', 'src/app.ts', '--app', 'browser', '--outfile', 'dist/app.browser.js'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 90 * 1000,
        });

        const outPath = join(projectDir, 'dist', 'app.browser.js');
        assert.ok(existsSync(outPath), 'dist/app.browser.js missing');

        const content = readFileSync(outPath, 'utf-8');
        assert.ok(
            !content.includes('@gjsify/node-gi'),
            `a --app browser build must NOT route system/gettext to node-gi\nContext: ${snippet(content, 'node-gi')}`,
        );
    });
});

/**
 * Return a short context snippet around the first occurrence of `needle` in
 * `text`, for assertion failure messages.
 */
function snippet(text, needle) {
    const idx = text.indexOf(needle);
    if (idx === -1) return '(not found)';
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + needle.length + 40);
    return `…${text.slice(start, end)}…`;
}
