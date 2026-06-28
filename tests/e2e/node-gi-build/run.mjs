// E2E test for `gjsify build --app node` of a `gi://` (GObject-Introspection)
// source — the Axis-5 reverse bridge.
//
// Guards that the node target rewrites `import Ns from 'gi://Ns?version=X'` to
// the `@gjsify/node-gi` L1 runtime (`requireGi('Ns', 'X')`) instead of an empty
// module, and keeps `@gjsify/node-gi/gi` EXTERNAL (a native addon that must
// resolve at runtime, not be bundled). The same source builds for `--app gjs`
// (native `gi://`) and `--app node` (node-gi) with no code changes.
//
// The build is also `node --check`ed for syntactic validity. The bundle is NOT
// executed here (running it needs `@gjsify/node-gi` installed + node-gyp built);
// the run-proof lives with the dual gjs/node example. This test only needs the
// gjsify CLI, so it runs in CI without a C++ toolchain — the GI runtime is
// externalised, never resolved at build time.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

describe('--app node gi:// → node-gi bundle E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-node-gi-build-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'node-gi-build-project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        setupProject(
            projectDir,
            {
                name: 'test-node-gi-build',
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

    it('rewrites gi:// to requireGi and externalises @gjsify/node-gi', () => {
        writeFileSync(
            join(projectDir, 'src', 'app.ts'),
            [
                // Unchanged GJS/GObject-Introspection source — identical to what a
                // `--app gjs` build consumes.
                "import Gio from 'gi://Gio?version=2.0';",
                "import GLib from 'gi://GLib?version=2.0';",
                "const action = new Gio.SimpleAction({ name: 'greet', enabled: true });",
                'console.log(action.get_name(), GLib.get_host_name());',
                '',
            ].join('\n'),
        );

        execFileSync('npx', ['gjsify', 'build', 'src/app.ts', '--app', 'node', '--outfile', 'dist/app.mjs'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 90 * 1000,
        });

        const outPath = join(projectDir, 'dist', 'app.mjs');
        assert.ok(existsSync(outPath), 'dist/app.mjs missing');
        assert.ok(statSync(outPath).size > 0, 'dist/app.mjs is empty');

        const content = readFileSync(outPath, 'utf-8');

        // gi:// must be rewritten to the node-gi runtime, not stubbed empty.
        assert.ok(
            content.includes('requireGi'),
            'dist/app.mjs must call requireGi (gi:// was not routed to @gjsify/node-gi)',
        );
        assert.ok(
            content.includes('@gjsify/node-gi/gi'),
            'dist/app.mjs must import @gjsify/node-gi/gi (the externalised GI runtime)',
        );
        // The namespaces + version must reach requireGi.
        assert.ok(content.includes('Gio') && content.includes('GLib'), 'namespaces missing');
        assert.ok(content.includes('2.0'), 'version missing');

        // The raw gi:// scheme must NOT survive in the output (it was rewritten).
        assert.ok(
            !content.includes('gi://'),
            `dist/app.mjs must not contain raw "gi://"\nContext: ${snippet(content, 'gi://')}`,
        );
        // @girs/* type packages must not leak either.
        assert.ok(
            !content.includes('@girs/'),
            `dist/app.mjs must not contain "@girs/"\nContext: ${snippet(content, '@girs/')}`,
        );
    });

    it('a gated gi:// import loads on Node without @gjsify/node-gi', () => {
        // Regression guard: a gi:// import used only inside a GJS-gated branch
        // must NOT make @gjsify/node-gi a hard load-time dependency. The temp
        // project does not install node-gi, so the bundle must load + run as long
        // as the gated code (behind a runtime-false guard the bundler can't prove
        // dead) never executes — node-gi is required lazily, only on first access.
        writeFileSync(
            join(projectDir, 'src', 'gated.ts'),
            [
                "import Gio from 'gi://Gio?version=2.0';",
                'if (globalThis.__nodegi_never) {',
                "    const a = new Gio.SimpleAction({ name: 'x' });",
                '    console.log(a);',
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

        const out = execFileSync('node', ['dist/gated.mjs'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 30 * 1000,
            encoding: 'utf-8',
        });
        assert.match(out, /loaded-ok/, 'gated gi:// bundle must run without @gjsify/node-gi installed');
    });

    it('node bundle output is syntactically valid JavaScript', () => {
        const outPath = join(projectDir, 'dist', 'app.mjs');
        if (!existsSync(outPath)) return; // skip if previous test did not build
        // `node --check` parses without resolving imports, so the externalised
        // @gjsify/node-gi/gi (not installed here) does not need to exist.
        execFileSync('node', ['--check', outPath], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 30 * 1000,
        });
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
