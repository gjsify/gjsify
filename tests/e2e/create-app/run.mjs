// E2E test for @gjsify/create-app CLI
// Scaffolds each template, patches @gjsify/* deps to local tarballs, installs,
// and runs `npm run build` to prove the template compiles end-to-end.
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

// Listing order matches the template catalog (simple first).
const TEMPLATES = [
  'gtk-minimal',
  'cli',
  'adw-canvas2d',
  'adw-webgl',
  'adw-game',
  'web-server-hono',
  'web-server-express',
];

// Templates that compile `.blp` files — require blueprint-compiler on PATH.
const BLUEPRINT_TEMPLATES = new Set(['adw-canvas2d', 'adw-webgl', 'adw-game']);

function hasBlueprintCompiler() {
  try {
    execFileSync('blueprint-compiler', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Scaffold a project using the create-app CLI with an explicit template. */
function scaffold(cwd, projectName, template) {
  const createAppBin = join(MONOREPO_ROOT, 'packages', 'infra', 'create-gjsify', 'lib', 'index.js');
  execFileSync('node', [createAppBin, projectName, '--template', template], {
    cwd,
    stdio: 'pipe',
  });
  return join(cwd, projectName);
}

/**
 * Patch the scaffolded package.json:
 * - Drop @girs/* (types-only; gi:// imports are externalized by esbuild).
 * - Remap @gjsify/* deps/devDeps to local tarballs.
 * - Leave third-party deps (hono, express, yargs, three, excalibur, …) as published versions.
 * - Add overrides for all @gjsify/* packages so transitive deps resolve to tarballs.
 */
function patchPackageJson(projectDir, tarballsDir, tarballMap) {
  const pkgPath = join(projectDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  for (const field of ['dependencies', 'devDependencies']) {
    if (!pkg[field]) continue;
    for (const name of Object.keys(pkg[field])) {
      if (name.startsWith('@girs/')) {
        delete pkg[field][name];
        continue;
      }
      const ref = toFileRef(name, tarballsDir, tarballMap);
      if (ref) pkg[field][name] = ref;
    }
  }

  pkg.overrides = buildOverrides(tarballsDir, tarballMap);

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('create-app E2E', { timeout: 60 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-create-app-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  for (const template of TEMPLATES) {
    describe(`template: ${template}`, { timeout: 10 * 60 * 1000 }, () => {
      let projectDir;
      let skipReason;

      before(() => {
        if (BLUEPRINT_TEMPLATES.has(template) && !hasBlueprintCompiler()) {
          skipReason = 'blueprint-compiler not installed';
          return;
        }

        console.log(`  [${template}] scaffolding…`);
        projectDir = scaffold(tmpDir, `test-${template}`, template);

        console.log(`  [${template}] patching package.json…`);
        patchPackageJson(projectDir, tarballsDir, tarballMap);

        console.log(`  [${template}] npm install…`);
        execSync('npm install --no-audit --no-fund', {
          cwd: projectDir,
          stdio: 'pipe',
          timeout: 5 * 60 * 1000,
        });
      });

      it('scaffolded project has expected files', (t) => {
        if (skipReason) return t.skip(skipReason);
        assert.ok(existsSync(join(projectDir, 'package.json')), 'package.json missing');
        assert.ok(existsSync(join(projectDir, 'tsconfig.json')), 'tsconfig.json missing');
        assert.ok(existsSync(join(projectDir, 'src', 'index.ts')), 'src/index.ts missing');
      });

      it('package.json was scaffolded with the expected name', (t) => {
        if (skipReason) return t.skip(skipReason);
        const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
        assert.equal(pkg.name, `test-${template}`, 'project name not rewritten');
        assert.notEqual(pkg.name, 'new-gjsify-app', 'sentinel name leaked through');
      });

      it('npm install created node_modules', (t) => {
        if (skipReason) return t.skip(skipReason);
        assert.ok(existsSync(join(projectDir, 'node_modules')), 'node_modules missing');
        assert.ok(
          existsSync(join(projectDir, 'node_modules', '.package-lock.json')),
          'lockfile missing',
        );
      });

      it('npm run build produces dist/index.js', (t) => {
        if (skipReason) return t.skip(skipReason);
        console.log(`  [${template}] npm run build…`);
        execSync('npm run build', {
          cwd: projectDir,
          stdio: 'pipe',
          timeout: 5 * 60 * 1000,
        });
        assert.ok(
          existsSync(join(projectDir, 'dist', 'index.js')),
          'dist/index.js missing after build',
        );
      });

      it('build output is valid JavaScript', (t) => {
        if (skipReason) return t.skip(skipReason);
        const outFile = join(projectDir, 'dist', 'index.js');
        if (!existsSync(outFile)) return t.skip('build output missing');
        execFileSync('node', ['--check', outFile], { stdio: 'pipe' });
      });
    });
  }
});
