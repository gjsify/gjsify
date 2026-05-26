// E2E test for `gjsify build --app browser`.
//
// Guards that the browser target produces a clean, self-contained bundle with
// NO `gi://` or `@girs/` specifier leakage — any such substring in the output
// means the `gjsImportsEmptyPlugin` alias is missing and a GJS-only import
// slipped through, which would crash in any real browser or bundler that does
// not understand the `gi://` scheme.
//
// Two cases are exercised:
//   1. A plain entry that uses a Web-native global (fetch / Response) without
//      importing any GJS-specific module at all.
//   2. An entry that pulls in `node:assert` (a cross-platform module that the
//      browser target re-aliases to `@gjsify/assert`) — exercises the
//      browser-polyfill alias path while still asserting no `gi://`/`@girs/`
//      leakage in the output.
//
// Both builds are also checked for syntactic validity via `node --check`.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

describe('--app browser gi://-free bundle E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-app-browser-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'app-browser-project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-app-browser',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
    }, tarballsDir, tarballMap);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  // Case 1: Web-global entry — fetch/Response are standard browser globals.
  // The bundle must contain NO gi:// or @girs/ substrings.
  it('builds a Web-global entry without gi:// or @girs/ leakage', () => {
    writeFileSync(join(projectDir, 'src', 'app.ts'),
      // Use Response / new Response() — a plain Web API that must NOT pull in
      // any GNOME/gi:// dep in the browser target output.
      [
        "const r = new Response('{}', { headers: { 'Content-Type': 'application/json' } });",
        "console.log(r.headers.get('Content-Type'));",
        '',
      ].join('\n'),
    );

    execFileSync('npx', [
      'gjsify', 'build', 'src/app.ts',
      '--app', 'browser',
      '--outfile', 'dist/app.mjs',
    ], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 90 * 1000,
    });

    const outPath = join(projectDir, 'dist', 'app.mjs');
    assert.ok(existsSync(outPath), 'dist/app.mjs missing');
    assert.ok(statSync(outPath).size > 0, 'dist/app.mjs is empty');

    const content = readFileSync(outPath, 'utf-8');
    assert.ok(
      !content.includes('gi://'),
      `dist/app.mjs must not contain "gi://" (GJS import leak)\n` +
      `First occurrence context: ${snippet(content, 'gi://')}`,
    );
    assert.ok(
      !content.includes('@girs/'),
      `dist/app.mjs must not contain "@girs/" (GNOME type-def import leak)\n` +
      `First occurrence context: ${snippet(content, '@girs/')}`,
    );
  });

  it('browser bundle output is syntactically valid JavaScript', () => {
    const outPath = join(projectDir, 'dist', 'app.mjs');
    if (!existsSync(outPath)) return; // skip if previous test did not build
    execFileSync('node', ['--check', outPath], {
      stdio: 'pipe',
      timeout: 30 * 1000,
    });
  });

  // Case 2: Entry that imports node:assert (aliased to @gjsify/assert in the
  // browser target).  @gjsify/assert is a pure-JS cross-platform package, but
  // it is reached through the browser-polyfill alias map.  The final bundle
  // must still be gi://-free — this exercises the alias path end-to-end.
  it('entry using node:assert alias produces no gi:// or @girs/ leakage', () => {
    writeFileSync(join(projectDir, 'src', 'with-assert.ts'),
      [
        "import assert from 'node:assert';",
        "assert.ok(true, 'sanity');",
        "console.log('assertions passed');",
        '',
      ].join('\n'),
    );

    execFileSync('npx', [
      'gjsify', 'build', 'src/with-assert.ts',
      '--app', 'browser',
      '--outfile', 'dist/with-assert.mjs',
    ], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 90 * 1000,
    });

    const outPath = join(projectDir, 'dist', 'with-assert.mjs');
    assert.ok(existsSync(outPath), 'dist/with-assert.mjs missing');
    assert.ok(statSync(outPath).size > 0, 'dist/with-assert.mjs is empty');

    const content = readFileSync(outPath, 'utf-8');
    assert.ok(
      !content.includes('gi://'),
      `dist/with-assert.mjs must not contain "gi://" (alias path leak)\n` +
      `First occurrence context: ${snippet(content, 'gi://')}`,
    );
    assert.ok(
      !content.includes('@girs/'),
      `dist/with-assert.mjs must not contain "@girs/" (alias path leak)\n` +
      `First occurrence context: ${snippet(content, '@girs/')}`,
    );
  });

  it('node:assert-alias bundle is syntactically valid JavaScript', () => {
    const outPath = join(projectDir, 'dist', 'with-assert.mjs');
    if (!existsSync(outPath)) return;
    execFileSync('node', ['--check', outPath], {
      stdio: 'pipe',
      timeout: 30 * 1000,
    });
  });
});

/**
 * Return a short context snippet around the first occurrence of `needle` in
 * `text` — useful for actionable assertion failure messages.
 */
function snippet(text, needle) {
  const idx = text.indexOf(needle);
  if (idx === -1) return '(not found)';
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + needle.length + 40);
  return JSON.stringify(`…${text.slice(start, end)}…`);
}
