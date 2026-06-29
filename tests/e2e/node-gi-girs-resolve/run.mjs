// E2E test for `gjsify build --app node` routing `@girs/<ns>-<ver>` VALUE
// imports through the `@gjsify/node-gi` reverse bridge (`requireGi`) instead of
// the empty module — GATED on the same `nodeGiGlobalsInject` genuine-GJS-source
// signal that drives the globals shim.
//
// The bug this guards (pinned by the Adwaita-storybook-on-node probe): a GJS
// app imports `@girs/adw-1` (the standard convention, NOT raw `gi://Adw`).
// `@girs/adw-1/adw-1.js` is literally `import Adw from 'gi://Adw?version=1';
// export default Adw`. On `--app node` the gjsImportsEmptyPlugin used to map
// `@girs/*`→`{}` BEFORE gjsGiNodePlugin could rewrite the inner `gi://`, so
// `class extends Adw.Bin` became `class extends ({}).Bin` → `TypeError: Class
// extends value undefined`. The fix lets `@girs/<ns>-<ver>` fall through to its
// real body so its inner `gi://Adw?version=1` is rewritten to
// `requireGi('Adw','1')` — the proper-cased namespace coming straight from the
// @girs package's own `gi://` specifier (no lowercased-pkg→namespace map).
//
// Two cases:
//   1. POSITIVE — a genuine GJS app (uses bare `print`/`ARGV`, the
//      `nodeGiGlobalsInject` signal) that imports an `@girs/<ns>-<ver>` package
//      and extends one of its classes → the output routes the namespace through
//      `requireGi` (NOT `{}`), keeps `@gjsify/node-gi/gi` external, and
//      `node --check` parses it.
//   2. REGRESSION — a cross-platform package (the `typeof globalThis.imports`
//      guard shape, no bare ambient globals) that imports the SAME
//      `@girs/<ns>-<ver>` package → `@girs/*` still maps to the empty module
//      (no `requireGi`, no node-gi), and the bundle loads + runs on plain Node
//      WITHOUT `@gjsify/node-gi` installed.
//
// Like the sibling node-gi suites this needs only the gjsify CLI — node-gi is
// externalised, never resolved at build time — so it runs in CI without a C++
// toolchain. The `@girs/foo-1` package is a hand-written stand-in (its own
// `gi://Foo?version=1` specifier carries the proper casing), so the test
// doesn't pull a real multi-MB `@girs/*` tarball from the registry.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

describe('--app node @girs/* → node-gi requireGi resolution E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-node-gi-girs-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'node-gi-girs-project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        // Deliberately does NOT depend on @gjsify/node-gi — the regression case
        // must load on plain Node without it.
        setupProject(
            projectDir,
            {
                name: 'test-node-gi-girs',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: { '@gjsify/cli': '^0.1.0' },
            },
            tarballsDir,
            tarballMap,
        );

        // A hand-written @girs stand-in, written AFTER npm install so npm never
        // tries to fetch it from the registry. Mirrors the real shape: the value
        // entry imports a `gi://` specifier and re-exports it as default. The
        // PROPER-CASED namespace (`Foo`) lives only in this package's own
        // specifier — proving the fix needs no lowercased-pkg→namespace map.
        const girsDir = join(projectDir, 'node_modules', '@girs', 'foo-1');
        mkdirSync(girsDir, { recursive: true });
        writeFileSync(
            join(girsDir, 'package.json'),
            JSON.stringify(
                {
                    name: '@girs/foo-1',
                    version: '1.0.0',
                    type: 'module',
                    main: './foo-1.js',
                    exports: { '.': './foo-1.js' },
                },
                null,
                2,
            ) + '\n',
        );
        writeFileSync(
            join(girsDir, 'foo-1.js'),
            ["import Foo from 'gi://Foo?version=1';", 'export default Foo;', ''].join('\n'),
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    it('routes @girs/<ns>-<ver> through requireGi for a genuine GJS source', () => {
        // Genuine GJS app: bare ambient globals (the nodeGiGlobalsInject signal)
        // + extends a class off the @girs default export — the exact storybook
        // shape that used to throw "Class extends value undefined".
        writeFileSync(
            join(projectDir, 'src', 'uses-girs.ts'),
            [
                "import Foo from '@girs/foo-1';",
                "print('hello from gjs-on-node', ARGV.length);",
                'class StoryWidget extends Foo.Bin {}',
                'console.log(typeof StoryWidget);',
                '',
            ].join('\n'),
        );

        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/uses-girs.ts', '--app', 'node', '--outfile', 'dist/uses-girs.mjs'],
            { cwd: projectDir, stdio: 'pipe', timeout: 90 * 1000 },
        );

        const outPath = join(projectDir, 'dist', 'uses-girs.mjs');
        assert.ok(existsSync(outPath), 'dist/uses-girs.mjs missing');
        assert.ok(statSync(outPath).size > 0, 'dist/uses-girs.mjs is empty');

        const content = readFileSync(outPath, 'utf-8');

        // The @girs namespace must be routed through node-gi's requireGi with the
        // proper-cased namespace lifted from the @girs package's gi:// specifier.
        assert.match(
            content,
            /requireGi\(\s*[`'"]Foo[`'"]/,
            `@girs/foo-1 must route through requireGi('Foo', …)\nContext: ${snippet(content, 'requireGi')}`,
        );
        // The runtime backend import is kept EXTERNAL (a native addon).
        assert.ok(
            content.includes('@gjsify/node-gi/gi'),
            'the node-gi backend (@gjsify/node-gi/gi) must be referenced (kept external)',
        );
        // It must NOT have been bundled-to-empty: the empty-module marker the
        // gjsImportsEmptyPlugin emits must be absent for this @girs import.
        assert.ok(
            !content.includes('export default {};'),
            `@girs/foo-1 must NOT be bundled to the empty module\nContext: ${snippet(content, 'export default {}')}`,
        );
        // The genuine-GJS-source gate also injected the globals shim (print/ARGV).
        assert.ok(
            content.includes('@gjsify/node-gi/globals'),
            'the nodeGiGlobalsInject gate (print/ARGV) must also inject the globals shim',
        );

        // node --check parses without resolving the externalised node-gi imports.
        execFileSync('node', ['--check', outPath], { cwd: projectDir, stdio: 'pipe', timeout: 30 * 1000 });
    });

    it('keeps @girs/* → empty for a cross-platform package, loadable without node-gi', () => {
        // Regression guard. A cross-platform package gates GJS usage behind a
        // `typeof globalThis.imports` host-member probe (the detector ignores
        // host-member forms) and uses NO bare ambient globals, so
        // nodeGiGlobalsInject stays false → @girs/* keeps mapping to the empty
        // module → no node-gi dependency → loads on plain Node.
        writeFileSync(
            join(projectDir, 'src', 'cross-platform.ts'),
            [
                "import Foo from '@girs/foo-1';",
                "if (typeof globalThis.imports !== 'undefined') {",
                '    // @ts-ignore — GJS-only branch, dormant on Node.',
                '    const w = new Foo.Bin();',
                '    console.log(w);',
                '}',
                "console.log('cross-platform-ok');",
                '',
            ].join('\n'),
        );

        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/cross-platform.ts', '--app', 'node', '--outfile', 'dist/cross-platform.mjs'],
            { cwd: projectDir, stdio: 'pipe', timeout: 90 * 1000 },
        );

        const outPath = join(projectDir, 'dist', 'cross-platform.mjs');
        assert.ok(existsSync(outPath), 'dist/cross-platform.mjs missing');

        const content = readFileSync(outPath, 'utf-8');
        assert.ok(
            !content.includes('requireGi'),
            `a cross-platform @girs import must NOT route through requireGi\nContext: ${snippet(content, 'requireGi')}`,
        );
        assert.ok(
            !content.includes('@gjsify/node-gi'),
            `a cross-platform @girs import must NOT pull @gjsify/node-gi\nContext: ${snippet(content, '@gjsify/node-gi')}`,
        );

        // Must load + run on plain Node without @gjsify/node-gi installed.
        const out = execFileSync('node', ['dist/cross-platform.mjs'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 30 * 1000,
            encoding: 'utf-8',
        });
        assert.match(out, /cross-platform-ok/, 'cross-platform bundle must run without @gjsify/node-gi installed');
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
