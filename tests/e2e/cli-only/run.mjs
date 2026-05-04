// E2E test for @gjsify/cli build without a user-defined package.json.
// Simulates: npx @gjsify/cli build — only the CLI is installed, no explicit polyfill deps.
// The CLI transitively brings @gjsify/node-polyfills and @gjsify/web-polyfills.
// Requires: yarn build (monorepo must be built first)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
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

describe('CLI-only E2E (no user polyfill deps)', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-cli-only-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    // Create a minimal project with ONLY @gjsify/cli as a dependency
    projectDir = join(tmpDir, 'cli-only-project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-cli-only',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: {
        '@gjsify/cli': '^0.1.0',
      },
    }, tarballsDir, tarballMap);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('builds a minimal console-only script', () => {
    writeFileSync(join(projectDir, 'src', 'index.ts'),
      "console.log('Hello from gjsify!');\n"
    );
    execSync('npx gjsify build src/index.ts --outfile dist/console-only.js', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'console-only.js')), 'dist/console-only.js missing');
  });

  it('builds a script importing node:path (alias resolves via CLI deps)', () => {
    writeFileSync(join(projectDir, 'src', 'with-path.ts'),
      "import * as path from 'node:path';\nconsole.log(path.join('a', 'b'));\n"
    );
    execSync('npx gjsify build src/with-path.ts --outfile dist/with-path.js', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'with-path.js')), 'dist/with-path.js missing');
  });

  it('builds a script importing node:events (alias resolves via CLI deps)', () => {
    writeFileSync(join(projectDir, 'src', 'with-events.ts'),
      "import { EventEmitter } from 'node:events';\nconst ee = new EventEmitter();\nconsole.log(ee);\n"
    );
    execSync('npx gjsify build src/with-events.ts --outfile dist/with-events.js', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'with-events.js')), 'dist/with-events.js missing');
  });

  it('build output is valid JavaScript', () => {
    for (const file of ['dist/console-only.js', 'dist/with-path.js', 'dist/with-events.js']) {
      const fullPath = join(projectDir, file);
      if (!existsSync(fullPath)) continue;
      execFileSync('node', ['--check', fullPath], { stdio: 'pipe' });
    }
  });

  it('gjsify check --json skips gwebgl when project does not use @gjsify/webgl', () => {
    // After the showcase-decoupling refactor (Phase D), the CLI no longer
    // transitively depends on @gjsify/webgl through showcase example packages.
    // `gjsify check` correctly skips the gwebgl check for projects that don't
    // use @gjsify/webgl — needsWebgl is decided per-project, not per-CLI.
    const out = execFileSync('npx', ['gjsify', 'check', '--json'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30 * 1000,
    });
    const result = JSON.parse(out);
    const gwebgl = result.deps.find(d => d.id === 'gwebgl');
    assert.strictEqual(gwebgl, undefined,
      'gwebgl should be skipped when project does not depend on @gjsify/webgl');
  });

  it('gjsify check --json resolves gwebgl from project deps (primary path)', () => {
    // Create a second project that has @gjsify/webgl as a direct dependency.
    // checkNpmPackage should find it from the project's own node_modules first.
    const webglProjectDir = join(tmpDir, 'webgl-project');
    mkdirSync(webglProjectDir, { recursive: true });

    setupProject(webglProjectDir, {
      name: 'test-webgl-check',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: {
        '@gjsify/cli': '^0.1.0',
        '@gjsify/webgl': '^0.1.0',
      },
    }, tarballsDir, tarballMap);

    const out = execFileSync('npx', ['gjsify', 'check', '--json'], {
      cwd: webglProjectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30 * 1000,
    });
    const result = JSON.parse(out);
    const gwebgl = result.deps.find(d => d.id === 'gwebgl');
    assert.ok(gwebgl, 'gwebgl check should be present in results');
    assert.strictEqual(gwebgl.found, true,
      'gwebgl should be found from project node_modules (primary path)');
  });

  it('gjsify showcase --list succeeds without errors', () => {
    const out = execFileSync('npx', ['gjsify', 'showcase', '--json'], {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30 * 1000,
    });
    const examples = JSON.parse(out);
    assert.ok(Array.isArray(examples), 'showcase --json should return an array');
    assert.ok(examples.length > 0, 'should have at least one example');
  });

  // -- PR #18: gjsify build --shebang -------------------------------------
  it('gjsify build --shebang prepends GJS shebang and sets +x', () => {
    writeFileSync(join(projectDir, 'src', 'shebang-app.ts'),
      "console.log('hello from shebanged app');\n"
    );
    execFileSync('npx', [
      'gjsify', 'build', 'src/shebang-app.ts',
      '--app', 'gjs', '--shebang',
      '--outfile', 'dist/shebang-app.mjs',
    ], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    const outPath = join(projectDir, 'dist', 'shebang-app.mjs');
    assert.ok(existsSync(outPath), 'dist/shebang-app.mjs missing');

    const content = readFileSync(outPath, 'utf-8');
    const firstLine = content.split('\n', 1)[0];
    assert.equal(firstLine, '#!/usr/bin/env -S gjs -m', 'first line should be the GJS shebang');

    const mode = statSync(outPath).mode & 0o777;
    assert.equal(mode, 0o755, `outfile mode should be 0o755, got 0o${mode.toString(8)}`);
  });

  it('gjsify build --shebang is idempotent on repeated builds', () => {
    // Builds twice and verifies only ONE shebang line exists — the CLI's
    // applyShebang() skips the prepend step if the file already starts with `#!`.
    writeFileSync(join(projectDir, 'src', 'shebang-idem.ts'),
      "console.log('idempotent');\n"
    );
    const args = [
      'gjsify', 'build', 'src/shebang-idem.ts',
      '--app', 'gjs', '--shebang',
      '--outfile', 'dist/shebang-idem.mjs',
    ];
    const opts = { cwd: projectDir, stdio: 'pipe', timeout: 60 * 1000 };
    execFileSync('npx', args, opts);
    execFileSync('npx', args, opts);

    const content = readFileSync(join(projectDir, 'dist', 'shebang-idem.mjs'), 'utf-8');
    const shebangLines = content.split('\n').filter(line => line.startsWith('#!'));
    assert.equal(shebangLines.length, 1, `expected exactly 1 shebang line, got ${shebangLines.length}`);
  });

  // -- PR #18: gjsify gresource -------------------------------------------
  it('gjsify gresource compiles XML descriptor into binary bundle', { skip: !hasCommand('glib-compile-resources') && 'glib-compile-resources not installed' }, () => {
    const dataDir = join(projectDir, 'gresource-data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'hello.txt'), 'world\n');
    writeFileSync(join(dataDir, 'app.gresource.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<gresources>\n` +
      `  <gresource prefix="/test">\n` +
      `    <file>hello.txt</file>\n` +
      `  </gresource>\n` +
      `</gresources>\n`
    );

    const outFile = join(projectDir, 'dist', 'app.gresource');
    mkdirSync(join(projectDir, 'dist'), { recursive: true });

    execFileSync('npx', [
      'gjsify', 'gresource',
      join(dataDir, 'app.gresource.xml'),
      '--sourcedir', dataDir,
      '--target', outFile,
    ], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    assert.ok(existsSync(outFile), 'binary .gresource missing');

    // If the `gresource` inspection tool is available, verify the embedded path
    // is actually present in the bundle. Usually shipped together with
    // glib-compile-resources, so this is nearly always reachable.
    if (hasCommand('gresource')) {
      const listing = execFileSync('gresource', ['list', outFile], {
        encoding: 'utf-8',
        timeout: 30 * 1000,
      });
      assert.match(listing, /\/test\/hello\.txt/, 'embedded file should be listed');
    }
  });

  // -- PR #18: gjsify gettext ---------------------------------------------
  it('gjsify gettext --format mo produces a per-language locale tree', { skip: !hasCommand('msgfmt') && 'msgfmt not installed' }, () => {
    const poDir = join(projectDir, 'po');
    mkdirSync(poDir, { recursive: true });
    writeFileSync(join(poDir, 'de.po'),
      'msgid ""\n' +
      'msgstr ""\n' +
      '"Content-Type: text/plain; charset=UTF-8\\n"\n' +
      '"Language: de\\n"\n\n' +
      'msgid "Hello"\n' +
      'msgstr "Hallo"\n'
    );

    const outDir = join(projectDir, 'gettext-out');
    execFileSync('npx', [
      'gjsify', 'gettext', poDir, outDir,
      '--domain', 'com.test.app',
      '--format', 'mo',
    ], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });

    const moFile = join(outDir, 'de', 'LC_MESSAGES', 'com.test.app.mo');
    assert.ok(existsSync(moFile), 'compiled .mo file missing at expected locale path');

    const moSize = statSync(moFile).size;
    assert.ok(moSize > 0, 'compiled .mo file should be non-empty');
  });
});
