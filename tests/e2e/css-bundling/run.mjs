// E2E test for the CSS pipeline in `gjsify build --app gjs`:
//   1. `@import` statements are resolved (lightningcss bundleAsync)
//   2. CSS nesting is flattened to GTK4-compatible flat selectors
//      (lightningcss `targets: { firefox: 60 << 16 }`)
// Both behaviors are required so that `import css from "./app.css"` in
// a GJS app produces a string GTK's CSS parser can consume directly.

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

describe('CLI css-bundling E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-css-bundling-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'css-bundling-project');
    mkdirSync(join(projectDir, 'src', 'widgets'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-css-bundling',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: {
        bundler: { output: { file: 'dist/app.js', minify: false } },
      },
    }, tarballsDir, tarballMap);

    writeFileSync(join(projectDir, 'src', 'main.css'),
      `@import "./widgets/button.css";\n@import "./widgets/input.css";\n`,
    );
    writeFileSync(join(projectDir, 'src', 'widgets', 'button.css'),
      `.btn {\n  color: red;\n  &:hover { color: blue; }\n  & .icon { padding: 4px; }\n}\n`,
    );
    writeFileSync(join(projectDir, 'src', 'widgets', 'input.css'),
      `.input {\n  border: 1px solid #ccc;\n  &.focused { border-color: green; }\n}\n`,
    );
    writeFileSync(join(projectDir, 'src', 'app.ts'),
      `import css from './main.css';\nconsole.log(css.length);\n`,
    );
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('inlines @imports and flattens nesting in the bundled CSS string', () => {
    execFileSync('npx', ['gjsify', 'build', '--app', 'gjs', 'src/app.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'app.js')), 'dist/app.js missing');
    const out = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');

    assert.doesNotMatch(out, /@import/,
      '@import statements should be resolved by lightningcss bundleAsync');
    assert.match(out, /\.btn:hover/,
      'nested `&:hover` should flatten to `.btn:hover` for GTK4');
    assert.match(out, /\.btn \.icon/,
      'nested `& .icon` should flatten to `.btn .icon` for GTK4');
    assert.match(out, /\.input\.focused/,
      'nested `&.focused` should flatten to `.input.focused` for GTK4');
  });
});
