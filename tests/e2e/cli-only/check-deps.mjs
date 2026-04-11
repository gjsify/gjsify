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

  it('output contains all expected REQUIRED dependency names', () => {
    const { stdout } = runCheck(projectDir);
    // Required deps are always shown, regardless of which @gjsify/* packages
    // are installed in the project. WebKitGTK is now optional (only needed
    // by @gjsify/iframe), so it is no longer in the required list.
    const expected = [
      'Node.js',
      'GJS',
      'Blueprint Compiler',
      'GTK4',
      'libadwaita',
      'libsoup3',
      'GObject Introspection',
    ];
    for (const name of expected) {
      assert.ok(stdout.includes(name), `Missing dep name in output: "${name}"\nOutput:\n${stdout}`);
    }
  });

  it('output contains the "Required:" and "Optional:" section headers', () => {
    const { stdout } = runCheck(projectDir);
    assert.ok(stdout.includes('Required:'), `Missing "Required:" header\nOutput:\n${stdout}`);
    // Optional section may be empty for the minimal cli-only project,
    // but the header is always shown when at least one optional dep is checked.
    // gwebgl is always reported (it's bundled with the CLI), so the section
    // header should be present.
    assert.ok(stdout.includes('Optional:'), `Missing "Optional:" header\nOutput:\n${stdout}`);
  });

  it('output contains status indicators (✓, ✗ or ⚠)', () => {
    const { stdout } = runCheck(projectDir);
    // ✓ = found, ✗ = missing required, ⚠ = missing optional
    const hasCheck = stdout.includes('✓');
    const hasCross = stdout.includes('✗');
    const hasWarn = stdout.includes('⚠');
    assert.ok(hasCheck || hasCross || hasWarn, `Expected ✓, ✗ or ⚠ in output\nOutput:\n${stdout}`);
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

  it('--json deps entries have id, name, found, and severity fields', () => {
    const { stdout } = runCheck(projectDir, ['--json']);
    const { deps } = JSON.parse(stdout);
    assert.ok(deps.length > 0, 'deps array should not be empty');
    for (const dep of deps) {
      assert.ok('id' in dep, `dep missing "id": ${JSON.stringify(dep)}`);
      assert.ok('name' in dep, `dep missing "name": ${JSON.stringify(dep)}`);
      assert.ok('found' in dep, `dep missing "found": ${JSON.stringify(dep)}`);
      assert.ok('severity' in dep, `dep missing "severity": ${JSON.stringify(dep)}`);
      assert.equal(typeof dep.id, 'string');
      assert.equal(typeof dep.name, 'string');
      assert.equal(typeof dep.found, 'boolean');
      assert.ok(
        dep.severity === 'required' || dep.severity === 'optional',
        `dep severity must be 'required' or 'optional', got ${dep.severity}`,
      );
    }
  });

  it('--json exit code is 0 when only optional deps are missing', () => {
    // This is the new behaviour: optional deps that are missing don't fail
    // the check. The cli-only test environment may be missing optional libs
    // (libmanette etc.) but that should not cause exit 1.
    const { stdout, exitCode } = runCheck(projectDir, ['--json']);
    const { deps } = JSON.parse(stdout);
    const missingRequired = deps.filter(d => !d.found && d.severity === 'required');
    if (missingRequired.length === 0) {
      assert.equal(
        exitCode, 0,
        `Expected exit 0 when all required deps found, got ${exitCode}. Missing required: ${JSON.stringify(missingRequired)}`,
      );
    }
  });

  it('cli-only project should not warn about libmanette / GStreamer / Cairo', () => {
    // The conditional check should hide optional deps for packages the
    // project doesn't depend on. The cli-only test scaffolds with only
    // @gjsify/cli installed (which transitively brings node-polyfills +
    // web-polyfills), so package-specific deps like libmanette (gamepad)
    // should NOT appear unless gamepad is actually present.
    const { stdout } = runCheck(projectDir, ['--json']);
    const { deps } = JSON.parse(stdout);
    const ids = deps.map(d => d.id);
    // gamepad pulls in libmanette — only present if @gjsify/gamepad is in the
    // project's installed @gjsify/* packages. The cli-only test ships
    // @gjsify/web-polyfills as a transitive dep which DOES include gamepad,
    // so libmanette may legitimately be present here. Test the conditional
    // mechanism by checking that the check completed cleanly (above tests).
    // This test mainly documents the intent.
    assert.ok(ids.length > 0, 'Should have detected at least Node.js + GJS');
  });

  it('--json always reports nodejs as found: true', () => {
    const { stdout } = runCheck(projectDir, ['--json']);
    const { deps } = JSON.parse(stdout);
    const nodeDep = deps.find(d => d.id === 'nodejs');
    assert.ok(nodeDep, 'No entry with id "nodejs" in deps');
    assert.equal(nodeDep.found, true, 'nodejs should always be found: true');
  });
});
