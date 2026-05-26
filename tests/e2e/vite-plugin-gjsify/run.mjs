// E2E test for `@gjsify/vite-plugin-gjsify` — the Vite-plugin track.
//
// Simulates a web app that uses `gjsifyBrowser()` in its Vite config and runs
// a programmatic `vite build` (the same engine path Vite uses for production
// browser bundles). The fixture entry pulls in GJS-shaped code: it imports
// `node:assert` (which the gjsify browser preset aliases to `@gjsify/assert`)
// and `@gjsify/unit` (which transitively reaches `@girs/*` / `gi://` GJS-only
// specifiers). The test then asserts the produced bundle:
//   - contains NO `gi://` substring,
//   - contains NO `@girs/` substring,
//   - resolved `node:assert` → `@gjsify/assert` (no bare `node:assert` import
//     left in the output).
//
// Mirrors the project-setup helpers used by `cli-only` / `standalone-plugin`:
// pack every workspace tarball, install via npm overrides, then drive the real
// build. `vite` is added as a devDep of the fixture project so the programmatic
// `await import('vite')` resolves from the project's own node_modules.
//
// Requires: yarn build (monorepo built first) — same precondition as the other
// plugin e2e suites; the real `vite build` is what CI verifies end-to-end.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  createTestEnvironment,
  cleanupTestEnvironment,
  setupProject,
} from '../helpers.mjs';

describe('vite-plugin-gjsify E2E (Vite-dev parity with --app browser)', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-vite-plugin-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'vite-plugin-project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    // A Vite config that spreads the gjsifyBrowser() preset.
    writeFileSync(join(projectDir, 'vite.config.mjs'),
      "import { defineConfig } from 'vite';\n" +
      "import { gjsifyBrowser } from '@gjsify/vite-plugin-gjsify';\n" +
      "\n" +
      "export default defineConfig({\n" +
      "  plugins: [...gjsifyBrowser()],\n" +
      "});\n"
    );

    // Entry imports GJS-shaped code:
    //  - `node:assert` → must be aliased to @gjsify/assert by the preset
    //  - `@gjsify/unit` → drags in transitive @girs/* / gi:// specifiers that
    //    gjsImportsEmptyPlugin must redirect to an empty module
    writeFileSync(join(projectDir, 'src', 'entry.ts'),
      "import assert from 'node:assert';\n" +
      "import * as unit from '@gjsify/unit';\n" +
      "\n" +
      "export function run() {\n" +
      "  assert.ok(typeof unit === 'object');\n" +
      "  return 'gjsify-vite-ok';\n" +
      "}\n" +
      "// Reference the export so tree-shaking keeps the assert/unit imports.\n" +
      "globalThis.__gjsifyViteRun = run;\n"
    );

    // The build driver: programmatic `vite build` with the preset's plugins.
    writeFileSync(join(projectDir, 'build.mjs'),
      "import { build } from 'vite';\n" +
      "import { gjsifyBrowser } from '@gjsify/vite-plugin-gjsify';\n" +
      "import { fileURLToPath } from 'node:url';\n" +
      "import { dirname, resolve } from 'node:path';\n" +
      "\n" +
      "const __dirname = dirname(fileURLToPath(import.meta.url));\n" +
      "\n" +
      "await build({\n" +
      "  root: __dirname,\n" +
      "  logLevel: 'error',\n" +
      "  plugins: [...gjsifyBrowser()],\n" +
      "  build: {\n" +
      "    outDir: resolve(__dirname, 'dist'),\n" +
      "    emptyOutDir: true,\n" +
      "    minify: false,\n" +
      "    lib: {\n" +
      "      entry: resolve(__dirname, 'src/entry.ts'),\n" +
      "      formats: ['es'],\n" +
      "      fileName: 'entry',\n" +
      "    },\n" +
      "  },\n" +
      "});\n"
    );

    setupProject(projectDir, {
      name: 'test-vite-plugin-gjsify',
      version: '0.1.0',
      type: 'module',
      private: true,
      dependencies: {
        '@gjsify/vite-plugin-gjsify': '^0.1.0',
        '@gjsify/unit': '^0.1.0',
        '@gjsify/assert': '^0.1.0',
        '@gjsify/empty': '^0.1.0',
      },
      devDependencies: {
        'vite': '^8.0.11',
      },
    }, tarballsDir, tarballMap);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  function readBundle() {
    const distDir = join(projectDir, 'dist');
    assert.ok(existsSync(distDir), 'dist/ missing after vite build');
    const jsFiles = readdirSync(distDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
    assert.ok(jsFiles.length > 0, 'no JS output produced by vite build');
    return jsFiles.map((f) => readFileSync(join(distDir, f), 'utf8')).join('\n');
  }

  it('vite build succeeds with gjsifyBrowser() preset', () => {
    // execSync via node so the programmatic vite build runs inside the project.
    execNode(join(projectDir, 'build.mjs'), projectDir);
    assert.ok(existsSync(join(projectDir, 'dist')), 'dist/ missing');
  });

  it('output contains NO gi:// specifier (gjsImportsEmptyPlugin redirected them)', () => {
    const out = readBundle();
    assert.ok(!out.includes('gi://'), 'bundle still contains a gi:// specifier');
  });

  it('output contains NO @girs/ specifier (gjsImportsEmptyPlugin redirected them)', () => {
    const out = readBundle();
    assert.ok(!out.includes('@girs/'), 'bundle still contains an @girs/ specifier');
  });

  it('node:assert resolved to @gjsify/assert (no bare node:assert import left)', () => {
    const out = readBundle();
    // No unresolved `node:assert` specifier should survive in the browser bundle.
    assert.ok(
      !out.includes('"node:assert"') && !out.includes("'node:assert'") && !out.includes('from"node:assert"'),
      'bundle still has an unresolved node:assert import — alias did not resolve',
    );
  });
});

// --- helpers ---------------------------------------------------------------

function execNode(scriptPath, cwd) {
  execFileSync('node', [scriptPath], {
    cwd,
    stdio: 'pipe',
    timeout: 5 * 60 * 1000,
  });
}
