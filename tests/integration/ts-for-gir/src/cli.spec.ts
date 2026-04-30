// SPDX-License-Identifier: MIT
// Phase 4 prep: validates that the @ts-for-gir/cli command tree (yargs +
// cosmiconfig + glob + colorette + the lighter command modules) can run
// on top of @gjsify/* polyfills.
//
// Scope notes:
// - Tests exec the bundled CLI as a subprocess and assert on stdout/stderr.
// - Node-only for now. The GJS bundle of @ts-for-gir/cli pulls in several
//   packages that read their own package.json eagerly via `import.meta.url`
//   (typedoc) or that need named exports we'd have to stub by hand
//   (@inquirer/prompts, inquirer). These need either upstream lazy-imports
//   or runtime npm-style resolution in `gjsify run` — tracked as Phase 4b in
//   STATUS.md.
// - This suite proves the gjsify infrastructure added in this PR
//   (`util.styleText`, `util.stripVTControlCharacters`, the ESM
//   `__filename`/`__dirname` banner for the Node target, and the new
//   `--define` / `--external` / `--alias` flags on `gjsify build`) is
//   sufficient to bundle and run a real-world non-trivial TypeScript CLI.

import { describe, expect, it, on } from '@gjsify/unit';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const CLI_NODE_BUNDLE = join(PROJECT_ROOT, 'dist', 'cli.node.mjs');
const GIRS_DIR = join(PROJECT_ROOT, 'girs');

interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runCli(args: string[]): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI_NODE_BUNDLE, ...args], {
      cwd: PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

export default async () => {
  // GJS skip: the @ts-for-gir/cli bundle does not currently load on GJS
  // (see header comment + STATUS.md Phase 4b). Node validates the
  // infrastructure end-to-end.
  await on('Node.js', async () => {

    await describe('@ts-for-gir/cli — yargs surface (Node bundle)', async () => {

      await it('--version prints the injected version', async () => {
        const r = await runCli(['--version']);
        expect(r.code).toBe(0);
        expect(r.stdout.trim()).toBe('4.0.0-rc.6');
      });

      await it('--help prints the command tree and the global options', async () => {
        const r = await runCli(['--help']);
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
      });

      await it('rejects an unknown command (yargs --strict in start.ts)', async () => {
        const r = await runCli(['this-command-does-not-exist']);
        // yargs --strict exits non-zero on unknown commands.
        expect(r.code).not.toBe(0);
        expect(r.stderr.length > 0 || r.stdout.length > 0).toBe(true);
      });
    });

    await describe('@ts-for-gir/cli list (cosmiconfig + glob + colorette)', async () => {

      await it('list --help prints the per-command options', async () => {
        const r = await runCli(['list', '--help']);
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('Lists all available GIR modules');
        // Confirms cosmiconfig + the option builder loaded successfully.
        expect(r.stdout).toContain('--girDirectories');
        expect(r.stdout).toContain('--ignore');
        expect(r.stdout).toContain('--configName');
      });

      await it('list -g <dir> discovers our local GIR fixtures', async () => {
        const r = await runCli(['list', '-g', GIRS_DIR]);
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
      });
    });
  });
};
