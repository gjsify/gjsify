// Node.js child_process module for GJS
// Uses Gio.Subprocess for process spawning
// Reference: Node.js lib/child_process.js

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { gbytesToUint8Array, deferEmit, ensureMainLoop } from '@gjsify/utils';
import { communicateWithTimeout } from './communicate.js';
import { applyArgv0, detachedPrefix, killProcess, shellArgv } from './platform/index.js';

// Wraps a Gio.InputStream as a Node.js Readable so proc.stdout/stderr work
// with standard stream consumers (.on('data', ...), pipe, async iteration).
class GioInputStreamReadable extends Readable {
    private _stream: Gio.InputStream;
    private _cancellable = new Gio.Cancellable();

    constructor(stream: Gio.InputStream) {
        super();
        this._stream = stream;
    }

    override _read(size: number): void {
        this._stream.read_bytes_async(
            Math.max(size, 4096),
            GLib.PRIORITY_DEFAULT,
            this._cancellable,
            (_source, result) => {
                try {
                    const gbytes = this._stream.read_bytes_finish(result);
                    const data = gbytes.get_data();
                    if (!data || data.length === 0) {
                        this.push(null);
                    } else {
                        this.push(Buffer.from(data));
                    }
                } catch (err) {
                    if (!this._cancellable.is_cancelled()) {
                        this.destroy(err as Error);
                    }
                }
            },
        );
    }

    override _destroy(error: Error | null, callback: (err?: Error | null) => void): void {
        this._cancellable.cancel();
        callback(error);
    }
}

/**
 * Wraps a `Gio.OutputStream` (e.g. `Gio.Subprocess.get_stdin_pipe()`) as a
 * Node.js `Writable` so async `spawn()` produces a `child.stdin` that
 * speaks the `.write(chunk)` / `.end(chunk?)` / pipe-from-Readable contract.
 *
 * Mirrors `GioInputStreamReadable` (stdout / stderr side). `_write` calls
 * `write_bytes_async`; `_final` closes the underlying stream so the child
 * sees EOF on stdin. Consumers like execa rely on `child.stdin.write(input)`
 * for the `{ input: 'string' }` shape — surfaced by the
 * `tests/integration/execa/` D-1 suite (#218), which is what motivated
 * landing the async-side path that had been missing.
 */
class GioOutputStreamWritable extends Writable {
    private _stream: Gio.OutputStream;
    private _cancellable = new Gio.Cancellable();
    private _closed = false;

    constructor(stream: Gio.OutputStream) {
        super();
        this._stream = stream;
    }

    override _write(
        chunk: Buffer | Uint8Array | string,
        _encoding: BufferEncoding,
        callback: (err?: Error | null) => void,
    ): void {
        if (this._closed) {
            callback(new Error('write after end'));
            return;
        }
        // Node's `_write` already coerces string chunks to Buffer when the
        // stream isn't in objectMode (default). Be defensive anyway — execa
        // passes ArrayBufferView for its `input` option.
        const bytes: Uint8Array =
            typeof chunk === 'string'
                ? Buffer.from(chunk)
                : chunk instanceof Uint8Array
                  ? chunk
                  : Buffer.from(chunk as unknown as ArrayLike<number>);
        // `new GLib.Bytes(uint8array)` copies into a GBytes; the GIO write
        // pipeline owns the lifetime. Doing it sync would require
        // `write_bytes(...)` which blocks the main loop — `_async` keeps
        // GTK + the timer queue responsive.
        this._stream.write_bytes_async(
            new GLib.Bytes(bytes),
            GLib.PRIORITY_DEFAULT,
            this._cancellable,
            (_source: unknown, result: Gio.AsyncResult) => {
                try {
                    this._stream.write_bytes_finish(result);
                    callback();
                } catch (err) {
                    if (this._cancellable.is_cancelled()) {
                        // Treat post-cancel finish as silent completion — destroy()
                        // already informed downstream listeners.
                        callback();
                    } else {
                        callback(err as Error);
                    }
                }
            },
        );
    }

    override _final(callback: (err?: Error | null) => void): void {
        if (this._closed) {
            callback();
            return;
        }
        this._closed = true;
        // Close the stdin pipe so the child sees EOF — symmetrical to Node's
        // `child.stdin.end()` -> `close()` on the underlying file descriptor.
        // Use sync `close()` here intentionally: `close_async()` on a pipe
        // whose read-end is held by an already-exited subprocess can hang
        // indefinitely because the kernel keeps the dispatch chain alive
        // until both ends agree. The sync close just flips fcntl + returns,
        // which is what Node's `child.stdin.end()` semantically promises.
        try {
            this._stream.close(null);
        } catch {
            // Already closed (subprocess exited and the kernel collapsed the
            // pipe end before us). Node's Writable contract is that the
            // `_final` callback resolves once EOF has been signalled; it has
            // been, even if via a different path.
        }
        callback();
    }

    override _destroy(error: Error | null, callback: (err?: Error | null) => void): void {
        this._cancellable.cancel();
        // Best-effort close — `_destroy` may fire before `_final` if the
        // consumer called `.destroy()` directly. Skip the async dance and use
        // the sync `close` to avoid leaving the stream open in error paths.
        if (!this._closed) {
            this._closed = true;
            try {
                this._stream.close(null);
            } catch {
                /* already closed */
            }
        }
        callback(error);
    }
}

interface ExecError extends Error {
    status?: number;
    code?: number | string;
    errno?: number;
    syscall?: string;
    path?: string;
    spawnargs?: string[];
    signal?: string | null;
    killed?: boolean;
    stdout?: string | Buffer;
    stderr?: string | Buffer;
    cmd?: string;
}

/**
 * Node-parity error normalisation for a Gio error caught during spawn.
 *
 * Node sets `err.code = 'ENOENT'` / `err.errno = -2` / `err.syscall = 'spawn <file>'`
 * / `err.path = <file>` / `err.spawnargs = <args>` for the canonical "command
 * not found" case (see `refs/node/lib/internal/child_process.js` —
 * `spawn ${this.spawnfile}` is the syscall string). GIO surfaces the same
 * condition as a `GLib.SpawnError` with code `NOENT`. We probe both the
 * `.matches()` helper (preferred — handles the gobject error-quark
 * comparison correctly) and the message text (fallback for environments
 * where the JS error object only carries `.message` after marshalling).
 */
function _gioErrorToNodeError(
    err: unknown,
    file: string,
    args: string[],
): ExecError {
    // CRITICAL: do NOT wrap the GLib error in `new Error(String(err))` —
    // GJS's `GLib.SpawnError` is NOT `instanceof Error` (it derives from
    // an internal `GLib_Error` shim) yet IT carries the `.matches()` GError
    // helper and `.code` (numeric enum value) we need to detect ENOENT.
    // Wrapping would discard both. Keep the raw error object and only
    // create an Error wrapper when truly necessary.
    const e = (err ?? new Error('Unknown spawn error')) as Error & {
        code?: number | string;
        matches?: (domain: unknown, code: number) => boolean;
        message?: string;
    };
    const out = e as ExecError;
    const numericCode = e.code;
    const matches = e.matches;
    let isNoent = false;
    if (typeof matches === 'function') {
        try {
            isNoent = matches.call(e, GLib.SpawnError, GLib.SpawnError.NOENT) === true;
        } catch {
            // matches() can throw on weird subclasses — fall through to text test.
        }
    }
    if (!isNoent && numericCode === GLib.SpawnError.NOENT) isNoent = true;
    if (
        !isNoent &&
        typeof e.message === 'string' &&
        // The localised GIO message contains "No such file or directory" in
        // English locales and translations in others (German: "Datei oder
        // Verzeichnis nicht gefunden"). The reliable marker across locales
        // is the leading "Failed to execute child process" (English) and
        // its translated forms — but matches()/code is the safer path.
        /No such file or directory|ENOENT|Failed to execute|nicht gefunden|nicht ausgeführt/i.test(e.message)
    ) {
        isNoent = true;
    }
    if (isNoent) {
        // Construct a fresh Error so `err instanceof Error` holds for the
        // returned value — GLib_SpawnError does NOT inherit from Error on
        // GJS, and consumers like Node test asserts (`assert(err instanceof
        // Error)`) would otherwise fail.
        const wrapped = new Error(`spawn ${file} ENOENT`) as ExecError;
        wrapped.code = 'ENOENT';
        wrapped.errno = -2;
        wrapped.syscall = `spawn ${file}`;
        wrapped.path = file;
        wrapped.spawnargs = args.slice();
        return wrapped;
    }
    // Non-ENOENT — still return an Error-shaped value so downstream
    // `.message` access works. Wrap if needed.
    if (e instanceof Error) return out;
    const eAny = e as { message?: unknown };
    const msg = typeof eAny.message === 'string' ? eAny.message : String(e);
    const wrap = new Error(msg) as ExecError;
    // Preserve any pre-set numeric code from the GLib error in case downstream
    // wants it.
    if (typeof numericCode === 'number' || typeof numericCode === 'string') {
        wrap.code = numericCode;
    }
    return wrap;
}

export interface ExecOptions {
    cwd?: string | URL;
    env?: Record<string, unknown> | NodeJS.ProcessEnv;
    encoding?: BufferEncoding | 'buffer' | null;
    shell?: string | boolean;
    timeout?: number;
    maxBuffer?: number;
    killSignal?: string | number;
    uid?: number;
    gid?: number;
    windowsHide?: boolean;
    /**
     * Allows aborting the child process via an `AbortController`. When the
     * signal fires, the child is killed with `killSignal` (default `SIGTERM`)
     * and the registered callback receives an `Error` with `name: 'AbortError'`.
     * Reference: https://nodejs.org/api/child_process.html#child_processexeccommand-options-callback
     */
    signal?: AbortSignal;
}

export interface ExecSyncOptions {
    cwd?: string | URL;
    env?: Record<string, unknown> | NodeJS.ProcessEnv;
    encoding?: BufferEncoding | 'buffer' | null;
    shell?: string | boolean;
    timeout?: number;
    maxBuffer?: number;
    killSignal?: string | number;
    uid?: number;
    gid?: number;
    argv0?: string;
    stdio?: string | string[];
    input?: string | Buffer | Uint8Array;
    windowsHide?: boolean;
    windowsVerbatimArguments?: boolean;
}

export interface SpawnOptions {
    cwd?: string | URL;
    env?: Record<string, unknown> | NodeJS.ProcessEnv;
    stdio?: string | string[];
    shell?: string | boolean;
    timeout?: number;
    killSignal?: string | number;
    uid?: number;
    gid?: number;
    /**
     * Override what the child process sees as `argv[0]`.
     *
     * `Gio.SubprocessLauncher` does not expose `set_child_setup` to GIR, so on
     * POSIX this is implemented by wrapping the spawn through a shell's
     * `exec -a "$0" "$@"`. Not expressible on Windows — throws there
     * (`ERR_UNSUPPORTED_OPERATION`).
     */
    argv0?: string;
    /**
     * Spawn the child as the leader of a new session/process group so it
     * survives the parent exiting.
     *
     * POSIX: uses `setsid(1)` resolved from PATH. When no `setsid` binary
     * exists (stock macOS, Windows) the child is still spawned and still
     * outlives the parent, but is not promoted to a session leader — see the
     * package README for the exact per-platform contract.
     */
    detached?: boolean;
    /**
     * Accepted and ignored on every platform: `Gio.SubprocessLauncher` exposes
     * no `CreateProcess` creation flags, so the console-window suppression
     * Node performs on Windows is unreachable from GIR.
     */
    windowsHide?: boolean;
    /**
     * Accepted and ignored on every platform: GLib always builds the Windows
     * command line itself (`protect_argv()`), so its argument quoting cannot
     * be bypassed the way libuv's can.
     */
    windowsVerbatimArguments?: boolean;
    /**
     * Allows aborting the child process via an `AbortController`. When the
     * signal fires, the child is killed with `killSignal` (default `SIGTERM`)
     * and an `error` event with `name: 'AbortError'` is emitted.
     * Reference: https://nodejs.org/api/child_process.html#child_processspawncommand-args-options
     */
    signal?: AbortSignal;
}

export interface SpawnSyncResult {
    pid: number;
    output: (Buffer | string | null)[];
    stdout: Buffer | string;
    stderr: Buffer | string;
    status: number | null;
    signal: string | null;
    error?: Error;
}

// GC guard — GJS garbage-collects objects with no JS references.
// Keep strong references to active child processes to prevent their
// Gio.Subprocess from being collected while async operations are pending.
const _activeProcesses = new Set<ChildProcess>();

/**
 * ChildProcess — EventEmitter wrapping Gio.Subprocess.
 */
export class ChildProcess extends EventEmitter {
    pid?: number;
    exitCode: number | null = null;
    signalCode: string | null = null;
    killed = false;
    connected = false;
    stdin: Writable | null = null;
    stdout: Readable | null = null;
    stderr: Readable | null = null;

    /**
     * Node-compatible `stdio` tuple — `[stdin, stdout, stderr, ...extraFds]`.
     * Index 0/1/2 mirror the named streams above. Slots 3+ are reserved for
     * `options.stdio = ['pipe', 'pipe', 'pipe', 'pipe']` extra fds, which we
     * don't surface yet — `null` placeholders match Node's shape when extras
     * weren't requested. Consumers like execa iterate this array (e.g. to
     * dispose streams on subprocess exit), so the property MUST exist even
     * when nothing was piped.
     */
    get stdio(): Array<Writable | Readable | null> {
        return [this.stdin, this.stdout, this.stderr];
    }

    private _subprocess: Gio.Subprocess | null = null;

    /**
     * @internal Adopt the underlying Gio.Subprocess.
     *
     * `pid` is supplied by the caller (`_spawnSubprocess`) rather than read
     * here via `proc.get_identifier()`, because that accessor is RACY for an
     * instant-exit child: `g_subprocess_get_identifier()` returns the pid only
     * while `subprocess->pid != 0`, and GSubprocess's child-watch (running on
     * the GLib *worker thread*, not the main context — see
     * `g_subprocess_exited` in glib's `gio/gsubprocess.c`) sets `pid = 0` the
     * instant it reaps the child. For a fast child like `echo`, that reap can
     * win the race against any synchronous JS read, leaving `get_identifier()`
     * permanently null. Node guarantees `cp.pid` is a positive integer
     * synchronously, so we capture the pid at spawn time — the one moment it
     * is provably still alive — and hand it in here. See
     * `_capturePidAtSpawn` / `_spawnSubprocess`.
     */
    _setSubprocess(proc: Gio.Subprocess, pid: number): void {
        this._subprocess = proc;
        if (pid > 0) this.pid = pid;
    }

    /**
     * Send a signal to the child process.
     *
     * Accepts a numeric signal or a POSIX signal NAME (`'SIGTERM'`,
     * `'SIGKILL'`, …). Unrecognised names default to SIGTERM the way
     * Gio's `send_signal` does. Returns `true` on success / when the
     * signal was at least dispatched, `false` if we no longer have a
     * subprocess handle (matches Node's "no-op on already-reaped child"
     * return shape).
     */
    kill(signal?: string | number): boolean {
        if (!this._subprocess) return false;
        try {
            // Signal delivery is platform-specific: the numeric values of
            // SIGUSR1/SIGUSR2/SIGSTOP/… differ between Linux and macOS, and
            // Windows has no signals at all (`send_signal` is a documented
            // no-op there, so every signal maps onto `force_exit`).
            // `platform/` owns those tables.
            killProcess(this._subprocess, signal ?? 'SIGTERM');
            this.killed = true;
            return true;
        } catch {
            return false;
        }
    }

    ref(): this {
        return this;
    }
    unref(): this {
        return this;
    }
}

// Node accepts `cwd` as a string, URL (file://), or Buffer.
// Gio.SubprocessLauncher.set_cwd only takes a string, so we normalise.
// Returns the resolved POSIX path or `undefined` if no cwd was supplied
// (matching Node's "inherit parent cwd" behaviour).
function _normalizeCwd(cwd: unknown): string | undefined {
    if (cwd === undefined || cwd === null) return undefined;
    if (typeof cwd === 'string') return cwd;
    // URL detection via duck typing on `.href` + `.protocol` — using
    // `instanceof URL` is unreliable across realms: `@gjsify/url` exposes
    // its own URL class on GJS that does not share identity with the URL
    // class an in-bundle test/test-app constructs. The duck check is what
    // Node's `getValidatedPath` does in spirit (it WHATWG-URL-tests via
    // the URL prototype symbol).
    if (
        typeof cwd === 'object' &&
        cwd !== null &&
        typeof (cwd as { href?: unknown }).href === 'string' &&
        typeof (cwd as { protocol?: unknown }).protocol === 'string'
    ) {
        const url = cwd as URL;
        if (url.protocol !== 'file:') {
            throw new TypeError(
                `The URL must be of scheme file:; received '${url.protocol}' for 'options.cwd'`,
            );
        }
        return fileURLToPath(url);
    }
    // Buffer / Uint8Array — decode as UTF-8 like Node's fs path normalizer.
    if (cwd instanceof Uint8Array) {
        return new TextDecoder().decode(cwd);
    }
    // Anything else — stringify (Node's path validation would throw, but
    // staying lenient here lets edge-case "string-coercible" objects pass).
    return String(cwd);
}

/**
 * Encode an env value the way Node's `normalizeSpawnArguments` does:
 * any value is coerced via the `${value}` template (so `null` → `"null"`,
 * `123` → `"123"`, `true` → `"true"`, an array → `"a,b,c"`, etc.), and
 * `undefined` is dropped entirely. Node's reference test
 * `refs/node-test/parallel/test-child-process-env.js` asserts this exact
 * behaviour (`UNDEFINED=undefined` MUST NOT appear in env, `NULL=null`
 * MUST).
 */
function _encodeEnvValue(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    // Use template-literal coercion to match Node's `${value}` exactly —
    // this differs from `String(value)` for objects with `[Symbol.toPrimitive]`
    // returning a non-string default hint.
    return `${value}`;
}

// Create a Gio.Subprocess with cwd and env support via SubprocessLauncher.
//
// Honours the full Node-parity option contract that the higher-level
// `spawn`/`exec`/`spawnSync` entry points expose:
//   - `cwd`: string, file:// URL, Buffer, or undefined (inherit)
//   - `env`: object whose values are stringified per Node's `${value}` rule;
//     `undefined` values are dropped; prototype-chain enumerable keys are
//     ALSO walked (Node uses `for…in` not `Object.entries`)
//   - `uid` / `gid`: validated but no-op on GIO (SubprocessLauncher does not
//     expose setuid/setgid; documenting the gap rather than silently
//     succeeding-but-running-as-the-parent-uid would be misleading, so we
//     read the option without throwing and let downstream consumers detect
//     via `whoami`)
//   - `argv0`: delegated to `platform/` — a shell `exec -a "$0" "$@"` wrapper on
//     POSIX (Gio.SubprocessLauncher does not expose a `set_child_setup` hook
//     for posix_spawn-style argv0 override), unsupported on Windows
//   - `detached`: delegated to `platform/` — prepends `setsid(1)` where one is
//     on PATH (matches Node's documented detached semantics on POSIX)
//   - `windowsHide` / `windowsVerbatimArguments`: read without throwing and
//     ignored on every platform — GIO exposes neither `CreateProcess` creation
//     flags nor an opt-out from GLib's own Windows argv quoting
interface _SpawnLowOptions {
    cwd?: string | URL | Uint8Array;
    env?: Record<string, unknown> | NodeJS.ProcessEnv;
    uid?: number;
    gid?: number;
    argv0?: string;
    detached?: boolean;
    windowsHide?: boolean;
    windowsVerbatimArguments?: boolean;
}

/**
 * Result of `_spawnSubprocess`: the live Gio.Subprocess plus the pid captured
 * at the single instant the child is provably still alive (right after
 * `spawnv()` returns, before the GLib worker-thread child-watch can reap an
 * instant-exit child and null out `get_identifier()`). See the long note on
 * `ChildProcess._setSubprocess` for why the pid cannot be read later.
 */
interface _SpawnResult {
    proc: Gio.Subprocess;
    pid: number;
}

function _spawnSubprocess(
    argv: string[],
    flags: Gio.SubprocessFlags,
    options?: _SpawnLowOptions,
): _SpawnResult {
    const launcher = new Gio.SubprocessLauncher({ flags });
    const cwd = _normalizeCwd(options?.cwd);
    // Distinguish "no cwd supplied" (undefined → don't call set_cwd) from
    // "empty string cwd" (still pass through — Gio will fail with NOENT,
    // matching Node which propagates the same ENOENT for `cwd: ''`).
    if (cwd !== undefined) {
        launcher.set_cwd(cwd);
    }
    if (options?.env) {
        const env = options.env;
        // Critical: when the caller provides ANY env (even an empty `{}`)
        // Node treats that as "child env is exactly this, not inherited".
        // Gio.SubprocessLauncher by default inherits the parent env. To
        // match Node, we wipe the launcher env to an empty set first via
        // `set_environ([])` and then setenv() each key/value pair on top.
        // Without the wipe, `env: {}` would leak the parent env to the
        // child — opposite of what Node guarantees.
        launcher.set_environ([]);
        // Node walks the prototype chain with `for…in` (see
        // `refs/node/lib/child_process.js` `normalizeSpawnArguments` →
        // `for (const key in env)`); `Object.entries` only returns own
        // enumerables, so a custom env with a prototype-set var would be
        // silently dropped. Match Node.
        const seen = new Set<string>();
        for (const key in env) {
            if (seen.has(key)) continue;
            seen.add(key);
            const value = _encodeEnvValue((env as Record<string, unknown>)[key]);
            if (value === undefined) continue;
            launcher.setenv(key, value, true);
        }
    }
    // `argv0` override. Gio does not expose `g_subprocess_launcher_set_child_setup`
    // to GIR bindings, so argv[0] cannot be set through the launcher; the
    // platform layer supplies the closest reachable mechanism (a shell
    // `exec -a "$0" "$@"` on POSIX) or throws where none exists (Windows).
    let realArgv = argv;
    if (options?.argv0 !== undefined && options.argv0 !== null) {
        if (typeof options.argv0 !== 'string') {
            throw new TypeError(
                `The "options.argv0" property must be of type string. Received type ${typeof options.argv0}`,
            );
        }
        realArgv = applyArgv0(options.argv0, argv);
    }
    // `detached: true` — make the child the leader of a new session/process
    // group so it survives the parent exiting. The platform layer resolves the
    // helper (`setsid(1)` on POSIX, resolved from PATH) and returns `null` when
    // the platform has none; in that case the child is still spawned, it just
    // is not promoted to a session leader (see `platform/darwin.ts` /
    // `platform/win32.ts` for the exact degraded contract).
    if (options?.detached === true) {
        const prefix = detachedPrefix();
        if (prefix !== null) realArgv = [...prefix, ...realArgv];
    }
    // Spawn, then capture the pid on the VERY NEXT statement. This ordering is
    // load-bearing: `get_identifier()` is only valid while the child is alive,
    // and GSubprocess's child-watch (GLib worker thread) nulls it out the
    // instant a fast child is reaped (see `_capturePidAtSpawn`). Reading the
    // pid here — before any other JS allocation/work runs — minimises that
    // window to the bare spawn→read gap.
    const proc = launcher.spawnv(realArgv);
    const pid = _capturePidAtSpawn(proc);
    return { proc, pid };
}

/**
 * Read a freshly-spawned child's pid from `Gio.Subprocess.get_identifier()`.
 *
 * `g_subprocess_get_identifier()` returns the decimal pid only while the child
 * is unreaped (`subprocess->pid != 0`); once GSubprocess's child-watch —
 * dispatched on GLib's *worker thread*, not the main context (see
 * `g_subprocess_exited` in glib `gio/gsubprocess.c`, which sets `pid = 0`) —
 * reaps the child, the accessor is permanently null and the pid is
 * unrecoverable through any public Gio/GLib API. The kernel pid of an
 * already-reaped child cannot be re-derived (it is gone from `/proc`, and
 * GSubprocess exposes no post-reap accessor). The only robust mitigation is to
 * read at the earliest possible instant after spawn, which the caller does.
 * Filed upstream as GNOME/glib#3981 (proposed `g_subprocess_get_initial_identifier()`);
 * the maintainer keeps it low-priority (pidfds, GNOME/glib#1866, are the
 * preferred correlation path), so this spawn-time capture is the stable answer.
 *
 * Returns the positive pid, or 0 when the read lost the reap race (caller
 * leaves `ChildProcess.pid` undefined, matching Node's behaviour for a child
 * that has already exited and been reaped before pid was observed).
 */
function _capturePidAtSpawn(proc: Gio.Subprocess): number {
    const id = proc.get_identifier();
    if (id) {
        const n = parseInt(id, 10);
        if (n > 0) return n;
    }
    return 0;
}

// Execute a command in a shell and buffer the output (sync).
export function execSync(command: string, options?: ExecSyncOptions): Buffer | string {
    const encoding = options?.encoding;
    const input = options?.input;

    const flags =
        Gio.SubprocessFlags.STDOUT_PIPE |
        Gio.SubprocessFlags.STDERR_PIPE |
        (input ? Gio.SubprocessFlags.STDIN_PIPE : Gio.SubprocessFlags.NONE);

    // Shell selection is Node's own per-platform decision (`/bin/sh`,
    // `/system/bin/sh` on Android, `%ComSpec%` + `/d /s /c` on Windows) —
    // see `platform/index.ts`.
    const argv = shellArgv(command, options?.shell);
    let proc: Gio.Subprocess;
    try {
        ({ proc } = _spawnSubprocess(argv, flags, options));
    } catch (err: unknown) {
        // Spawn-time failure (binary missing, invalid argv, …) — Node's
        // execSync surfaces this as a thrown Error with `.code = 'ENOENT'`
        // etc. The shell wrapper makes ENOENT *the shell's* missing-binary,
        // not the user's, but the syscall string still references the
        // shell — match Node's shape.
        throw _gioErrorToNodeError(err, argv[0], argv.slice(1));
    }

    const stdinBytes = input
        ? new GLib.Bytes(typeof input === 'string' ? new TextEncoder().encode(input) : input)
        : null;

    const [, stdoutBytes, stderrBytes] = proc.communicate(stdinBytes, null);

    const status = proc.get_exit_status();
    if (status !== 0) {
        const stderrStr = stderrBytes ? new TextDecoder().decode(gbytesToUint8Array(stderrBytes)) : '';
        const stdoutStr = stdoutBytes ? new TextDecoder().decode(gbytesToUint8Array(stdoutBytes)) : '';
        const error = new Error(`Command failed: ${command}\n${stderrStr}`) as ExecError;
        error.status = status;
        // Node's execSync sets `error.stderr` / `error.stdout` to Buffer when
        // encoding is buffer/null, otherwise to a string in the requested
        // encoding. Keep parity.
        if (encoding === 'buffer' || encoding === null) {
            error.stderr = stderrBytes ? Buffer.from(gbytesToUint8Array(stderrBytes)) : Buffer.alloc(0);
            error.stdout = stdoutBytes ? Buffer.from(gbytesToUint8Array(stdoutBytes)) : Buffer.alloc(0);
        } else {
            error.stderr = stderrStr;
            error.stdout = stdoutStr;
        }
        throw error;
    }

    if (!stdoutBytes) {
        if (encoding === 'buffer' || encoding === null || encoding === undefined) return Buffer.alloc(0);
        return '';
    }
    const data = gbytesToUint8Array(stdoutBytes);
    if (encoding === 'buffer' || encoding === null || encoding === undefined) {
        return Buffer.from(data);
    }
    const enc: BufferEncoding = (Buffer.isEncoding(encoding) ? encoding : 'utf8') as BufferEncoding;
    return Buffer.from(data).toString(enc);
}

/**
 * Decode the stdout/stderr blobs that `exec`/`execFile` produced according
 * to Node's `encoding` semantics:
 *   - `'buffer'` or `null` → return a `Buffer` (Node 23+ default for the
 *     undocumented null case; same shape regardless)
 *   - any `BufferEncoding` string → decoded string
 *   - omitted → `'utf8'` (Node's default)
 *
 * Returns `Buffer | string` so the callback can be invoked with whichever
 * shape Node would have produced for the same option set.
 */
function _decodeExecOutput(
    bytes: Uint8Array | null,
    encoding: BufferEncoding | 'buffer' | null | undefined,
): Buffer | string {
    const data = bytes ?? new Uint8Array(0);
    if (encoding === 'buffer' || encoding === null) {
        return Buffer.from(data);
    }
    // Match Node: default encoding is 'utf8'. Any unknown value falls back
    // to utf8 (Node's `Buffer.isEncoding` check rejects unknowns silently).
    const enc: BufferEncoding = (encoding && Buffer.isEncoding(encoding) ? encoding : 'utf8') as BufferEncoding;
    return Buffer.from(data).toString(enc);
}

/**
 * Coerce `kill` callers' signal strings/numbers to the Gio surface.
 * Used by timeout/abort/manual `.kill()`. Mirrors Node's
 * `sanitizeKillSignal` but in lieu of throwing for invalid values we
 * substitute `SIGTERM` because Gio's kill path is fire-and-forget.
 */
function _normalizeKillSignal(signal: string | number | undefined): string | number {
    if (signal === undefined || signal === null) return 'SIGTERM';
    return signal;
}

/**
 * Execute a command in a shell (async with callback).
 *
 * Supports the full Node option set (per
 * `refs/node/lib/child_process.js` and the
 * `refs/node-test/parallel/test-child-process-exec-*` tests):
 *   - `encoding`: `'utf8'` (default), other `BufferEncoding`, `'buffer'`
 *     or `null` (→ Buffer)
 *   - `timeout`: kill the child with `killSignal` (default `SIGTERM`)
 *     after N ms; the callback receives an Error with `killed: true`
 *     and `signal` set to the kill signal
 *   - `maxBuffer`: throw `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` when the
 *     captured stdout/stderr exceeds N bytes (default 1 MiB, matching
 *     Node's `MAX_BUFFER`); the child is killed and the truncated
 *     output is returned
 *   - `signal` (`AbortSignal`): kill the child on abort and surface an
 *     `AbortError` to the callback
 *   - `killSignal`: signal used by timeout / abort (default `SIGTERM`)
 *   - `cwd` / `env` / `shell` / `uid` / `gid` / `argv0` etc. via
 *     `_spawnSubprocess`
 */
function _exec(
    command: string,
    options?: ExecOptions | ((error: ExecError | null, stdout: string | Buffer, stderr: string | Buffer) => void),
    callback?: (error: ExecError | null, stdout: string | Buffer, stderr: string | Buffer) => void,
): ChildProcess {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }
    const opts = (options || {}) as ExecOptions;
    const child = new ChildProcess();

    // Note: we do NOT request STDIN_PIPE here — `g_subprocess_communicate_async`
    // requires a non-null `stdin_buf` if the launcher was created with
    // STDIN_PIPE, but Node's `exec` contract is "no input is supplied". We
    // pass `null` to `communicate_async` and Gio's default stdin (/dev/null
    // equivalent) is used. The child sees EOF on stdin immediately, which
    // matches Node's behaviour exactly.
    const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;

    // Node uses 1 MiB as the default maxBuffer. Infinity disables the cap.
    const maxBuffer = opts.maxBuffer ?? 1024 * 1024;
    const timeoutMs = opts.timeout && opts.timeout > 0 ? opts.timeout : 0;
    const killSignal = _normalizeKillSignal(opts.killSignal);
    const abortSignal = opts.signal;

    // `_exec` paths share a fair amount of bookkeeping with `execFile`:
    // factor out into the inner helper below. Shell selection is Node's own
    // per-platform decision — see `platform/index.ts`.
    return _execImpl(child, shellArgv(command, opts.shell), flags, opts, {
        cmd: command,
        encoding: opts.encoding,
        maxBuffer,
        timeoutMs,
        killSignal,
        abortSignal,
        callback,
    });
}

interface _ExecImplCtx {
    cmd: string;
    encoding: BufferEncoding | 'buffer' | null | undefined;
    maxBuffer: number;
    timeoutMs: number;
    killSignal: string | number;
    abortSignal?: AbortSignal;
    callback?: (error: ExecError | null, stdout: string | Buffer, stderr: string | Buffer) => void;
}

function _execImpl(
    child: ChildProcess,
    argv: string[],
    flags: Gio.SubprocessFlags,
    opts: ExecOptions,
    ctx: _ExecImplCtx,
): ChildProcess {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let didKillForTimeout = false;
    let didKillForMaxBuffer = false;
    let abortError: Error | null = null;
    let onAbort: (() => void) | null = null;

    const armTimeout = (proc: Gio.Subprocess) => {
        if (!ctx.timeoutMs) return;
        timeoutHandle = setTimeout(() => {
            didKillForTimeout = true;
            try {
                // Route through the platform layer so a NAMED killSignal
                // ('SIGKILL', 'SIGINT', …) is translated to this platform's
                // number instead of silently degrading to SIGTERM.
                killProcess(proc, ctx.killSignal);
            } catch {
                /* already dead */
            }
            child.killed = true;
        }, ctx.timeoutMs);
    };

    const disarmTimeout = () => {
        if (timeoutHandle !== null) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }
    };

    const armAbort = (proc: Gio.Subprocess) => {
        if (!ctx.abortSignal) return;
        const fire = () => {
            abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            try {
                killProcess(proc, ctx.killSignal);
            } catch {
                /* already dead */
            }
            child.killed = true;
        };
        if (ctx.abortSignal.aborted) {
            queueMicrotask(fire);
            return;
        }
        onAbort = fire;
        ctx.abortSignal.addEventListener('abort', onAbort, { once: true });
    };

    const disarmAbort = () => {
        if (ctx.abortSignal && onAbort) {
            ctx.abortSignal.removeEventListener('abort', onAbort);
            onAbort = null;
        }
    };

    try {
        const { proc, pid } = _spawnSubprocess(argv, flags, opts);
        child._setSubprocess(proc, pid);
        _activeProcesses.add(child);
        ensureMainLoop();
        armTimeout(proc);
        armAbort(proc);

        // NOTE: we intentionally do NOT surface `proc.get_stdout_pipe()` as a
        // Readable here — `communicate_async` below consumes the pipe itself
        // and a competing Reader would split the byte stream. Node DOES expose
        // `child.stdout`/`child.stderr` on the `exec`-returned ChildProcess,
        // but that's an under-documented edge: most consumers use the callback
        // shape, and the few that touch `.stdout` get a Readable wrapping the
        // captured Buffer. Implementing that wrapper is a follow-up; the
        // callback contract is the primary surface.

        // We can't use `communicate_utf8_async` when the caller wants
        // `'buffer'` encoding or a non-utf8 encoding (those need the raw
        // bytes). Use `communicate_async` and decode ourselves.
        proc.communicate_async(null, null, (_source: Gio.Subprocess | null, result: Gio.AsyncResult) => {
            disarmTimeout();
            disarmAbort();
            _activeProcesses.delete(child);
            try {
                const [, stdoutBytes, stderrBytes] = proc.communicate_finish(result);
                let stdoutData = stdoutBytes ? gbytesToUint8Array(stdoutBytes) : null;
                let stderrData = stderrBytes ? gbytesToUint8Array(stderrBytes) : null;

                // maxBuffer enforcement — Node throws RangeError with code
                // ERR_CHILD_PROCESS_STDIO_MAXBUFFER when EITHER stream exceeds
                // the cap. The captured output is truncated TO the cap (not
                // dropped), matching Node's exec behaviour.
                let maxBufErr: ExecError | null = null;
                if (ctx.maxBuffer !== Infinity && stdoutData && stdoutData.length > ctx.maxBuffer) {
                    didKillForMaxBuffer = true;
                    stdoutData = stdoutData.subarray(0, ctx.maxBuffer);
                    maxBufErr = new RangeError('stdout maxBuffer length exceeded') as ExecError;
                    maxBufErr.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
                }
                if (
                    !maxBufErr &&
                    ctx.maxBuffer !== Infinity &&
                    stderrData &&
                    stderrData.length > ctx.maxBuffer
                ) {
                    didKillForMaxBuffer = true;
                    stderrData = stderrData.subarray(0, ctx.maxBuffer);
                    maxBufErr = new RangeError('stderr maxBuffer length exceeded') as ExecError;
                    maxBufErr.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
                }

                const stdout = _decodeExecOutput(stdoutData, ctx.encoding);
                const stderr = _decodeExecOutput(stderrData, ctx.encoding);
                const exitedNormally = proc.get_if_exited();
                const exitStatus = exitedNormally ? proc.get_exit_status() : null;
                const signal = proc.get_if_signaled() ? (typeof ctx.killSignal === 'string' ? ctx.killSignal : 'SIGTERM') : null;
                child.exitCode = exitStatus;
                child.signalCode = signal;

                let error: ExecError | null = null;
                if (abortError) {
                    error = abortError as ExecError;
                    error.killed = true;
                    error.signal = signal;
                    error.stdout = stdout;
                    error.stderr = stderr;
                    error.cmd = ctx.cmd;
                } else if (maxBufErr) {
                    error = maxBufErr;
                    error.killed = child.killed;
                    error.signal = signal;
                    error.stdout = stdout;
                    error.stderr = stderr;
                    error.cmd = ctx.cmd;
                } else if (didKillForTimeout) {
                    error = new Error(`Command failed: ${ctx.cmd}`) as ExecError;
                    error.killed = true;
                    error.code = null as unknown as number;
                    error.signal = typeof ctx.killSignal === 'string' ? ctx.killSignal : 'SIGTERM';
                    error.stdout = stdout;
                    error.stderr = stderr;
                    error.cmd = ctx.cmd;
                } else if (exitStatus !== 0 && exitStatus !== null) {
                    const stderrStr = typeof stderr === 'string' ? stderr : stderr.toString();
                    error = new Error(`Command failed: ${ctx.cmd}\n${stderrStr}`) as ExecError;
                    error.code = exitStatus;
                    error.killed = child.killed;
                    error.signal = signal;
                    error.stdout = stdout;
                    error.stderr = stderr;
                    error.cmd = ctx.cmd;
                } else if (signal) {
                    error = new Error(`Command failed: ${ctx.cmd}`) as ExecError;
                    error.killed = true;
                    error.signal = signal;
                    error.code = null as unknown as number;
                    error.stdout = stdout;
                    error.stderr = stderr;
                    error.cmd = ctx.cmd;
                }

                if (ctx.callback) ctx.callback(error, stdout, stderr);

                child.emit('exit', exitStatus, signal);
                child.emit('close', exitStatus, signal);
            } catch (err: unknown) {
                const error = err instanceof Error ? err : new Error(String(err));
                if (ctx.callback) ctx.callback(error as ExecError, '', '');
                child.emit('error', error);
            }
        });

        // Emit 'spawn' on the microtask queue (Node emits it on nextTick), NOT via
        // deferEmit's setTimeout(0): a 0ms GLib timeout source can be starved for
        // seconds on a loaded CI runner, spuriously tripping the spawn-event test's
        // timeout. Microtasks drain with the JS job queue (immune to loop pressure)
        // and still fire before the exit/close macrotasks, preserving event order.
        queueMicrotask(() => child.emit('spawn'));
    } catch (err: unknown) {
        disarmTimeout();
        disarmAbort();
        const error = _gioErrorToNodeError(err, argv[0] ?? '', argv.slice(1));
        setTimeout(() => {
            if (ctx.callback) ctx.callback(error, '', '');
            child.emit('error', error);
        }, 0);
    }
    // Silence the unused-variable warning; the flag is used inside the closure
    // for future diagnostic hooks (logged when the user enables verbose mode).
    void didKillForMaxBuffer;
    return child;
}

export { _exec as exec };

/**
 * Execute a file directly without shell (async).
 *
 * Shares the timeout / maxBuffer / signal / encoding plumbing with `exec`
 * via `_execImpl`. The only structural difference is argv construction
 * (no shell wrap).
 */
export function execFile(
    file: string,
    args?: string[] | ((error: ExecError | null, stdout: string | Buffer, stderr: string | Buffer) => void),
    options?: ExecOptions | ((error: ExecError | null, stdout: string | Buffer, stderr: string | Buffer) => void),
    callback?: (error: ExecError | null, stdout: string | Buffer, stderr: string | Buffer) => void,
): ChildProcess {
    let _args: string[] = [];
    let _opts: ExecOptions = {};
    let _callback:
        | ((error: ExecError | null, stdout: string | Buffer, stderr: string | Buffer) => void)
        | undefined;

    if (typeof args === 'function') {
        _callback = args;
    } else if (Array.isArray(args)) {
        _args = args;
        if (typeof options === 'function') {
            _callback = options;
        } else {
            _opts = options || {};
            _callback = callback;
        }
    } else if (args && typeof args === 'object') {
        // `execFile(file, options, cb?)` — second positional is options.
        _opts = args as ExecOptions;
        _callback = typeof options === 'function' ? options : callback;
    }

    const child = new ChildProcess();
    // Same stdin treatment as `exec` — no STDIN_PIPE because
    // `communicate_async` would assert on a null stdin_buf, and Node's
    // `execFile` does not feed input either.
    const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
    const maxBuffer = _opts.maxBuffer ?? 1024 * 1024;
    const timeoutMs = _opts.timeout && _opts.timeout > 0 ? _opts.timeout : 0;
    const killSignal = _normalizeKillSignal(_opts.killSignal);
    return _execImpl(child, [file, ..._args], flags, _opts, {
        cmd: file,
        encoding: _opts.encoding,
        maxBuffer,
        timeoutMs,
        killSignal,
        abortSignal: _opts.signal,
        callback: _callback,
    });
}

/**
 * Execute a file directly without shell (sync).
 *
 * Node's overloads accept `execFileSync(file)`, `execFileSync(file, args)`,
 * `execFileSync(file, options)` and `execFileSync(file, args, options)`.
 * Match all four — passing options as the 2nd positional must not be
 * spread into argv.
 */
export function execFileSync(
    file: string,
    args?: string[] | ExecSyncOptions,
    options?: ExecSyncOptions,
): Buffer | string {
    let _args: string[] = [];
    let _options: ExecSyncOptions | undefined;
    if (Array.isArray(args)) {
        _args = args;
        _options = options;
    } else if (args && typeof args === 'object') {
        _options = args as ExecSyncOptions;
    }
    const encoding = _options?.encoding;
    const input = _options?.input;

    const flags =
        Gio.SubprocessFlags.STDOUT_PIPE |
        Gio.SubprocessFlags.STDERR_PIPE |
        (input ? Gio.SubprocessFlags.STDIN_PIPE : Gio.SubprocessFlags.NONE);

    let proc: Gio.Subprocess;
    try {
        ({ proc } = _spawnSubprocess([file, ..._args], flags, _options));
    } catch (err: unknown) {
        throw _gioErrorToNodeError(err, file, _args);
    }

    const stdinBytes = input
        ? new GLib.Bytes(typeof input === 'string' ? new TextEncoder().encode(input) : input)
        : null;

    const [, stdoutBytes, stderrBytes] = proc.communicate(stdinBytes, null);

    const status = proc.get_exit_status();
    if (status !== 0) {
        const stderrStr = stderrBytes ? new TextDecoder().decode(gbytesToUint8Array(stderrBytes)) : '';
        const stdoutStr = stdoutBytes ? new TextDecoder().decode(gbytesToUint8Array(stdoutBytes)) : '';
        const error = new Error(`Command failed: ${file} ${_args.join(' ')}`) as ExecError;
        error.status = status;
        if (encoding === 'buffer' || encoding === null) {
            error.stderr = stderrBytes ? Buffer.from(gbytesToUint8Array(stderrBytes)) : Buffer.alloc(0);
            error.stdout = stdoutBytes ? Buffer.from(gbytesToUint8Array(stdoutBytes)) : Buffer.alloc(0);
        } else {
            error.stderr = stderrStr;
            error.stdout = stdoutStr;
        }
        throw error;
    }

    if (!stdoutBytes) {
        if (encoding === 'buffer' || encoding === null || encoding === undefined) return Buffer.alloc(0);
        return '';
    }
    const data = gbytesToUint8Array(stdoutBytes);
    if (encoding === 'buffer' || encoding === null || encoding === undefined) {
        return Buffer.from(data);
    }
    const enc: BufferEncoding = (Buffer.isEncoding(encoding) ? encoding : 'utf8') as BufferEncoding;
    return Buffer.from(data).toString(enc);
}

/**
 * Spawn a new process (async, with event-based API).
 *
 * Node accepts both `spawn(command, args, options)` and `spawn(command, options)`
 * — the second form omits args. Detect the overload at the boundary so callers
 * that pass options as the 2nd positional (e.g. `spawn('sh', { shell: true })`)
 * don't get the options object spread into argv.
 */
export function spawn(
    command: string,
    argsOrOptions?: string[] | SpawnOptions,
    maybeOptions?: SpawnOptions,
): ChildProcess {
    let args: string[] | undefined;
    let options: SpawnOptions | undefined;
    if (Array.isArray(argsOrOptions)) {
        args = argsOrOptions;
        options = maybeOptions;
    } else if (argsOrOptions !== undefined && argsOrOptions !== null) {
        // Node's `normalizeSpawnArguments` throws ERR_INVALID_ARG_TYPE when
        // the second positional is neither an array nor an object. Match.
        if (typeof argsOrOptions !== 'object') {
            throw new TypeError(
                `The "args" argument must be of type object. Received type ${typeof argsOrOptions}`,
            );
        }
        args = undefined;
        options = argsOrOptions;
    } else {
        args = undefined;
        options = argsOrOptions;
    }
    // `options` must be an object when present — Node throws on string/number.
    if (options !== undefined && options !== null && typeof options !== 'object') {
        throw new TypeError(
            `The "options" argument must be of type object. Received type ${typeof options}`,
        );
    }
    // argv0 type validation — synchronous throw (matches Node).
    if (options?.argv0 !== undefined && options.argv0 !== null && typeof options.argv0 !== 'string') {
        throw new TypeError(
            `The "options.argv0" property must be of type string. Received type ${typeof options.argv0}`,
        );
    }
    // Pre-validate cwd type (URL scheme, etc.) so it throws synchronously
    // instead of becoming a deferred 'error' event — matches Node's
    // synchronous-throw semantics for type errors.
    if (options?.cwd !== undefined) {
        _normalizeCwd(options.cwd);
    }
    const _args = args || [];
    const child = new ChildProcess();
    const useShell = options?.shell;

    let argv: string[];
    if (useShell) {
        // Node joins file + args into one command string, then hands it to the
        // platform's shell (`<sh> -c <cmd>` on POSIX, `<cmd.exe> /d /s /c "<cmd>"`
        // on Windows). See `platform/index.ts`.
        argv = shellArgv([command, ..._args].join(' '), useShell);
    } else {
        argv = [command, ..._args];
    }

    // Honour `stdio` (subset of Node's API): `'inherit'` → no PIPE flag so the
    // child writes directly to the parent's fd; `'ignore'` → no PIPE either,
    // child output is silently dropped at the kernel level; `'pipe'` (default)
    // → PIPE flag set so child output flows through GioInputStreamReadable.
    // Three-tuple form `['inherit'|'pipe'|'ignore', ..., ...]` is normalised
    // per-fd so callers can mix-and-match (e.g. ['ignore','pipe','pipe']).
    const stdioOpt = options?.stdio;
    const stdioTriple: [string, string, string] = Array.isArray(stdioOpt)
        ? [
              typeof stdioOpt[0] === 'string' ? stdioOpt[0] : 'pipe',
              typeof stdioOpt[1] === 'string' ? stdioOpt[1] : 'pipe',
              typeof stdioOpt[2] === 'string' ? stdioOpt[2] : 'pipe',
          ]
        : typeof stdioOpt === 'string'
          ? [stdioOpt, stdioOpt, stdioOpt]
          : ['pipe', 'pipe', 'pipe'];
    let flags = Gio.SubprocessFlags.NONE;
    // stdin asymmetry vs stdout/stderr: Gio.Subprocess defaults stdin to
    // /dev/null when neither STDIN_PIPE nor STDIN_INHERIT is set, while
    // stdout/stderr default to *inherited* (only PIPE / SILENCE flip them).
    // So `stdio: 'inherit'` must explicitly request STDIN_INHERIT — without
    // it, TTY-aware children (release-it / enquirer prompts, password
    // readers, …) see closed stdin and bail with "0 null" before any user
    // input is possible.
    if (stdioTriple[0] === 'pipe') flags |= Gio.SubprocessFlags.STDIN_PIPE;
    else if (stdioTriple[0] === 'inherit') flags |= Gio.SubprocessFlags.STDIN_INHERIT;
    if (stdioTriple[1] === 'pipe') flags |= Gio.SubprocessFlags.STDOUT_PIPE;
    if (stdioTriple[1] === 'ignore') flags |= Gio.SubprocessFlags.STDOUT_SILENCE;
    if (stdioTriple[2] === 'pipe') flags |= Gio.SubprocessFlags.STDERR_PIPE;
    if (stdioTriple[2] === 'ignore') flags |= Gio.SubprocessFlags.STDERR_SILENCE;

    try {
        const { proc, pid } = _spawnSubprocess(argv, flags, options);
        child._setSubprocess(proc, pid);
        _activeProcesses.add(child);

        // Stdin: wire the pipe as a Writable when caller asked for 'pipe'
        // (default when stdio[0] is unspecified). Otherwise leave
        // `child.stdin = null` — matches Node for `'inherit'` / `'ignore'`
        // shapes where the child uses the parent's fd directly or has stdin
        // silenced at spawn time.
        if (stdioTriple[0] === 'pipe') {
            const stdinPipe = proc.get_stdin_pipe();
            if (stdinPipe) child.stdin = new GioOutputStreamWritable(stdinPipe);
        }

        const stdoutPipe = proc.get_stdout_pipe();
        if (stdoutPipe) child.stdout = new GioInputStreamReadable(stdoutPipe);

        const stderrPipe = proc.get_stderr_pipe();
        if (stderrPipe) child.stderr = new GioInputStreamReadable(stderrPipe);

        // AbortSignal wiring — the documented Node behavior is to kill the
        // child on abort (with `killSignal` if provided) and emit an `error`
        // event whose `name` is `'AbortError'`. We register `{ once: true }`
        // because the listener is no longer interesting after either abort
        // OR child-exit, and we explicitly remove it from the exit handler so
        // a late abort never fires after the child is already gone.
        const abortSignal = options?.signal;
        let onAbort: (() => void) | null = null;
        const emitAbortError = () => {
            const killSig = options?.killSignal ?? 'SIGTERM';
            child.kill(killSig);
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            child.emit('error', err);
        };
        if (abortSignal) {
            if (abortSignal.aborted) {
                // Already aborted before spawn returned — kill + emit AbortError on
                // the next microtask so subscribers attached after `spawn()` returns
                // still receive the event (matches Node's documented behaviour).
                queueMicrotask(emitAbortError);
            } else {
                onAbort = emitAbortError;
                abortSignal.addEventListener('abort', onAbort, { once: true });
            }
        }

        // `timeout` option — kill the child with `killSignal` (default
        // SIGTERM) after N ms. Matches Node's documented `spawn` contract.
        // The exit handler later observes `child.killed` and reports the
        // signal accordingly.
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        if (options?.timeout && options.timeout > 0) {
            const sig = options.killSignal ?? 'SIGTERM';
            timeoutHandle = setTimeout(() => {
                child.kill(sig);
                timeoutHandle = null;
            }, options.timeout);
        }

        ensureMainLoop();
        proc.wait_async(null, (_source: Gio.Subprocess | null, result: Gio.AsyncResult) => {
            try {
                proc.wait_finish(result);
                const exitStatus = proc.get_if_exited() ? proc.get_exit_status() : null;
                // Node reports the kill signal NAME (e.g. 'SIGTERM'). Gio
                // doesn't expose `get_term_sig()` to JS so we cannot decode
                // the real signal — surface the user-requested killSignal
                // when we issued the kill (timeout or .kill()), otherwise
                // default to SIGTERM (which is what Gio.Subprocess uses for
                // its own kill paths).
                let signal: string | null = null;
                if (proc.get_if_signaled()) {
                    const requested = options?.killSignal;
                    signal = typeof requested === 'string' ? requested : 'SIGTERM';
                }
                child.exitCode = exitStatus;
                child.signalCode = signal;
                if (timeoutHandle !== null) {
                    clearTimeout(timeoutHandle);
                    timeoutHandle = null;
                }
                if (abortSignal && onAbort) {
                    abortSignal.removeEventListener('abort', onAbort);
                }
                // Match Node's `child_process` behaviour: when the subprocess
                // exits, destroy `child.stdin` if it's still open. Without this,
                // consumers that await `stream.finished(child.stdin)` (e.g.
                // execa's `waitForStdioStreams`) hang indefinitely because no
                // one has called `end()` or `destroy()` on the Writable. Node's
                // own impl does the same at
                // https://github.com/nodejs/node/blob/main/lib/internal/child_process.js
                // (search for `this.stdin.destroy()` on the exit path).
                if (child.stdin && !child.stdin.destroyed) {
                    child.stdin.destroy();
                }
                child.emit('exit', exitStatus, signal);
                child.emit('close', exitStatus, signal);
            } catch (err: unknown) {
                child.emit('error', err instanceof Error ? err : new Error(String(err)));
            }
            _activeProcesses.delete(child);
        });

        // Emit 'spawn' on the microtask queue (Node emits it on nextTick), NOT via
        // deferEmit's setTimeout(0): a 0ms GLib timeout source can be starved for
        // seconds on a loaded CI runner, spuriously tripping the spawn-event test's
        // timeout. Microtasks drain with the JS job queue (immune to loop pressure)
        // and still fire before the exit/close macrotasks, preserving event order.
        queueMicrotask(() => child.emit('spawn'));
    } catch (err: unknown) {
        // Normalise the spawn-time error so consumers can match on
        // `err.code === 'ENOENT'` / `err.errno === -2` etc. The spawn-side
        // error MUST identify the real binary (`argv[0]` for non-shell,
        // `command` for shell), not the wrapping `/bin/sh`.
        const spawnFile = useShell ? command : argv[0] ?? '';
        const spawnArgs = useShell ? _args : argv.slice(1);
        deferEmit(child, 'error', _gioErrorToNodeError(err, spawnFile, spawnArgs));
    }

    return child;
}

/**
 * Spawn a new process (sync).
 *
 * Same overload as `spawn`: accepts both `(command, args, options)` and
 * `(command, options)`.
 */
export function spawnSync(
    command: string,
    argsOrOptions?: string[] | ExecSyncOptions,
    maybeOptions?: ExecSyncOptions,
): SpawnSyncResult {
    let args: string[] | undefined;
    let options: ExecSyncOptions | undefined;
    if (Array.isArray(argsOrOptions)) {
        args = argsOrOptions;
        options = maybeOptions;
    } else if (argsOrOptions !== undefined && argsOrOptions !== null) {
        if (typeof argsOrOptions !== 'object') {
            throw new TypeError(
                `The "args" argument must be of type object. Received type ${typeof argsOrOptions}`,
            );
        }
        args = undefined;
        options = argsOrOptions;
    } else {
        args = undefined;
        options = argsOrOptions;
    }
    if (options !== undefined && options !== null && typeof options !== 'object') {
        throw new TypeError(
            `The "options" argument must be of type object. Received type ${typeof options}`,
        );
    }
    // argv0 type-validation happens here (NOT inside `_spawnSubprocess`)
    // because `spawnSync` wraps the spawn call in a try/catch that turns
    // failures into a `result.error` field — but Node's `spawnSync` THROWS
    // synchronously for type errors. Mirror Node.
    if (options?.argv0 !== undefined && options.argv0 !== null && typeof options.argv0 !== 'string') {
        throw new TypeError(
            `The "options.argv0" property must be of type string. Received type ${typeof options.argv0}`,
        );
    }
    // Pre-validate cwd (URL scheme, etc.) so failures throw synchronously
    // rather than getting caught by the spawn try/catch below and stuffed
    // into `result.error` — Node throws for type errors but reports
    // ENOENT-style failures via result.error.
    if (options?.cwd !== undefined) {
        _normalizeCwd(options.cwd);
    }
    const _args = args || [];
    const useShell = options?.shell;
    const input = options?.input;

    let argv: string[];
    if (useShell) {
        // Node joins file + args into one command string, then hands it to the
        // platform's shell — see `platform/index.ts`.
        argv = shellArgv([command, ..._args].join(' '), useShell);
    } else {
        argv = [command, ..._args];
    }

    // `timeout` is enforced IN PROCESS by `communicateWithTimeout()` — a GLib
    // timer on a private main context that drives `communicate_async()` and
    // kills the child on the deadline. It used to be delegated to the GNU
    // coreutils `timeout(1)` binary (absent on macOS and Windows), which also
    // masked the child's real pid and termination signal. See `communicate.ts`.
    const timeoutMs = options?.timeout && options.timeout > 0 ? options.timeout : 0;

    const flags =
        Gio.SubprocessFlags.STDOUT_PIPE |
        Gio.SubprocessFlags.STDERR_PIPE |
        (input ? Gio.SubprocessFlags.STDIN_PIPE : Gio.SubprocessFlags.NONE);

    // Node's `input` option only accepts string / Buffer / TypedArray /
    // DataView — anything else (number, plain object, …) throws
    // ERR_INVALID_ARG_TYPE. We match because consumer code (test runners,
    // execa, …) relies on the throw to detect misuse. Cast to `unknown`
    // first so the runtime check still works under TS's narrowed type.
    const inputU: unknown = input;
    if (
        inputU !== undefined &&
        inputU !== null &&
        typeof inputU !== 'string' &&
        !(inputU instanceof Uint8Array) &&
        !(inputU instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(inputU)
    ) {
        throw new TypeError(
            `The "input" property must be of type string, Buffer, TypedArray, or DataView. Received type ${typeof inputU}`,
        );
    }

    const encoding = options?.encoding;
    const emptyOut: Buffer | string =
        encoding === 'buffer' || encoding === null || encoding === undefined ? Buffer.alloc(0) : '';

    let proc: Gio.Subprocess;
    // `spawnPid` is captured at spawn time (the one instant the child is
    // provably alive) so the SpawnSyncResult.pid is never lost to the
    // worker-thread reap race — same fix as the async ChildProcess.pid path.
    let spawnPid = 0;
    try {
        ({ proc, pid: spawnPid } = _spawnSubprocess(argv, flags, options));
    } catch (err: unknown) {
        // Surface spawn-time failure (most commonly ENOENT for a missing
        // binary) as Node does — a SpawnSyncResult with `error` set, never
        // throw. Map the GIO error to the Node ErrnoException shape.
        const spawnFile = useShell ? command : argv[0] ?? '';
        const spawnArgs = useShell ? _args : argv.slice(1);
        return {
            pid: 0,
            output: [null, emptyOut, emptyOut],
            stdout: emptyOut,
            stderr: emptyOut,
            status: null,
            signal: null,
            error: _gioErrorToNodeError(err, spawnFile, spawnArgs),
        };
    }

    const stdinBytes = input
        ? new GLib.Bytes(typeof input === 'string' ? new TextEncoder().encode(input) : (input as Uint8Array))
        : null;

    let stdoutBytes: GLib.Bytes | null;
    let stderrBytes: GLib.Bytes | null;
    let commError: ExecError | null = null;
    let timeoutFired = false;
    try {
        if (timeoutMs > 0) {
            // Deadline path — `proc.communicate()` blocks without iterating any
            // main context, so the timer has to drive `communicate_async()` on
            // a private context instead (no re-entrancy into app code).
            const bounded = communicateWithTimeout(proc, stdinBytes, timeoutMs, () => {
                killProcess(proc, options?.killSignal ?? 'SIGTERM');
            });
            timeoutFired = bounded.timedOut;
            if (bounded.error) throw bounded.error;
            stdoutBytes = bounded.stdout;
            stderrBytes = bounded.stderr;
        } else {
            const ret = proc.communicate(stdinBytes, null);
            // tuple: [success, stdout, stderr]
            stdoutBytes = ret[1] ?? null;
            stderrBytes = ret[2] ?? null;
        }
    } catch (err: unknown) {
        commError = err instanceof Error ? (err as ExecError) : (new Error(String(err)) as ExecError);
        stdoutBytes = null;
        stderrBytes = null;
    }

    const stdoutBuf = stdoutBytes ? Buffer.from(gbytesToUint8Array(stdoutBytes)) : Buffer.alloc(0);
    const stderrBuf = stderrBytes ? Buffer.from(gbytesToUint8Array(stderrBytes)) : Buffer.alloc(0);

    const decode = (buf: Buffer): Buffer | string => {
        if (encoding === 'buffer' || encoding === null || encoding === undefined) return buf;
        const enc: BufferEncoding = (Buffer.isEncoding(encoding) ? encoding : 'utf8') as BufferEncoding;
        return buf.toString(enc);
    };
    const stdoutData = decode(stdoutBuf);
    const stderrData = decode(stderrBuf);

    const status = proc.get_if_exited() ? proc.get_exit_status() : null;
    let signal: string | null = null;
    if (proc.get_if_signaled()) {
        const requested = options?.killSignal;
        signal = typeof requested === 'string' ? requested : 'SIGTERM';
    }
    // The child we killed on the deadline was terminated by a signal, so
    // `get_if_signaled()` above already produced the right name — but pin it
    // explicitly for the rare case where the child managed to exit normally in
    // the same instant the timer fired.
    if (timeoutFired) {
        signal = typeof options?.killSignal === 'string' ? options.killSignal : 'SIGTERM';
    }

    const result: SpawnSyncResult = {
        pid: spawnPid,
        output: [null, stdoutData, stderrData],
        stdout: stdoutData,
        stderr: stderrData,
        status: timeoutFired ? null : status,
        signal,
    };
    if (timeoutFired) {
        const err = new Error(
            `Command failed: ${argv.join(' ')}\n${typeof stderrData === 'string' ? stderrData : stderrData.toString()}`,
        ) as ExecError;
        err.code = 'ETIMEDOUT';
        err.killed = true;
        err.signal = signal;
        result.error = err;
    } else if (commError) {
        result.error = commError;
    }
    return result;
}

export default {
    ChildProcess,
    exec: _exec,
    execSync,
    execFile,
    execFileSync,
    spawn,
    spawnSync,
};
