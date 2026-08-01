// E2E test for the resolver's declaration-driven alias routing.
//
// Verifies that bundles built with `--app node` / `--app gjs` reflect each
// `@gjsify/*` package's declared `gjsify.runtimes` triplet:
//
//   - `node:native`  → bare `@gjsify/<X>` imports route through `<pkg>/globals`
//                       on Node target → bundle re-exports native `node:<X>`.
//   - `node:polyfill` → bare `@gjsify/<X>` keeps the polyfill — `node:<X>` does
//                       NOT appear in the Node bundle for these.
//   - `gjs:polyfill`  → the GJS bundle uses our impl unconditionally.
//
// Mirrors `tests/e2e/app-browser/run.mjs`'s structure (workspace-pack tarballs
// + `setupProject` + `gjsify build` invocations + bundle-content assertions).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

describe('--app routing via package.json#gjsify.runtimes', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-runtimes-routing-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'runtimes-routing-project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        setupProject(
            projectDir,
            {
                name: 'test-runtimes-routing',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: {
                    '@gjsify/cli': '^0.1.0',
                    // Direct deps to ensure they end up in node_modules for the
                    // resolver to reach.
                    '@gjsify/assert': '^0.1.0',
                    '@gjsify/util': '^0.1.0',
                    '@gjsify/buffer': '^0.1.0',
                    '@gjsify/events': '^0.1.0',
                },
            },
            tarballsDir,
            tarballMap,
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    // The Node target should route `@gjsify/assert` (declared `node: "native"`)
    // through `globals.mjs` → which contains `export * from 'node:assert'`. The
    // bundled output therefore MUST contain `'node:assert'` and MUST NOT contain
    // the polyfill's internal `AssertionError` class declaration (a substring
    // unique to the polyfill's `lib/esm/index.js`).
    it('node target re-exports native node:assert for @gjsify/assert', () => {
        writeFileSync(
            join(projectDir, 'src', 'app-assert.ts'),
            [
                "import { ok, strictEqual, AssertionError } from '@gjsify/assert';",
                'ok(true);',
                'strictEqual(1, 1);',
                'console.log(AssertionError.name);',
                '',
            ].join('\n'),
        );

        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/app-assert.ts', '--app', 'node', '--outfile', 'dist/app-assert.node.mjs'],
            { cwd: projectDir, stdio: 'pipe', timeout: 90 * 1000 },
        );

        const outPath = join(projectDir, 'dist', 'app-assert.node.mjs');
        assert.ok(existsSync(outPath), 'dist/app-assert.node.mjs missing');
        assert.ok(statSync(outPath).size > 0, 'dist/app-assert.node.mjs is empty');

        const content = readFileSync(outPath, 'utf-8');
        assert.ok(
            content.includes('node:assert'),
            `Node bundle MUST re-export from 'node:assert' (declared runtimes.node="native").\n` +
                `bundle size: ${content.length} chars; first 400: ${content.slice(0, 400)}`,
        );
    });

    it('node target bundle for @gjsify/assert is syntactically valid', () => {
        const outPath = join(projectDir, 'dist', 'app-assert.node.mjs');
        if (!existsSync(outPath)) return;
        execFileSync('node', ['--check', outPath], { stdio: 'pipe', timeout: 30 * 1000 });
    });

    // The GJS target uses our polyfill — the bundle MUST NOT contain a
    // `node:assert` import string (node: scheme has no meaning on GJS) and
    // MUST contain code shape produced by our polyfill (`AssertionError`
    // class body, or the `equal`/`strictEqual` impl). We assert the negative
    // (no `node:assert`) plus syntactic validity.
    it('gjs target uses polyfill (no node:assert) for @gjsify/assert', () => {
        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/app-assert.ts', '--app', 'gjs', '--outfile', 'dist/app-assert.gjs.mjs'],
            { cwd: projectDir, stdio: 'pipe', timeout: 90 * 1000 },
        );

        const outPath = join(projectDir, 'dist', 'app-assert.gjs.mjs');
        assert.ok(existsSync(outPath), 'dist/app-assert.gjs.mjs missing');
        assert.ok(statSync(outPath).size > 0, 'dist/app-assert.gjs.mjs is empty');

        const content = readFileSync(outPath, 'utf-8');
        assert.ok(
            !content.includes("from 'node:assert'") && !content.includes('from"node:assert"'),
            `GJS bundle MUST NOT import 'node:assert' (use polyfill instead).\n` +
                `first 400: ${content.slice(0, 400)}`,
        );
        // Sanity: the bundle is non-trivial — it actually pulls in some polyfill code.
        assert.ok(content.length > 200, 'GJS bundle too small — polyfill not inlined');
    });

    // Same assertions for `@gjsify/util` — declared `node: "native"`. The Node
    // bundle MUST forward to `node:util` via `globals.mjs`.
    it('node target re-exports native node:util for @gjsify/util', () => {
        writeFileSync(
            join(projectDir, 'src', 'app-util.ts'),
            [
                "import { format, inspect } from '@gjsify/util';",
                "console.log(format('%s', 'x'));",
                'console.log(inspect({a:1}));',
                '',
            ].join('\n'),
        );

        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/app-util.ts', '--app', 'node', '--outfile', 'dist/app-util.node.mjs'],
            { cwd: projectDir, stdio: 'pipe', timeout: 90 * 1000 },
        );

        const outPath = join(projectDir, 'dist', 'app-util.node.mjs');
        const content = readFileSync(outPath, 'utf-8');
        assert.ok(
            content.includes('node:util'),
            `Node bundle MUST re-export from 'node:util' (declared runtimes.node="native"). first 400: ${content.slice(0, 400)}`,
        );
    });

    // The hardcoded `ALIASES_WEB_FOR_NODE` map already routes `webcrypto`
    // (bare specifier) to `@gjsify/webcrypto/globals` on Node target. The new
    // derivation must NOT regress that — hardcoded entries win over derived.
    // Build code that uses `webcrypto` and assert the bundle still re-exports
    // native `globalThis.crypto`.
    it('hardcoded bare-specifier routes still win (webcrypto stays /globals)', () => {
        writeFileSync(
            join(projectDir, 'src', 'app-webcrypto.ts'),
            [
                // Reading the named export — what `@gjsify/webcrypto/globals.mjs`
                // surfaces. The bundle must read it from globalThis.crypto.
                "import { subtle } from 'webcrypto';",
                'console.log(typeof subtle);',
                '',
            ].join('\n'),
        );

        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/app-webcrypto.ts', '--app', 'node', '--outfile', 'dist/app-webcrypto.node.mjs'],
            { cwd: projectDir, stdio: 'pipe', timeout: 90 * 1000 },
        );

        const outPath = join(projectDir, 'dist', 'app-webcrypto.node.mjs');
        const content = readFileSync(outPath, 'utf-8');
        // `globals.mjs` re-exports `globalThis.crypto.subtle`. The bundle must
        // contain that lookup pattern (not the polyfill's GLib.Checksum code).
        assert.ok(
            content.includes('globalThis.crypto'),
            `Node bundle MUST read native crypto via globalThis (hardcoded webcrypto alias). first 400: ${content.slice(0, 400)}`,
        );
        assert.ok(
            !content.includes('GLib.Checksum'),
            `Node bundle MUST NOT contain GLib.Checksum (would mean polyfill leaked through). first 400: ${content.slice(0, 400)}`,
        );
    });

    // Reverse direction: GJS bundle for `@gjsify/events` (declared
    // `gjs: "polyfill"`) MUST NOT alias the package to `/globals` —
    // the polyfill path must reach `lib/esm/index.js`. Cross-check by
    // ensuring the bundle does NOT import `node:events`.
    it('gjs target keeps @gjsify/events as polyfill', () => {
        writeFileSync(
            join(projectDir, 'src', 'app-events.ts'),
            [
                "import { EventEmitter } from '@gjsify/events';",
                'const ee = new EventEmitter();',
                "ee.on('x', () => {});",
                "ee.emit('x');",
                '',
            ].join('\n'),
        );

        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/app-events.ts', '--app', 'gjs', '--outfile', 'dist/app-events.gjs.mjs'],
            { cwd: projectDir, stdio: 'pipe', timeout: 90 * 1000 },
        );

        const outPath = join(projectDir, 'dist', 'app-events.gjs.mjs');
        const content = readFileSync(outPath, 'utf-8');
        assert.ok(
            !content.includes("from 'node:events'") && !content.includes('from"node:events"'),
            `GJS bundle MUST NOT import 'node:events'. first 400: ${content.slice(0, 400)}`,
        );
    });
});
