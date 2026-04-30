// SPDX-License-Identifier: MIT
// Validates that the @ts-for-gir/cli command tree (yargs + cosmiconfig + glob
// + colorette + the lighter command modules) runs end-to-end on top of
// @gjsify/* polyfills on BOTH Node and GJS.
//
// The suite spawns BOTH bundles (`dist/cli.node.mjs` and `dist/cli.gjs.mjs`)
// as subprocesses from Node. Spawning from inside the GJS test runner would
// be the natural counterpart but `@gjsify/child_process` (Gio.Subprocess)
// currently hangs the parent's main loop when spawning another `gjs` and
// waiting for `close`/`exit` events — tracked as a separate `@gjsify/*` gap
// outside the scope of this PR. Spawning from Node still validates the GJS
// bundle end-to-end: cold-starting `gjs -m <bundle>` exercises the entire
// SpiderMonkey 128 module chain plus our `@gjsify/*` polyfills.
//
// On GJS the suite is gated via the runtime check below — re-running the
// subprocess assertions would be redundant after Node has proven both
// bundles work.

import { describe, expect, it } from '@gjsify/unit';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const REPO_ROOT = join(PROJECT_ROOT, '..', '..', '..');
const CLI_NODE_BUNDLE = join(PROJECT_ROOT, 'dist', 'cli.node.mjs');
const CLI_GJS_BUNDLE = join(PROJECT_ROOT, 'dist', 'cli.gjs.mjs');
const GIRS_DIR = join(PROJECT_ROOT, 'girs');

const isGjs = typeof (globalThis as { imports?: unknown }).imports !== 'undefined';
// The CLI bundle is ~13–28 MB; cold-starting `gjs -m <bundle>` takes 5–10s
// while it walks the bundle, registers the GLib MainLoop, and parses yargs
// config. Generous budget so the test is not flaky under CI load.
const CLI_TEST_TIMEOUT_MS = 30_000;

interface RuntimeBundle {
  label: string;
  cmd: string;
  baseArgs: string[];
  extraEnv: Record<string, string>;
}

const NODE_BUNDLE: RuntimeBundle = {
  label: 'Node bundle',
  cmd: 'node',
  baseArgs: [CLI_NODE_BUNDLE],
  extraEnv: {},
};

const GJS_BUNDLE: RuntimeBundle = {
  label: 'GJS bundle',
  cmd: 'gjs',
  baseArgs: ['-m', CLI_GJS_BUNDLE],
  extraEnv: gjsEnv(),
};

function gjsEnv(): Record<string, string> {
  // The CLI bundle transitively pulls in @gjsify/http-soup-bridge, whose
  // GjsifyHttpSoupBridge-1.0 typelib lives under its prebuilds dir. We don't
  // need webgl/webrtc-native here but include them for symmetry with what
  // `gjsify run` sets, so anything else added later picks up automatically.
  const paths = [
    join(REPO_ROOT, 'node_modules', '@gjsify', 'http-soup-bridge', 'prebuilds', 'linux-x86_64'),
    join(REPO_ROOT, 'node_modules', '@gjsify', 'webgl', 'prebuilds', 'linux-x86_64'),
    join(REPO_ROOT, 'node_modules', '@gjsify', 'webrtc-native', 'prebuilds', 'linux-x86_64'),
  ].join(':');
  return { LD_LIBRARY_PATH: paths, GI_TYPELIB_PATH: paths };
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runCli(bundle: RuntimeBundle, args: string[]): Promise<SpawnResult> {
  const baseEnv = { ...(process.env as Record<string, string>) };
  for (const [k, v] of Object.entries(bundle.extraEnv)) {
    baseEnv[k] = v + (baseEnv[k] ? `:${baseEnv[k]}` : '');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bundle.cmd, [...bundle.baseArgs, ...args], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: baseEnv,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

function describeForBundle(bundle: RuntimeBundle): () => Promise<void> {
  return async () => {

    await describe(`@ts-for-gir/cli — yargs surface (${bundle.label})`, async () => {

      await it('--version prints the injected version', async () => {
        const r = await runCli(bundle, ['--version']);
        expect(r.code).toBe(0);
        expect(r.stdout.trim()).toBe('4.0.0-rc.7');
      }, { timeout: CLI_TEST_TIMEOUT_MS });

      await it('--help prints the command tree and the global options', async () => {
        const r = await runCli(bundle, ['--help']);
        expect(r.code).toBe(0);
        // Top-level usage line from APP_USAGE.
        expect(r.stdout).toContain('TypeScript type definition generator');
        // Each command should appear in the help table.
        for (const cmd of ['analyze', 'create', 'generate', 'json', 'list', 'copy', 'doc']) {
          expect(r.stdout).toContain(`ts-for-gir ${cmd}`);
        }
        // yargs auto-options.
        expect(r.stdout).toContain('--version');
        expect(r.stdout).toContain('--help');
      }, { timeout: CLI_TEST_TIMEOUT_MS });

      await it('rejects an unknown command (yargs --strict in start.ts)', async () => {
        const r = await runCli(bundle, ['this-command-does-not-exist']);
        // yargs --strict exits non-zero on unknown commands.
        expect(r.code).not.toBe(0);
        expect(r.stderr.length > 0 || r.stdout.length > 0).toBe(true);
      }, { timeout: CLI_TEST_TIMEOUT_MS });
    });

    await describe(`@ts-for-gir/cli list (cosmiconfig + glob + colorette) on ${bundle.label}`, async () => {

      await it('list --help prints the per-command options', async () => {
        const r = await runCli(bundle, ['list', '--help']);
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('Lists all available GIR modules');
        // Confirms cosmiconfig + the option builder loaded successfully.
        expect(r.stdout).toContain('--girDirectories');
        expect(r.stdout).toContain('--ignore');
        expect(r.stdout).toContain('--configName');
      }, { timeout: CLI_TEST_TIMEOUT_MS });

      await it('list -g <dir> discovers our local GIR fixtures', async () => {
        const r = await runCli(bundle, ['list', '-g', GIRS_DIR]);
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('Search for gir files in:');
        expect(r.stdout).toContain(GIRS_DIR);
        expect(r.stdout).toContain('Available Modules:');
        // Our three Vala-generated GIRs each appear with their full path —
        // proves glob found them and the renderer formatted them correctly.
        expect(r.stdout).toContain('Gwebgl-0.1');
        expect(r.stdout).toContain(`${GIRS_DIR}/Gwebgl-0.1.gir`);
        expect(r.stdout).toContain('GjsifyWebrtc-0.1');
        expect(r.stdout).toContain(`${GIRS_DIR}/GjsifyWebrtc-0.1.gir`);
        expect(r.stdout).toContain('GjsifyHttpSoupBridge-1.0');
        expect(r.stdout).toContain(`${GIRS_DIR}/GjsifyHttpSoupBridge-1.0.gir`);
      }, { timeout: CLI_TEST_TIMEOUT_MS });
    });
  };
}

export default async () => {
  if (isGjs) {
    // Skip on GJS — `@gjsify/child_process` (Gio.Subprocess) currently hangs
    // when the parent is also `gjs` and is waiting on the child's close/exit
    // events. Both bundles are exercised from the Node side; re-running them
    // here would be a no-op against the same on-disk artifacts.
    return;
  }
  await describeForBundle(NODE_BUNDLE)();
  await describeForBundle(GJS_BUNDLE)();
};
