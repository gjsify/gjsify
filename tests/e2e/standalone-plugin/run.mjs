// E2E test for standalone @gjsify/esbuild-plugin-gjsify usage.
// Simulates a user writing their own esbuild config with the plugin.
// The user installs esbuild + the plugin + @gjsify/node-polyfills.
// Requires: yarn build (monorepo must be built first)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

describe('standalone esbuild-plugin E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-plugin-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'plugin-project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    // Custom esbuild config using the plugin directly
    writeFileSync(join(projectDir, 'esbuild.config.mjs'),
      "import { build } from 'esbuild';\n" +
      "import { gjsifyPlugin } from '@gjsify/esbuild-plugin-gjsify';\n" +
      "\n" +
      "await build({\n" +
      "    entryPoints: ['src/index.ts'],\n" +
      "    outfile: 'dist/index.js',\n" +
      "    plugins: [gjsifyPlugin({ app: 'gjs' })],\n" +
      "});\n"
    );

    // Source file with console + Node.js imports
    writeFileSync(join(projectDir, 'src', 'index.ts'),
      "import * as path from 'node:path';\n" +
      "console.log(path.join('hello', 'world'));\n"
    );

    // Install esbuild + plugin + polyfills (no CLI!)
    setupProject(projectDir, {
      name: 'test-standalone-plugin',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: {
        'esbuild': '^0.27.4',
        '@gjsify/esbuild-plugin-gjsify': '^0.1.0',
        '@gjsify/node-polyfills': '^0.1.0',
      },
    }, tarballsDir, tarballMap);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('builds with standalone plugin + polyfills installed', () => {
    execSync('node esbuild.config.mjs', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    assert.ok(existsSync(join(projectDir, 'dist', 'index.js')), 'dist/index.js missing');
  });

  it('console shim is self-contained (no unresolved @gjsify/console import)', () => {
    const output = readFileSync(join(projectDir, 'dist', 'index.js'), 'utf8');
    // The bundled shim should NOT contain an import from @gjsify/console —
    // it should be fully inlined.
    assert.ok(
      !output.includes('from "@gjsify/console"') && !output.includes("from '@gjsify/console'"),
      'Build output still has unresolved @gjsify/console import — shim not bundled correctly'
    );
  });

  it('build output is valid JavaScript', () => {
    const fullPath = join(projectDir, 'dist', 'index.js');
    if (existsSync(fullPath)) {
      execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
    }
  });
});
