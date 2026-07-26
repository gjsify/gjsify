// Reference: Node.js lib/child_process.js (`normalizeSpawnArguments`, win32 branch).
// Windows specialisation — GJS on Windows still reaches GIO, so `Gio.Subprocess`
// works, but every POSIX helper binary (`sh`, `setsid`, `timeout`) is absent.

import GLib from '@girs/glib-2.0';
import type Gio from '@girs/gio-2.0';

/** Matches `cmd`, `cmd.exe`, and any `…\cmd.exe` — Node's own test. */
const CMD_RE = /^(?:.*\\)?cmd(?:\.exe)?$/i;

/**
 * Node's default shell on Windows: `process.env.comspec || 'cmd.exe'`.
 * `g_getenv()` maps onto `GetEnvironmentVariable()`, which is case-insensitive,
 * so a single lookup covers `ComSpec` / `COMSPEC` / `comspec`.
 */
export function defaultShell(): string {
    return GLib.getenv('ComSpec') || 'cmd.exe';
}

/**
 * Build the full argv for a `shell: true` / `shell: '<path>'` spawn.
 *
 * Mirrors Node's win32 branch: `cmd.exe` gets `/d /s /c "<command>"` (the extra
 * quoting is what makes `cmd` treat the whole string as one command), any other
 * shell gets the POSIX `-c <command>` form.
 *
 * Node additionally forces `windowsVerbatimArguments = true` for the `cmd` case
 * so libuv does not re-quote the already-quoted string. GLib has no equivalent
 * opt-out — `g_spawn_*` always runs argv through its own `protect_argv()` — so
 * a command containing embedded double quotes may be quoted differently than
 * under Node. See `windowsVerbatimArguments` in the package README.
 */
export function shellArgv(command: string, shell: string | boolean | undefined): string[] {
    const file = typeof shell === 'string' && shell.length > 0 ? shell : defaultShell();
    if (CMD_RE.test(file)) return [file, '/d', '/s', '/c', `"${command}"`];
    return [file, '-c', command];
}

/**
 * Windows has no sessions/process groups in the POSIX sense; Node implements
 * `detached` with `DETACHED_PROCESS` / `CREATE_NEW_PROCESS_GROUP` flags passed
 * to `CreateProcess()`. `Gio.SubprocessLauncher` exposes no way to set
 * `CreateProcess` creation flags, so there is nothing to prepend.
 *
 * DEGRADED CONTRACT: `detached: true` is accepted and the child is spawned
 * normally. It is NOT placed in its own process group, so a console Ctrl-C
 * event still reaches it. (The child does still outlive the parent — GIO does
 * not put children in a job object.)
 */
export function detachedPrefix(): string[] | null {
    return null;
}

/**
 * `argv0` cannot be honoured on Windows.
 *
 * There is no `exec -a` in `cmd.exe`, and `CreateProcess()`'s `lpCommandLine`
 * is built by GLib's `protect_argv()` from `argv[0]` — `GSubprocess` never sets
 * `G_SPAWN_FILE_AND_ARGV_ZERO`, so the executable path and the child's
 * `argv[0]` cannot be decoupled through any introspectable API.
 *
 * We throw rather than silently ignore the option: a caller that asked for a
 * specific `argv[0]` has no way to detect that it did not happen, and running
 * the child with the wrong name is a correctness bug, not a cosmetic one.
 */
export function applyArgv0(argv0: string, _argv: string[]): string[] {
    const err = new Error(
        `options.argv0 (${argv0}) is not supported on Windows: GSubprocess cannot decouple the ` +
            `executable path from the child's argv[0]`,
    ) as Error & { code?: string };
    err.code = 'ERR_UNSUPPORTED_OPERATION';
    throw err;
}

/**
 * Windows signal numbers are meaningless — `g_subprocess_send_signal()` is a
 * documented no-op there. Node maps `SIGTERM`/`SIGKILL`/`SIGINT` onto
 * `TerminateProcess()`; `force_exit()` is Gio's binding for exactly that, so
 * every signal takes it.
 */
export function killProcess(proc: Gio.Subprocess, _signal: string | number | undefined): void {
    proc.force_exit();
}

/** Placeholder so the module shape matches `linux.ts` / `darwin.ts`. */
export const SIGNALS: Readonly<Record<string, number>> = Object.freeze({
    SIGINT: 2,
    SIGKILL: 9,
    SIGTERM: 15,
});
