// E2E test for `gjsify build --library` with TWO outdirs (ESM + CJS).
//
// `BuildAction.buildLibrary()` runs two esbuild passes when
// `package.json#library.module` and `library.main` resolve to different
// directories — one ESM build into the module outdir, one CJS build into
// the main outdir. Two copy-paste bugs slipped into the second-pass options
// at one point: the wrong format token (CJS pass picked up the ESM
// `moduleFormat`) and the wrong extension token (jsExtension was set to a
// directory path instead of the file extension). Either silently produced a
// broken artifact — same code shape, wrong format — that loaded only by
// chance for callers that didn't care which file they picked.
//
// This test asserts both outputs use the format and extension declared by
// their respective package.json entries.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject, hasCommand, MONOREPO_ROOT } from '../helpers.mjs';

describe('Library multi-build E2E (ESM + CJS, separate outdirs)', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-library-multi-build-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'lib');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        setupProject(
            projectDir,
            {
                name: 'test-library-multi-build',
                version: '0.1.0',
                type: 'module',
                private: true,
                // Two distinct outdirs: dist/esm/ for ESM, dist/cjs/ for CJS. The
                // CJS outdir's `/cjs/` segment is what `buildLibrary` keys off to
                // pick the CJS format.
                module: 'dist/esm/index.js',
                main: 'dist/cjs/index.js',
                dependencies: {
                    '@gjsify/cli': '^0.1.0',
                },
            },
            tarballsDir,
            tarballMap,
        );

        writeFileSync(
            join(projectDir, 'src', 'index.ts'),
            `export const ANSWER = 42;\n` + `export function greet(name: string): string { return "hi " + name; }\n`,
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    it('produces ESM and CJS artifacts with the correct format + extension', () => {
        execFileSync('npx', ['gjsify', 'build', 'src/index.ts', '--library', '--app', 'node'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        });

        const esmPath = join(projectDir, 'dist', 'esm', 'index.js');
        const cjsPath = join(projectDir, 'dist', 'cjs', 'index.js');

        assert.ok(existsSync(esmPath), 'ESM artifact missing');
        assert.ok(existsSync(cjsPath), 'CJS artifact missing');

        const esm = readFileSync(esmPath, 'utf-8');
        const cjs = readFileSync(cjsPath, 'utf-8');

        // ESM: must use `export`, must NOT use CJS `module.exports`.
        assert.match(esm, /\bexport\b/, 'ESM artifact has no `export` — wrong format emitted');
        assert.doesNotMatch(esm, /\bmodule\.exports\b/, 'ESM artifact contains CJS `module.exports`');

        // CJS: must use `module.exports` / `exports.*`, must NOT use ESM `export`.
        assert.match(
            cjs,
            /\b(module\.exports|exports\.)/,
            'CJS artifact has no CJS exports — wrong format emitted (regression of format: moduleFormat copy-paste bug)',
        );
        assert.doesNotMatch(cjs, /^\s*export\s/m, 'CJS artifact contains ESM `export` keyword');
    });

    // --- Library-mode externalization policy (functional, not just shape) ---
    //
    // `--library` output must re-export its dep tree BY REFERENCE: a bare /
    // scoped import stays an import of the ORIGINAL specifier and the dep's
    // source is NOT inlined into the emitted package. The policy is enforced
    // by `externalsPlugin(isExternalSpecifier)` (a resolveId hook returning
    // `{ external: true }`) because the top-level `external` FUNCTION option
    // is silently dropped at @gjsify/rolldown-native's JSON options boundary
    // — inlining a workspace dep bakes a private copy into each consumer and
    // breaks module-level brand checks (the shipped `@gjsify/web-streams`
    // `transform.readable must be a ReadableStream` bug). Before this test
    // the only guard was the CI grep counting 'must be a ReadableStream'
    // occurrences in the committed CLI bundle.

    const DEP_MARKER = 'FAKE_DEP_MARKER_must_not_be_inlined_a3f9';

    function setupExternalizationFixture() {
        // A RESOLVABLE fake dependency — the dangerous case. Unresolvable
        // specifiers ride rolldown's unresolved-import→external fallback by
        // accident; a resolvable one is only kept external by the policy.
        const depDir = join(projectDir, 'node_modules', '@scope', 'fake-dep');
        mkdirSync(depDir, { recursive: true });
        writeFileSync(
            join(depDir, 'package.json'),
            JSON.stringify({ name: '@scope/fake-dep', version: '1.0.0', type: 'module', main: 'index.js' }),
        );
        writeFileSync(join(depDir, 'index.js'), `export const marker = '${DEP_MARKER}';\n`);

        writeFileSync(join(projectDir, 'src', 'util2.ts'), `export function helper(): number { return 7; }\n`);
        writeFileSync(
            join(projectDir, 'src', 'entry2.ts'),
            `import { marker } from '@scope/fake-dep';\n` +
                `import { helper } from './util2.js';\n` +
                `export const combined = marker + helper();\n`,
        );
    }

    function assertNoInlining(label) {
        const entryPath = join(projectDir, 'dist', 'esm', 'entry2.js');
        const utilPath = join(projectDir, 'dist', 'esm', 'util2.js');
        assert.ok(existsSync(entryPath), `[${label}] ESM entry2.js missing`);

        const entry = readFileSync(entryPath, 'utf-8');

        // The bare scoped dep survives VERBATIM as a by-reference import.
        // (`\s*` — minified output omits the space after `from`.)
        assert.match(
            entry,
            /from\s*["']@scope\/fake-dep["']/,
            `[${label}] '@scope/fake-dep' import was not preserved verbatim — externals policy regressed`,
        );
        // …and its source text is NOT inlined into the emitted package.
        assert.ok(
            !entry.includes(DEP_MARKER),
            `[${label}] dep source was INLINED into the library output (dropped externals predicate class)`,
        );

        // The package's own relative module IS bundled — emitted 1:1 as its
        // own file (preserveModules), imported relatively.
        assert.ok(existsSync(utilPath), `[${label}] relative module util2.js not emitted as its own file`);
        assert.match(
            entry,
            /from\s*["']\.\/util2\.js["']/,
            `[${label}] relative module import not preserved as relative`,
        );
        assert.ok(readFileSync(utilPath, 'utf-8').includes('helper'), `[${label}] util2.js lost its source`);
    }

    it('keeps a resolvable scoped dep external + bundles relative modules (npm engine)', () => {
        setupExternalizationFixture();

        execFileSync('npx', ['gjsify', 'build', 'src/entry2.ts', '--library', '--app', 'node'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 60 * 1000,
        });

        assertNoInlining('npm-engine');
    });

    it('keeps a resolvable scoped dep external under the native GJS engine', (t) => {
        // Engine-parity leg — the exact configuration the original bug
        // shipped in (function `external` dropped at the JSON boundary).
        // Runs the same build through the committed GJS CLI bundle +
        // @gjsify/rolldown-native; skipped when gjs or the prebuild are
        // not present (e.g. non-Fedora dev boxes without the typelib).
        const gjsBundle = join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
        const archDir = process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
        const prebuildDir = join(
            MONOREPO_ROOT,
            'node_modules',
            '@gjsify',
            'rolldown-native',
            'prebuilds',
            archDir,
        );
        const nativeLib = join(MONOREPO_ROOT, 'node_modules', '@gjsify', 'rolldown-native', 'lib', 'esm', 'index.js');
        if (!hasCommand('gjs') || !existsSync(gjsBundle) || !existsSync(prebuildDir) || !existsSync(nativeLib)) {
            t.skip('gjs or @gjsify/rolldown-native (prebuild + built lib) not available');
            return;
        }

        setupExternalizationFixture();
        // `gjs -m` is invoked directly (not via the node_modules/.bin shim),
        // so the typelib search paths the shim would export must be set here
        // — without them the native probe fails and the CLI falls back to
        // npm rolldown, which cannot load under GJS. GJSIFY_BUNDLER=native
        // makes a probe failure LOUD instead of a confusing fallback error.
        execFileSync('gjs', ['-m', gjsBundle, 'build', 'src/entry2.ts', '--library', '--app', 'node'], {
            cwd: projectDir,
            stdio: 'pipe',
            timeout: 5 * 60 * 1000,
            env: {
                ...process.env,
                GJSIFY_BUNDLER: 'native',
                GI_TYPELIB_PATH: `${prebuildDir}${process.env.GI_TYPELIB_PATH ? `:${process.env.GI_TYPELIB_PATH}` : ''}`,
                LD_LIBRARY_PATH: `${prebuildDir}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}`,
            },
        });

        assertNoInlining('native-engine');
    });
});
