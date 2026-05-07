// E2E test for the `loaders` config key — opt-in extensions become JS
// string default exports. Replaces the legacy esbuild
// `loader: { '.ui': 'text', '.asm': 'text' }` shorthand.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

describe('CLI text-loader E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-text-loader-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'text-loader-project');
    mkdirSync(join(projectDir, 'src', 'ui'), { recursive: true });
    mkdirSync(join(projectDir, 'src', 'asm'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-text-loader',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: {
        bundler: { output: { file: 'dist/app.js', minify: false } },
        loaders: { '.ui': 'text', '.asm': 'text' },
      },
    }, tarballsDir, tarballMap);

    writeFileSync(join(projectDir, 'src', 'ui', 'window.ui'),
      `<interface><object class="GtkWindow"><property name="title">hello-from-ui</property></object></interface>`,
    );
    writeFileSync(join(projectDir, 'src', 'asm', 'demo.asm'),
      `LDA #$ff   ; assembler-fixture-byte-marker\n`,
    );
    writeFileSync(join(projectDir, 'src', 'app.ts'),
      `import ui from './ui/window.ui';
import asm from './asm/demo.asm';
console.log(ui.length, asm.length);
`);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('inlines .ui and .asm files as JS string default exports', () => {
    execFileSync('npx', ['gjsify', 'build', 'src/app.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'app.js')), 'dist/app.js missing');
    const out = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');
    assert.match(out, /hello-from-ui/, '.ui content not inlined as string');
    assert.match(out, /assembler-fixture-byte-marker/, '.asm content not inlined as string');
  });
});
