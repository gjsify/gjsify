// E2E test for `--app nativescript` platform file resolution + platform defines.
//
// Verifies the `platformResolvePlugin` + `nativescriptPlatformDefines` wiring
// in `app/nativescript.ts`:
//
//   - `import './greeting'` resolves to the most specific platform variant on
//     disk — `greeting.android.ts` when building for android,
//     `greeting.native.ts` when no platform is set (native-but-not-browser),
//     never the base `greeting.ts` (the browser file) once a `.native`/
//     `.<platform>` sibling exists.
//   - the standard NS compile-time flags `__ANDROID__` / `__IOS__` / `__DEV__`
//     are statically replaced per target.
//
// The platform is taken from `NATIVESCRIPT_PLATFORM` (the same env NS' CLI
// passes through to a spawned bundler). Mirrors `tests/e2e/runtimes-routing`'s
// structure: pack workspace tarballs, install via npm overrides, drive the
// real `gjsify build`, assert bundle contents.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

describe('--app nativescript platform file resolution + defines', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-ns-platform-resolve-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'ns-platform-resolve-project');
        mkdirSync(join(projectDir, 'src'), { recursive: true });

        // Three variants of the same module — base (browser), platform-agnostic
        // native, and android-specific.
        writeFileSync(join(projectDir, 'src', 'greeting.ts'), "export const greeting = 'BASE_BROWSER_VARIANT';\n");
        writeFileSync(
            join(projectDir, 'src', 'greeting.native.ts'),
            "export const greeting = 'NATIVE_GENERIC_VARIANT';\n",
        );
        writeFileSync(
            join(projectDir, 'src', 'greeting.android.ts'),
            "export const greeting = 'ANDROID_PLATFORM_VARIANT';\n",
        );
        // Entry imports the bare `./greeting` (no platform suffix) + references
        // the compile-time platform flags.
        writeFileSync(
            join(projectDir, 'src', 'entry.ts'),
            [
                "import { greeting } from './greeting';",
                'declare const __ANDROID__: boolean;',
                'declare const __IOS__: boolean;',
                'declare const __DEV__: boolean;',
                "console.log('GREETING=' + greeting);",
                "console.log('ANDROID=' + __ANDROID__ + ' IOS=' + __IOS__ + ' DEV=' + __DEV__);",
                '',
            ].join('\n'),
        );

        setupProject(
            projectDir,
            {
                name: 'test-ns-platform-resolve',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: {
                    '@gjsify/cli': '^0.1.0',
                },
            },
            tarballsDir,
            tarballMap,
        );
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    // android target: the `.android` variant wins over `.native` + base, and
    // `__ANDROID__` is `true`.
    it('resolves the .android variant + sets __ANDROID__=true when NATIVESCRIPT_PLATFORM=android', () => {
        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/entry.ts', '--app', 'nativescript', '--outfile', 'dist/android.mjs'],
            {
                cwd: projectDir,
                stdio: 'pipe',
                timeout: 120 * 1000,
                env: { ...process.env, NATIVESCRIPT_PLATFORM: 'android' },
            },
        );

        const outPath = join(projectDir, 'dist', 'android.mjs');
        assert.ok(existsSync(outPath), 'dist/android.mjs missing');
        assert.ok(statSync(outPath).size > 0, 'dist/android.mjs is empty');

        const content = readFileSync(outPath, 'utf-8');
        assert.ok(
            content.includes('ANDROID_PLATFORM_VARIANT'),
            `android bundle MUST resolve greeting.android.ts.\nfirst 400: ${content.slice(0, 400)}`,
        );
        assert.ok(
            !content.includes('BASE_BROWSER_VARIANT') && !content.includes('NATIVE_GENERIC_VARIANT'),
            'android bundle MUST NOT contain the base or native variant',
        );
        // Defines were statically replaced (then the dead `IOS`/`DEV` branches
        // baked the literal flags into the log string).
        assert.ok(
            content.includes('ANDROID=true') && content.includes('IOS=false') && content.includes('DEV=false'),
            `android bundle MUST bake __ANDROID__=true / __IOS__=false / __DEV__=false.\nfirst 400: ${content.slice(0, 400)}`,
        );
    });

    it('android bundle is syntactically valid', () => {
        const outPath = join(projectDir, 'dist', 'android.mjs');
        if (!existsSync(outPath)) return;
        execFileSync('node', ['--check', outPath], { stdio: 'pipe', timeout: 30 * 1000 });
    });

    // No platform → `.native` wins over the base browser file, `__ANDROID__` is
    // `false`.
    it('falls back to the .native variant + sets __ANDROID__=false when no platform is set', () => {
        execFileSync(
            'npx',
            ['gjsify', 'build', 'src/entry.ts', '--app', 'nativescript', '--outfile', 'dist/default.mjs'],
            { cwd: projectDir, stdio: 'pipe', timeout: 120 * 1000 },
        );

        const outPath = join(projectDir, 'dist', 'default.mjs');
        assert.ok(existsSync(outPath), 'dist/default.mjs missing');

        const content = readFileSync(outPath, 'utf-8');
        assert.ok(
            content.includes('NATIVE_GENERIC_VARIANT'),
            `default bundle MUST resolve greeting.native.ts.\nfirst 400: ${content.slice(0, 400)}`,
        );
        assert.ok(
            !content.includes('BASE_BROWSER_VARIANT') && !content.includes('ANDROID_PLATFORM_VARIANT'),
            'default bundle MUST NOT contain the base or android variant',
        );
        assert.ok(
            content.includes('ANDROID=false') && content.includes('IOS=false'),
            `default bundle MUST bake __ANDROID__=false / __IOS__=false.\nfirst 400: ${content.slice(0, 400)}`,
        );
    });
});
