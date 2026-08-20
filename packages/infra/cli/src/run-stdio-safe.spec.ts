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
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The worktree-local compiled CLI lib, as a `file://` URL.
// `gjsify run test:node` runs from `packages/infra/cli`.
//
// A URL, not a path, because every use below is an ESM specifier: the static
// `import` inside RUNNER_SRC and the dynamic `import()`s in the `--` tests. On
// POSIX an absolute path happens to work as a specifier; on Windows it is
// `C:\…`, which the loader rejects outright with ERR_UNSUPPORTED_ESM_URL_SCHEME
// ("Received protocol 'c:'"), failing these three tests for a reason that has
// nothing to do with what they assert. `pathToFileURL` also escapes the spaces
// and `#` a checkout path may contain, which plain interpolation mangles on
// every platform.
const PKG_ROOT = process.cwd();
const CLI_LIB = pathToFileURL(resolve(PKG_ROOT, 'lib')).href;

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
// NB `completion` is passed here as SOURCE TEXT, so no type checker can hold it:
// the CLI's tsconfig excludes specs, and this string is written to a temp file and
// run in a child. It is `'exit'` because the runner ends when the bundle does.
const RUNNER_SRC = `
import { runGjsBundle } from '${CLI_LIB}/utils/run-gjs.js';
const [,, bundlePath, ...extraArgs] = process.argv;
await runGjsBundle(bundlePath, extraArgs, { completion: 'exit' });
`;

let tmpDir: string | undefined;

// INSIDE `@gjsify/cli`, not the OS temp dir, and that is a resolution
// requirement rather than tidiness. Deno resolves a bare specifier against the
// nearest `package.json` ABOVE THE ENTRY; a runner under `/tmp` has none, so
// its dependency set is empty. `run-gjs.js` reaches
// `@gjsify/rolldown-plugin-gjsify/runtime` (through `utils/spawn.js`, for
// `isGjs()`), and Deno refused the whole graph with `Import "…" not a
// dependency` while node and bun resolved it by walking `node_modules` — three
// tests red on the `cross-runtime` leg alone. `@gjsify/cli` DECLARES that
// dependency, so anchoring the runner in its directory is what makes all three
// runtimes agree. `tmp/` is gitignored tree-wide, so a crashed run leaves
// nothing behind that `git status` will show.
function setup(): { bundlePath: string; runnerPath: string } {
    const scratch = join(PKG_ROOT, 'tmp');
    mkdirSync(scratch, { recursive: true });
    tmpDir = mkdtempSync(join(scratch, 'run-stdio-safe-'));
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
        // oxlint-disable-next-line gjsify/spawn-node-binary -- re-entering the CURRENT runtime IS the intent here: this suite is built `--app node` and run by node, bun and deno (`test:cross-runtime`), so the child has to be whichever of the three is under test. It never runs under GJS, so the wrong-interpreter hazard the rule guards cannot arise.
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
                // `-w`/`--workspace` added an `.option()` link to the builder chain
                // (run.ts) — the stub must expose it or the chain throws before
                // reaching `.parserConfiguration()`.
                option: () => mockYargs,
                // The pass-through builder also calls `.version(false).help(false)`
                // to stop gjsify intercepting the target's --version/--help.
                version: () => mockYargs,
                help: () => mockYargs,
                parserConfiguration: (cfg: Record<string, unknown>) => {
                    capturedConfig = cfg;
                    return mockYargs;
                },
            };
            runMod.runCommand.builder(mockYargs as unknown as Parameters<typeof runMod.runCommand.builder>[0]);
            expect(capturedConfig?.['populate--']).toBe(true);
            // Also forwards unknown flags without a `--` separator.
            expect(capturedConfig?.['unknown-options-as-args']).toBe(true);
        });

        await it('yargs puts -- args in args["--"], handler merges them into extraArgs', async () => {
            // Verify the actual yargs parsing: with populate-- set, args after
            // `--` must land in args['--'], not be silently dropped.
            // We call yargs without .strict() here because the bundled yargs
            // may not expose .strict() on the factory return value.
            const yargsLib = (await import('yargs')) as { default: (args: string[]) => unknown };
            const yargs = yargsLib.default as unknown as (args: string[]) => {
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
            expect(((handlerArgs?.['--'] as string[]) ?? []).includes('from-double-dash')).toBe(true);
        });

        await it('forwards unknown --flags WITHOUT a -- separator (unknown-options-as-args)', async () => {
            // The common case: `gjsify run app.gjs.mjs serve --port 8080 --year 2025`.
            // Without `unknown-options-as-args`, --port/--year are parsed as the
            // run command's own options (and rejected by the top-level .strict());
            // with it, they route into the `[args..]` positional and reach the child.
            const yargsLib = (await import('yargs')) as { default: (args: string[]) => unknown };
            const yargs = yargsLib.default as unknown as (args: string[]) => {
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
            await yargs(['run', 'mytarget', 'serve', '--port', '8080', '--year', '2025'])
                .command(
                    'run <target> [args..]',
                    'run cmd',
                    (y) =>
                        y
                            .positional('target', { type: 'string', demandOption: true })
                            .positional('args', { type: 'string', array: true, default: [] })
                            .parserConfiguration({ 'populate--': true, 'unknown-options-as-args': true }),
                    (args) => {
                        handlerArgs = JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
                    },
                )
                .parseAsync();

            const forwarded = (handlerArgs?.args as string[]) ?? [];
            expect(forwarded.includes('--port')).toBe(true);
            expect(forwarded.includes('8080')).toBe(true);
            expect(forwarded.includes('--year')).toBe(true);
        });

        // ------------------------------------------------------------------ //
        // Bug 3: --help / --version must forward to the target, not be caught
        // by gjsify. The builder disables gjsify's own version/help for this
        // pass-through command (same as `tsc`), so they become unknown flags
        // and route into `[args..]` like any other forwarded flag.
        // ------------------------------------------------------------------ //

        await it('run builder disables gjsify --version/--help (so they forward to the target)', async () => {
            const runMod = (await import(`${CLI_LIB}/commands/run.js`)) as {
                runCommand: { builder: (y: unknown) => unknown };
            };
            let versionArg: unknown = 'unset';
            let helpArg: unknown = 'unset';
            const mockYargs = {
                positional: () => mockYargs,
                option: () => mockYargs,
                parserConfiguration: () => mockYargs,
                version: (v: unknown) => {
                    versionArg = v;
                    return mockYargs;
                },
                help: (h: unknown) => {
                    helpArg = h;
                    return mockYargs;
                },
            };
            runMod.runCommand.builder(mockYargs as unknown as Parameters<typeof runMod.runCommand.builder>[0]);
            // Both must be explicitly disabled (false) — else yargs intercepts
            // `gjsify run <target> --help` / `--version` instead of forwarding.
            expect(versionArg).toBe(false);
            expect(helpArg).toBe(false);
        });

        await it('with version/help disabled, --help and --version forward into args', async () => {
            const yargsLib = (await import('yargs')) as { default: (args: string[]) => unknown };
            const yargs = yargsLib.default as unknown as (args: string[]) => {
                command(
                    cmd: string,
                    desc: string,
                    builder: (y: {
                        positional(name: string, opts: unknown): unknown;
                        version(v: boolean): unknown;
                        help(h: boolean): unknown;
                        parserConfiguration(cfg: unknown): unknown;
                    }) => unknown,
                    handler: (args: Record<string, unknown>) => void,
                ): { parseAsync(): Promise<void> };
            };
            let handlerArgs: Record<string, unknown> | null = null;
            await yargs(['run', 'start', 'check-apis', '--help', '--version'])
                .command(
                    'run <target> [args..]',
                    'run cmd',
                    (y) =>
                        y
                            .positional('target', { type: 'string', demandOption: true })
                            .positional('args', { type: 'string', array: true, default: [] })
                            .version(false)
                            .help(false)
                            .parserConfiguration({ 'populate--': true, 'unknown-options-as-args': true }),
                    (args) => {
                        handlerArgs = JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
                    },
                )
                .parseAsync();
            const forwarded = (handlerArgs?.args as string[]) ?? [];
            // --help/--version reach the child instead of triggering gjsify's own.
            expect(forwarded.includes('--help')).toBe(true);
            expect(forwarded.includes('--version')).toBe(true);
            // …and the target is still parsed correctly.
            expect(handlerArgs?.target).toBe('start');
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
