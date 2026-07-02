// E2E for the `gjsify build --library` src-leak guard.
//
// `BuildAction.buildLibrary` derives its output dir from `dirname(module ??
// main)`. A package whose `main` points at its SOURCE entry (`src/index.ts` —
// the intended runtime entry for Vite/gjsify-compiled consumers, e.g.
// `@gjsify/adwaita-web`) makes that derived dir `src/`, so a `--library` build
// wrote the compiled `.js` tree straight over the sources: `src/*.js` /
// `*2.js` duplicates, a `src/_virtual/` dir, and a nested `src/<pkg>/src`
// preserve-modules tree. This was worked around per-package (PR #687/#688
// dropped their `build:gjsify`), but the CLI still silently did the wrong
// thing for any package with that shape.
//
// The build action now REFUSES the derived-src outdir up front. This test
// drives the CLI's Node entry directly (no tarball install needed — a trivial
// no-dep project resolves the bundler from the monorepo) and asserts:
//   A. main→src/index.ts + --library  → non-zero exit, clear error, NO .js
//      leaks into src/.
//   B. main→lib/index.js              → builds fine (no false positive).
//   C. main→src/index.ts + --outdir   → builds fine (explicit escape hatch),
//      output lands in the chosen dir, src/ stays clean.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_ENTRY = fileURLToPath(new URL('../../../packages/infra/cli/lib/index.js', import.meta.url));

function makeProject(root, pkgOverrides) {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'lib-guard-fixture', version: '0.0.0', type: 'module', private: true, ...pkgOverrides }, null, 2) +
            '\n',
    );
    writeFileSync(join(root, 'src', 'index.ts'), 'export const ANSWER = 42;\n');
}

function runBuild(cwd, extraArgs) {
    return spawnSync(process.execPath, [CLI_ENTRY, 'build', 'src/index.ts', '--library', '--app', 'node', ...extraArgs], {
        cwd,
        encoding: 'utf-8',
        timeout: 90 * 1000,
    });
}

/** The JS files a build may have leaked into src/ (index.ts is the source). */
function jsFilesInSrc(root) {
    if (!existsSync(join(root, 'src'))) return [];
    return readdirSync(join(root, 'src')).filter((f) => /\.[cm]?js$/.test(f));
}

describe('gjsify build --library src-leak guard (E2E)', { timeout: 5 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-library-src-leak-'));
    });

    after(() => {
        if (!process.env.GJSIFY_E2E_KEEP_TEMP) rmSync(tmpDir, { recursive: true, force: true });
    });

    it('A. refuses to emit into src/ when main points at a source path', () => {
        const root = join(tmpDir, 'leak');
        makeProject(root, { main: 'src/index.ts' });

        const res = runBuild(root, []);

        assert.notEqual(res.status, 0, 'build must fail rather than corrupt src/');
        const combined = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
        assert.match(combined, /refusing to write output into "src"/, 'missing the clear src-leak error');
        // The whole point: nothing was written next to the sources.
        assert.deepEqual(jsFilesInSrc(root), [], 'build leaked .js files into src/');
    });

    it('B. builds normally when main points at the built lib/ (no false positive)', () => {
        const root = join(tmpDir, 'safe-lib');
        makeProject(root, { main: 'lib/index.js' });

        const res = runBuild(root, []);

        assert.equal(res.status, 0, `safe library build failed:\n${res.stderr}`);
        assert.ok(existsSync(join(root, 'lib', 'index.js')), 'expected output at lib/index.js');
        assert.deepEqual(jsFilesInSrc(root), [], 'safe build should not touch src/');
    });

    it('C. honours an explicit --outdir escape hatch even with main→src', () => {
        const root = join(tmpDir, 'escape');
        makeProject(root, { main: 'src/index.ts' });

        const res = runBuild(root, ['--outdir', 'dist']);

        assert.equal(res.status, 0, `escape-hatch build failed:\n${res.stderr}`);
        assert.ok(existsSync(join(root, 'dist', 'index.js')), 'expected output at dist/index.js');
        assert.deepEqual(jsFilesInSrc(root), [], '--outdir build should not touch src/');
    });
});
