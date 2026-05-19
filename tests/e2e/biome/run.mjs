// E2E for `gjsify format` / `gjsify lint` / `gjsify fix`.
//
// Strategy: install the real `@biomejs/biome` (along with its
// transitive @biomejs/cli-<platform>-<arch> optional dep) and run our
// CLI against it. Verifies the binary-resolution + spawn pipeline
// end-to-end without stubbing biome — the resolver is the load-bearing
// new code path; biome's actual format/lint output is biome's job.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

const BIOME_VERSION = '^2.4.13';

describe('CLI gjsify format/lint/fix E2E (biome native-spawn)', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;
  let workspaceRoot;
  let subWorkspaceDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-biome-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    // === Standalone project (no workspaces) ===
    projectDir = join(tmpDir, 'standalone');
    mkdirSync(projectDir, { recursive: true });
    setupProject(projectDir, {
      name: 'standalone-biome-smoke',
      version: '0.0.1',
      type: 'module',
      private: true,
      devDependencies: {
        '@gjsify/cli': '^0.1.0',
        '@biomejs/biome': BIOME_VERSION,
      },
    }, tarballsDir, tarballMap);

    // === Workspace setup: root + one sub-workspace ===
    workspaceRoot = join(tmpDir, 'workspace');
    mkdirSync(join(workspaceRoot, 'packages', 'pkg-a', 'src'), { recursive: true });
    setupProject(workspaceRoot, {
      name: 'workspace-root',
      version: '0.0.1',
      type: 'module',
      private: true,
      workspaces: ['packages/*'],
      devDependencies: {
        '@gjsify/cli': '^0.1.0',
        '@biomejs/biome': BIOME_VERSION,
      },
    }, tarballsDir, tarballMap);
    subWorkspaceDir = join(workspaceRoot, 'packages', 'pkg-a');
    writeFileSync(join(subWorkspaceDir, 'package.json'), JSON.stringify({
      name: 'pkg-a',
      version: '0.0.1',
      type: 'module',
      private: true,
    }, null, 2) + '\n');
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('format --init writes recommended biome.json with GJS-tuned defaults', () => {
    const out = execFileSync('npx', ['gjsify', 'format', '--init'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    }).toString();

    assert.match(out, /wrote .+biome\.json/);
    assert.ok(existsSync(join(projectDir, 'biome.json')));

    const cfg = JSON.parse(readFileSync(join(projectDir, 'biome.json'), 'utf-8'));
    // Tuned defaults — JS/TS 4-space, JSON/CSS 2-space, single quotes, line 120
    assert.equal(cfg.formatter.indentWidth, 4);
    assert.equal(cfg.formatter.lineWidth, 120);
    assert.equal(cfg.javascript.formatter.quoteStyle, 'single');
    assert.equal(cfg.json.formatter.indentWidth, 2);
    assert.equal(cfg.css.formatter.indentWidth, 2);
    // Linter ON with GJS opt-outs
    assert.equal(cfg.linter.rules.recommended, true);
    assert.equal(cfg.linter.rules.style.noNonNullAssertion, 'off');
    assert.equal(cfg.linter.rules.suspicious.noConsole, 'off');
  });

  it('format --init does not overwrite existing biome.json without --force', () => {
    const sentinel = JSON.stringify({ formatter: { indentWidth: 99 } }, null, 2);
    writeFileSync(join(projectDir, 'biome.json'), sentinel);

    const out = execFileSync('npx', ['gjsify', 'format', '--init'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    }).toString();
    assert.match(out, /exists.*--force/i);
    assert.equal(readFileSync(join(projectDir, 'biome.json'), 'utf-8'), sentinel);

    // With --force, overwrite
    execFileSync('npx', ['gjsify', 'format', '--init', '--force'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    const cfg = JSON.parse(readFileSync(join(projectDir, 'biome.json'), 'utf-8'));
    assert.equal(cfg.formatter.indentWidth, 4, 'biome.json should be overwritten with the template');
  });

  it('format --write formats source files in place via the native biome binary', () => {
    writeFileSync(join(projectDir, 'test.ts'), 'const x={a:1,b:2};\n');

    execFileSync('npx', ['gjsify', 'format', '--write', 'test.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    const out = readFileSync(join(projectDir, 'test.ts'), 'utf-8');
    // Tuned defaults: single quotes, 4-space, space inside braces
    assert.match(out, /const x = \{ a: 1, b: 2 \};/);
  });

  it('format --check exits non-zero on drift (CI semantic)', () => {
    writeFileSync(join(projectDir, 'unformatted.ts'), 'const y={x:1};\n');

    const res = spawnSync('npx', ['gjsify', 'format', '--check', 'unformatted.ts'], {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 60 * 1000,
    });
    assert.notStrictEqual(res.status, 0, 'expected --check to exit non-zero on drift');
  });

  it('format resolves biome binary from workspace-root node_modules when run from sub-workspace', () => {
    writeFileSync(join(subWorkspaceDir, 'src', 'main.ts'), 'const z={a:1};\n');

    // Write the biome.json at workspace root (not in sub-workspace)
    execFileSync('npx', ['gjsify', 'format', '--init'], {
      cwd: workspaceRoot,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    // Run format from sub-workspace — biome lives at workspace root's node_modules
    execFileSync('npx', ['gjsify', 'format', '--write', 'src/main.ts'], {
      cwd: subWorkspaceDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    const out = readFileSync(join(subWorkspaceDir, 'src', 'main.ts'), 'utf-8');
    assert.match(out, /const z = \{ a: 1 \};/);
  });

  it('format surfaces a clear install hint when @biomejs/biome is missing', () => {
    const noBiomeDir = join(tmpDir, 'no-biome');
    mkdirSync(noBiomeDir, { recursive: true });
    setupProject(noBiomeDir, {
      name: 'no-biome',
      version: '0.0.1',
      type: 'module',
      private: true,
      devDependencies: {
        '@gjsify/cli': '^0.1.0',
        // Deliberately NO @biomejs/biome
      },
    }, tarballsDir, tarballMap);

    writeFileSync(join(noBiomeDir, 'test.ts'), 'const x=1;\n');

    const res = spawnSync('npx', ['gjsify', 'format', '--write', 'test.ts'], {
      cwd: noBiomeDir,
      encoding: 'utf-8',
      timeout: 60 * 1000,
    });
    assert.notStrictEqual(res.status, 0);
    const merged = (res.stdout ?? '') + (res.stderr ?? '');
    assert.match(merged, /biome native binary not found/i);
    assert.match(merged, /gjsify install -D @biomejs\/biome/);
  });

  it('lint reports diagnostics; --write applies safe fixes', () => {
    // `let` → `const` (useConst, never re-assigned) IS a safe biome fix.
    writeFileSync(join(projectDir, 'lint-test.ts'), `let x = 1;\nexport { x };\n`);

    const reportRes = spawnSync('npx', ['gjsify', 'lint', 'lint-test.ts'], {
      cwd: projectDir,
      encoding: 'utf-8',
      timeout: 60 * 1000,
    });
    const reportOut = (reportRes.stdout ?? '') + (reportRes.stderr ?? '');
    // useConst is part of biome's recommended set
    assert.match(reportOut, /useConst|const/i);

    execFileSync('npx', ['gjsify', 'lint', '--write', 'lint-test.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    const after = readFileSync(join(projectDir, 'lint-test.ts'), 'utf-8');
    assert.match(after, /^const x = 1;/m, '`let` should be rewritten to const');
  });

  it('fix runs biome check --write (format + safe-fix + organize-imports)', () => {
    writeFileSync(join(projectDir, 'fix-test.ts'), `import {join} from 'node:path';\nconst x={a:1,b:2};\n`);

    execFileSync('npx', ['gjsify', 'fix', 'fix-test.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    const out = readFileSync(join(projectDir, 'fix-test.ts'), 'utf-8');
    // Formatted (single-quote, spacing) AND imports cleaned up
    assert.match(out, /const x = \{ a: 1, b: 2 \};/);
  });
});
