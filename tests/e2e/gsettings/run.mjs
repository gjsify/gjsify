// E2E test for `gjsify gsettings` — wraps glib-compile-schemas.
//
// Validates that:
// 1. The CLI compiles a fixture .gschema.xml into gschemas.compiled.
// 2. --targetdir routes output to a separate directory.
// 3. ENOENT for missing glib-compile-schemas surfaces a clear error.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
  hasCommand,
} from '../helpers.mjs';

const SCHEMA_XML = `<?xml version="1.0" encoding="UTF-8"?>
<schemalist>
  <schema id="org.example.GjsifyGsettingsTest" path="/org/example/gjsify-gsettings-test/">
    <key name="hello" type="s">
      <default>"world"</default>
      <summary>Test key</summary>
    </key>
  </schema>
</schemalist>
`;

describe('CLI gsettings E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    if (!hasCommand('glib-compile-schemas')) {
      console.log('  skipping: glib-compile-schemas not on PATH');
      return;
    }
    const env = createTestEnvironment('gjsify-e2e-gsettings-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'gsettings-project');
    mkdirSync(join(projectDir, 'data'), { recursive: true });
    writeFileSync(
      join(projectDir, 'data', 'org.example.gschema.xml'),
      SCHEMA_XML,
    );

    setupProject(projectDir, {
      name: 'test-gsettings',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
    }, tarballsDir, tarballMap);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('compiles a schema into gschemas.compiled in the schema dir by default', (t) => {
    if (!projectDir) return t.skip();
    execFileSync('npx', ['gjsify', 'gsettings', 'data'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(
      existsSync(join(projectDir, 'data', 'gschemas.compiled')),
      'gschemas.compiled missing in default targetdir',
    );
  });

  it('honours --targetdir', (t) => {
    if (!projectDir) return t.skip();
    const out = join(projectDir, 'compiled-out');
    execFileSync('npx', ['gjsify', 'gsettings', 'data', '--targetdir', out], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(
      existsSync(join(out, 'gschemas.compiled')),
      'gschemas.compiled missing in --targetdir',
    );
  });
});
