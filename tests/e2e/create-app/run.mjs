// E2E test for @gjsify/create-app CLI
// Simulates a real user creating a project outside the monorepo workspace.
// Requires: yarn build (monorepo must be built first)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pack all workspace tarballs via pack.sh, return { name: filename } map. */
function packWorkspaces(tarballsDir) {
  const stdout = execFileSync('bash', [join(__dirname, 'pack.sh'), tarballsDir], {
    cwd: MONOREPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
  });
  return JSON.parse(stdout);
}

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

  const toFileRef = (name) => {
    const filename = tarballMap[name];
    if (!filename) return undefined;
    return `file:${join(tarballsDir, filename)}`;
  };

  // Patch deps and devDeps
  for (const field of ['dependencies', 'devDependencies']) {
    if (!pkg[field]) continue;
    for (const [name] of Object.entries(pkg[field])) {
      if (name.startsWith('@girs/')) {
        delete pkg[field][name];
        continue;
      }
      const ref = toFileRef(name);
      if (ref) pkg[field][name] = ref;
    }
  }

  // Add overrides for ALL @gjsify/* packages so transitive deps resolve too
  pkg.overrides = {};
  for (const [name, filename] of Object.entries(tarballMap)) {
    pkg.overrides[name] = `file:${join(tarballsDir, filename)}`;
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('create-app E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let projectDir;
  let tarballsDir;

  before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-'));
    tarballsDir = join(tmpDir, 'tarballs');

    console.log(`  tmp dir: ${tmpDir}`);

    // 1. Pack all workspace packages
    console.log('  packing workspace packages...');
    const tarballMap = packWorkspaces(tarballsDir);
    const count = Object.keys(tarballMap).length;
    console.log(`  packed ${count} packages`);

    // 2. Scaffold project
    console.log('  scaffolding project...');
    projectDir = scaffold(tmpDir, 'test-app');

    // 3. Replace src/index.ts with minimal content (no GTK)
    writeFileSync(join(projectDir, 'src', 'index.ts'), "console.log('Hello from gjsify!');\n");

    // 4. Patch package.json
    patchPackageJson(projectDir, tarballsDir, tarballMap);

    // 5. npm install
    console.log('  running npm install...');
    execSync('npm install --no-audit --no-fund', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 3 * 60 * 1000,
    });
    console.log('  npm install done');
  });

  after(() => {
    if (process.env.GJSIFY_E2E_KEEP_TEMP) {
      console.log(`  keeping tmp dir: ${tmpDir}`);
    } else if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('scaffolded project has expected files', () => {
    assert.ok(existsSync(join(projectDir, 'package.json')), 'package.json missing');
    assert.ok(existsSync(join(projectDir, 'tsconfig.json')), 'tsconfig.json missing');
    assert.ok(existsSync(join(projectDir, 'src', 'index.ts')), 'src/index.ts missing');
  });

  it('npm install created node_modules', () => {
    assert.ok(existsSync(join(projectDir, 'node_modules')), 'node_modules missing');
    assert.ok(existsSync(join(projectDir, 'node_modules', '.package-lock.json')), 'lockfile missing');
  });

  it('gjsify build succeeds with console shim (default)', () => {
    // This is the test that catches the @gjsify/console resolution bug.
    // The default GJS build injects console-gjs.js which imports @gjsify/console.
    execSync('npx gjsify build src/index.ts --outfile dist/index.js', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'index.js')), 'dist/index.js missing');
  });

  it('gjsify build succeeds with --no-console-shim', () => {
    execSync('npx gjsify build src/index.ts --outfile dist/no-shim.js --no-console-shim', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'no-shim.js')), 'dist/no-shim.js missing');
  });

  it('build output is valid JavaScript', () => {
    // node --check validates syntax without executing
    for (const file of ['dist/index.js', 'dist/no-shim.js']) {
      const fullPath = join(projectDir, file);
      if (!existsSync(fullPath)) continue;
      execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
    }
  });
});
