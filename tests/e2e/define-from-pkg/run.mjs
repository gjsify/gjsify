// E2E test for defineFromPackageJson / defineFromEnv config keys.
//
// Validates that both keys flow through cosmiconfig → bundler.transform.define
// and that values are JSON-stringified (so the resulting bundle inlines them
// as JS expressions). Replaces the wrapper-script pattern (spawnSync +
// --define KEY=JSON.stringify(value)) used by external consumers like
// @ts-for-gir/cli before this option existed.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

describe('defineFromPackageJson / defineFromEnv E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-define-from-pkg-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'define-from-pkg-project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-define-from-pkg',
      version: '7.42.99',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: {
        bundler: { output: { file: 'dist/app.js', minify: false } },
        defineFromPackageJson: {
          __PKG_VERSION__: { field: 'version' },
          __PKG_NAME__: { field: 'name' },
        },
        defineFromEnv: {
          __APP_ID__: { env: 'TEST_DEFINE_APP_ID', default: 'org.example.fallback' },
          __MISSING__: { env: 'TEST_DEFINE_MISSING_NO_DEFAULT' },
        },
      },
    }, tarballsDir, tarballMap);

    // Source uses the defines directly. Rolldown substitutes at parse time,
    // so the resulting bundle should contain the literal values.
    writeFileSync(join(projectDir, 'src', 'app.ts'),
      `declare const __PKG_VERSION__: string;
declare const __PKG_NAME__: string;
declare const __APP_ID__: string;
declare const __MISSING__: string | undefined;
console.log(__PKG_VERSION__);
console.log(__PKG_NAME__);
console.log(__APP_ID__);
console.log(typeof __MISSING__);
`);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('inlines package.json fields and env-with-default values', () => {
    execFileSync('npx', ['gjsify', 'build', 'src/app.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
      env: { ...process.env, TEST_DEFINE_APP_ID: 'org.example.set' },
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'app.js')), 'dist/app.js missing');
    const out = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');
    assert.match(out, /"7\.42\.99"/, 'package.json#version not inlined');
    assert.match(out, /"test-define-from-pkg"/, 'package.json#name not inlined');
    assert.match(out, /"org\.example\.set"/, 'env-with-set value not inlined');
  });

  it('replaces missing env (no default) with the literal undefined', () => {
    // Same project, build without setting TEST_DEFINE_APP_ID — falls back to
    // default; TEST_DEFINE_MISSING_NO_DEFAULT remains unset.
    execFileSync('npx', ['gjsify', 'build', 'src/app.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    const out = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');
    assert.match(out, /"org\.example\.fallback"/, 'env-with-default not inlined when env unset');
    // The bundler replaces `__MISSING__` with the literal `undefined` at
    // transform time. Rolldown may constant-fold `typeof undefined` to the
    // string `"undefined"`, so we don't pin the exact post-fold shape — we
    // only require that the `__MISSING__` placeholder no longer appears in
    // the emitted bundle.
    assert.doesNotMatch(
      out,
      /__MISSING__/,
      '__MISSING__ literal still present in bundle — define substitution did not run',
    );
  });
});
