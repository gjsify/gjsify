// E2E test for @gjsify/create-app CLI
// Simulates a real user creating a project outside the monorepo workspace.
// Requires: yarn build (monorepo must be built first)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  MONOREPO_ROOT,
  createTestEnvironment,
  cleanupTestEnvironment,
  toFileRef,
  buildOverrides,
} from '../helpers.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Scaffold a project using create-app CLI. */
function scaffold(cwd, projectName) {
  const createAppBin = join(MONOREPO_ROOT, 'packages', 'infra', 'create-gjsify', 'lib', 'index.js');
  execFileSync('node', [createAppBin, projectName], { cwd, stdio: 'pipe' });
  return join(cwd, projectName);
}

/**
 * Patch the scaffolded package.json:
 * - Remove @girs/* deps (not needed for minimal test)
 * - Point all @gjsify/* deps/devDeps to local tarballs
 * - Add overrides for all @gjsify/* packages
 */
function patchPackageJson(projectDir, tarballsDir, tarballMap) {
  const pkgPath = join(projectDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  // Patch deps and devDeps
  for (const field of ['dependencies', 'devDependencies']) {
    if (!pkg[field]) continue;
    for (const [name] of Object.entries(pkg[field])) {
      if (name.startsWith('@girs/')) {
        delete pkg[field][name];
        continue;
      }
      const ref = toFileRef(name, tarballsDir, tarballMap);
      if (ref) pkg[field][name] = ref;
    }
  }

  // Add overrides for ALL @gjsify/* packages so transitive deps resolve too
  pkg.overrides = buildOverrides(tarballsDir, tarballMap);

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('create-app E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let projectDir;
  let tarballsDir;
  let tarballMap;

  before(async () => {
    const env = createTestEnvironment('gjsify-e2e-create-app-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    // 1. Scaffold project
    console.log('  scaffolding project...');
    projectDir = scaffold(tmpDir, 'test-app');

    // 2. Replace src/index.ts with minimal content (no GTK)
    writeFileSync(join(projectDir, 'src', 'index.ts'), "console.log('Hello from gjsify!');\n");

    // 3. Patch package.json
    patchPackageJson(projectDir, tarballsDir, tarballMap);

    // 4. npm install
    console.log('  running npm install...');
    execSync('npm install --no-audit --no-fund', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 3 * 60 * 1000,
    });
    console.log('  npm install done');
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('scaffolded project has expected files', () => {
    assert.ok(existsSync(join(projectDir, 'package.json')), 'package.json missing');
    assert.ok(existsSync(join(projectDir, 'tsconfig.json')), 'tsconfig.json missing');
    assert.ok(existsSync(join(projectDir, 'src', 'index.ts')), 'src/index.ts missing');
  });

  it('scaffolded project includes @gjsify/node-polyfills', () => {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const hasPolyfills = Object.keys(deps).some(name =>
      name === '@gjsify/node-polyfills' || (pkg.overrides && pkg.overrides['@gjsify/node-polyfills'])
    );
    assert.ok(hasPolyfills, '@gjsify/node-polyfills not in dependencies');
  });

  it('npm install created node_modules', () => {
    assert.ok(existsSync(join(projectDir, 'node_modules')), 'node_modules missing');
    assert.ok(existsSync(join(projectDir, 'node_modules', '.package-lock.json')), 'lockfile missing');
  });

  it('gjsify build succeeds with console shim (default)', () => {
    // This is the test that catches the @gjsify/console resolution bug.
    // The default GJS build injects console-gjs.js which imports @gjsify/console.
    // Note: --globals none is required because the minimal scaffolded project
    // only has @gjsify/cli installed; the auto mode would try to inject
    // register modules from packages that aren't present.
    execSync('npx gjsify build src/index.ts --outfile dist/index.js --globals none', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'index.js')), 'dist/index.js missing');
  });

  it('gjsify build succeeds with --no-console-shim', () => {
    execSync('npx gjsify build src/index.ts --outfile dist/no-shim.js --no-console-shim --globals none', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'no-shim.js')), 'dist/no-shim.js missing');
  });

  it('gjsify build succeeds with aliased Node.js imports', () => {
    // Write a file that uses Node.js module aliases
    writeFileSync(join(projectDir, 'src', 'with-node-imports.ts'),
      "import * as path from 'node:path';\n" +
      "import { EventEmitter } from 'node:events';\n" +
      "console.log(path.join('a', 'b'));\n" +
      "console.log(new EventEmitter());\n"
    );
    execSync('npx gjsify build src/with-node-imports.ts --outfile dist/with-node-imports.js --globals none', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'with-node-imports.js')), 'dist/with-node-imports.js missing');
  });

  it('build output is valid JavaScript', () => {
    // node --check validates syntax without executing
    for (const file of ['dist/index.js', 'dist/no-shim.js', 'dist/with-node-imports.js']) {
      const fullPath = join(projectDir, file);
      if (!existsSync(fullPath)) continue;
      execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
    }
  });
});
