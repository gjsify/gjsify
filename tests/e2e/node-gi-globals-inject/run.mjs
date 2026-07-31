// E2E test for `gjsify build --app node` auto-injecting `@gjsify/node-gi/globals`
// when GJS ambient globals (`print`/`printerr`/`log`/`logError`/`ARGV`/`imports`)
// are used — the reverse of the GJS `--globals auto` pipeline.
//
// The node target detects those globals in the bundled (post-tree-shake) output
// and, ONLY when present, prepends a side-effect `import '@gjsify/node-gi/globals'`
// so the shim seeds them on Node. The shim is kept EXTERNAL (it loads the native
// node-gi addon), never bundled.
//
// Two cases, mirroring the #641 gated-load lesson:
//   1. an entry that USES print/imports → output imports the shim (external).
//   2. a gated/unused entry → output does NOT import the shim, and it loads +
//      runs on plain Node WITHOUT @gjsify/node-gi installed (the regression
//      guard: importing the shim eagerly loads the native addon, which would
//      crash here).
//
// Like node-gi-build, this needs only the gjsify CLI — node-gi is externalised,
// never resolved at build time — so it runs in CI without a C++ toolchain.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

describe('--app node GJS-globals shim injection E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-node-gi-globals-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'node-gi-globals-project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        // Deliberately does NOT depend on @gjsify/node-gi — the regression case
        // must load on plain Node without it.
        setupProject(
            projectDir,
            {
                name: 'test-node-gi-globals',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: { '@gjsify/cli': '^0.1.0' },
            },
            tarballsDir,
            tarballMap,
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    it('injects @gjsify/node-gi/globals when print/imports are used', () => {
        writeFileSync(
            join(projectDir, 'src', 'uses-globals.ts'),
            [
                // Unchanged GJS source: bare ambient globals + legacy imports.
                'const Gtk = imports.gi.Gtk;',
                "print('hello from gjs-on-node', ARGV.length);",
                "printerr('an error line');",
                "log('a log line');",
                'function boom() {',
                "  try { throw new Error('x'); } catch (e) { logError(e, 'boom'); }",
                '}',
                'boom();',
                'console.log(typeof Gtk);',
                '',
            ].join('\n'),
        );

        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/uses-globals.ts', '--app', 'node', '--outfile', 'dist/uses-globals.mjs'],
            { cwd: projectDir, stdio: 'pipe', timeout: 90 * 1000 },
        );

        const outPath = join(projectDir, 'dist', 'uses-globals.mjs');
        assert.ok(existsSync(outPath), 'dist/uses-globals.mjs missing');
        assert.ok(statSync(outPath).size > 0, 'dist/uses-globals.mjs is empty');

        const content = readFileSync(outPath, 'utf-8');

        // The shim must be injected as a side-effect import…
        assert.ok(
            content.includes('@gjsify/node-gi/globals'),
            'output must import @gjsify/node-gi/globals when GJS globals are used',
        );
        // …and kept EXTERNAL (a bare import, NOT bundled). If it were bundled the
        // shim's own `import { requireGi } from './gi.js'` source would appear.
        assert.ok(
            /import\s*['"]@gjsify\/node-gi\/globals['"]/.test(content),
            `the shim must be a bare external import\nContext: ${snippet(content, '@gjsify/node-gi/globals')}`,
        );
        assert.ok(
            !content.includes('installGjsGlobals'),
            'the shim must NOT be bundled (installGjsGlobals leaked into the output)',
        );

        // node --check parses without resolving the externalised import.
        execFileSync('node', ['--check', outPath], { cwd: projectDir, stdio: 'pipe', timeout: 30 * 1000 });
    });

    it('injects for a PORTABLE GJS source (bare `system` import, no ambient global)', () => {
        // The portable spelling AGENTS.md mandates: `system.programArgs`
        // instead of `ARGV`, no bare ambient global anywhere. The bundled
        // output then retains a static `@gjsify/node-gi/system` import (the
        // externalised bare built-in) — a bundle ALREADY bound to the bridge
        // at load — and that import is the second detection signal. Before it
        // was one, this exact shape lost its GJS-source treatment entirely
        // (`gjsify storybook --runtime node` emitted a bundle with no
        // `requireGi` once the storybook stopped referencing `imports`/`ARGV`).
        writeFileSync(
            join(projectDir, 'src', 'portable.ts'),
            [
                "import system from 'system';",
                "console.log('argv:', system.programArgs.length, system.programInvocationName);",
                '',
            ].join('\n'),
        );

        execFileSync('npx', ['gjsify', 'build', 'src/portable.ts', '--app', 'node', '--outfile', 'dist/portable.mjs'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 90 * 1000,
        });

        const outPath = join(projectDir, 'dist', 'portable.mjs');
        assert.ok(existsSync(outPath), 'dist/portable.mjs missing');
        const content = readFileSync(outPath, 'utf-8');

        // The bare built-in is externalised to the bridge…
        assert.ok(
            /import\s+[^'"]*['"]@gjsify\/node-gi\/system['"]/.test(content),
            `bare \`system\` must be externalised to @gjsify/node-gi/system\nContext: ${snippet(content, 'node-gi')}`,
        );
        // …and that import IS the GJS-source signal: the globals shim rides along.
        assert.ok(
            content.includes('@gjsify/node-gi/globals'),
            'a bundle retaining @gjsify/node-gi/system must get the globals shim injected',
        );

        // node --check parses without resolving the externalised imports.
        execFileSync('node', ['--check', outPath], { cwd: projectDir, stdio: 'pipe', timeout: 30 * 1000 });
    });

    it('does NOT inject the shim for a gated/unused entry, and it runs on plain Node', () => {
        // Regression guard. The entry references the globals only behind a
        // statically-dead branch (tree-shaken away) and uses a runtime-false
        // gi:// guard (lazy in the gi:// shim) — never a surviving real use. So
        // no @gjsify/node-gi/globals import is injected, and the bundle loads +
        // runs without @gjsify/node-gi installed.
        writeFileSync(
            join(projectDir, 'src', 'gated.ts'),
            [
                "import Gio from 'gi://Gio?version=2.0';",
                'if (globalThis.__nodegi_never) {',
                "    const a = new Gio.SimpleAction({ name: 'x' });",
                '    console.log(a);',
                '}',
                '// statically-dead — must tree-shake away, never trigger injection.',
                'if (false) {',
                "    // @ts-ignore — print is a GJS ambient global, absent on Node.",
                "    print('dead');",
                '}',
                "console.log('loaded-ok');",
                '',
            ].join('\n'),
        );

        execFileSync('npx', ['gjsify', 'build', 'src/gated.ts', '--app', 'node', '--outfile', 'dist/gated.mjs'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 90 * 1000,
        });

        const outPath = join(projectDir, 'dist', 'gated.mjs');
        assert.ok(existsSync(outPath), 'dist/gated.mjs missing');

        const content = readFileSync(outPath, 'utf-8');
        assert.ok(
            !content.includes('@gjsify/node-gi/globals'),
            `a gated/unused entry must NOT import @gjsify/node-gi/globals\nContext: ${snippet(content, '@gjsify/node-gi/globals')}`,
        );

        // Must load + run on plain Node without @gjsify/node-gi installed.
        const out = execFileSync('node', ['dist/gated.mjs'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 30 * 1000,
            encoding: 'utf-8',
        });
        assert.match(out, /loaded-ok/, 'gated bundle must run without @gjsify/node-gi installed');
    });

    it('does NOT inject for the globalThis.imports isomorphic guard', () => {
        // Cross-platform "am I on GJS?" probe + guarded host-member access. The
        // host-member form (globalThis.imports) is NOT genuine GJS source —
        // injecting the shim here would break plain-Node loadability of a
        // package that merely gates GJS usage. Must stay shim-free + loadable.
        writeFileSync(
            join(projectDir, 'src', 'guard.ts'),
            [
                "if (typeof globalThis.imports !== 'undefined') {",
                '    // @ts-ignore — GJS-only branch, dormant on Node.',
                '    const Gtk = globalThis.imports.gi.Gtk;',
                '    console.log(Gtk);',
                '}',
                "console.log('guard-ok');",
                '',
            ].join('\n'),
        );

        execFileSync('npx', ['gjsify', 'build', 'src/guard.ts', '--app', 'node', '--outfile', 'dist/guard.mjs'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 90 * 1000,
        });

        const outPath = join(projectDir, 'dist', 'guard.mjs');
        const content = readFileSync(outPath, 'utf-8');
        assert.ok(
            !content.includes('@gjsify/node-gi/globals'),
            `the globalThis.imports guard must NOT inject the shim\nContext: ${snippet(content, '@gjsify/node-gi/globals')}`,
        );

        const out = execFileSync('node', ['dist/guard.mjs'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 30 * 1000,
            encoding: 'utf-8',
        });
        assert.match(out, /guard-ok/, 'guarded bundle must run without @gjsify/node-gi installed');
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
