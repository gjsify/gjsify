// E2E tests for @gjsify/cli config sources.
//
// Covers two related behaviours:
// 1. `package.json#gjsify` and `.gjsifyrc.js` are MERGED, not first-match-wins.
//    Cosmiconfig's default behaviour silently drops one source, so a project
//    that adds `gjsify.bin` to package.json (for `gjsify dlx` resolution)
//    inadvertently disables its `.gjsifyrc.js` build settings. We always
//    union the two with the explicit file overriding package.json on
//    duplicated keys.
// 2. `gjsify build` refuses to default --outfile to a TypeScript source path.
//    A TS-direct project's package.json#main typically points at `src/*.ts`;
//    without this safety check, the build would silently overwrite the
//    source.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

describe('CLI config E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-cli-config-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'cli-config-project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-cli-config',
      version: '0.1.0',
      type: 'module',
      private: true,
      // Mimic a TS-direct project: package.json#main is the source file. The
      // outfile-safety check should refuse to default to this.
      main: 'src/index.ts',
      module: 'src/index.ts',
      dependencies: {
        '@gjsify/cli': '^0.1.0',
      },
      // gjsify.bin lives in package.json (dlx reads from here). Build
      // settings will live in .gjsifyrc.js — both sources must merge.
      gjsify: {
        bin: { 'app': 'dist/app.js' },
      },
    }, tarballsDir, tarballMap);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('merges package.json#gjsify with .gjsifyrc.js', () => {
    writeFileSync(join(projectDir, 'src', 'app.ts'),
      "console.log('built via merged config');\n"
    );
    writeFileSync(join(projectDir, '.gjsifyrc.js'),
      "export default { esbuild: { outfile: 'dist/merged.js' } };\n"
    );
    execFileSync('npx', ['gjsify', 'build', 'src/app.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(
      existsSync(join(projectDir, 'dist', 'merged.js')),
      'dist/merged.js missing — .gjsifyrc.js outfile was not honoured (cosmiconfig dropped it)'
    );
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
    assert.equal(pkg.gjsify.bin.app, 'dist/app.js', 'package.json#gjsify.bin lost');
  });

  it('refuses to default --outfile to src/index.ts', () => {
    // Isolated subdir so the test is independent of the merge case above.
    const isolatedDir = join(projectDir, 'isolated');
    mkdirSync(join(isolatedDir, 'src'), { recursive: true });
    writeFileSync(join(isolatedDir, 'package.json'), JSON.stringify({
      name: 'isolated-test',
      version: '0.0.1',
      type: 'module',
      private: true,
      main: 'src/index.ts',
    }));
    const sourceText = "// THIS MUST NOT BE OVERWRITTEN.\nexport const ok = 1;\n";
    writeFileSync(join(isolatedDir, 'src', 'index.ts'), sourceText);
    let stderr = '';
    let exitCode = 0;
    try {
      execFileSync('npx', ['gjsify', 'build', 'src/index.ts'], {
        cwd: isolatedDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60 * 1000,
      });
    } catch (e) {
      exitCode = e.status ?? -1;
      stderr = (e.stderr ?? '').toString();
    }
    assert.notStrictEqual(exitCode, 0, 'gjsify build should have failed safety check');
    assert.match(
      stderr,
      /refusing to default --outfile/i,
      `expected safety-check error message, got stderr:\n${stderr}`,
    );
    // Source must still be intact.
    const after = readFileSync(join(isolatedDir, 'src', 'index.ts'), 'utf-8');
    assert.equal(after, sourceText, 'src/index.ts was clobbered');
  });
});
