// E2E test for `gjsify build --extract-node-modules-assets`.
//
// Verifies the bundle stays runnable after being moved to a different
// filesystem location (the failure mode of the legacy source-relative
// rewriter): when a `node_modules` package reads its own data files via
// `import.meta.url`, the rewritten URL must point at a co-located
// `_node_modules/<pkg>/<file>` so the read works regardless of layout.
//
// Tests both the "do this for me" CLI flag and the "leave the bundle alone"
// default — the default must keep the source-relative behaviour to not
// regress local-dev re-runs.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

/** Returns true when `cmd` is resolvable on the current PATH. */
function hasCommand(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop a tiny `node_modules/@fixture/reads-via-url` package into the project
 * that exercises the rewriter pattern: the package's entry reads a sibling
 * data file via `readFileSync(new URL("./data.json", import.meta.url))`.
 *
 * If the rewriter rewrites `import.meta.url` to a path that doesn't exist
 * at runtime, this read crashes with ENOENT — exactly the failure mode the
 * `--extract-node-modules-assets` flag is designed to fix.
 */
function createFixtureNodeModulesPackage(projectDir) {
  const pkgDir = join(projectDir, 'node_modules', '@fixture', 'reads-via-url');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name: '@fixture/reads-via-url',
    version: '1.0.0',
    type: 'module',
    main: './index.js',
    exports: { '.': './index.js' },
  }, null, 2));
  writeFileSync(join(pkgDir, 'data.json'),
    JSON.stringify({ greeting: 'hello-from-data' }) + '\n'
  );
  writeFileSync(join(pkgDir, 'index.js'),
    `import { readFileSync } from 'node:fs';\n` +
    `export function getGreeting() {\n` +
    `  const url = new URL('./data.json', import.meta.url);\n` +
    `  return JSON.parse(readFileSync(url, 'utf-8')).greeting;\n` +
    `}\n`
  );
}

describe('Portable bundle E2E (--extract-node-modules-assets)', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-portable-bundle-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-portable-bundle',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: {
        '@gjsify/cli': '^0.1.0',
      },
    }, tarballsDir, tarballMap);

    // The fixture is dropped AFTER setupProject did its npm install — so the
    // installer doesn't try to fetch `@fixture/reads-via-url` from any
    // registry. We only need the directory present on disk for the rewriter
    // to discover during bundle.
    createFixtureNodeModulesPackage(projectDir);

    writeFileSync(join(projectDir, 'src', 'app.ts'),
      `import { getGreeting } from '@fixture/reads-via-url';\n` +
      `console.log('OK:' + getGreeting());\n`
    );
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('default: bundle without asset extraction works in-place but is layout-bound', () => {
    const outDir = join(projectDir, 'dist-default');
    mkdirSync(outDir, { recursive: true });
    execFileSync('npx', ['gjsify', 'build', 'src/app.ts',
      '--app', 'node',
      '--outfile', join(outDir, 'app.js'),
    ], { cwd: projectDir, stdio: 'pipe', timeout: 60 * 1000 });

    assert.ok(existsSync(join(outDir, 'app.js')), 'bundle missing');
    assert.ok(!existsSync(join(outDir, '_node_modules')),
      '_node_modules created without --extract-node-modules-assets');

    // Bundle uses ../../node_modules/... relative paths (legacy form).
    const bundle = readFileSync(join(outDir, 'app.js'), 'utf-8');
    assert.match(bundle, /node_modules\/@fixture\/reads-via-url\//,
      'bundle missing the rewritten URL — onLoad rewriter did not fire');
    assert.doesNotMatch(bundle, /_node_modules\/@fixture/,
      'bundle accidentally got asset URL form without the flag');

    // Runs in-place because the original node_modules/ tree is right there.
    if (hasCommand('node')) {
      const out = execFileSync('node', [join(outDir, 'app.js')], {
        stdio: 'pipe',
        timeout: 30 * 1000,
      }).toString();
      assert.match(out, /^OK:hello-from-data/,
        `default-mode bundle did not run in-place. Got: ${out}`);
    }
  });

  it('--extract-node-modules-assets: bundle is portable across layouts', () => {
    const outDir = join(projectDir, 'dist-portable');
    mkdirSync(outDir, { recursive: true });
    execFileSync('npx', ['gjsify', 'build', 'src/app.ts',
      '--app', 'node',
      '--outfile', join(outDir, 'app.js'),
      '--extract-node-modules-assets',
    ], { cwd: projectDir, stdio: 'pipe', timeout: 60 * 1000 });

    assert.ok(existsSync(join(outDir, 'app.js')), 'bundle missing');
    assert.ok(existsSync(join(outDir, '_node_modules')),
      '_node_modules companion dir not created');
    assert.ok(existsSync(join(outDir, '_node_modules', 'fixture-reads-via-url')),
      'extracted package dir missing — extraction skipped this dep');
    assert.ok(existsSync(join(outDir, '_node_modules', 'fixture-reads-via-url', 'data.json')),
      'extracted data.json missing — copy was not recursive');
    assert.ok(existsSync(join(outDir, '_node_modules', 'fixture-reads-via-url', 'package.json')),
      'extracted package.json missing');

    // Bundle now uses asset URLs.
    const bundle = readFileSync(join(outDir, 'app.js'), 'utf-8');
    assert.match(bundle, /\.\/_node_modules\/fixture-reads-via-url\//,
      'bundle does not contain asset URL — rewriter did not switch modes');

    if (hasCommand('node')) {
      // Runs in original location.
      const out1 = execFileSync('node', [join(outDir, 'app.js')], {
        stdio: 'pipe',
        timeout: 30 * 1000,
      }).toString();
      assert.match(out1, /^OK:hello-from-data/,
        `bundle did not print expected line. Got: ${out1}`);

      // Move the entire dist-portable/ to a sibling location, mimicking
      // what `gjsify dlx` does (extract published tarball into a cache dir
      // far from the build site). The bundle must still work because it
      // carries its `_node_modules` companion with it.
      const movedDir = join(projectDir, 'dist-moved');
      cpSync(outDir, movedDir, { recursive: true });

      const out2 = execFileSync('node', [join(movedDir, 'app.js')], {
        stdio: 'pipe',
        timeout: 30 * 1000,
      }).toString();
      assert.match(out2, /^OK:hello-from-data/,
        `moved bundle failed — extraction did not produce a portable layout. Got: ${out2}`);

      // And from a deeply nested layout (relative ../../ jumps must still resolve).
      const nestedDir = join(projectDir, 'a', 'b', 'c', 'dist');
      mkdirSync(join(projectDir, 'a', 'b', 'c'), { recursive: true });
      cpSync(outDir, nestedDir, { recursive: true });

      const out3 = execFileSync('node', [join(nestedDir, 'app.js')], {
        stdio: 'pipe',
        timeout: 30 * 1000,
      }).toString();
      assert.match(out3, /^OK:hello-from-data/,
        `nested-layout bundle failed. Got: ${out3}`);

      // Cleanup intermediates.
      rmSync(movedDir, { recursive: true, force: true });
      rmSync(join(projectDir, 'a'), { recursive: true, force: true });
    }
  });
});
