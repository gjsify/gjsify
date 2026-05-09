// E2E test for the rewriter's static-read inlining when the source file
// lives inside a Yarn-PnP virtual zip cache.
//
// Background — STATUS.md "Open TODOs / High priority — rewriter must inline
// zip-resident static reads (PnP)" (introduced by PR #70):
//
//   When `gjsify build` processes a workspace under `nodeLinker: pnp`, files
//   resolved from `.yarn/cache/<pkg>.zip/...` are read via PnP-patched fs
//   from inside the build process. Any bundled
//   `readFileSync(new URL("./x", import.meta.url))` against an adjacent
//   resource (own package.json, locale data, ...) used to crash with ENOENT
//   at runtime because the rewriter only updated the URL — it did NOT
//   inline the read. The proper fix is to inline the bytes at build time
//   so the bundle stays self-contained.
//
// The Rolldown migration (PR #81 / #83) brought a unified `inlineStaticReads`
// pass that runs on every loaded `node_modules/...` source — including
// zip-resident files served by `@gjsify/rolldown-plugin-pnp`. This test
// asserts the regression is closed end-to-end:
//
//   1. fixture package `@fixture/pnp-zip-reads` defines two patterns:
//        - readFileSync(new URL('./data.json', import.meta.url), 'utf8')
//        - JSON.parse(readFileSync(new URL('./package.json', ...), 'utf8'))
//   2. installed under Yarn 4 with `nodeLinker: pnp` from a packed tarball
//      → Yarn stores it as `.yarn/cache/<pkg>.zip` and resolves it through
//      the PnP runtime. The build sees the source path with the `.zip/`
//      segment.
//   3. `gjsify build` for both `--app node` and `--app gjs` must produce a
//      bundle that
//        - contains the literal data string (proves inliner fired);
//        - has NO runtime `readFileSync(new URL(...))` against the inlined
//          paths (proves the call was replaced, not just URL-rewritten);
//        - runs successfully from any directory after a copy.
//
// Reverting the inliner's zip-resident handling causes the `.includes(
// 'inlined-from-pnp-zip')` assertion to fail.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProjectYarnPnp,
  hasCommand,
} from '../helpers.mjs';

/**
 * Pack a tiny `@fixture/pnp-zip-reads` package into `tarballsDir` so the
 * Yarn-PnP project below can depend on it via `file:` ref → ends up in
 * `.yarn/cache/<pkg>.zip` after install.
 *
 * The returned absolute tarball path is what we wire into package.json.
 */
function packFixture(tarballsDir) {
  const fixtureDir = join(tarballsDir, 'fixture-src');
  mkdirSync(fixtureDir, { recursive: true });

  writeFileSync(join(fixtureDir, 'package.json'), JSON.stringify({
    name: '@fixture/pnp-zip-reads',
    version: '4.2.0',
    type: 'module',
    main: './index.js',
    exports: { '.': './index.js' },
  }, null, 2) + '\n');

  writeFileSync(join(fixtureDir, 'data.json'),
    JSON.stringify({ secret: 'inlined-from-pnp-zip' }) + '\n'
  );

  writeFileSync(join(fixtureDir, 'index.js'),
    `import { readFileSync } from 'node:fs';\n` +
    `\n` +
    `// Pattern A: readFileSync(new URL(<lit>, import.meta.url), "utf8")\n` +
    `const dataText = readFileSync(new URL("./data.json", import.meta.url), "utf8");\n` +
    `const data = JSON.parse(dataText);\n` +
    `\n` +
    `// Pattern B: JSON.parse(readFileSync(new URL(<lit>, import.meta.url), "utf8"))\n` +
    `const pkg = JSON.parse(\n` +
    `  readFileSync(new URL("./package.json", import.meta.url), "utf8")\n` +
    `);\n` +
    `\n` +
    `export function getReport() {\n` +
    `  return data.secret + ":" + pkg.name + "@" + pkg.version;\n` +
    `}\n`
  );

  // npm pack into tarballsDir (npm writes the .tgz into cwd, then we move).
  const out = execFileSync('npm', ['pack', '--silent', '--pack-destination', tarballsDir], {
    cwd: fixtureDir,
    encoding: 'utf8',
    timeout: 60 * 1000,
  }).trim();
  // npm pack prints the produced filename on stdout.
  const tarballPath = join(tarballsDir, out.split('\n').pop());
  if (!existsSync(tarballPath)) {
    throw new Error(`npm pack output not found at ${tarballPath}`);
  }
  return tarballPath;
}

/** Returns true when `gjs` is installed AND can run a one-liner. */
function gjsRunnable() {
  if (!hasCommand('gjs')) return false;
  try {
    execFileSync('gjs', ['-c', '"ok"'], { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

describe('PnP zip-resident static reads E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;
  let fixtureTarball;
  const skipReason = !hasCommand('yarn')
    ? 'yarn (>= 4) not on PATH — skipping PnP suite'
    : null;

  before(() => {
    if (skipReason) return;

    const env = createTestEnvironment('gjsify-e2e-pnp-zip-reads-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    fixtureTarball = packFixture(tarballsDir);

    projectDir = join(tmpDir, 'pnp-zip-project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    setupProjectYarnPnp(projectDir, {
      name: 'test-pnp-zip-reads',
      version: '0.1.0',
      type: 'module',
      private: true,
      // The fixture sits behind a `file:` ref — Yarn caches it as
      // `.yarn/cache/<pkg>.zip` exactly as it would for a registry tarball.
      dependencies: {
        '@fixture/pnp-zip-reads': `file:${fixtureTarball}`,
      },
      devDependencies: {
        '@gjsify/cli': '^0.3.0',
        '@gjsify/empty': '^0.3.0',
      },
    }, tarballsDir, tarballMap);

    // Sanity: confirm Yarn actually cached the fixture as a .zip — otherwise
    // we're testing the wrong path and a real regression could slip past.
    const cacheDir = join(projectDir, '.yarn', 'cache');
    if (existsSync(cacheDir)) {
      const cached = execFileSync('ls', [cacheDir], { encoding: 'utf8' });
      if (!/@fixture-pnp-zip-reads.*\.zip/.test(cached)) {
        throw new Error(
          `expected @fixture-pnp-zip-reads .zip in ${cacheDir}, got: ${cached}`
        );
      }
    }
  });

  after(() => {
    if (!skipReason) cleanupTestEnvironment(tmpDir);
  });

  function buildAndAssert(appTarget, outFile) {
    writeFileSync(join(projectDir, 'src', 'app.ts'),
      `import { getReport } from '@fixture/pnp-zip-reads';\n` +
      `console.log('OK:' + getReport());\n`
    );

    const bundlePath = join(projectDir, 'dist', outFile);
    mkdirSync(join(projectDir, 'dist'), { recursive: true });

    // --no-minify: substring assertions need readable property names.
    execFileSync('yarn', [
      'gjsify', 'build', 'src/app.ts',
      '--app', appTarget,
      '--outfile', bundlePath,
      '--no-minify',
    ], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 2 * 60 * 1000,
    });

    assert.ok(existsSync(bundlePath), `${outFile} missing`);
    const bundle = readFileSync(bundlePath, 'utf-8');

    // The fixture's literal data string must appear in the bundle source —
    // the inliner READ the zip-resident data.json at build time.
    assert.ok(bundle.includes('inlined-from-pnp-zip'),
      `${outFile} does not contain the fixture data — inliner did not fire on the zip-resident file. ` +
      `This is the regression PR #70 documented as the high-priority TODO.`);

    // The fixture's package.json name must appear — the JSON.parse(readFileSync)
    // composition was inlined too.
    assert.ok(
      bundle.includes('"@fixture/pnp-zip-reads"') ||
      bundle.includes(`"name":"@fixture/pnp-zip-reads"`),
      `${outFile} does not contain the fixture package.json — JSON.parse pattern did not fire on the zip-resident file`
    );

    // The bundle must NOT contain a runtime call to readFileSync against
    // the original URL — proves the inlining REPLACED the call rather
    // than just URL-rewriting it (the half-fix PR #70 warned about).
    assert.ok(
      !/readFileSync\(\s*new URL\(\s*["']\.\/(data\.json|package\.json)["']/m.test(bundle),
      `${outFile} still has a runtime readFileSync(new URL("./data.json"|"./package.json")) call ` +
      `— inliner only rewrote the URL instead of replacing the read`
    );
    return bundlePath;
  }

  it('inlines static readFileSync(URL) calls from PnP zip-resident files (--app node)',
    skipReason ? { skip: skipReason } : {},
    () => {
      const bundlePath = buildAndAssert('node', 'app.node.mjs');

      if (!hasCommand('node')) return;

      // Run from build location.
      const out1 = execFileSync('node', [bundlePath], {
        stdio: 'pipe',
        timeout: 30 * 1000,
      }).toString();
      assert.match(out1, /^OK:inlined-from-pnp-zip:@fixture\/pnp-zip-reads@4\.2\.0/,
        `node bundle produced unexpected output. Got: ${out1}`);

      // Move bundle out of the PnP project entirely — proves the bundle no
      // longer depends on the .yarn/cache/ zip existing on disk. This is
      // the original ts-for-gir / typedoc / mini-shiki crash scenario.
      const isolatedDir = '/tmp/gjsify-pnp-zip-isolated-' + Date.now();
      mkdirSync(isolatedDir, { recursive: true });
      cpSync(bundlePath, join(isolatedDir, 'app.mjs'));
      const out2 = execFileSync('node', [join(isolatedDir, 'app.mjs')], {
        stdio: 'pipe',
        timeout: 30 * 1000,
      }).toString();
      assert.match(out2, /^OK:inlined-from-pnp-zip:@fixture\/pnp-zip-reads@4\.2\.0/,
        `bundle in isolated dir failed — bundle is not self-contained. Got: ${out2}`);
      rmSync(isolatedDir, { recursive: true, force: true });
    });

  it('inlines static readFileSync(URL) calls from PnP zip-resident files (--app gjs)',
    skipReason || !gjsRunnable() ? { skip: skipReason || 'gjs not runnable — skipping GJS bundle execution' } : {},
    () => {
      const bundlePath = buildAndAssert('gjs', 'app.gjs.js');

      // Move out of the PnP project before running under gjs.
      const isolatedDir = '/tmp/gjsify-pnp-zip-gjs-' + Date.now();
      mkdirSync(isolatedDir, { recursive: true });
      cpSync(bundlePath, join(isolatedDir, 'app.js'));
      const out = execFileSync('gjs', ['-m', join(isolatedDir, 'app.js')], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30 * 1000,
      });
      assert.match(out, /^OK:inlined-from-pnp-zip:@fixture\/pnp-zip-reads@4\.2\.0/,
        `gjs bundle produced unexpected output. Got: ${out}`);
      rmSync(isolatedDir, { recursive: true, force: true });
    });
});
