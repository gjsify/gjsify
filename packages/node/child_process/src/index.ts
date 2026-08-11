// `node:child_process` over Gio.Subprocess.
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
 * `Gio.Subprocess.get_stdin_pipe()` as a Node `Writable`, so `child.stdin`
 * honours `.write()` / `.end()` / pipe-from-Readable. execa's
 * `{ input: 'string' }` shape rides on it (`tests/integration/execa/`).
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
        // Node's `_write` already coerces strings outside objectMode, but execa
        // hands us a bare ArrayBufferView for its `input` option.
        const bytes: Uint8Array =
            typeof chunk === 'string'
                ? Buffer.from(chunk)
                : chunk instanceof Uint8Array
                  ? chunk
                  : Buffer.from(chunk as unknown as ArrayLike<number>);
        // `new GLib.Bytes(…)` copies, so the GIO pipeline owns the lifetime. Async
        // on purpose: `write_bytes()` blocks the main loop.
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
                        // destroy() already told downstream; finish silently.
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
        // Close so the child sees EOF. Sync on purpose: `close_async()` on a pipe
        // whose read-end belongs to an already-exited subprocess can hang forever,
        // because the kernel holds the dispatch chain until both ends agree.
        try {
            this._stream.close(null);
        } catch {
            // Already closed — the subprocess exited and collapsed the pipe end
            // first. EOF has still been signalled, so `_final` may resolve.
        }
        callback();
    }

    override _destroy(error: Error | null, callback: (err?: Error | null) => void): void {
        this._cancellable.cancel();
        // `_destroy` can beat `_final` when the consumer calls `.destroy()`
        // directly, so close here too rather than leak the stream on error paths.
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
    /** `null` when the child was signalled (timeout kill) — matches Node. */
    status?: number | null;
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
 * Normalise a Gio spawn error into Node's "command not found" shape — `code`
 * `'ENOENT'`, `errno` -2, `syscall` `spawn <file>`, plus `path`/`spawnargs`
 * (`refs/node/lib/internal/child_process.js`). GIO raises the same condition as
 * `GLib.SpawnError` `NOENT`, matched via `.matches()` first and message text as
 * fallback, for hosts where marshalling leaves only `.message`.
 */
function _gioErrorToNodeError(err: unknown, file: string, args: string[]): ExecError {
    // Do NOT wrap in `new Error(String(err))`: `GLib_SpawnError` is not
    // `instanceof Error`, yet it is what carries the `.matches()` GError helper
    // and the numeric `.code` this function needs. Wrapping discards both.
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
        // GIO translates this message, so the alternatives cover the localised
        // spellings too. Last resort only — matches()/code above are reliable.
        /No such file or directory|ENOENT|Failed to execute|nicht gefunden|nicht ausgeführt/i.test(e.message)
    ) {
        isNoent = true;
    }
    if (isNoent) {
        // Fresh Error so `err instanceof Error` holds — GLib_SpawnError fails it,
        // and Node's own tests assert it.
        const wrapped = new Error(`spawn ${file} ENOENT`) as ExecError;
        wrapped.code = 'ENOENT';
        wrapped.errno = -2;
        wrapped.syscall = `spawn ${file}`;
        wrapped.path = file;
        wrapped.spawnargs = args.slice();
        return wrapped;
    }
    // Non-ENOENT still has to be Error-shaped for downstream `.message`.
    if (e instanceof Error) return out;
    const eAny = e as { message?: unknown };
    const msg = typeof eAny.message === 'string' ? eAny.message : String(e);
    const wrap = new Error(msg) as ExecError;
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
    /** On abort the child is killed with `killSignal` (default `SIGTERM`) and the
     *  callback receives an `Error` with `name: 'AbortError'`. */
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
     * `Gio.SubprocessLauncher` hides `set_child_setup` from GIR, so on POSIX
     * argv[0] is overridden by wrapping the spawn in a shell's
     * `exec -a "$0" "$@"`. Inexpressible on Windows — throws
     * `ERR_UNSUPPORTED_OPERATION` there.
     */
    argv0?: string;
    /**
     * Leader of a new session/process group, via `setsid(1)` from PATH. With no
     * `setsid` binary (stock macOS, Windows) the child still spawns and still
     * outlives the parent, it is just not promoted to session leader.
     */
    detached?: boolean;
    /** Accepted and ignored everywhere: GIR exposes no `CreateProcess` creation flags. */
    windowsHide?: boolean;
    /** Accepted and ignored everywhere: GLib builds the Windows command line itself
     *  (`protect_argv()`), so its quoting cannot be bypassed as libuv's can. */
    windowsVerbatimArguments?: boolean;
    /** On abort the child is killed with `killSignal` (default `SIGTERM`) and an
     *  `error` event with `name: 'AbortError'` is emitted. */
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

// GC guard: without a strong JS reference GJS collects the Gio.Subprocess out
// from under pending async operations.
const _activeProcesses = new Set<ChildProcess>();

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
     * `[stdin, stdout, stderr]` only — extra fds from
     * `options.stdio = [..., 'pipe']` are not surfaced, so the tuple never grows
     * past index 2. Must exist even when nothing was piped: execa iterates it to
     * dispose streams on subprocess exit.
     */
    get stdio(): Array<Writable | Readable | null> {
        return [this.stdin, this.stdout, this.stderr];
    }

    private _subprocess: Gio.Subprocess | null = null;

    /**
     * @internal The caller passes `pid` in rather than letting us read
     * `proc.get_identifier()`, which is racy: GSubprocess's child-watch runs on
     * the GLib worker thread and nulls the identifier the instant it reaps, so a
     * fast child like `echo` can beat any synchronous JS read and leave the pid
     * permanently unreadable. Node promises `cp.pid` synchronously, so
     * `_capturePidAtSpawn` takes it at spawn time instead.
     */
    _setSubprocess(proc: Gio.Subprocess, pid: number): void {
        this._subprocess = proc;
        if (pid > 0) this.pid = pid;
    }

    /**
     * Accepts a signal number or POSIX name; an unrecognised name falls back to
     * SIGTERM rather than throwing. `false` when there is no subprocess handle
     * left — Node's "no-op on an already-reaped child" shape.
     */
    kill(signal?: string | number): boolean {
        if (!this._subprocess) return false;
        try {
            // Signal numbers differ across Linux/macOS, and Windows has none at
            // all (every signal collapses onto `force_exit`). `platform/` owns
            // those tables.
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

// Node takes `cwd` as string, file:// URL or Buffer; `set_cwd` takes a string.
// `undefined` means no cwd was supplied — Node then inherits the parent's.
function _normalizeCwd(cwd: unknown): string | undefined {
    if (cwd === undefined || cwd === null) return undefined;
    if (typeof cwd === 'string') return cwd;
    // Duck-typed, not `instanceof URL`: `@gjsify/url` installs its own URL class
    // on GJS, which does not share identity with the one an in-bundle test builds.
    if (
        typeof cwd === 'object' &&
        cwd !== null &&
        typeof (cwd as { href?: unknown }).href === 'string' &&
        typeof (cwd as { protocol?: unknown }).protocol === 'string'
    ) {
        const url = cwd as URL;
        if (url.protocol !== 'file:') {
            throw new TypeError(`The URL must be of scheme file:; received '${url.protocol}' for 'options.cwd'`);
        }
        return fileURLToPath(url);
    }
    if (cwd instanceof Uint8Array) {
        return new TextDecoder().decode(cwd);
    }
    // Lenient where Node's path validation throws, so "string-coercible" objects pass.
    return String(cwd);
}

/**
 * Coerce an env value through Node's `${value}` template — `null` → `"null"`,
 * an array → `"a,b,c"` — and drop `undefined` entirely. Asserted by
 * `refs/node-test/parallel/test-child-process-env.js`: `NULL=null` must appear
 * in the child env, `UNDEFINED=undefined` must not.
 */
function _encodeEnvValue(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    // Template coercion, not `String(value)`: the two differ for a
    // `[Symbol.toPrimitive]` that returns a non-string on the default hint.
    return `${value}`;
}

// `uid` / `gid` are accepted so Node option objects type-check, then ignored:
// Gio.SubprocessLauncher exposes no setuid/setgid, and there is no validation —
// the child runs as the parent user.
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

/** `pid` is captured right after `spawnv()`, the last instant it is readable —
 *  see `_capturePidAtSpawn`. */
interface _SpawnResult {
    proc: Gio.Subprocess;
    pid: number;
}

function _spawnSubprocess(argv: string[], flags: Gio.SubprocessFlags, options?: _SpawnLowOptions): _SpawnResult {
    const launcher = new Gio.SubprocessLauncher({ flags });
    const cwd = _normalizeCwd(options?.cwd);
    // An empty-string cwd is passed through, not skipped: Gio then fails with
    // NOENT, which is the same ENOENT Node propagates for `cwd: ''`.
    if (cwd !== undefined) {
        launcher.set_cwd(cwd);
    }
    if (options?.env) {
        const env = options.env;
        // ANY caller-supplied env — `{}` included — means "exactly this, not
        // inherited" in Node, while the launcher inherits by default. Without the
        // wipe, `env: {}` leaks the parent env: the opposite of the guarantee.
        launcher.set_environ([]);
        // `for…in`, not `Object.entries`: Node's `normalizeSpawnArguments` walks
        // the prototype chain, so a prototype-set var must not be dropped.
        const seen = new Set<string>();
        for (const key in env) {
            if (seen.has(key)) continue;
            seen.add(key);
            const value = _encodeEnvValue((env as Record<string, unknown>)[key]);
            if (value === undefined) continue;
            launcher.setenv(key, value, true);
        }
    }
    let realArgv = argv;
    if (options?.argv0 !== undefined && options.argv0 !== null) {
        if (typeof options.argv0 !== 'string') {
            throw new TypeError(
                `The "options.argv0" property must be of type string. Received type ${typeof options.argv0}`,
            );
        }
        realArgv = applyArgv0(options.argv0, argv);
    }
    // `null` prefix = this platform has no `setsid`; the child still spawns and
    // outlives us, it is just not a session leader.
    if (options?.detached === true) {
        const prefix = detachedPrefix();
        if (prefix !== null) realArgv = [...prefix, ...realArgv];
    }
    // The capture must be the VERY NEXT statement — any work in between widens
    // the window in which a fast child is reaped and the pid lost.
    const proc = launcher.spawnv(realArgv);
    const pid = _capturePidAtSpawn(proc);
    return { proc, pid };
}

/**
 * Read a freshly-spawned child's pid, or 0 if the read lost the reap race — the
 * caller then leaves `ChildProcess.pid` undefined, as Node does for a child
 * already reaped before the pid was observed.
 *
 * `get_identifier()` is valid only while the child is unreaped, and GSubprocess
 * reaps from GLib's worker thread, so a fast child can null it before any
 * synchronous JS read. Once nulled the pid is unrecoverable: no public Gio/GLib
 * accessor survives the reap, and /proc is already gone. Reading at the earliest
 * possible instant is the whole mitigation. Upstream request: GNOME/glib#3981.
 */
function _capturePidAtSpawn(proc: Gio.Subprocess): number {
    const id = proc.get_identifier();
    if (id) {
        const n = parseInt(id, 10);
        if (n > 0) return n;
    }
    return 0;
}

/**
 * Bounded `communicate()` shared by the two synchronous exec wrappers.
 *
 * `Gio.Subprocess.communicate()` blocks the calling thread and never iterates
 * a GLib main context, so `options.timeout` cannot be honoured by arming a
 * timer around it — the timer could never fire. `communicateWithTimeout()`
 * (see `communicate.ts`) drives `communicate_async()` on a PRIVATE main
 * context instead, which is the same mechanism `spawnSync` already uses. NOT
 * the GNU coreutils `timeout(1)` binary: that is absent on macOS/Windows,
 * masks the child's pid and cannot report the real termination signal.
 *
 * @returns the drained output plus whether the deadline was hit
 */
function _communicateSync(
    proc: Gio.Subprocess,
    stdinBytes: GLib.Bytes | null,
    timeoutMs: number,
    killSignal: string | number | undefined,
): { stdout: GLib.Bytes | null; stderr: GLib.Bytes | null; timedOut: boolean } {
    if (timeoutMs <= 0) {
        // tuple: [success, stdout, stderr]
        const ret = proc.communicate(stdinBytes, null);
        return { stdout: ret[1] ?? null, stderr: ret[2] ?? null, timedOut: false };
    }
    const bounded = communicateWithTimeout(proc, stdinBytes, timeoutMs, () => {
        killProcess(proc, killSignal ?? 'SIGTERM');
    });
    if (bounded.error) throw bounded.error;
    return { stdout: bounded.stdout, stderr: bounded.stderr, timedOut: bounded.timedOut };
}

/**
 * The error `execSync` / `execFileSync` throw on `options.timeout`. `status` is
 * null because the child was signalled, and `stdout`/`stderr` carry the PARTIAL
 * output captured before the kill, in the caller's encoding.
 *
 * Node leaves `killed` undefined here and words the message `spawnSync <file>
 * ETIMEDOUT`; `killed: true` plus `Command failed: …` is this package's
 * convention, and it is what makes a timeout distinguishable from a plain
 * non-zero exit at the call site.
 */
function _syncTimeoutError(
    cmd: string,
    stdoutBytes: GLib.Bytes | null,
    stderrBytes: GLib.Bytes | null,
    encoding: BufferEncoding | 'buffer' | null | undefined,
    killSignal: string | number | undefined,
): ExecError {
    const stdoutData = stdoutBytes ? gbytesToUint8Array(stdoutBytes) : new Uint8Array(0);
    const stderrData = stderrBytes ? gbytesToUint8Array(stderrBytes) : new Uint8Array(0);
    const stderrStr = new TextDecoder().decode(stderrData);
    const error = new Error(`Command failed: ${cmd}\n${stderrStr}`) as ExecError;
    error.code = 'ETIMEDOUT';
    error.killed = true;
    error.signal = typeof killSignal === 'string' ? killSignal : 'SIGTERM';
    error.status = null;
    if (encoding === 'buffer' || encoding === null) {
        error.stdout = Buffer.from(stdoutData);
        error.stderr = Buffer.from(stderrData);
    } else {
        error.stdout = new TextDecoder().decode(stdoutData);
        error.stderr = stderrStr;
    }
    return error;
}

export function execSync(command: string, options?: ExecSyncOptions): Buffer | string {
    const encoding = options?.encoding;
    const input = options?.input;

    const flags =
        Gio.SubprocessFlags.STDOUT_PIPE |
        Gio.SubprocessFlags.STDERR_PIPE |
        (input ? Gio.SubprocessFlags.STDIN_PIPE : Gio.SubprocessFlags.NONE);

    const argv = shellArgv(command, options?.shell);
    let proc: Gio.Subprocess;
    try {
        ({ proc } = _spawnSubprocess(argv, flags, options));
    } catch (err: unknown) {
        // Because of the shell wrapper the ENOENT is the SHELL's missing binary,
        // not the user's, and the syscall string names the shell — as Node's does.
        throw _gioErrorToNodeError(err, argv[0], argv.slice(1));
    }

    const stdinBytes = input
        ? new GLib.Bytes(typeof input === 'string' ? new TextEncoder().encode(input) : input)
        : null;

    const timeoutMs = options?.timeout && options.timeout > 0 ? options.timeout : 0;
    const {
        stdout: stdoutBytes,
        stderr: stderrBytes,
        timedOut,
    } = _communicateSync(proc, stdinBytes, timeoutMs, options?.killSignal);
    if (timedOut) {
        throw _syncTimeoutError(command, stdoutBytes, stderrBytes, encoding, options?.killSignal);
    }

    const status = proc.get_exit_status();
    if (status !== 0) {
        const stderrStr = stderrBytes ? new TextDecoder().decode(gbytesToUint8Array(stderrBytes)) : '';
        const stdoutStr = stdoutBytes ? new TextDecoder().decode(gbytesToUint8Array(stdoutBytes)) : '';
        const error = new Error(`Command failed: ${command}\n${stderrStr}`) as ExecError;
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

/** Node's `encoding` semantics for `exec`/`execFile` output: `'buffer'` or `null`
 *  yield a Buffer, anything else a string, with an omitted encoding meaning utf8. */
function _decodeExecOutput(
    bytes: Uint8Array | null,
    encoding: BufferEncoding | 'buffer' | null | undefined,
): Buffer | string {
    const data = bytes ?? new Uint8Array(0);
    if (encoding === 'buffer' || encoding === null) {
        return Buffer.from(data);
    }
    // An unknown encoding degrades to utf8 rather than throwing, as Node does.
    const enc: BufferEncoding = (encoding && Buffer.isEncoding(encoding) ? encoding : 'utf8') as BufferEncoding;
    return Buffer.from(data).toString(enc);
}

/**
 * Default the kill signal for timeout / abort / manual `.kill()`. Unlike Node's
 * `sanitizeKillSignal` this validates nothing — an unknown NAME is resolved (and
 * defaulted) later by `platform/`, because Gio's kill path is fire-and-forget.
 */
function _normalizeKillSignal(signal: string | number | undefined): string | number {
    if (signal === undefined || signal === null) return 'SIGTERM';
    return signal;
}

/**
 * Execute a command in a shell (async with callback).
 *
 * Option semantics follow `refs/node/lib/child_process.js` and the
 * `refs/node-test/parallel/test-child-process-exec-*` tests.
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

    // No STDIN_PIPE: `communicate_async` demands a non-null `stdin_buf` once the
    // launcher has it, and `exec` supplies no input. Passing `null` gives the
    // child Gio's default stdin, so it sees EOF at once — Node's behaviour.
    const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;

    // Node's default. Infinity disables the cap.
    const maxBuffer = opts.maxBuffer ?? 1024 * 1024;
    const timeoutMs = opts.timeout && opts.timeout > 0 ? opts.timeout : 0;
    const killSignal = _normalizeKillSignal(opts.killSignal);
    const abortSignal = opts.signal;

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

/**
 * Stand-in for the `errorhandler` listener Node attaches at the end of
 * `execFile`, so the spawn-failure `emit('error', …)` is never unhandled.
 *
 * It must exist because `EventEmitter.emit` RETHROWS an unhandled `'error'`: a
 * correctly handled `execFile('missing-binary', cb)` — callback already invoked
 * with ENOENT — otherwise threw the same error again out of a `setTimeout`, as a
 * process-level uncaught exception. A no-op suffices since the callback has the
 * error already, and a user `.on('error')` is a second listener that still fires.
 * `spawn()` keeps the unguarded emit; there throw-on-unhandled IS Node's contract.
 */
function _absorbExecError(): void {
    /* The callback already received the error. */
}

function _execImpl(
    child: ChildProcess,
    argv: string[],
    flags: Gio.SubprocessFlags,
    opts: ExecOptions,
    ctx: _ExecImplCtx,
): ChildProcess {
    child.on('error', _absorbExecError);

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
                // Via `platform/` so a NAMED killSignal resolves to this host's
                // number rather than degrading to SIGTERM.
                killProcess(proc, ctx.killSignal);
            } catch {
                /* NOT the already-dead case: force_exit/send_signal have no throw
                   path in the GIR. This only guards an invalid killSignal. */
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
                /* Only guards an invalid killSignal — see armTimeout. */
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

        // `child.stdout`/`child.stderr` stay null on an exec-returned child, unlike
        // Node: `communicate_async` owns the pipe and a competing Reader would split
        // the byte stream. Not `communicate_utf8_async`, because 'buffer' and
        // non-utf8 encodings need the raw bytes.
        proc.communicate_async(null, null, (_source: Gio.Subprocess | null, result: Gio.AsyncResult) => {
            disarmTimeout();
            disarmAbort();
            _activeProcesses.delete(child);
            try {
                const [, stdoutBytes, stderrBytes] = proc.communicate_finish(result);
                let stdoutData = stdoutBytes ? gbytesToUint8Array(stdoutBytes) : null;
                let stderrData = stderrBytes ? gbytesToUint8Array(stderrBytes) : null;

                // Either stream over the cap produces Node's RangeError. Output is
                // truncated TO the cap rather than dropped, as Node's exec does —
                // but unlike Node we do not kill the child, so the overflow is only
                // observed once `communicate_async` has already drained everything.
                let maxBufErr: ExecError | null = null;
                if (ctx.maxBuffer !== Infinity && stdoutData && stdoutData.length > ctx.maxBuffer) {
                    didKillForMaxBuffer = true;
                    stdoutData = stdoutData.subarray(0, ctx.maxBuffer);
                    maxBufErr = new RangeError('stdout maxBuffer length exceeded') as ExecError;
                    maxBufErr.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
                }
                if (!maxBufErr && ctx.maxBuffer !== Infinity && stderrData && stderrData.length > ctx.maxBuffer) {
                    didKillForMaxBuffer = true;
                    stderrData = stderrData.subarray(0, ctx.maxBuffer);
                    maxBufErr = new RangeError('stderr maxBuffer length exceeded') as ExecError;
                    maxBufErr.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
                }

                const stdout = _decodeExecOutput(stdoutData, ctx.encoding);
                const stderr = _decodeExecOutput(stderrData, ctx.encoding);
                const exitedNormally = proc.get_if_exited();
                const exitStatus = exitedNormally ? proc.get_exit_status() : null;
                const signal = proc.get_if_signaled()
                    ? typeof ctx.killSignal === 'string'
                        ? ctx.killSignal
                        : 'SIGTERM'
                    : null;
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

        // A microtask, not deferEmit's setTimeout(0): a 0 ms GLib timeout source can
        // be starved for seconds on a loaded CI runner, tripping the spawn-event
        // test's own timeout. Microtasks drain with the JS job queue, so they are
        // immune to loop pressure and still precede the exit/close macrotasks.
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
    // `didKillForMaxBuffer` is assigned but never read; the `void` keeps the
    // unused-variable lint quiet.
    void didKillForMaxBuffer;
    return child;
}

export { _exec as exec };

/** Execute a file directly without shell (async). */
export function execFile(
    file: string,
    args?: string[] | ((error: ExecError | null, stdout: string | Buffer, stderr: string | Buffer) => void),
    options?: ExecOptions | ((error: ExecError | null, stdout: string | Buffer, stderr: string | Buffer) => void),
    callback?: (error: ExecError | null, stdout: string | Buffer, stderr: string | Buffer) => void,
): ChildProcess {
    let _args: string[] = [];
    let _opts: ExecOptions = {};
    let _callback: ((error: ExecError | null, stdout: string | Buffer, stderr: string | Buffer) => void) | undefined;

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
    // No STDIN_PIPE, for the same reason as `exec`.
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
 * Execute a file directly without shell (sync). All four Node overloads are
 * accepted, so options as the 2nd positional must not be spread into argv.
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

    const timeoutMs = _options?.timeout && _options.timeout > 0 ? _options.timeout : 0;
    const {
        stdout: stdoutBytes,
        stderr: stderrBytes,
        timedOut,
    } = _communicateSync(proc, stdinBytes, timeoutMs, _options?.killSignal);
    if (timedOut) {
        throw _syncTimeoutError(
            `${file} ${_args.join(' ')}`.trim(),
            stdoutBytes,
            stderrBytes,
            encoding,
            _options?.killSignal,
        );
    }

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
 * The `spawn(command, options)` overload is detected at the boundary so
 * `spawn('sh', { shell: true })` does not spread the options object into argv.
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
        // Node throws ERR_INVALID_ARG_TYPE for a 2nd positional that is neither
        // array nor object.
        if (typeof argsOrOptions !== 'object') {
            throw new TypeError(`The "args" argument must be of type object. Received type ${typeof argsOrOptions}`);
        }
        args = undefined;
        options = argsOrOptions;
    } else {
        args = undefined;
        options = argsOrOptions;
    }
    if (options !== undefined && options !== null && typeof options !== 'object') {
        throw new TypeError(`The "options" argument must be of type object. Received type ${typeof options}`);
    }
    if (options?.argv0 !== undefined && options.argv0 !== null && typeof options.argv0 !== 'string') {
        throw new TypeError(
            `The "options.argv0" property must be of type string. Received type ${typeof options.argv0}`,
        );
    }
    // Validate cwd HERE so a bad type throws synchronously, as Node does, instead
    // of surfacing later as a deferred 'error' event.
    if (options?.cwd !== undefined) {
        _normalizeCwd(options.cwd);
    }
    const _args = args || [];
    const child = new ChildProcess();
    const useShell = options?.shell;

    let argv: string[];
    if (useShell) {
        // As Node does: join file + args into one command string for the shell.
        argv = shellArgv([command, ..._args].join(' '), useShell);
    } else {
        argv = [command, ..._args];
    }

    // `stdio` is supported as a subset: a single string or a three-tuple of
    // 'pipe' | 'inherit' | 'ignore', normalised per-fd so they can be mixed.
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
    // Gio's defaults are asymmetric: unflagged stdin is /dev/null, unflagged
    // stdout/stderr are INHERITED. So 'inherit' needs an explicit STDIN_INHERIT —
    // without it TTY-aware children (release-it/enquirer prompts, password
    // readers) see closed stdin and bail before any input is possible.
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

        // `child.stdin` stays null for 'inherit'/'ignore', as in Node — the child
        // uses the parent's fd or had stdin silenced at spawn time.
        if (stdioTriple[0] === 'pipe') {
            const stdinPipe = proc.get_stdin_pipe();
            if (stdinPipe) child.stdin = new GioOutputStreamWritable(stdinPipe);
        }

        const stdoutPipe = proc.get_stdout_pipe();
        if (stdoutPipe) child.stdout = new GioInputStreamReadable(stdoutPipe);

        const stderrPipe = proc.get_stderr_pipe();
        if (stderrPipe) child.stderr = new GioInputStreamReadable(stderrPipe);

        // `{ once: true }` plus explicit removal on exit, so a late abort cannot
        // fire against an already-gone child.
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
                // Deferred a microtask so subscribers attached after `spawn()`
                // returns still see the event.
                queueMicrotask(emitAbortError);
            } else {
                onAbort = emitAbortError;
                abortSignal.addEventListener('abort', onAbort, { once: true });
            }
        }

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
                // Node reports the signal NAME, but Gio hides `get_term_sig()` from
                // JS, so the REAL signal is undecodable: report what the caller
                // asked us to send, else SIGTERM (what Gio's own kill paths use).
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
                // Destroy a still-open `child.stdin` on exit, as Node's
                // `lib/internal/child_process.js` does. Without it a consumer that
                // awaits `stream.finished(child.stdin)` — execa's
                // `waitForStdioStreams` — hangs forever: nobody ends the Writable.
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

        // Microtask rather than deferEmit's setTimeout(0) — see `_execImpl`.
        queueMicrotask(() => child.emit('spawn'));
    } catch (err: unknown) {
        // Normalise the spawn-time error so consumers can match on
        // `err.code === 'ENOENT'` / `err.errno === -2` etc. The spawn-side
        // error MUST identify the real binary (`argv[0]` for non-shell,
        // `command` for shell), not the wrapping `/bin/sh`.
        const spawnFile = useShell ? command : (argv[0] ?? '');
        const spawnArgs = useShell ? _args : argv.slice(1);
        deferEmit(child, 'error', _gioErrorToNodeError(err, spawnFile, spawnArgs));
    }

    return child;
}

/** Spawn a new process (sync). Same overloads as `spawn`. */
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
            throw new TypeError(`The "args" argument must be of type object. Received type ${typeof argsOrOptions}`);
        }
        args = undefined;
        options = argsOrOptions;
    } else {
        args = undefined;
        options = argsOrOptions;
    }
    if (options !== undefined && options !== null && typeof options !== 'object') {
        throw new TypeError(`The "options" argument must be of type object. Received type ${typeof options}`);
    }
    // argv0 and cwd are validated HERE, not in `_spawnSubprocess`: the spawn below
    // is wrapped in a try/catch that turns failures into `result.error`, but Node's
    // `spawnSync` THROWS for type errors and only reports ENOENT-style failures
    // through `result.error`.
    if (options?.argv0 !== undefined && options.argv0 !== null && typeof options.argv0 !== 'string') {
        throw new TypeError(
            `The "options.argv0" property must be of type string. Received type ${typeof options.argv0}`,
        );
    }
    if (options?.cwd !== undefined) {
        _normalizeCwd(options.cwd);
    }
    const _args = args || [];
    const useShell = options?.shell;
    const input = options?.input;

    let argv: string[];
    if (useShell) {
        argv = shellArgv([command, ..._args].join(' '), useShell);
    } else {
        argv = [command, ..._args];
    }

    // `timeout` is enforced in-process by `communicateWithTimeout()`, never by the
    // GNU coreutils `timeout(1)` binary: that is absent on macOS/Windows and masks
    // the child's real pid and termination signal. See `communicate.ts`.
    const timeoutMs = options?.timeout && options.timeout > 0 ? options.timeout : 0;

    const flags =
        Gio.SubprocessFlags.STDOUT_PIPE |
        Gio.SubprocessFlags.STDERR_PIPE |
        (input ? Gio.SubprocessFlags.STDIN_PIPE : Gio.SubprocessFlags.NONE);

    // Test runners and execa rely on Node's ERR_INVALID_ARG_TYPE throw to detect
    // misuse of `input`. Cast to `unknown` so the check survives TS's narrowing.
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
    // Captured at spawn time so the pid never falls to the reap race — see
    // `_capturePidAtSpawn`.
    let spawnPid = 0;
    try {
        ({ proc, pid: spawnPid } = _spawnSubprocess(argv, flags, options));
    } catch (err: unknown) {
        // A spawn failure — usually ENOENT — is reported through `result.error`,
        // never thrown, as Node does.
        const spawnFile = useShell ? command : (argv[0] ?? '');
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
            // `proc.communicate()` blocks without iterating any main context, so no
            // timer around it could ever fire; the deadline path drives
            // `communicate_async()` on a private context instead.
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
    // Pinned explicitly for the rare case where the child exited normally in the
    // same instant the timer fired, so `get_if_signaled()` was false.
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
