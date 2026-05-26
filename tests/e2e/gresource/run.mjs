// E2E test for `gjsify gresource` — wraps glib-compile-resources.
//
// Validates that:
// 1. The CLI compiles a fixture .gresource.xml into a binary .gresource blob
//    next to the descriptor (default target derivation).
// 2. --target routes the output to an explicit path.
// 3. --sourcedir overrides the directory searched for resource files.
// 4. If glib-compile-resources is absent, each test skips cleanly.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
  hasCommand,
} from '../helpers.mjs';

// Minimal GResource XML descriptor referencing a single text file.
const GRESOURCE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<gresources>
  <gresource prefix="/org/example/gjsify-gresource-test">
    <file>hello.txt</file>
  </gresource>
</gresources>
`;

// The resource file referenced by the descriptor above.
const HELLO_TXT = 'Hello from gjsify gresource e2e!\n';

describe('CLI gresource E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    if (!hasCommand('glib-compile-resources')) {
      console.log('  skipping: glib-compile-resources not on PATH');
      return;
    }
    const env = createTestEnvironment('gjsify-e2e-gresource-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'gresource-project');
    mkdirSync(join(projectDir, 'data'), { recursive: true });

    // Write the .gresource.xml descriptor and the resource file it references.
    writeFileSync(
      join(projectDir, 'data', 'app.gresource.xml'),
      GRESOURCE_XML,
    );
    writeFileSync(
      join(projectDir, 'data', 'hello.txt'),
      HELLO_TXT,
    );

    setupProject(projectDir, {
      name: 'test-gresource',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
    }, tarballsDir, tarballMap);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('compiles a .gresource.xml into a .gresource blob next to the descriptor (default target)', (t) => {
    if (!projectDir) return t.skip();
    execFileSync('npx', ['gjsify', 'gresource', 'data/app.gresource.xml'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    // Default target: strip trailing .xml → data/app.gresource
    const out = join(projectDir, 'data', 'app.gresource');
    assert.ok(
      existsSync(out),
      'data/app.gresource is missing after default compilation',
    );
    assert.ok(
      statSync(out).size > 0,
      'data/app.gresource is empty — compilation produced no output',
    );
  });

  it('honours --target to write the .gresource to an explicit path', (t) => {
    if (!projectDir) return t.skip();
    const out = join(projectDir, 'out', 'custom.gresource');
    execFileSync(
      'npx',
      ['gjsify', 'gresource', 'data/app.gresource.xml', '--target', out],
      {
        cwd: projectDir,
        stdio: 'pipe',
        timeout: 60 * 1000,
      },
    );
    assert.ok(
      existsSync(out),
      `${out} is missing — --target was not honoured`,
    );
    assert.ok(
      statSync(out).size > 0,
      `${out} is empty — --target compilation produced no output`,
    );
  });

  it('honours --sourcedir to locate resource files in a separate directory', (t) => {
    if (!projectDir) return t.skip();
    // Place the resource file in a sibling dir and use --sourcedir.
    const srcDir = join(projectDir, 'resources');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'hello.txt'), HELLO_TXT);

    // Write a descriptor-only directory (no hello.txt next to it).
    const xmlDir = join(projectDir, 'xml-only');
    mkdirSync(xmlDir, { recursive: true });
    writeFileSync(join(xmlDir, 'app.gresource.xml'), GRESOURCE_XML);

    const out = join(projectDir, 'out', 'sourcedir.gresource');
    execFileSync(
      'npx',
      [
        'gjsify', 'gresource',
        'xml-only/app.gresource.xml',
        '--sourcedir', srcDir,
        '--target', out,
      ],
      {
        cwd: projectDir,
        stdio: 'pipe',
        timeout: 60 * 1000,
      },
    );
    assert.ok(
      existsSync(out),
      `${out} is missing — --sourcedir compilation failed`,
    );
    assert.ok(
      statSync(out).size > 0,
      `${out} is empty — --sourcedir compilation produced no output`,
    );
  });
});
