// E2E for location-independent runtime resolution of bundled-dep data reads
// (`rewrite-node-modules-paths.ts` case 1 + `shims/module-resolve.ts`).
//
// Reproduces the class of bug that crashed ts-for-gir's globally-installed GJS
// bundle: a bundled dep that reads its own data files at runtime via a
// *dynamic* (non-inlinable) `import.meta.url` path. The naive rewriter baked a
// path relative to the BUILD location (`../../../node_modules/<dep>`), which is
// correct in the workspace but doubles to `node_modules/node_modules/<dep>`
// once the bundle is PUBLISHED and installed at `node_modules/<pkg>/bin/<bundle>`.
//
// The fixture's read is intentionally dynamic (filename built at runtime) so the
// static-read inliner can NOT inline it — exercising the runtime-resolve path
// rather than the inliner. We then build, RELOCATE the bundle to a different
// node_modules depth (with the dep present there), run it under GJS, and assert
// it still finds the data file.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject, hasCommand } from '../helpers.mjs';

/**
 * A `node_modules/@fixture/dynamic-reader` package whose entry reads its own
 * `data.json` via a RUNTIME-computed URL — `new URL("./" + name + ".json",
 * import.meta.url)`. The static-read inliner can't evaluate the concatenated
 * name, so the read survives to runtime and `import.meta.url` must resolve to
 * the dep's real on-disk location wherever the bundle ends up.
 */
function createFixture(projectDir) {
    const pkgDir = join(projectDir, 'node_modules', '@fixture', 'dynamic-reader');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify(
            {
                name: '@fixture/dynamic-reader',
                version: '4.2.0',
                type: 'module',
                main: './index.js',
                exports: { '.': './index.js' },
            },
            null,
            2,
        ),
    );
    writeFileSync(join(pkgDir, 'data.json'), JSON.stringify({ secret: 'resolved-at-runtime' }) + '\n');
    writeFileSync(
        join(pkgDir, 'index.js'),
        `import { readFileSync } from 'node:fs';\n` +
            `import { fileURLToPath } from 'node:url';\n` +
            `\n` +
            `// Dynamic name → NOT statically inlinable → import.meta.url is rewritten\n` +
            `// to the runtime resolver, which must find this file wherever installed.\n` +
            `function load(name) {\n` +
            `  const p = fileURLToPath(new URL('./' + name + '.json', import.meta.url));\n` +
            `  return JSON.parse(readFileSync(p, 'utf8'));\n` +
            `}\n` +
            `\n` +
            `export function getSecret() {\n` +
            `  return load('data').secret;\n` +
            `}\n`,
    );
    return pkgDir;
}

/**
 * A CJS `node_modules/@fixture/cjs-reader` package whose entry reads a sibling
 * data file via `__dirname` (CJS — no `import.meta.url`). Reproduces the
 * `@gjsify/tsc` class of bug: tsc derives its default-lib dir from `__dirname`
 * of `_tsc.js`, and the naive rewriter baked the build machine's absolute path.
 * The dynamic name keeps the static-read inliner from collapsing it, so the
 * read survives to runtime and `__dirname` must resolve to the dep's real
 * on-disk location (case 4a — CJS runtime-resolve).
 */
function createCjsFixture(projectDir) {
    const pkgDir = join(projectDir, 'node_modules', '@fixture', 'cjs-reader');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
        join(pkgDir, 'package.json'),
        JSON.stringify(
            {
                name: '@fixture/cjs-reader',
                version: '1.0.0',
                main: './index.cjs',
                exports: { '.': './index.cjs' },
            },
            null,
            2,
        ),
    );
    writeFileSync(join(pkgDir, 'data.json'), JSON.stringify({ secret: 'cjs-resolved-at-runtime' }) + '\n');
    writeFileSync(
        join(pkgDir, 'index.cjs'),
        `const { readFileSync } = require('node:fs');\n` +
            `const { join } = require('node:path');\n` +
            `\n` +
            `// __dirname (CJS) → rewritten to the runtime resolver; dynamic name\n` +
            `// keeps the static-read inliner from collapsing it.\n` +
            `function load(name) {\n` +
            `  return JSON.parse(readFileSync(join(__dirname, name + '.json'), 'utf8'));\n` +
            `}\n` +
            `\n` +
            `exports.getSecret = function getSecret() {\n` +
            `  return load('data').secret;\n` +
            `};\n`,
    );
    return pkgDir;
}

describe('Published-bundle runtime resolve E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-published-bundle-reads-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        setupProject(
            projectDir,
            {
                name: 'test-published-bundle-reads',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: { '@gjsify/cli': '^0.1.0' },
            },
            tarballsDir,
            tarballMap,
        );

        createFixture(projectDir);
        createCjsFixture(projectDir);

        writeFileSync(
            join(projectDir, 'src', 'app.ts'),
            `import { getSecret } from '@fixture/dynamic-reader';\n` + `console.log('OK:' + getSecret());\n`,
        );
        writeFileSync(
            join(projectDir, 'src', 'cjs-app.ts'),
            `import { getSecret } from '@fixture/cjs-reader';\n` + `console.log('CJSOK:' + getSecret());\n`,
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    it('rewrites a dynamic dep read to runtime resolution and survives relocation', () => {
        const outDir = join(projectDir, 'dist');
        mkdirSync(outDir, { recursive: true });
        const bundlePath = join(outDir, 'app.gjs.mjs');
        execFileSync('npx', ['gjsify', 'build', 'src/app.ts', '--app', 'gjs', '--outfile', bundlePath, '--no-minify'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 120 * 1000,
        });

        assert.ok(existsSync(bundlePath), 'bundle missing');
        const bundle = readFileSync(bundlePath, 'utf-8');

        // The dep's import.meta.url must be rewritten to the runtime resolver
        // keyed by the dep's package-qualified spec — NOT a build-relative path.
        assert.ok(
            bundle.includes('__gjsifyModuleUrl("@fixture/dynamic-reader/index.js")'),
            'bundle does not route the dep read through the runtime resolver',
        );
        assert.ok(bundle.includes('globalThis.__gjsifyBundleUrl'), 'bundle is missing the bundle-URL anchor banner');
        // The build-relative path the old rewriter baked must be gone.
        assert.ok(
            !bundle.includes('../../../node_modules/@fixture/dynamic-reader'),
            'bundle still bakes a build-relative path to the dep (the publish bug)',
        );

        if (!hasCommand('gjs')) return;

        // Build-site run (sanity).
        const out0 = execFileSync('gjs', ['-m', bundlePath], { stdio: 'pipe', timeout: 30 * 1000 }).toString();
        assert.match(out0, /^OK:resolved-at-runtime/, `build-site run failed. Got: ${out0}`);

        // Simulate PUBLISH: place the bundle at a DIFFERENT node_modules depth
        // (node_modules/@app/cli/bin/<bundle>) with the dep installed alongside
        // (node_modules/@fixture/dynamic-reader/). This is the exact layout the
        // build-relative path got wrong. createRequire must walk up from the
        // bundle and find the dep here.
        const installRoot = join(tmpDir, 'installed');
        const binDir = join(installRoot, 'node_modules', '@app', 'cli', 'bin');
        mkdirSync(binDir, { recursive: true });
        cpSync(bundlePath, join(binDir, 'app.gjs.mjs'));
        cpSync(
            join(projectDir, 'node_modules', '@fixture', 'dynamic-reader'),
            join(installRoot, 'node_modules', '@fixture', 'dynamic-reader'),
            { recursive: true },
        );

        const out1 = execFileSync('gjs', ['-m', join(binDir, 'app.gjs.mjs')], {
            stdio: 'pipe',
            timeout: 30 * 1000,
        }).toString();
        assert.match(
            out1,
            /^OK:resolved-at-runtime/,
            `relocated (published-layout) bundle failed to resolve the dep read. Got: ${out1}`,
        );
    });

    it('rewrites a CJS dep __dirname read to runtime resolution and survives relocation', () => {
        const outDir = join(projectDir, 'dist');
        mkdirSync(outDir, { recursive: true });
        const bundlePath = join(outDir, 'cjs-app.gjs.mjs');
        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/cjs-app.ts', '--app', 'gjs', '--outfile', bundlePath, '--no-minify'],
            { cwd: projectDir, stdio: 'pipe', timeout: 120 * 1000 },
        );

        assert.ok(existsSync(bundlePath), 'cjs bundle missing');
        const bundle = readFileSync(bundlePath, 'utf-8');

        // The CJS dep's __dirname must be rewritten to the runtime resolver
        // keyed by the dep's package-qualified spec — NOT a build-relative path.
        assert.ok(
            bundle.includes('__gjsifyModuleDir("@fixture/cjs-reader/index.cjs")'),
            'cjs bundle does not route __dirname through the runtime resolver',
        );
        assert.ok(bundle.includes('globalThis.__gjsifyBundleUrl'), 'cjs bundle is missing the bundle-URL anchor banner');
        // No absolute build-machine path may be baked for the dep (the publish bug).
        assert.ok(
            !bundle.includes(join(projectDir, 'node_modules', '@fixture', 'cjs-reader')),
            'cjs bundle still bakes the absolute build path to the dep (the publish bug)',
        );

        if (!hasCommand('gjs')) return;

        // Build-site run (sanity).
        const out0 = execFileSync('gjs', ['-m', bundlePath], { stdio: 'pipe', timeout: 30 * 1000 }).toString();
        assert.match(out0, /^CJSOK:cjs-resolved-at-runtime/, `cjs build-site run failed. Got: ${out0}`);

        // Simulate PUBLISH at a different node_modules depth with the dep present.
        const installRoot = join(tmpDir, 'installed-cjs');
        const binDir = join(installRoot, 'node_modules', '@app', 'cli', 'bin');
        mkdirSync(binDir, { recursive: true });
        cpSync(bundlePath, join(binDir, 'cjs-app.gjs.mjs'));
        cpSync(
            join(projectDir, 'node_modules', '@fixture', 'cjs-reader'),
            join(installRoot, 'node_modules', '@fixture', 'cjs-reader'),
            { recursive: true },
        );

        const out1 = execFileSync('gjs', ['-m', join(binDir, 'cjs-app.gjs.mjs')], {
            stdio: 'pipe',
            timeout: 30 * 1000,
        }).toString();
        assert.match(
            out1,
            /^CJSOK:cjs-resolved-at-runtime/,
            `relocated (published-layout) cjs bundle failed to resolve the __dirname read. Got: ${out1}`,
        );
    });
});
