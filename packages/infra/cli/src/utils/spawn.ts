// One `spawn` → `Promise<{ code, signal }>` wrapper for the whole CLI.
//
// ## The GJS teardown contract — why this helper has a host branch
//
// `@gjsify/child_process`'s ASYNC `spawn()` calls `ensureMainLoop()`
// (`@gjsify/utils`) to give the `Gio.Subprocess` `wait_async` exit callback a
// running GLib main context. That arms a GJS main-loop hook
// (`GLib.MainLoop.runAsync()` → `setMainLoopHook`) which `eval_module` runs AFTER
// the entry module's top-level await settles, entering a blocking
// `g_main_loop_run()` nothing ever quits. GJS has no atexit hook, so only
// `process.exit()` tears it down (`exitProcess` idle-schedules `quitMainLoop()` +
// `imports.system.exit()`).
//
// So on gjs 1.88 a command that async-spawns a child and then RETURNS NORMALLY
// parks at 0% CPU AFTER the child has exited and been reaped. The symptom — live
// parent, no children, blocked in `poll`, `SNl` — is identical to a lost exit
// callback and gets misdiagnosed as one; the event IS delivered, and the parent
// then parks in the armed loop on its way out.
//
// The branch is therefore NOT "GJS ⇒ spawnSync":
//
//   | host | caller ends with       | path                                |
//   |------|------------------------|-------------------------------------|
//   | Node | anything               | async `spawn` (streaming)           |
//   | GJS  | `process.exit(…)`      | async `spawn` (streaming)           |
//   | GJS  | a normal `return`      | blocking `spawnSync` (captured)     |
//   | GJS  | never — it supervises  | async `spawn` (streaming)           |
//
// The fourth row is `completion: 'daemon'`: a command like `gjsify storybook
// --watch` neither exits nor unwinds, so an armed loop is not a leak there but the
// thing keeping it alive. It takes the handle through `onSpawn` and never awaits the
// completion promise. What it must NOT do is expect this spawn to arm that loop —
// `ensureMainLoop()` declines at `GLib.main_depth() !== 0`, and a supervisor reaches
// its spawn from a continuation GJS resumed inside the main-context spin it runs
// while the entry module's top-level await is pending, i.e. at depth 1. A daemon
// holds the loop itself, through `holdMainLoop()` (`utils/watch-loop.ts` does).
//
// which is why `gjsify foreach`/`workspace`/`check` and `runGjsBundle` run hundreds
// of async-spawned children under GJS without hanging: each ends its handler with
// `process.exit(…)`. `gjsify lint` did not, and that was the hang. Hence the
// REQUIRED {@link SpawnToCompletionOptions.completion} field — a new call site must
// state which side of the table it is on rather than inherit a wrong default.
//
// ## Under `packages/infra/cli/src/`, a raw async `spawn` is never fine
//
// The contract above binds only code that USES this helper, and one import bypassed
// it for years — `utils/run-lifecycle-script.ts` reached for `node:child_process`
// while its own header asserted the opposite, and `gjsify pack` parked for 5m30s
// after finishing its work on any package with a `prepack`, the production
// `gjsify run publish:app` chain included (#1010).
//
// So the rule is enforced rather than written down: `scripts/check-spawn-teardown-
// contract.mjs` fails on a value import of async `spawn` from `node:child_process`
// anywhere under `packages/infra/cli/src/` outside this file, unless the site
// carries an entry in `scripts/spawn-teardown-exceptions.mjs`. Deliberately narrow
// to async `spawn`: `spawnSync` blocks and arms nothing, and `exec`/`execFile` stay
// out until the `gjsify gsettings` observation (an `execFile` command that compiles
// a schema and exits in 0.45 s although `_execImpl` also calls `ensureMainLoop`) is
// explained rather than generalised from.
//
// ## What is spawned still matters — the Windows rewrite
//
// This helper also carries the Windows command rewrite (`forWin32`), which is a
// second reason to come through it, and the one that applies OUTSIDE the CLI too:
//
//   • a real executable (`git`, `gh`, `node`, `gjs`, `flatpak`, `process.execPath`)
//     resolves on Windows via `.exe`, so a rewrite is not what it needs.
//   • `shell: true` is fine — Node routes it through `%COMSPEC%`, which finds
//     `.cmd` shims.
//   • a PACKAGE MANAGER or any `node_modules/.bin` entry by BARE NAME (`npm`,
//     `yarn`, `npx`, `tsc`, `oxlint`, a `pm` from `detectPackageManager()`) cannot
//     work without it: on Windows those are `.cmd` shims, where `spawn('npm')` is
//     ENOENT and `spawn('npm.cmd')` is EINVAL.
//
// The third case is not hypothetical, and each instance was invisible to Linux and
// macOS CI: raw spawns left `commands/check.ts` exiting 1 with no diagnostic,
// `utils/install-backend.ts` reporting "npm not found on PATH" where npm was on
// PATH, and `commands/onboard.ts` breaking the pre-publish build.

import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isGjs } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { type Win32Invocation, resolveWin32Command } from './win32-command.js';

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * What the calling command does once this spawn settles.
 *
 * - `'exit'` — the command terminates the process itself, which quits the armed GJS
 *   main loop, so the streaming async `spawn` is safe on both hosts.
 * - `'return'` — the command returns and lets the CLI unwind. Under GJS that must
 *   not leave a main loop armed, so the child runs on the blocking `spawnSync` path.
 * - `'daemon'` — the command settles nothing: it stays alive supervising the child,
 *   on a main loop it holds ITSELF under GJS (`holdMainLoop()`; see the module header
 *   for why this spawn cannot arm one for it). The caller takes the handle through
 *   {@link SpawnToCompletionOptions.onSpawn} and does NOT await the returned promise,
 *   so "once this spawn settles" has no answer for it. Distinct from `'exit'` because
 *   a supervisor has no exit to be safe by; it routes to the same streaming path.
 *
 * See the module header for the full rationale.
 */
export type SpawnCompletionContract = 'exit' | 'return' | 'daemon';

export interface SpawnToCompletionOptions {
    /** The caller's teardown contract. Required — see {@link SpawnCompletionContract}. */
    completion: SpawnCompletionContract;
    /** Working directory for the child. Defaults to the parent's. */
    cwd?: string;
    /** Environment for the child. Omit to inherit the parent's verbatim. */
    env?: NodeJS.ProcessEnv;
    /**
     * Seed `FORCE_COLOR=1` unless `FORCE_COLOR`/`NO_COLOR` is already set, so tools
     * keying on `process.stdout.isTTY` still emit ANSI into a pipe. Mirrors
     * yarn/npm. Default `false`.
     */
    color?: boolean;
    /**
     * `'inherit'` (default) forwards the parent's stdio; `'pipe'` gives the caller
     * `child.stdout`/`child.stderr` via {@link onSpawn}, so it needs
     * `completion: 'exit'`.
     *
     * `'inherit-stderr'` inherits but routes the child's **stdout to the parent's
     * stderr**, for a parent whose own stdout is machine-readable: `gjsify pack
     * --json` emits JSON there, and interleaved lifecycle-script log lines make it
     * unparseable for anything piping into `JSON.parse`.
     *
     * `'capture'` collects both streams into {@link SpawnCompletion} and emits
     * NEITHER, for a caller that reports the child's output only on failure. Unlike
     * `'pipe'` it works on both paths, so it composes with `completion: 'return'` —
     * `'pipe'` hands back a live `ChildProcess` the blocking path cannot produce,
     * which is why that one is `'exit'`-only.
     */
    stdio?: 'inherit' | 'pipe' | 'inherit-stderr' | 'capture';
    /**
     * Run `cmd` through the platform shell so `&&`, `|` and env-var references work.
     * `cmd` is then a whole command LINE and `args` must be empty — npm/yarn script
     * semantics. Skips the win32 rewrite by design: Node routes it through
     * `%COMSPEC%`, which finds `.cmd` shims itself, so rewriting would corrupt it.
     */
    shell?: boolean;
    /**
     * Called synchronously with the live `ChildProcess` after a successful async
     * spawn — the seam for kill-tracking registries and piped output forwarders.
     * ONLY fires on the streaming path (the blocking path has no handle), so a site
     * needing the handle must declare `completion: 'exit'`.
     */
    onSpawn?: (child: ChildProcess) => void;
    /**
     * Map an `ENOENT` spawn failure to a domain error carrying an install hint.
     * Other spawn errors are rejected as-is.
     */
    notFound?: (err: NodeJS.ErrnoException) => Error;
    /**
     * Capture ceiling for the blocking path, default 64 MiB: a full-workspace lint
     * with many findings runs well past Node's 1 MB default, and an overflow would
     * silently truncate diagnostics.
     */
    maxBuffer?: number;
}

export interface SpawnCompletion {
    /** The child's exit code, or `null` when it was terminated by a signal. */
    code: number | null;
    /** The terminating signal, or `null` on a normal exit. */
    signal: NodeJS.Signals | null;
    /** The child's stdout — only under `stdio: 'capture'`, `''` when it wrote none. */
    stdout?: string;
    /** The child's stderr — only under `stdio: 'capture'`, `''` when it wrote none. */
    stderr?: string;
}

/** `undefined` (inherit) unless the caller passed an env or asked for colour. */
function resolveEnv(opts: SpawnToCompletionOptions): NodeJS.ProcessEnv | undefined {
    if (!opts.color) return opts.env;
    const base = opts.env ?? process.env;
    const seed =
        process.env.FORCE_COLOR !== undefined || process.env.NO_COLOR !== undefined ? {} : { FORCE_COLOR: '1' };
    return { ...base, ...seed };
}

/**
 * Rewrite a bare command for Windows (see `utils/win32-command.ts`). A no-op on
 * every other platform, and on win32 for anything already carrying a path or
 * extension. Applied to BOTH paths below so the blocking and streaming branches
 * agree; `env` is the CHILD's, because its `PATH` is what must be searched.
 */
function forWin32(cmd: string, args: readonly string[], env: NodeJS.ProcessEnv | undefined): Win32Invocation {
    const rewritten = resolveWin32Command(cmd, args, {
        platform: process.platform,
        env: env ?? process.env,
        exists: existsSync,
        join,
    });
    return rewritten ?? { cmd, args: [...args] };
}

/** Turn a spawn-time failure into the caller's domain error when it is ENOENT. */
function mapSpawnError(err: NodeJS.ErrnoException, opts: SpawnToCompletionOptions): Error {
    if (err.code === 'ENOENT' && opts.notFound) return opts.notFound(err);
    return err;
}

/**
 * Whether this call has to run on the blocking path — only under GJS for a caller
 * that returns normally, per the module header's table.
 */
function mustBlock(opts: SpawnToCompletionOptions): boolean {
    return isGjs() && opts.completion === 'return';
}

/**
 * Run `cmd args…` to completion and resolve with its exit code and signal.
 *
 * Resolves for ANY child exit — a non-zero code is data, not an error, so each call
 * site keeps its own failure message. Rejects only when the child could not be
 * started (ENOENT mapped through {@link SpawnToCompletionOptions.notFound}). Picks
 * the streaming or blocking path per the teardown contract in the module header.
 */
export function spawnToCompletion(
    cmd: string,
    args: readonly string[],
    opts: SpawnToCompletionOptions,
): Promise<SpawnCompletion> {
    const env = resolveEnv(opts);

    // A shell invocation is a command LINE, not an argv, so the win32 rewrite
    // must not touch it — see `SpawnToCompletionOptions.shell`.
    const invocation = opts.shell
        ? { cmd, args: [...args], windowsVerbatimArguments: false }
        : forWin32(cmd, args, env);

    if (mustBlock(opts)) {
        // `'inherit'` is NOT forwarded through `@gjsify/child_process`'s GJS
        // spawnSync path (it drives a private main context via
        // `communicateWithTimeout`), so the child's diagnostics would be silently
        // dropped — capture and re-emit them instead. stdin stays inherited so an
        // interactive child still reads the tty.
        const r = spawnSync(invocation.cmd, invocation.args, {
            stdio: ['inherit', 'pipe', 'pipe'],
            cwd: opts.cwd,
            env,
            shell: opts.shell,
            maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
            windowsVerbatimArguments: invocation.windowsVerbatimArguments,
        });
        if (r.error) return Promise.reject(mapSpawnError(r.error as NodeJS.ErrnoException, opts));
        // `'capture'` hands both streams back instead of emitting them — this path
        // already pipes, so it is the same read, routed to the caller.
        if (opts.stdio === 'capture') {
            return Promise.resolve({
                code: r.status,
                signal: r.signal ?? null,
                stdout: String(r.stdout ?? ''),
                stderr: String(r.stderr ?? ''),
            });
        }
        // Captured stdout goes to the parent's STDERR under `'inherit-stderr'`, the
        // destination the streaming path routes it to, so the two agree on where a
        // lifecycle script's chatter lands.
        const out = opts.stdio === 'inherit-stderr' ? process.stderr : process.stdout;
        if (r.stdout && r.stdout.length > 0) out.write(r.stdout);
        if (r.stderr && r.stderr.length > 0) process.stderr.write(r.stderr);
        return Promise.resolve({ code: r.status, signal: r.signal ?? null });
    }

    return new Promise<SpawnCompletion>((resolvePromise, reject) => {
        const win = invocation;
        const spawnOpts: SpawnOptions = {
            cwd: opts.cwd,
            // Numeric fds route the child's matching stream to that fd, so
            // `['inherit', 2, 2]` is stdin inherited, stdout AND stderr → fd 2.
            stdio:
                opts.stdio === 'pipe'
                    ? ['ignore', 'pipe', 'pipe']
                    : opts.stdio === 'capture'
                      ? ['inherit', 'pipe', 'pipe']
                      : opts.stdio === 'inherit-stderr'
                        ? ['inherit', 2, 2]
                        : 'inherit',
        };
        if (opts.shell) spawnOpts.shell = true;
        if (env) spawnOpts.env = env;
        if (win.windowsVerbatimArguments) spawnOpts.windowsVerbatimArguments = true;
        const child = spawn(win.cmd, win.args, spawnOpts);
        opts.onSpawn?.(child);

        // Collected only under `'capture'`; the other modes never attach a reader,
        // so an inherited stream is untouched.
        let captured: { stdout: string; stderr: string } | undefined;
        if (opts.stdio === 'capture') {
            // Bound to a const the listeners close over: narrowing `captured` does
            // not survive into a callback, and `captured!` would be a lie the day
            // someone reorders these lines.
            const buf = { stdout: '', stderr: '' };
            captured = buf;
            child.stdout?.on('data', (d) => (buf.stdout += String(d)));
            child.stderr?.on('data', (d) => (buf.stderr += String(d)));
        }

        // `close` (not `exit`) so piped stdio is fully drained before the caller's
        // flushers run; with `stdio: 'inherit'` the two are emitted back to back.
        child.on('close', (code, signal) => {
            resolvePromise(captured ? { code, signal, ...captured } : { code, signal });
        });
        child.on('error', (err: NodeJS.ErrnoException) => {
            reject(mapSpawnError(err, opts));
        });
    });
}

/**
 * Format the "child failed" suffix the way the call sites report it: an exit
 * code when the child exited, the signal name when it was killed.
 */
export function describeExit(result: SpawnCompletion): string {
    return result.signal !== null ? `signal ${result.signal}` : `code ${result.code}`;
}
