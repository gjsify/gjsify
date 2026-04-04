// E2E test for @gjsify/cli build without a user-defined package.json.
// Simulates: npx @gjsify/cli build — only the CLI is installed, no explicit polyfill deps.
// The CLI transitively brings @gjsify/node-polyfills and @gjsify/web-polyfills.
// Requires: yarn build (monorepo must be built first)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

describe('CLI-only E2E (no user polyfill deps)', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-cli-only-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    // Create a minimal project with ONLY @gjsify/cli as a dependency
    projectDir = join(tmpDir, 'cli-only-project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-cli-only',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: {
        '@gjsify/cli': '^0.1.0',
      },
    }, tarballsDir, tarballMap);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('builds a minimal console-only script', () => {
    writeFileSync(join(projectDir, 'src', 'index.ts'),
      "console.log('Hello from gjsify!');\n"
    );
    execSync('npx gjsify build src/index.ts --outfile dist/console-only.js', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'console-only.js')), 'dist/console-only.js missing');
  });

  it('builds a script importing node:path (alias resolves via CLI deps)', () => {
    writeFileSync(join(projectDir, 'src', 'with-path.ts'),
      "import * as path from 'node:path';\nconsole.log(path.join('a', 'b'));\n"
    );
    execSync('npx gjsify build src/with-path.ts --outfile dist/with-path.js', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'with-path.js')), 'dist/with-path.js missing');
  });

  it('builds a script importing node:events (alias resolves via CLI deps)', () => {
    writeFileSync(join(projectDir, 'src', 'with-events.ts'),
      "import { EventEmitter } from 'node:events';\nconst ee = new EventEmitter();\nconsole.log(ee);\n"
    );
    execSync('npx gjsify build src/with-events.ts --outfile dist/with-events.js', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'with-events.js')), 'dist/with-events.js missing');
  });

  it('build output is valid JavaScript', () => {
    for (const file of ['dist/console-only.js', 'dist/with-path.js', 'dist/with-events.js']) {
      const fullPath = join(projectDir, file);
      if (!existsSync(fullPath)) continue;
      execFileSync('node', ['--check', fullPath], { stdio: 'pipe' });
    }
  });

  it('gjsify check --json resolves gwebgl via CLI fallback (not in project deps)', () => {
    // The project only has @gjsify/cli — @gjsify/webgl is NOT a direct dep.
    // checkNpmPackage must fall back to the CLI's own node_modules.
    const out = execFileSync('npx', ['gjsify', 'check', '--json'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30 * 1000,
    });
    const result = JSON.parse(out);
    const gwebgl = result.deps.find(d => d.id === 'gwebgl');
    assert.ok(gwebgl, 'gwebgl check should be present in results');
    assert.strictEqual(gwebgl.found, true,
      'gwebgl should be found via CLI fallback when not in project deps');
  });

  it('gjsify check --json resolves gwebgl from project deps (primary path)', () => {
    // Create a second project that has @gjsify/webgl as a direct dependency.
    // checkNpmPackage should find it from the project's own node_modules first.
    const webglProjectDir = join(tmpDir, 'webgl-project');
    mkdirSync(webglProjectDir, { recursive: true });

    setupProject(webglProjectDir, {
      name: 'test-webgl-check',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: {
        '@gjsify/cli': '^0.1.0',
        '@gjsify/webgl': '^0.1.0',
      },
    }, tarballsDir, tarballMap);

    const out = execFileSync('npx', ['gjsify', 'check', '--json'], {
      cwd: webglProjectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30 * 1000,
    });
    const result = JSON.parse(out);
    const gwebgl = result.deps.find(d => d.id === 'gwebgl');
    assert.ok(gwebgl, 'gwebgl check should be present in results');
    assert.strictEqual(gwebgl.found, true,
      'gwebgl should be found from project node_modules (primary path)');
  });

  it('gjsify showcase --list succeeds without errors', () => {
    const out = execFileSync('npx', ['gjsify', 'showcase', '--json'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30 * 1000,
    });
    const examples = JSON.parse(out);
    assert.ok(Array.isArray(examples), 'showcase --json should return an array');
    assert.ok(examples.length > 0, 'should have at least one example');
  });
});
