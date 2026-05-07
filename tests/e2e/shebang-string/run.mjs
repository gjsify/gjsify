// E2E test for the `shebang` config field as a string template.
// Validates `${env:NAME}` and `${env:NAME:-default}` expansion against
// `process.env`. Required so that build tooling like Meson (used by
// Flatpak-driven GJS apps) can thread the build-time GJS interpreter path
// (`GJS_CONSOLE`) into the bundle's shebang without a wrapper script.

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

describe('CLI shebang-string E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-shebang-string-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'shebang-string-project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-shebang-string',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: {
        bundler: { output: { file: 'dist/app.js', minify: false } },
        // Test:
        // - GJS_CONSOLE_TEST is unset → fallback `/usr/bin/env -S gjs` is used
        // - When env is set in the second case, the env value wins
        shebang: '${env:GJS_CONSOLE_TEST:-/usr/bin/env -S gjs} -m',
      },
    }, tarballsDir, tarballMap);

    writeFileSync(join(projectDir, 'src', 'app.ts'), `console.log('hi');\n`);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('expands ${env:NAME:-default} fallback when env is unset', () => {
    execFileSync('npx', ['gjsify', 'build', 'src/app.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'app.js')), 'dist/app.js missing');
    const out = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');
    const firstLine = out.split('\n')[0];
    assert.equal(
      firstLine,
      '#!/usr/bin/env -S gjs -m',
      `expected fallback shebang, got: ${firstLine}`,
    );
  });

  it('expands ${env:NAME} from process.env when set', () => {
    execFileSync('npx', ['gjsify', 'build', 'src/app.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
      env: { ...process.env, GJS_CONSOLE_TEST: '/usr/bin/gjs-console' },
    });
    const out = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');
    const firstLine = out.split('\n')[0];
    assert.equal(
      firstLine,
      '#!/usr/bin/gjs-console -m',
      `expected env-set shebang, got: ${firstLine}`,
    );
  });
});
