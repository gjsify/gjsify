// Node.js child_process module for GJS
// Uses Gio.Subprocess for process spawning
// Reference: Node.js lib/child_process.js

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import type { Writable } from 'node:stream';
import { gbytesToUint8Array, deferEmit, ensureMainLoop } from '@gjsify/utils';

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

interface ExecError extends Error {
  status?: number;
  code?: number | string;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  encoding?: BufferEncoding | 'buffer';
  shell?: string | boolean;
  timeout?: number;
  maxBuffer?: number;
  killSignal?: string | number;
  uid?: number;
  gid?: number;
  windowsHide?: boolean;
}

export interface ExecSyncOptions {
  cwd?: string;
  env?: Record<string, string>;
  encoding?: BufferEncoding | 'buffer';
  shell?: string | boolean;
  timeout?: number;
  maxBuffer?: number;
  killSignal?: string | number;
  stdio?: string | string[];
  input?: string | Buffer | Uint8Array;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdio?: string | string[];
  shell?: string | boolean;
  timeout?: number;
  killSignal?: string | number;
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

  private _subprocess: Gio.Subprocess | null = null;

  /** @internal Set the underlying Gio.Subprocess and extract PID. */
  _setSubprocess(proc: Gio.Subprocess): void {
    this._subprocess = proc;
    const pid = proc.get_identifier();
    if (pid) this.pid = parseInt(pid, 10);
  }

  /** Send a signal to the child process. */
  kill(signal?: string | number): boolean {
    if (!this._subprocess) return false;
    try {
      if (signal === 'SIGKILL' || signal === 9) {
        this._subprocess.force_exit();
      } else {
        this._subprocess.send_signal(typeof signal === 'number' ? signal : 15);
      }
      this.killed = true;
      return true;
    } catch {
      return false;
    }
  }

  ref(): this { return this; }
  unref(): this { return this; }
}

// Create a Gio.Subprocess with cwd and env support via SubprocessLauncher.
function _spawnSubprocess(
  argv: string[],
  flags: Gio.SubprocessFlags,
  options?: { cwd?: string; env?: Record<string, string> }
): Gio.Subprocess {
  const launcher = new Gio.SubprocessLauncher({ flags });
  if (options?.cwd) {
    launcher.set_cwd(options.cwd);
  }
  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      launcher.setenv(key, value, true);
    }
  }
  return launcher.spawnv(argv);
}

// Execute a command in a shell and buffer the output (sync).
export function execSync(command: string, options?: ExecSyncOptions): Buffer | string {
  const encoding = options?.encoding;
  const input = options?.input;

  const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    | (input ? Gio.SubprocessFlags.STDIN_PIPE : Gio.SubprocessFlags.NONE);

  const shell = typeof options?.shell === 'string' ? options.shell : '/bin/sh';
  const proc = _spawnSubprocess([shell, '-c', command], flags, options);

  const stdinBytes = input
    ? new GLib.Bytes(typeof input === 'string' ? new TextEncoder().encode(input) : input)
    : null;

  const [, stdoutBytes, stderrBytes] = proc.communicate(stdinBytes, null);

  const status = proc.get_exit_status();
  if (status !== 0) {
    const stderrStr = stderrBytes
      ? new TextDecoder().decode(gbytesToUint8Array(stderrBytes))
      : '';
    const error = new Error(`Command failed: ${command}\n${stderrStr}`) as ExecError;
    error.status = status;
    error.stderr = stderrStr;
    error.stdout = stdoutBytes
      ? new TextDecoder().decode(gbytesToUint8Array(stdoutBytes))
      : '';
    throw error;
  }

  if (!stdoutBytes) return encoding && encoding !== 'buffer' ? '' : Buffer.alloc(0);
  const data = gbytesToUint8Array(stdoutBytes);
  if (encoding && encoding !== 'buffer') {
    return new TextDecoder().decode(data);
  }
  return Buffer.from(data);
}

/**
 * Execute a command in a shell (async with callback).
 */
function _exec(
  command: string,
  options?: ExecOptions | ((error: Error | null, stdout: string, stderr: string) => void),
  callback?: (error: Error | null, stdout: string, stderr: string) => void,
): ChildProcess {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const opts = (options || {}) as ExecOptions;
  const child = new ChildProcess();

  const shell = typeof opts.shell === 'string' ? opts.shell : '/bin/sh';
  const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;

  try {
    const proc = _spawnSubprocess([shell, '-c', command], flags, opts);
    child._setSubprocess(proc);
    ensureMainLoop();

    proc.communicate_utf8_async(null, null, (_source: Gio.Subprocess | null, result: Gio.AsyncResult) => {
      try {
        const [, stdout, stderr] = proc.communicate_utf8_finish(result);
        const exitStatus = proc.get_exit_status();
        child.exitCode = exitStatus;

        if (exitStatus !== 0) {
          const error = new Error(`Command failed: ${command}`) as ExecError;
          error.code = exitStatus;
          error.killed = child.killed;
          error.stdout = stdout || '';
          error.stderr = stderr || '';
          if (callback) callback(error, stdout || '', stderr || '');
        } else {
          if (callback) callback(null, stdout || '', stderr || '');
        }

        child.emit('close', exitStatus, null);
        child.emit('exit', exitStatus, null);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (callback) callback(error, '', '');
        child.emit('error', error);
      }
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    setTimeout(() => {
      if (callback) callback(error, '', '');
      child.emit('error', error);
    }, 0);
  }

  return child;
}

export { _exec as exec };

/**
 * Execute a file directly without shell (async).
 */
export function execFile(
  file: string,
  args?: string[] | ((error: Error | null, stdout: string, stderr: string) => void),
  options?: ExecOptions | ((error: Error | null, stdout: string, stderr: string) => void),
  callback?: (error: Error | null, stdout: string, stderr: string) => void,
): ChildProcess {
  let _args: string[] = [];
  let _opts: ExecOptions = {};
  let _callback: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;

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
  }

  const child = new ChildProcess();
  const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;

  try {
    const proc = _spawnSubprocess([file, ..._args], flags, _opts);
    child._setSubprocess(proc);
    ensureMainLoop();

    proc.communicate_utf8_async(null, null, (_source: Gio.Subprocess | null, result: Gio.AsyncResult) => {
      try {
        const [, stdout, stderr] = proc.communicate_utf8_finish(result);
        const exitStatus = proc.get_exit_status();
        child.exitCode = exitStatus;

        if (exitStatus !== 0) {
          const error = new Error(`Command failed: ${file}`) as ExecError;
          error.code = exitStatus;
          error.stdout = stdout || '';
          error.stderr = stderr || '';
          if (_callback) _callback(error, stdout || '', stderr || '');
        } else {
          if (_callback) _callback(null, stdout || '', stderr || '');
        }

        child.emit('close', exitStatus, null);
        child.emit('exit', exitStatus, null);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (_callback) _callback(error, '', '');
        child.emit('error', error);
      }
    });
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    setTimeout(() => {
      if (_callback) _callback(error, '', '');
      child.emit('error', error);
    }, 0);
  }

  return child;
}

/**
 * Execute a file directly without shell (sync).
 */
export function execFileSync(file: string, args?: string[], options?: ExecSyncOptions): Buffer | string {
  const _args = args || [];
  const encoding = options?.encoding;
  const input = options?.input;

  const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    | (input ? Gio.SubprocessFlags.STDIN_PIPE : Gio.SubprocessFlags.NONE);

  const proc = _spawnSubprocess([file, ..._args], flags, options);

  const stdinBytes = input
    ? new GLib.Bytes(typeof input === 'string' ? new TextEncoder().encode(input) : input)
    : null;

  const [, stdoutBytes, stderrBytes] = proc.communicate(stdinBytes, null);

  const status = proc.get_exit_status();
  if (status !== 0) {
    const stderrStr = stderrBytes
      ? new TextDecoder().decode(gbytesToUint8Array(stderrBytes))
      : '';
    const error = new Error(`Command failed: ${file} ${_args.join(' ')}`) as ExecError;
    error.status = status;
    error.stderr = stderrStr;
    throw error;
  }

  if (!stdoutBytes) return encoding && encoding !== 'buffer' ? '' : Buffer.alloc(0);
  const data = gbytesToUint8Array(stdoutBytes);
  if (encoding && encoding !== 'buffer') {
    return new TextDecoder().decode(data);
  }
  return Buffer.from(data);
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
  } else {
    args = undefined;
    options = argsOrOptions;
  }
  const _args = args || [];
  const child = new ChildProcess();
  const useShell = options?.shell;

  let argv: string[];
  if (useShell) {
    const shell = typeof useShell === 'string' ? useShell : '/bin/sh';
    const fullCmd = [command, ..._args].join(' ');
    argv = [shell, '-c', fullCmd];
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
  if (stdioTriple[0] === 'pipe') flags |= Gio.SubprocessFlags.STDIN_PIPE;
  if (stdioTriple[1] === 'pipe') flags |= Gio.SubprocessFlags.STDOUT_PIPE;
  if (stdioTriple[1] === 'ignore') flags |= Gio.SubprocessFlags.STDOUT_SILENCE;
  if (stdioTriple[2] === 'pipe') flags |= Gio.SubprocessFlags.STDERR_PIPE;
  if (stdioTriple[2] === 'ignore') flags |= Gio.SubprocessFlags.STDERR_SILENCE;

  try {
    const proc = _spawnSubprocess(argv, flags, options);
    child._setSubprocess(proc);
    _activeProcesses.add(child);

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

    ensureMainLoop();
    proc.wait_async(null, (_source: Gio.Subprocess | null, result: Gio.AsyncResult) => {
      try {
        proc.wait_finish(result);
        const exitStatus = proc.get_if_exited() ? proc.get_exit_status() : null;
        const signal = proc.get_if_signaled() ? 'SIGTERM' : null;
        child.exitCode = exitStatus;
        child.signalCode = signal;
        if (abortSignal && onAbort) {
          abortSignal.removeEventListener('abort', onAbort);
        }
        child.emit('exit', exitStatus, signal);
        child.emit('close', exitStatus, signal);
      } catch (err: unknown) {
        child.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
      _activeProcesses.delete(child);
    });

    deferEmit(child, 'spawn');
  } catch (err: unknown) {
    deferEmit(child, 'error', err instanceof Error ? err : new Error(String(err)));
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
  } else {
    args = undefined;
    options = argsOrOptions;
  }
  const _args = args || [];
  const useShell = options?.shell;
  const input = options?.input;

  let argv: string[];
  if (useShell) {
    const shell = typeof useShell === 'string' ? useShell : '/bin/sh';
    const fullCmd = [command, ..._args].join(' ');
    argv = [shell, '-c', fullCmd];
  } else {
    argv = [command, ..._args];
  }

  const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    | (input ? Gio.SubprocessFlags.STDIN_PIPE : Gio.SubprocessFlags.NONE);

  try {
    const proc = _spawnSubprocess(argv, flags, options);
    const pid = proc.get_identifier();

    const stdinBytes = input
      ? new GLib.Bytes(typeof input === 'string' ? new TextEncoder().encode(input) : input)
      : null;

    const [, stdoutBytes, stderrBytes] = proc.communicate(stdinBytes, null);

    const stdoutBuf = stdoutBytes ? Buffer.from(gbytesToUint8Array(stdoutBytes)) : Buffer.alloc(0);
    const stderrBuf = stderrBytes ? Buffer.from(gbytesToUint8Array(stderrBytes)) : Buffer.alloc(0);

    const encoding = options?.encoding;
    const stdoutData: Buffer | string = encoding && encoding !== 'buffer' ? new TextDecoder().decode(stdoutBuf) : stdoutBuf;
    const stderrData: Buffer | string = encoding && encoding !== 'buffer' ? new TextDecoder().decode(stderrBuf) : stderrBuf;

    const status = proc.get_if_exited() ? proc.get_exit_status() : null;
    const signal = proc.get_if_signaled() ? 'SIGTERM' : null;

    return {
      pid: pid ? parseInt(pid, 10) : 0,
      output: [null, stdoutData, stderrData],
      stdout: stdoutData,
      stderr: stderrData,
      status,
      signal,
    };
  } catch (err: unknown) {
    const empty: Buffer | string = options?.encoding && options.encoding !== 'buffer' ? '' : Buffer.alloc(0);
    return {
      pid: 0,
      output: [null, empty, empty],
      stdout: empty,
      stderr: empty,
      status: null,
      signal: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
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
