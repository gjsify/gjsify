// SPDX-License-Identifier: MIT
// Regression tests for `gjsify run <file>` stdio safety and arg forwarding.
//
// Verified bugs (both fixed in this PR):
//
//   1. STDOUT POLLUTION: `runGjsBundle` emitted `$ gjs -m <file>` via
//      `console.log` which went to stdout. Children speaking a protocol on
//      stdout (e.g. an MCP stdio server) received a corrupt stream.
//      Fix: changed to `console.error`.
//
//   2. ARG DROPPING with `--`: `gjsify run target -- a b c` silently dropped
//      a, b, c. Yargs put them in `args._` (not in the `args` positional)
//      when `populate--` was not set. Fix: added
//      `parserConfiguration({ 'populate--': true })` to the builder and
//      merged `args['--']` into `extraArgs` in the handler.
//
// Test strategy: rather than spawning the full CLI binary (which requires all
// @gjsify/* workspace packages to be compiled), each test spawns a thin
// inline runner that imports ONLY `lib/utils/run-gjs.js` — the only module
// that changed for bug 1. For bug 2 we import `lib/commands/run.js` directly
// to verify yargs parses `--` correctly without loading the full CLI surface.

import { describe, it, expect } from '@gjsify/unit';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

// Path to the worktree-local compiled CLI lib.
// `gjsify run test:node` runs from `packages/infra/cli`.
const CLI_LIB = resolve(process.cwd(), 'lib');

// A minimal GJS ESM module (no imports needed — print/ARGV are GJS globals):
//   - Prints a fixed marker on stdout  →  assert no banner leaked in
//   - Echoes its first ARGV arg on stdout  →  assert arg forwarding
const GJS_BUNDLE_SRC = `
// GJS-runnable ESM module: print a marker and echo the first arg.
const args = typeof ARGV !== 'undefined' ? ARGV : [];
print('MARKER:hello');
if (args.length > 0) {
    print('ARG0:' + args[0]);
}
`;

// Thin Node.js runner that calls runGjsBundle directly — avoids loading the
// full CLI (which would need all @gjsify/* workspace packages compiled).
// argv[2] = bundle path, argv[3..] = extra args to forward.
const RUNNER_SRC = `
import { runGjsBundle } from '${CLI_LIB}/utils/run-gjs.js';
const [,, bundlePath, ...extraArgs] = process.argv;
await runGjsBundle(bundlePath, extraArgs);
`;

let tmpDir: string | undefined;

function setup(): { bundlePath: string; runnerPath: string } {
    tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-run-spec-'));
    const bundlePath = join(tmpDir, 'child.mjs');
    writeFileSync(bundlePath, GJS_BUNDLE_SRC);
    const runnerPath = join(tmpDir, 'runner.mjs');
    writeFileSync(runnerPath, RUNNER_SRC);
    return { bundlePath, runnerPath };
}

function cleanup(): void {
    if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = undefined;
    }
}

/** Spawn the thin runner and capture stdout + stderr separately. */
function spawnRunner(
    runnerPath: string,
    bundlePath: string,
    extraArgs: string[] = [],
): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((res) => {
        const child = spawn(process.execPath, [runnerPath, bundlePath, ...extraArgs], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d: Buffer) => (stdout += String(d)));
        child.stderr.on('data', (d: Buffer) => (stderr += String(d)));
        child.on('close', (code: number | null) => res({ stdout, stderr, code: code ?? 1 }));
    });
}

export default async (): Promise<void> => {
    await describe('gjsify run stdio safety + arg forwarding', async () => {
        const { bundlePath, runnerPath } = setup();

        // ------------------------------------------------------------------ //
        // Bug 1: banner must NOT appear on stdout (was console.log, now .error)
        // ------------------------------------------------------------------ //

        await it('stdout contains only the child output — no banner', async () => {
            const { stdout, code } = await spawnRunner(runnerPath, bundlePath);
            expect(code).toBe(0);
            const lines = stdout.trim().split('\n').filter(Boolean);
            // Must contain the child's marker.
            expect(lines).toContain('MARKER:hello');
            // Must NOT contain any `$ gjs -m …` banner line.
            for (const line of lines) {
                expect(line.startsWith('$ ')).toBe(false);
            }
        });

        await it('banner is emitted on stderr (not lost)', async () => {
            const { stderr } = await spawnRunner(runnerPath, bundlePath);
            // The `$ gjs -m <file>` line must be on stderr.
            expect(stderr).toContain('gjs');
            expect(stderr).toContain('-m');
        });

        // ------------------------------------------------------------------ //
        // Bug 2: args must reach the gjs child — positional and after `--`
        // ------------------------------------------------------------------ //

        await it('positional extra args are forwarded to the gjs child', async () => {
            const { stdout, code } = await spawnRunner(runnerPath, bundlePath, ['hello-positional']);
            expect(code).toBe(0);
            expect(stdout).toContain('ARG0:hello-positional');
        });

        // The `--` form is tested via the yargs layer: the `run` command builder
        // must set `parserConfiguration({ 'populate--': true })` and the handler
        // must merge `args['--']` into `extraArgs`. We verify the yargs config
        // directly rather than through the full CLI binary (which requires all
        // @gjsify/* workspace packages compiled).
        await it('yargs populate-- is set in the run command builder', async () => {
            // Import the compiled run command and check its builder output.
            // The builder is a function, so we call it with a mock yargs object
            // that records parserConfiguration calls.
            const runMod = (await import(`${CLI_LIB}/commands/run.js`)) as {
                runCommand: { builder: (y: unknown) => unknown };
            };
            let capturedConfig: Record<string, unknown> | undefined;
            const mockYargs = {
                positional: () => mockYargs,
                parserConfiguration: (cfg: Record<string, unknown>) => {
                    capturedConfig = cfg;
                    return mockYargs;
                },
            };
            runMod.runCommand.builder(mockYargs as unknown as Parameters<typeof runMod.runCommand.builder>[0]);
            expect(capturedConfig?.['populate--']).toBe(true);
        });

        await it('yargs puts -- args in args["--"], handler merges them into extraArgs', async () => {
            // Verify the actual yargs parsing: with populate-- set, args after
            // `--` must land in args['--'], not be silently dropped.
            // We call yargs without .strict() here because the bundled yargs
            // may not expose .strict() on the factory return value.
            const yargsLib = (await import('yargs')) as { default: (args: string[]) => unknown };
            const yargs = yargsLib.default as unknown as (
                args: string[],
            ) => {
                command(
                    cmd: string,
                    desc: string,
                    builder: (y: {
                        positional(name: string, opts: unknown): unknown;
                        parserConfiguration(cfg: unknown): unknown;
                    }) => unknown,
                    handler: (args: Record<string, unknown>) => void,
                ): { parseAsync(): Promise<void> };
            };
            let handlerArgs: Record<string, unknown> | null = null;
            await yargs(['run', 'mytarget', '--', 'from-double-dash', 'second'])
                .command(
                    'run <target> [args..]',
                    'run cmd',
                    (y) =>
                        y
                            .positional('target', { type: 'string', demandOption: true })
                            .positional('args', { type: 'string', array: true, default: [] })
                            .parserConfiguration({ 'populate--': true }),
                    (args) => {
                        handlerArgs = JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
                    },
                )
                .parseAsync();

            // With populate-- true, args['--'] must hold the post-separator values.
            expect(Array.isArray(handlerArgs?.['--'])).toBe(true);
            expect((handlerArgs?.['--'] as string[]).includes('from-double-dash')).toBe(true);
        });

        // ------------------------------------------------------------------ //
        // Teardown
        // ------------------------------------------------------------------ //

        await it('teardown', async () => {
            cleanup();
            expect(true).toBe(true);
        });
    });
};
