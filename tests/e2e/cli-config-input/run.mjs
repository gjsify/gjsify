// E2E regression test for `gjsify build` honouring `bundler.input` from
// package.json#gjsify (or .gjsifyrc.js) when no `--entry-points` flag is
// passed.
//
// What this guards against (concretely): @ts-for-gir/cli@4.0.0-rc.14
// shipped a GJS bundle that exited silently on `--version` / `--help` /
// any invocation. Root cause was here in @gjsify/cli: yargs's
// `--entry-points` had `default: ['src/index.ts']`, which is
// indistinguishable from "user explicitly passed the flag" in the
// parsed-args object — so the merge step in config.ts always wrote
// `cliArgs.entryPoints` to `bundler.input`, silently overriding
// `gjsify.bundler.input: "src/start.ts"` from the consumer's package.json.
// Result: the bundle was built from `src/index.ts` (a barrel re-export
// file) instead of `src/start.ts` (the yargs-runtime entry), so nothing
// ran at module load.
//
// The test sets up a project where `src/index.ts` ONLY emits a sentinel
// string for the index-built case, and `src/start.ts` ONLY emits a
// sentinel for the start-built case. We declare the start-file via
// `gjsify.bundler.input` and assert the bundle contains the start
// sentinel, not the index sentinel.

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

const SENTINEL_INDEX = '__SENTINEL_BUILT_FROM_INDEX_TS__';
const SENTINEL_START = '__SENTINEL_BUILT_FROM_START_TS__';

describe('gjsify build entry-point resolution E2E', { timeout: 10 * 60 * 1000 }, () => {
  let tmpDir;
  let tarballsDir;
  let tarballMap;
  let projectDir;

  before(() => {
    const env = createTestEnvironment('gjsify-e2e-cli-config-input-');
    tmpDir = env.tmpDir;
    tarballsDir = env.tarballsDir;
    tarballMap = env.tarballMap;

    projectDir = join(tmpDir, 'cli-config-input-project');
    mkdirSync(join(projectDir, 'src'), { recursive: true });

    // Two distinguishable entry candidates. Whichever one `gjsify build`
    // bundles will leave its sentinel in the output; we read the bundle
    // and assert which one wins.
    writeFileSync(
      join(projectDir, 'src', 'index.ts'),
      `console.log("${SENTINEL_INDEX}");\nexport const fromIndex = true;\n`,
    );
    writeFileSync(
      join(projectDir, 'src', 'start.ts'),
      `console.log("${SENTINEL_START}");\nexport const fromStart = true;\n`,
    );

    setupProject(projectDir, {
      name: 'test-cli-config-input',
      version: '0.0.1',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: {
        // The exact knob whose precedence we're testing. Without the fix,
        // yargs's `--entry-points` default would shadow this.
        bundler: {
          input: 'src/start.ts',
          output: { file: 'dist/app.js', minify: false },
        },
      },
    }, tarballsDir, tarballMap);
  });

  after(() => {
    cleanupTestEnvironment(tmpDir);
  });

  it('respects gjsify.bundler.input from package.json when no --entry-points is passed', () => {
    // Note: no positional or `--entry-points` argument here. The whole
    // point of the regression is that `gjsify build` (no args) must read
    // its entry from the cosmiconfig data, not from the yargs default.
    execFileSync('npx', ['gjsify', 'build'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    const out = join(projectDir, 'dist', 'app.js');
    assert.ok(existsSync(out), `expected ${out} to be written`);
    const contents = readFileSync(out, 'utf8');
    assert.ok(
      contents.includes(SENTINEL_START),
      `bundle should contain the start.ts sentinel (was bundled from the wrong entry?). dist/app.js contents:\n${contents}`,
    );
    assert.ok(
      !contents.includes(SENTINEL_INDEX),
      `bundle must NOT contain the index.ts sentinel — that means yargs's default leaked through`,
    );
  });

  it('explicit --entry-points overrides the package.json setting', () => {
    // The override the yargs default was meant to enable still works when
    // the user actually passes the flag.
    execFileSync('npx', ['gjsify', 'build', '--entry-points', 'src/index.ts'], {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    const out = join(projectDir, 'dist', 'app.js');
    const contents = readFileSync(out, 'utf8');
    assert.ok(contents.includes(SENTINEL_INDEX), 'CLI flag should pick index.ts');
    assert.ok(!contents.includes(SENTINEL_START), 'start.ts must not appear when CLI flag is set');
  });

  it('falls back to src/index.ts when neither CLI nor config sets an entry', () => {
    // A second project with NO `gjsify.bundler.input` configured. Without
    // any cosmiconfig `bundler.input` and no CLI flag, the documented
    // fallback should take effect.
    const fallbackDir = join(tmpDir, 'cli-config-input-fallback');
    mkdirSync(join(fallbackDir, 'src'), { recursive: true });
    writeFileSync(
      join(fallbackDir, 'src', 'index.ts'),
      `console.log("${SENTINEL_INDEX}");\n`,
    );
    setupProject(fallbackDir, {
      name: 'test-cli-config-input-fallback',
      version: '0.0.1',
      type: 'module',
      private: true,
      dependencies: { '@gjsify/cli': '^0.1.0' },
      gjsify: {
        bundler: { output: { file: 'dist/app.js', minify: false } },
      },
    }, tarballsDir, tarballMap);

    execFileSync('npx', ['gjsify', 'build'], {
      cwd: fallbackDir,
      stdio: 'pipe',
      timeout: 60 * 1000,
    });
    const out = join(fallbackDir, 'dist', 'app.js');
    assert.ok(existsSync(out), `expected ${out} to be written`);
    const contents = readFileSync(out, 'utf8');
    assert.ok(contents.includes(SENTINEL_INDEX), 'fallback to src/index.ts must work');
  });
});
