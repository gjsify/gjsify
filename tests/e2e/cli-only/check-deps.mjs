// E2E test for `gjsify check` command.
// Verifies that the command runs without crashing, produces correctly formatted output,
// and correctly reports Node.js as found (since the CLI itself runs in Node.js).
// Requires: yarn build (monorepo must be built first)

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

/** Run gjsify check and return { stdout, exitCode }. Never throws. */
function runCheck(projectDir, extraArgs = []) {
  try {
    const stdout = execFileSync('npx', ['gjsify', 'check', ...extraArgs], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 30 * 1000,
      encoding: 'utf8',
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    // execFileSync throws on non-zero exit; capture stdout from the error object
    return {
      stdout: err.stdout ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

describe('gjsify check E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-check-deps-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'check-deps-project');
    mkdirSync(projectDir, { recursive: true });

    setupProject(projectDir, {
      name: 'test-check-deps',
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

  it('exits with code 0 (all found) or 1 (some missing) — never crashes', () => {
    const { exitCode } = runCheck(projectDir);
    assert.ok(
      exitCode === 0 || exitCode === 1,
      `Expected exit code 0 or 1, got ${exitCode}`,
    );
  });

  it('output contains all expected dependency names', () => {
    const { stdout } = runCheck(projectDir);
    const expected = [
      'Node.js',
      'GJS',
      'Blueprint Compiler',
      'GTK4',
      'libadwaita',
      'libsoup3',
      'WebKitGTK',
      'GObject Introspection',
      'gwebgl',
    ];
    for (const name of expected) {
      assert.ok(stdout.includes(name), `Missing dep name in output: "${name}"\nOutput:\n${stdout}`);
    }
  });

  it('output contains status indicators (✓ or ✗)', () => {
    const { stdout } = runCheck(projectDir);
    const hasCheck = stdout.includes('✓');
    const hasCross = stdout.includes('✗');
    assert.ok(hasCheck || hasCross, `Expected ✓ or ✗ in output\nOutput:\n${stdout}`);
  });

  it('output contains "Package manager:" line', () => {
    const { stdout } = runCheck(projectDir);
    assert.ok(stdout.includes('Package manager:'), `Missing "Package manager:" line\nOutput:\n${stdout}`);
  });

  it('Node.js is always reported as found', () => {
    const { stdout } = runCheck(projectDir);
    assert.ok(stdout.includes('✓  Node.js'), `Expected "✓  Node.js" in output\nOutput:\n${stdout}`);
  });

  it('--json exits with code 0 or 1 and outputs valid JSON', () => {
    const { stdout, exitCode } = runCheck(projectDir, ['--json']);
    assert.ok(
      exitCode === 0 || exitCode === 1,
      `Expected exit code 0 or 1, got ${exitCode}`,
    );
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      assert.fail(`Output is not valid JSON\nOutput:\n${stdout}`);
    }
    assert.ok(parsed !== null && typeof parsed === 'object', 'JSON output should be an object');
  });

  it('--json output has "packageManager" and "deps" fields', () => {
    const { stdout } = runCheck(projectDir, ['--json']);
    const parsed = JSON.parse(stdout);
    assert.ok('packageManager' in parsed, 'Missing "packageManager" field in JSON');
    assert.ok('deps' in parsed, 'Missing "deps" field in JSON');
    assert.ok(Array.isArray(parsed.deps), '"deps" should be an array');
    assert.equal(typeof parsed.packageManager, 'string', '"packageManager" should be a string');
  });

  it('--json deps entries have id, name, and found fields', () => {
    const { stdout } = runCheck(projectDir, ['--json']);
    const { deps } = JSON.parse(stdout);
    assert.ok(deps.length > 0, 'deps array should not be empty');
    for (const dep of deps) {
      assert.ok('id' in dep, `dep missing "id": ${JSON.stringify(dep)}`);
      assert.ok('name' in dep, `dep missing "name": ${JSON.stringify(dep)}`);
      assert.ok('found' in dep, `dep missing "found": ${JSON.stringify(dep)}`);
      assert.equal(typeof dep.id, 'string');
      assert.equal(typeof dep.name, 'string');
      assert.equal(typeof dep.found, 'boolean');
    }
  });

  it('--json always reports nodejs as found: true', () => {
    const { stdout } = runCheck(projectDir, ['--json']);
    const { deps } = JSON.parse(stdout);
    const nodeDep = deps.find(d => d.id === 'nodejs');
    assert.ok(nodeDep, 'No entry with id "nodejs" in deps');
    assert.equal(nodeDep.found, true, 'nodejs should always be found: true');
  });
});
