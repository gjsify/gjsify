// E2E test for the rewriter's static-read inlining.
//
// Verifies that bundles produced by `gjsify build` are portable across
// filesystem layouts (gjsify dlx cache, manual moves, CI artifact downloads)
// because static `readFileSync(new URL(...), "utf8")` patterns are evaluated
// at build time and replaced with literal contents.
//
// The test fixture is a tiny `node_modules/@fixture/reads-via-url` package
// whose entry reads its own `package.json` via `import.meta.url`. Without
// inlining, the bundle would crash with ENOENT from any location other than
// the build site. With inlining, the bundle prints the embedded value and
// runs from any directory.

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

function hasCommand(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Drop a tiny `node_modules/@fixture/reads-via-url` package that exercises
 * the inliner: `readFileSync(new URL("./data.json", import.meta.url), "utf8")`
 * + `JSON.parse(readFileSync(new URL("./package.json", ...), "utf8"))`.
 */
function createFixture(projectDir) {
  const pkgDir = join(projectDir, 'node_modules', '@fixture', 'reads-via-url');
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({
    name: '@fixture/reads-via-url',
    version: '4.2.0',
    type: 'module',
    main: './index.js',
    exports: { '.': './index.js' },
  }, null, 2));
  writeFileSync(join(pkgDir, 'data.json'),
    JSON.stringify({ secret: 'inlined-at-build-time' }) + '\n'
  );
  writeFileSync(join(pkgDir, 'index.js'),
    `import { readFileSync } from 'node:fs';\n` +
    `\n` +
    `// Inliner pattern A: readFileSync(new URL(<lit>, import.meta.url), "utf8")\n` +
    `const dataText = readFileSync(new URL("./data.json", import.meta.url), "utf8");\n` +
    `const data = JSON.parse(dataText);\n` +
    `\n` +
    `// Inliner pattern B: JSON.parse(readFileSync(new URL(<lit>, import.meta.url), "utf8"))\n` +
    `const pkg = JSON.parse(\n` +
    `  readFileSync(new URL("./package.json", import.meta.url), "utf8")\n` +
    `);\n` +
    `\n` +
    `export function getReport() {\n` +
    `  return data.secret + ":" + pkg.name + "@" + pkg.version;\n` +
    `}\n`
  );
}

describe('Inline static reads E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-inline-static-reads-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-inline-static-reads',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: {
        '@gjsify/cli': '^0.1.0',
      },
    }, tarballsDir, tarballMap);

    createFixture(projectDir);

    writeFileSync(join(projectDir, 'src', 'app.ts'),
      `import { getReport } from '@fixture/reads-via-url';\n` +
      `console.log('OK:' + getReport());\n`
    );
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('bundle inlines static readFileSync calls and stays portable', () => {
    const outDir = join(projectDir, 'dist');
    mkdirSync(outDir, { recursive: true });
    const bundlePath = join(outDir, 'app.js');
    execFileSync('npx', ['gjsify', 'build', 'src/app.ts',
      '--app', 'node',
      '--outfile', bundlePath,
    ], { cwd: projectDir, stdio: 'pipe', timeout: 60 * 1000 });

    assert.ok(existsSync(bundlePath), 'bundle missing');

    const bundle = readFileSync(bundlePath, 'utf-8');
    // The fixture's literal data string should appear in the bundle source —
    // proving the read was evaluated at build time.
    assert.ok(bundle.includes('inlined-at-build-time'),
      'bundle does not contain the fixture data — inliner did not fire');
    assert.ok(bundle.includes('"@fixture/reads-via-url"') || bundle.includes(`"name":"@fixture/reads-via-url"`),
      'bundle does not contain the fixture package.json — JSON.parse pattern did not fire');

    // Bundle should NOT contain a runtime call to readFileSync against the
    // fixture's URL (proves the inlining replaced the call rather than just
    // rewriting the URL).
    assert.ok(!/readFileSync\(\s*new URL\(\s*["']\.\/(data\.json|package\.json)["']/m.test(bundle),
      'bundle still has a runtime readFileSync(new URL("./data.json"|"./package.json")) call');

    if (!hasCommand('node')) return;

    // Run from build location.
    const out1 = execFileSync('node', [bundlePath], { stdio: 'pipe', timeout: 30 * 1000 }).toString();
    assert.match(out1, /^OK:inlined-at-build-time:@fixture\/reads-via-url@4\.2\.0/,
      `bundle produced unexpected output. Got: ${out1}`);

    // Move the entire bundle and re-run — proves the bundle no longer
    // depends on `node_modules/@fixture/reads-via-url/` existing in any
    // particular relative location.
    const movedDir = join(projectDir, 'moved');
    cpSync(outDir, movedDir, { recursive: true });
    const out2 = execFileSync('node', [join(movedDir, 'app.js')], { stdio: 'pipe', timeout: 30 * 1000 }).toString();
    assert.match(out2, /^OK:inlined-at-build-time:@fixture\/reads-via-url@4\.2\.0/,
      `moved bundle failed — bundle is not self-contained. Got: ${out2}`);

    // Even from a path that doesn't have node_modules anywhere upward.
    const isolatedDir = '/tmp/gjsify-inline-isolated-' + Date.now();
    mkdirSync(isolatedDir, { recursive: true });
    cpSync(bundlePath, join(isolatedDir, 'app.js'));
    const out3 = execFileSync('node', [join(isolatedDir, 'app.js')], { stdio: 'pipe', timeout: 30 * 1000 }).toString();
    assert.match(out3, /^OK:inlined-at-build-time:@fixture\/reads-via-url@4\.2\.0/,
      `bundle in isolated dir failed — bundle is not self-contained. Got: ${out3}`);
    rmSync(isolatedDir, { recursive: true, force: true });
    rmSync(movedDir, { recursive: true, force: true });
  });
});
