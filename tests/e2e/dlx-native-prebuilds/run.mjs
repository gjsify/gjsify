// E2E test for `gjsify dlx` / `gjsify run` native-prebuild env injection.
//
// Reproduces the showcase regression where `gjsify dlx <pkg>` failed with
// `Typelib file for namespace 'GjsifyHttpSoupBridge', version '1.0' not found`
// because the previous detection (`resolveNativePackages`) only iterated
// the bundle's package.json#dependencies (direct deps), missing transitive
// native deps like `@gjsify/http-soup-bridge`.
//
// Strategy: build a synthetic project with the consumer-facing layout
// `<root>/node_modules/<pkg>/dist/bundle.js` plus `@gjsify/http-soup-bridge`
// installed alongside (declared as a dep of <pkg>, mirroring the post-fix
// showcase shape). Then call the pure helper `computeNativeEnvForBundle()`
// from a CWD with no node_modules (simulating `npx @gjsify/cli showcase …`)
// and assert the bridge's prebuild dir lands in GI_TYPELIB_PATH /
// LD_LIBRARY_PATH from the **bundle-side** walk alone.
//
// This locks down both halves of the fix:
//   1. `runGjsBundle` walks node_modules from the bundle dir as well as CWD.
//   2. The walker scans every package, so transitive native deps surface
//      automatically.
//
// The second describe() block covers the OS-axis follow-up: the walker used to
// interpolate a literal `linux-` prefix, so it could only ever find a
// uname-style directory — never a `darwin-arm64` artifact at all.
//
// Every package in the release train now stages the ONE canonical spelling,
// `${process.platform}-${process.arch}` (`linux-x64`, `linux-arm64`,
// `darwin-arm64`, `win32-x64`). The uname spelling (`linux-x86_64`) survives
// only as a READ-side compat probe, so a tarball published before the rename —
// which ships that directory and may predate `gjsify.platforms` entirely —
// still loads. Both must resolve, and the emitted environment must name the
// variable the HOST's loader reads.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { createTestEnvironment, cleanupTestEnvironment, setupProject } from '../helpers.mjs';

describe('CLI dlx / native-prebuild env injection E2E', { timeout: 10 * 60 * 1000 }, () => {
    let tmpDir;
    let tarballsDir;
    let tarballMap;
    let projectDir;
    let bundlePath;
    /** A throwaway CWD with no node_modules — emulates `npx … showcase` invocation. */
    let cleanCwd;

    before(() => {
        const env = createTestEnvironment('gjsify-e2e-dlx-native-prebuilds-');
        tmpDir = env.tmpDir;
        tarballsDir = env.tarballsDir;
        tarballMap = env.tarballMap;

        projectDir = join(tmpDir, 'consumer');
        mkdirSync(projectDir, { recursive: true });

        // Synthetic consumer:
        //   - declares @gjsify/http-soup-bridge as a `dependencies` entry (the
        //     same fix applied to the express-webserver showcase post-bug).
        //   - the "bundle" lives directly in the project dir; no inner package.
        // What we're testing is the env walker, NOT the showcase package.
        setupProject(
            projectDir,
            {
                name: 'test-dlx-native-prebuilds',
                version: '0.1.0',
                type: 'module',
                private: true,
                dependencies: { '@gjsify/http-soup-bridge': '^0.1.0' },
            },
            tarballsDir,
            tarballMap,
        );

        // Emulate the dlx-cache layout where the bundle lives inside a nested
        // package dir so the walker has to climb up to reach node_modules/.
        const innerPkgDir = join(projectDir, 'node_modules', '@gjsify', 'fake-consumer');
        mkdirSync(join(innerPkgDir, 'dist'), { recursive: true });
        writeFileSync(
            join(innerPkgDir, 'package.json'),
            JSON.stringify({ name: '@gjsify/fake-consumer', version: '0.1.0', main: 'dist/bundle.js' }, null, 2),
        );
        bundlePath = join(innerPkgDir, 'dist', 'bundle.js');
        writeFileSync(bundlePath, '// synthetic bundle for env-detection test\n');

        // Sanity: the bridge's prebuilds dir exists in the install tree.
        const bridgeDir = join(projectDir, 'node_modules', '@gjsify', 'http-soup-bridge', 'prebuilds');
        assert.ok(existsSync(bridgeDir), `@gjsify/http-soup-bridge/prebuilds missing in install tree: ${bridgeDir}`);

        cleanCwd = mkdtempSync(join(tmpdir(), 'gjsify-e2e-dlx-native-prebuilds-cwd-'));
    });

    after(() => {
        if (cleanCwd) rmSync(cleanCwd, { recursive: true, force: true });
        cleanupTestEnvironment(tmpDir);
    });

    it('detects @gjsify/http-soup-bridge from the bundle dir, not from CWD', async () => {
        const cliReq = createRequire(import.meta.url);
        const utilsPath = cliReq.resolve('@gjsify/cli/lib/utils/run-gjs.js');
        const { computeNativeEnvForBundle } = await import(pathToFileURL(utilsPath).href);

        const { env, envPrefix } = computeNativeEnvForBundle(bundlePath, cleanCwd);

        assert.match(
            env.GI_TYPELIB_PATH ?? '',
            /@gjsify[\\/]http-soup-bridge[\\/]prebuilds[\\/]linux-/,
            'GI_TYPELIB_PATH should contain @gjsify/http-soup-bridge prebuild dir',
        );
        assert.match(
            env.LD_LIBRARY_PATH ?? '',
            /@gjsify[\\/]http-soup-bridge[\\/]prebuilds[\\/]linux-/,
            'LD_LIBRARY_PATH should contain @gjsify/http-soup-bridge prebuild dir',
        );
        assert.match(envPrefix, /GI_TYPELIB_PATH=/);
        assert.match(envPrefix, /LD_LIBRARY_PATH=/);
    });

    it('walks the bundle-side node_modules even when CWD has none', async () => {
        const cliReq = createRequire(import.meta.url);
        const utilsPath = cliReq.resolve('@gjsify/cli/lib/utils/run-gjs.js');
        const { computeNativeEnvForBundle } = await import(pathToFileURL(utilsPath).href);

        const fromBundleAndCleanCwd = computeNativeEnvForBundle(bundlePath, cleanCwd);
        const fromBundleAndProjectCwd = computeNativeEnvForBundle(bundlePath, projectDir);

        assert.ok(
            fromBundleAndCleanCwd.env.GI_TYPELIB_PATH.length > 0,
            'GI_TYPELIB_PATH must be populated from the bundle-side walk alone (regression case)',
        );
        assert.ok(
            fromBundleAndProjectCwd.env.GI_TYPELIB_PATH.length > 0,
            'GI_TYPELIB_PATH must be populated when CWD is the project dir',
        );
    });
});

describe('CLI native-prebuild resolution across naming conventions E2E', { timeout: 10 * 60 * 1000 }, () => {
    /** Legacy uname-style arch token — what pre-rename tarballs shipped. */
    const UNAME_ARCH = { x64: 'x86_64', arm64: 'aarch64', arm: 'armv7', ia32: 'i686' }[process.arch] ?? process.arch;
    /** Environment variable the host's dynamic loader actually consults. */
    const LIB_VAR =
        process.platform === 'darwin' ? 'DYLD_LIBRARY_PATH' : process.platform === 'win32' ? 'PATH' : 'LD_LIBRARY_PATH';

    let root;
    let bundlePath;
    let cleanCwd;

    /** Seed `<root>/node_modules/<name>` with a gjsify manifest + prebuild dirs. */
    const seed = (name, prebuildDirs, platforms) => {
        const pkgDir = join(root, 'node_modules', ...name.split('/'));
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(
            join(pkgDir, 'package.json'),
            JSON.stringify({
                name,
                version: '1.0.0',
                gjsify: { prebuilds: 'prebuilds', ...(platforms ? { platforms } : {}) },
            }),
        );
        for (const dir of prebuildDirs) {
            mkdirSync(join(pkgDir, 'prebuilds', dir), { recursive: true });
            writeFileSync(join(pkgDir, 'prebuilds', dir, 'placeholder'), '');
        }
    };

    before(() => {
        root = mkdtempSync(join(tmpdir(), 'gjsify-e2e-prebuild-naming-'));
        writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'naming-consumer', private: true }));

        // Legacy uname-style — a tarball published before the rename
        // (`prebuilds/linux-x86_64`), with no `gjsify.platforms` to probe.
        seed('@test/uname-style', [`${process.platform}-${UNAME_ARCH}`]);
        // The canonical spelling every current package stages + declares
        // (`prebuilds/${process.platform}-${process.arch}`).
        seed('@test/node-style', [`${process.platform}-${process.arch}`]);
        // Declares its own spelling AND ships only a foreign platform: must be
        // skipped cleanly, exactly like @gjsify/sab-native on a Mac.
        seed('@test/foreign-only', ['plan9-sparc'], ['plan9-sparc']);

        bundlePath = join(root, 'bundle.js');
        writeFileSync(bundlePath, '// synthetic bundle\n');
        cleanCwd = mkdtempSync(join(tmpdir(), 'gjsify-e2e-prebuild-naming-cwd-'));
    });

    after(() => {
        if (cleanCwd) rmSync(cleanCwd, { recursive: true, force: true });
        if (root) rmSync(root, { recursive: true, force: true });
    });

    it('resolves the canonical spelling AND a pre-rename uname-style directory', async () => {
        const cliReq = createRequire(import.meta.url);
        const { computeNativeEnvForBundle } = await import(
            pathToFileURL(cliReq.resolve('@gjsify/cli/lib/utils/run-gjs.js')).href
        );
        const { env } = computeNativeEnvForBundle(bundlePath, cleanCwd);

        assert.ok(
            env.GI_TYPELIB_PATH.includes(join('uname-style', 'prebuilds', `${process.platform}-${UNAME_ARCH}`)),
            `uname-style prebuild dir missing from GI_TYPELIB_PATH: ${env.GI_TYPELIB_PATH}`,
        );
        assert.ok(
            env.GI_TYPELIB_PATH.includes(join('node-style', 'prebuilds', `${process.platform}-${process.arch}`)),
            `node-style prebuild dir missing from GI_TYPELIB_PATH: ${env.GI_TYPELIB_PATH}`,
        );
    });

    it('skips a package that ships nothing for this host', async () => {
        const cliReq = createRequire(import.meta.url);
        const { computeNativeEnvForBundle } = await import(
            pathToFileURL(cliReq.resolve('@gjsify/cli/lib/utils/run-gjs.js')).href
        );
        const { env } = computeNativeEnvForBundle(bundlePath, cleanCwd);
        assert.ok(!env.GI_TYPELIB_PATH.includes('foreign-only'), 'a foreign-platform-only package must not resolve');
    });

    it('emits the library variable THIS host’s loader reads, and no other', async () => {
        const cliReq = createRequire(import.meta.url);
        const { computeNativeEnvForBundle } = await import(
            pathToFileURL(cliReq.resolve('@gjsify/cli/lib/utils/run-gjs.js')).href
        );
        const { env, envPrefix } = computeNativeEnvForBundle(bundlePath, cleanCwd);

        assert.ok(env[LIB_VAR], `expected ${LIB_VAR} to be set on ${process.platform}`);
        assert.match(envPrefix, new RegExp(`${LIB_VAR}=`));
        for (const other of ['LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH'].filter((v) => v !== LIB_VAR)) {
            assert.equal(env[other], undefined, `${other} must not be emitted on ${process.platform}`);
        }
    });
});
