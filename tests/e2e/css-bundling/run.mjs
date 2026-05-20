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

  it('resolves @import of npm-package specifiers via node_modules + exports', () => {
    // Plant a fake scoped package under node_modules whose package.json
    // exposes a CSS file via the `exports` field. The bundled CSS must
    // pull in that file's content, mirroring how downstream monorepos
    // (e.g. pixel-rpg/map-editor) share CSS across workspace packages.
    const pkgDir = join(projectDir, 'node_modules', '@css-fixture', 'shared');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
      name: '@css-fixture/shared',
      version: '0.0.1',
      exports: { './styles.css': './lib/styles.css' },
    }, null, 2));
    mkdirSync(join(pkgDir, 'lib'), { recursive: true });
    writeFileSync(join(pkgDir, 'lib', 'styles.css'),
      `.shared-banner { background: papayawhip; padding: 8px; }\n`,
    );

    // Bare-package import + relative imports in the same file, so the
    // resolver must pick the right strategy for each kind.
    writeFileSync(join(projectDir, 'src', 'pkg-import.css'),
      `@import "@css-fixture/shared/styles.css";\n@import "./widgets/button.css";\n`,
    );
    writeFileSync(join(projectDir, 'src', 'pkg-import.ts'),
      `import css from './pkg-import.css';\nconsole.log(css.length);\n`,
    );

    execFileSync('npx', ['gjsify', 'build', '--app', 'gjs', 'src/pkg-import.ts', '--outfile', 'dist/pkg-import.js'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    const out = readFileSync(join(projectDir, 'dist', 'pkg-import.js'), 'utf-8');

    assert.doesNotMatch(out, /@import/,
      'all @import statements resolved — none left as literal text');
    assert.match(out, /\.shared-banner/,
      'css from @css-fixture/shared/styles.css must be inlined');
    assert.match(out, /papayawhip/,
      'concrete property from the bare-package CSS must survive bundling');
    assert.match(out, /\.btn:hover/,
      'relative @import still works alongside the bare-package one');
  });
});
