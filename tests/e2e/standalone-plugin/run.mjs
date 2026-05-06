// E2E test for standalone `@gjsify/rolldown-plugin-gjsify` usage.
// Simulates a user writing their own Rolldown config with the orchestrator.
// The user installs rolldown + the plugin + @gjsify/node-polyfills.
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

describe('standalone rolldown-plugin E2E', { timeout: 10 * 60 * 1000 }, () => {
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

    // Custom Rolldown config using the orchestrator plugin directly.
    // Mirrors what `gjsify build` does internally — the orchestrator
    // returns `{ options, plugins }` which the user composes with
    // `rolldown(...)` + `.write()` + `.close()`.
    writeFileSync(join(projectDir, 'rolldown.config.mjs'),
      "import { rolldown } from 'rolldown';\n" +
      "import { gjsifyPlugin } from '@gjsify/rolldown-plugin-gjsify';\n" +
      "\n" +
      "const cfg = await gjsifyPlugin(\n" +
      "    { input: 'src/index.ts', output: { file: 'dist/index.js' } },\n" +
      "    { app: 'gjs' },\n" +
      ");\n" +
      "\n" +
      "const build = await rolldown({ ...cfg.options, plugins: cfg.plugins });\n" +
      "try {\n" +
      "    await build.write(cfg.options.output ?? {});\n" +
      "} finally {\n" +
      "    await build.close();\n" +
      "}\n"
    );

    // Source file with console + Node.js imports
    writeFileSync(join(projectDir, 'src', 'index.ts'),
      "import * as path from 'node:path';\n" +
      "console.log(path.join('hello', 'world'));\n"
    );

    // Install rolldown + plugin + polyfills (no CLI!)
    setupProject(projectDir, {
      name: 'test-standalone-plugin',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: {
        'rolldown': '^1.0.0-rc.18',
        '@gjsify/rolldown-plugin-gjsify': '^0.1.0',
        '@gjsify/node-polyfills': '^0.1.0',
      },
    }, tarballsDir, tarballMap);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('builds with standalone plugin + polyfills installed', () => {
    execSync('node rolldown.config.mjs', {
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
