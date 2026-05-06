// E2E test for `gjsify build --library` with TWO outdirs (ESM + CJS).
//
// `BuildAction.buildLibrary()` runs two esbuild passes when
// `package.json#library.module` and `library.main` resolve to different
// directories — one ESM build into the module outdir, one CJS build into
// the main outdir. Two copy-paste bugs slipped into the second-pass options
// at one point: the wrong format token (CJS pass picked up the ESM
// `moduleFormat`) and the wrong extension token (jsExtension was set to a
// directory path instead of the file extension). Either silently produced a
// broken artifact — same code shape, wrong format — that loaded only by
// chance for callers that didn't care which file they picked.
//
// This test asserts both outputs use the format and extension declared by
// their respective package.json entries.

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

describe('Library multi-build E2E (ESM + CJS, separate outdirs)', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-library-multi-build-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'lib');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-library-multi-build',
      version: '0.1.0',
      type: 'module',
      private: true,
      // Two distinct outdirs: dist/esm/ for ESM, dist/cjs/ for CJS. The
      // CJS outdir's `/cjs/` segment is what `buildLibrary` keys off to
      // pick the CJS format.
      module: 'dist/esm/index.js',
      main: 'dist/cjs/index.js',
      dependencies: {
        '@gjsify/cli': '^0.1.0',
      },
    }, tarballsDir, tarballMap);

    writeFileSync(join(projectDir, 'src', 'index.ts'),
      `export const ANSWER = 42;\n` +
      `export function greet(name: string): string { return "hi " + name; }\n`
    );
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('produces ESM and CJS artifacts with the correct format + extension', () => {
    execFileSync('npx', ['gjsify', 'build', 'src/index.ts',
      '--library',
      '--app', 'node',
    ], { cwd: projectDir, stdio: 'pipe', timeout: 60 * 1000 });

    const esmPath = join(projectDir, 'dist', 'esm', 'index.js');
    const cjsPath = join(projectDir, 'dist', 'cjs', 'index.js');

    assert.ok(existsSync(esmPath), 'ESM artifact missing');
    assert.ok(existsSync(cjsPath), 'CJS artifact missing');

    const esm = readFileSync(esmPath, 'utf-8');
    const cjs = readFileSync(cjsPath, 'utf-8');

    // ESM: must use `export`, must NOT use CJS `module.exports`.
    assert.match(esm, /\bexport\b/, 'ESM artifact has no `export` — wrong format emitted');
    assert.doesNotMatch(esm, /\bmodule\.exports\b/, 'ESM artifact contains CJS `module.exports`');

    // CJS: must use `module.exports` / `exports.*`, must NOT use ESM `export`.
    assert.match(cjs, /\b(module\.exports|exports\.)/,
      'CJS artifact has no CJS exports — wrong format emitted (regression of format: moduleFormat copy-paste bug)');
    assert.doesNotMatch(cjs, /^\s*export\s/m,
      'CJS artifact contains ESM `export` keyword');
  });
});
