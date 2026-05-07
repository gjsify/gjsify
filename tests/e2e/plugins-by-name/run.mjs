// E2E test for `bundler.plugins` entries that reference a plugin by package
// name (or relative path). Lets `package.json#gjsify` describe the full
// plugin chain without dropping to a JS-form config file.

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

const PLUGIN_SOURCE = `// Tiny test plugin — replaces the literal __INJECTED__ in any module
// with a marker string. Tests that:
//   1. By-name resolution finds the file
//   2. The default-export factory is called with the supplied options
//   3. The resulting plugin is wired into the Rolldown plugin chain
export default function testPlugin(options) {
  const marker = options?.marker ?? 'fallback-marker';
  return {
    name: 'e2e-test-plugin',
    transform: {
      filter: { id: /\\.[mc]?[tj]sx?$/ },
      handler(code) {
        if (!code.includes('__INJECTED__')) return null;
        return { code: code.replace(/__INJECTED__/g, JSON.stringify(marker)), map: null };
      },
    },
  };
}
`;

describe('CLI plugins-by-name E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-plugins-by-name-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'plugins-by-name-project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    setupProject(projectDir, {
      name: 'test-plugins-by-name',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: {
        bundler: {
          output: { file: 'dist/app.js', minify: false },
          plugins: [
            { name: './fixture-plugin.mjs', options: { marker: 'hello-from-by-name' } },
          ],
        },
      },
    }, tarballsDir, tarballMap);

    writeFileSync(join(projectDir, 'fixture-plugin.mjs'), PLUGIN_SOURCE);
    writeFileSync(join(projectDir, 'src', 'app.ts'),
      `// @ts-nocheck — __INJECTED__ is provided by the fixture plugin via
// a substitution transform, not a declaration. A \`declare const\`
// here would also get rewritten by the transform (regex is intentionally
// dumb to keep the test fixture small) and produce invalid TS.
console.log(__INJECTED__);
`);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('resolves a relative-path plugin and applies its transform', () => {
    execFileSync('npx', ['gjsify', 'build', 'src/app.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'app.js')), 'dist/app.js missing');
    const out = readFileSync(join(projectDir, 'dist', 'app.js'), 'utf-8');
    assert.match(
      out,
      /"hello-from-by-name"/,
      'plugin transform did not run — __INJECTED__ marker still present or replaced with fallback',
    );
  });
});
