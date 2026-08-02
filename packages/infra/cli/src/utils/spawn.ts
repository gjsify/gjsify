// One `spawn` → `Promise<{ code, signal }>` wrapper for the whole CLI.
//
// Six near-identical wrappers used to live in `commands/{foreach,check,
// workspace,install}.ts`, `flatpak/build.ts` and `utils/oxc-resolve.ts`. They
// diverged on the completion event (`close` vs `exit`), whether an ENOENT
// spawn failure got a human hint, whether `FORCE_COLOR` was seeded — and, the
// dangerous one, on how they handled the GJS teardown contract below.
//
// ## The GJS teardown contract — why this helper has a host branch
//
// `@gjsify/child_process`'s ASYNC `spawn()` calls `ensureMainLoop()`
// (`@gjsify/utils`) so the `Gio.Subprocess` `wait_async` exit callback has a
// running GLib main context to be dispatched on. `ensureMainLoop()` arms a
// GJS **main-loop hook** (`GLib.MainLoop.runAsync()` → `setMainLoopHook`), and
// GJS's `eval_module` runs that hook AFTER the entry module's top-level await
// settles — entering a blocking `g_main_loop_run()` that nothing ever quits.
// GJS has no atexit hook, so the only thing that tears it back down is
// `process.exit()` (whose `exitProcess` idle-schedules `quitMainLoop()` +
// `imports.system.exit()`).
//
// Consequence, measured on gjs 1.88 against the committed `dist/cli.gjs.mjs`:
// a command that async-spawns a child and then RETURNS NORMALLY parks at 0%
// CPU **after** the child has already exited and been reaped. The symptom —
// a live parent with no children, blocked in `poll`, `SNl` — is *identical*
// to a lost exit callback, which is how it was previously misdiagnosed as
// "the async `spawn`'s exit/close event is not delivered under the bundle".
// It IS delivered: instrumenting the exit handler shows it firing with the
// right code; the parent then parks in the armed loop on its way out.
//
// So the branch is NOT "GJS ⇒ spawnSync". It is exactly this:
//
//   | host | caller ends with       | path                                |
//   |------|------------------------|-------------------------------------|
//   | Node | anything               | async `spawn` (streaming)           |
//   | GJS  | `process.exit(…)`      | async `spawn` (streaming)           |
//   | GJS  | a normal `return`      | blocking `spawnSync` (captured)     |
//
// which is why `gjsify foreach` / `workspace` / `check` and `runGjsBundle` run
// hundreds of async-spawned children under GJS without ever hanging: every one
// of them ends its handler with `process.exit(…)`. `gjsify lint` did not, and
// that is the hang the `spawnSync` branch in `oxc-resolve.ts` was papering
// over.
//
// Callers therefore declare their teardown contract via the REQUIRED
// {@link SpawnToCompletionOptions.completion} field. It is required on
// purpose: a new call site must state which side of the table it is on rather
// than silently inherit a default that may be wrong for it.
//
// ## When a raw `node:child_process` spawn is still fine — and when it is not
//
// This helper is also where the Windows command rewrite lives (`forWin32`
// below), so the rule is about WHAT is being spawned, not about house style:
//
//   • spawning a real executable — `git`, `gh`, `node`, `gjs`, `flatpak`, or
//     `process.execPath` — may use `node:child_process` directly. Windows
//     resolves those via `.exe` on its own.
//   • spawning with `shell: true` is fine too: Node routes it through
//     `%COMSPEC%`, which finds `.cmd` shims.
//   • spawning a PACKAGE MANAGER or any other `node_modules/.bin` entry by
//     BARE NAME — `npm`, `yarn`, `npx`, `tsc`, `oxlint`, or a `pm` variable
//     from `detectPackageManager()` — MUST come through here. On Windows those
//     are `.cmd` shims: `spawn('npm')` is ENOENT and `spawn('npm.cmd')` is
//     EINVAL, so a raw spawn cannot work at all.
//
// The third case is not hypothetical. Three sites kept a raw spawn after the
// consolidation above and each one broke on win32 in its own way:
// `commands/check.ts` (single-package mode) read only `r.status` and so exited
// 1 with no diagnostic whatsoever; `utils/install-backend.ts` reported "npm not
// found on PATH" on a host where npm was on PATH; `commands/onboard.ts` broke
// the pre-publish build. All three were invisible to Linux and macOS CI.

import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isGjs } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { type Win32Invocation, resolveWin32Command } from './win32-command.js';

/** Default capture ceiling on the blocking path — 64 MiB. */
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * What the calling command does once this spawn settles.
 *
 * - `'exit'` — the command terminates the process itself (`process.exit(…)`,
 *   `forceExit(…)`, …). The armed GJS main loop is quit by that exit, so the
 *   streaming async `spawn` is safe on both hosts.
 * - `'return'` — the command returns normally and lets the CLI unwind. Under
 *   GJS that MUST NOT leave a main loop armed, so the child is run on the
 *   blocking `spawnSync` path instead.
 *
 * See the module header for the full rationale.
 */
export type SpawnCompletionContract = 'exit' | 'return';

export interface SpawnToCompletionOptions {
    /** The caller's teardown contract. Required — see {@link SpawnCompletionContract}. */
    completion: SpawnCompletionContract;
    /** Working directory for the child. Defaults to the parent's. */
    cwd?: string;
    /**
     * Environment for the child. Omit to inherit the parent's environment
     * verbatim (what `spawn` does with no `env`).
     */
    env?: NodeJS.ProcessEnv;
    /**
     * Seed `FORCE_COLOR=1` (on top of `env` ?? `process.env`) unless the user
     * explicitly set `FORCE_COLOR` or `NO_COLOR`, so tools that key on
     * `process.stdout.isTTY` (chalk, picocolors, …) still emit ANSI when their
     * stdout is a pipe. Mirrors yarn / npm. Default `false`.
     */
    color?: boolean;
    /**
     * `'inherit'` (default) forwards the parent's stdio. `'pipe'` gives the
     * caller `child.stdout` / `child.stderr` via {@link onSpawn} — only
     * meaningful together with `completion: 'exit'` (see {@link onSpawn}).
     */
    stdio?: 'inherit' | 'pipe';
    /**
     * Invoked synchronously with the live `ChildProcess` right after a
     * successful async spawn — the seam for kill-tracking registries and for
     * wiring piped output forwarders.
     *
     * ONLY fires on the streaming path: the blocking `spawnSync` path has no
     * `ChildProcess` handle at all. A site that needs the handle must
     * therefore declare `completion: 'exit'`.
     */
    onSpawn?: (child: ChildProcess) => void;
    /**
     * Map an `ENOENT` spawn failure (command not on PATH) to a domain error
     * carrying an install hint. Other spawn errors are rejected as-is.
     */
    notFound?: (err: NodeJS.ErrnoException) => Error;
    /**
     * Capture ceiling for the blocking path. Defaults to 64 MiB — a
     * full-workspace lint with many findings runs well past Node's 1 MB
     * default, and an overflow would silently truncate diagnostics.
     */
    maxBuffer?: number;
}

export interface SpawnCompletion {
    /** The child's exit code, or `null` when it was terminated by a signal. */
    code: number | null;
    /** The terminating signal, or `null` on a normal exit. */
    signal: NodeJS.Signals | null;
}

/**
 * Build the child's environment: `undefined` (inherit) unless the caller
 * passed one or asked for colour seeding.
 */
function resolveEnv(opts: SpawnToCompletionOptions): NodeJS.ProcessEnv | undefined {
    if (!opts.color) return opts.env;
    const base = opts.env ?? process.env;
    const seed =
        process.env.FORCE_COLOR !== undefined || process.env.NO_COLOR !== undefined ? {} : { FORCE_COLOR: '1' };
    return { ...base, ...seed };
}

/**
 * Rewrite a bare command for Windows, where `spawn('npm', …)` is ENOENT and
 * `spawn('npm.cmd', …)` is EINVAL — see `utils/win32-command.ts`. A no-op on
 * every other platform, and on win32 for anything already carrying a path or an
 * extension. Applied to BOTH paths below so the blocking GJS branch and the
 * streaming one agree; `env` is the child's, because its `PATH` (with
 * `node_modules/.bin` prepended) is what has to be searched.
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
 * Whether this call has to run on the blocking path.
 *
 * Only true under GJS for a caller that returns normally — see the module
 * header's table. On Node the async path is always correct (and keeps the
 * event loop free), and under GJS a caller that exits the process quits the
 * armed main loop itself.
 */
function mustBlock(opts: SpawnToCompletionOptions): boolean {
    return isGjs() && opts.completion === 'return';
}

/**
 * Run `cmd args…` to completion and resolve with its exit code and signal.
 *
 * Resolves for ANY child exit — a non-zero code is data, not an error, so each
 * call site keeps its own failure message. Rejects only when the child could
 * not be started at all (mapped through {@link SpawnToCompletionOptions.notFound}
 * for ENOENT).
 *
 * Picks the streaming async path or the blocking captured path per the GJS
 * teardown contract documented at the top of this file.
 */
export function spawnToCompletion(
    cmd: string,
    args: readonly string[],
    opts: SpawnToCompletionOptions,
): Promise<SpawnCompletion> {
    const env = resolveEnv(opts);

    if (mustBlock(opts)) {
        // `'inherit'` is NOT forwarded through `@gjsify/child_process`'s GJS
        // spawnSync path (it drives a private main context via
        // `communicateWithTimeout`), so the child's diagnostics would be
        // silently dropped. Capture them and re-emit after the child exits.
        // stdin stays inherited so an interactive child still reads the tty.
        const win = forWin32(cmd, args, env);
        const r = spawnSync(win.cmd, win.args, {
            stdio: ['inherit', 'pipe', 'pipe'],
            cwd: opts.cwd,
            env,
            maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
            windowsVerbatimArguments: win.windowsVerbatimArguments,
        });
        if (r.error) return Promise.reject(mapSpawnError(r.error as NodeJS.ErrnoException, opts));
        if (r.stdout && r.stdout.length > 0) process.stdout.write(r.stdout);
        if (r.stderr && r.stderr.length > 0) process.stderr.write(r.stderr);
        return Promise.resolve({ code: r.status, signal: r.signal ?? null });
    }

    return new Promise<SpawnCompletion>((resolvePromise, reject) => {
        const win = forWin32(cmd, args, env);
        const spawnOpts: SpawnOptions = {
            cwd: opts.cwd,
            stdio: opts.stdio === 'pipe' ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        };
        if (env) spawnOpts.env = env;
        if (win.windowsVerbatimArguments) spawnOpts.windowsVerbatimArguments = true;
        const child = spawn(win.cmd, win.args, spawnOpts);
        opts.onSpawn?.(child);

        // `close` (not `exit`) so piped stdio is fully drained before the
        // caller's flushers run. With `stdio: 'inherit'` the two are emitted
        // back to back, so this is a strict superset of the old `exit` sites.
        child.on('close', (code, signal) => {
            resolvePromise({ code, signal });
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
