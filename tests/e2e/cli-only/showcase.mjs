// E2E test for `gjsify showcase` command.
// Verifies that listing mode works correctly and that invalid example names
// produce helpful errors. Does not test actual GJS execution (needs display + GTK).
// Requires: yarn build && yarn build:examples (monorepo must be built first)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

/** Run gjsify showcase and return { stdout, stderr, exitCode }. Never throws. */
function runShowcase(projectDir, args = []) {
  try {
    const stdout = execFileSync('npx', ['gjsify', 'showcase', ...args], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 30 * 1000,
      encoding: 'utf8',
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

describe('gjsify showcase E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-showcase-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'showcase-project');
    mkdirSync(projectDir, { recursive: true });

    setupProject(projectDir, {
      name: 'test-showcase',
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

  it('listing mode exits with code 0', () => {
    const { exitCode } = runShowcase(projectDir);
    assert.equal(exitCode, 0, 'gjsify showcase should exit 0 in listing mode');
  });

  it('output contains known example names', () => {
    const { stdout } = runShowcase(projectDir);
    const expected = ['three-geometry-shapes', 'canvas2d-confetti', 'cli-node-path'];
    for (const name of expected) {
      assert.ok(stdout.includes(name), `Missing example "${name}" in output:\n${stdout}`);
    }
  });

  it('output groups by category (DOM and NODE)', () => {
    const { stdout } = runShowcase(projectDir);
    assert.ok(stdout.includes('DOM:'), `Missing "DOM:" category header\n${stdout}`);
    assert.ok(stdout.includes('NODE:'), `Missing "NODE:" category header\n${stdout}`);
  });

  it('output shows usage hint', () => {
    const { stdout } = runShowcase(projectDir);
    assert.ok(stdout.includes('gjsify showcase'), `Missing usage hint\n${stdout}`);
  });

  it('--json outputs valid JSON array', () => {
    const { stdout, exitCode } = runShowcase(projectDir, ['--json']);
    assert.equal(exitCode, 0);
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      assert.fail(`Output is not valid JSON:\n${stdout}`);
    }
    assert.ok(Array.isArray(parsed), 'JSON output should be an array');
    assert.ok(parsed.length > 0, 'JSON array should not be empty');
  });

  it('--json entries have required fields', () => {
    const { stdout } = runShowcase(projectDir, ['--json']);
    const parsed = JSON.parse(stdout);
    for (const entry of parsed) {
      assert.ok('name' in entry, `Missing "name": ${JSON.stringify(entry)}`);
      assert.ok('packageName' in entry, `Missing "packageName": ${JSON.stringify(entry)}`);
      assert.ok('category' in entry, `Missing "category": ${JSON.stringify(entry)}`);
      assert.ok('bundlePath' in entry, `Missing "bundlePath": ${JSON.stringify(entry)}`);
      assert.equal(typeof entry.name, 'string');
      assert.equal(typeof entry.packageName, 'string');
      assert.ok(['dom', 'node'].includes(entry.category), `Invalid category: ${entry.category}`);
    }
  });

  it('--json contains known examples', () => {
    const { stdout } = runShowcase(projectDir, ['--json']);
    const parsed = JSON.parse(stdout);
    const names = parsed.map(e => e.name);
    assert.ok(names.includes('three-geometry-shapes'), 'Missing three-geometry-shapes');
    assert.ok(names.includes('canvas2d-confetti'), 'Missing canvas2d-confetti');
    assert.ok(names.includes('cli-node-path'), 'Missing cli-node-path');
  });

  it('running a webgl example does not fail with Gwebgl typelib error', () => {
    // Run a WebGL example — it will fail (no display/GTK in headless),
    // but the error must NOT be about Gwebgl typelib resolution.
    // This proves that runGjsBundle resolves native prebuilds from the bundle's location.
    const { stdout, stderr, exitCode } = runShowcase(projectDir, ['three-postprocessing-pixel']);
    const combined = stdout + stderr;

    // If the example isn't installed, skip gracefully
    if (combined.includes('Unknown example')) {
      return;
    }

    assert.ok(
      !combined.includes('Typelib file for namespace \'Gwebgl\''),
      `Gwebgl typelib should be resolved via native prebuilds, but got:\n${combined}`,
    );
  });

  it('invalid example name exits non-zero with helpful error', () => {
    const { stderr, exitCode } = runShowcase(projectDir, ['nonexistent-example-xyz']);
    assert.ok(exitCode !== 0, 'Should exit non-zero for invalid name');
    const combined = stderr;
    assert.ok(
      combined.includes('nonexistent-example-xyz') || combined.includes('Unknown example'),
      `Error should mention the invalid name:\n${combined}`,
    );
  });
});
