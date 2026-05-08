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

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

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
    writeFileSync(bundlePath, "// synthetic bundle for env-detection test\n");

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
