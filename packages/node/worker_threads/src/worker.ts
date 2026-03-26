// Reference: Node.js lib/internal/worker.js
// Reimplemented for GJS using Gio.Subprocess (subprocess-based workers)
//
// Limitations:
// - No shared memory (SharedArrayBuffer not supported across processes)
// - Worker scripts must be pre-built .mjs files (no on-the-fly TypeScript)
// - Higher overhead than native threading (process spawning)
// - eval mode code must be self-contained (no bare specifier imports)

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'node:events';

let _nextThreadId = 1;
const _encoder = new TextEncoder();

// GJS worker bootstrap script — runs in the child gjs process,
// sets up IPC via stdin/stdout pipes using gi:// imports.
const BOOTSTRAP_CODE = `\
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const loop = new GLib.MainLoop(null, false);
const stdinStream = Gio.UnixInputStream.new(0, false);
const dataIn = Gio.DataInputStream.new(stdinStream);
const stdoutStream = Gio.UnixOutputStream.new(1, false);

function send(obj) {
  const line = JSON.stringify(obj) + '\\n';
  stdoutStream.write_all(_encoder.encode(line), null);
}

// Read init data (first line, blocking)
const [initLine] = dataIn.read_line_utf8(null);
const init = JSON.parse(initLine);

// Simplified EventEmitter for parentPort
const _listeners = new Map();
const parentPort = {
  on(ev, fn) {
    if (!_listeners.has(ev)) _listeners.set(ev, []);
    _listeners.get(ev).push(fn);
    return this;
  },
  once(ev, fn) {
    const w = (...a) => { parentPort.off(ev, w); fn(...a); };
    return parentPort.on(ev, w);
  },
  off(ev, fn) {
    const a = _listeners.get(ev);
    if (a) _listeners.set(ev, a.filter(f => f !== fn));
    return this;
  },
  emit(ev, ...a) { (_listeners.get(ev) || []).forEach(fn => fn(...a)); },
  postMessage(data) { send({ type: 'message', data }); },
  close() { send({ type: 'exit', code: 0 }); loop.quit(); },
  removeAllListeners(ev) {
    if (ev) _listeners.delete(ev); else _listeners.clear();
    return this;
  },
};

// Set worker context globals (read by @gjsify/worker_threads when imported by user script)
globalThis.__gjsify_worker_context = {
  isMainThread: false,
  parentPort,
  workerData: init.workerData ?? null,
  threadId: init.threadId ?? 0,
};

send({ type: 'online' });

// Async stdin reader for messages from parent
function readNext() {
  dataIn.read_line_async(GLib.PRIORITY_DEFAULT, null, (source, result) => {
    try {
      const [line] = source.read_line_finish_utf8(result);
      if (line === null) { loop.quit(); return; }
      const msg = JSON.parse(line);
      if (msg.type === 'message') parentPort.emit('message', msg.data);
      else if (msg.type === 'terminate') { send({ type: 'exit', code: 1 }); loop.quit(); return; }
      readNext();
    } catch { loop.quit(); }
  });
}
readNext();

// Execute worker code
try {
  if (init.eval) {
    const AsyncFn = Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFn('parentPort', 'workerData', 'threadId', init.code)(
      parentPort, init.workerData, init.threadId
    );
  } else {
    await import(init.filename);
  }
} catch (error) {
  send({ type: 'error', message: error.message, stack: error.stack || '' });
}

loop.run();
`;

const BOOTSTRAP_BYTES = _encoder.encode(BOOTSTRAP_CODE);

export interface WorkerOptions {
  argv?: unknown[];
  env?: Record<string, string> | symbol;
  execArgv?: string[];
  stdin?: boolean;
  stdout?: boolean;
  stderr?: boolean;
  workerData?: unknown;
  eval?: boolean;
  transferList?: unknown[];
  resourceLimits?: Record<string, number>;
  name?: string;
}

export class Worker extends EventEmitter {
  readonly threadId: number;
  readonly resourceLimits: Record<string, unknown>;

  private _subprocess: Gio.Subprocess | null = null;
  private _stdinPipe: Gio.OutputStream | null = null;
  private _exited = false;
  private _bootstrapFile: Gio.File | null = null;

  constructor(filename: string | URL, options?: WorkerOptions) {
    super();
    this.threadId = _nextThreadId++;
    this.resourceLimits = options?.resourceLimits || {};

    const isEval = options?.eval === true;
    const resolvedFilename = Worker._resolveFilename(filename, isEval);

    // Write bootstrap script to temp file
    const tmpDir = GLib.get_tmp_dir();
    const bootstrapPath = `${tmpDir}/gjsify-worker-${this.threadId}-${Date.now()}.mjs`;
    this._bootstrapFile = Gio.File.new_for_path(bootstrapPath);

    try {
      this._bootstrapFile.replace_contents(
        BOOTSTRAP_BYTES,
        null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null
      );
    } catch (err) {
      throw new Error(`Failed to create worker bootstrap: ${err instanceof Error ? err.message : err}`);
    }

    // Spawn GJS subprocess
    const launcher = new Gio.SubprocessLauncher({
      flags: Gio.SubprocessFlags.STDIN_PIPE
        | Gio.SubprocessFlags.STDOUT_PIPE
        | Gio.SubprocessFlags.STDERR_PIPE,
    });

    if (options?.env && typeof options.env === 'object') {
      for (const [key, value] of Object.entries(options.env as Record<string, string>)) {
        launcher.setenv(key, String(value), true);
      }
    }

    try {
      this._subprocess = launcher.spawnv(['gjs', '-m', bootstrapPath]);
    } catch (err) {
      this._cleanup();
      throw new Error(`Failed to spawn worker: ${err instanceof Error ? err.message : err}`);
    }

    this._stdinPipe = this._subprocess.get_stdin_pipe();
    const stdoutPipe = this._subprocess.get_stdout_pipe();

    // Verify file exists for non-eval workers
    if (!isEval) {
      const filePath = resolvedFilename.startsWith('file://')
        ? resolvedFilename.slice(7)
        : resolvedFilename;
      const file = Gio.File.new_for_path(filePath);
      if (!file.query_exists(null)) {
        this._cleanup();
        const err = new Error(`Cannot find module '${filePath}'`);
        (err as any).code = 'ERR_MODULE_NOT_FOUND';
        // Emit error asynchronously to match Node.js behavior
        Promise.resolve().then(() => {
          this.emit('error', err);
          this._exited = true;
          this.emit('exit', 1);
        });
        // Return early — subprocess was already cleaned up
        return;
      }
    }

    // Send init data as first line on stdin
    const initData = JSON.stringify({
      threadId: this.threadId,
      workerData: options?.workerData ?? null,
      eval: isEval,
      filename: isEval ? undefined : resolvedFilename,
      code: isEval ? resolvedFilename : undefined,
    }) + '\n';

    try {
      this._stdinPipe!.write_all(_encoder.encode(initData), null);
    } catch (err) {
      this._cleanup();
      throw new Error(`Failed to send init data: ${err instanceof Error ? err.message : err}`);
    }

    // Read IPC messages from subprocess stdout
    if (stdoutPipe) {
      const dataStream = Gio.DataInputStream.new(stdoutPipe);
      this._readMessages(dataStream);
    }

    // Read stderr for error reporting
    const stderrPipe = this._subprocess.get_stderr_pipe();
    if (stderrPipe) {
      this._readStderr(Gio.DataInputStream.new(stderrPipe));
    }

    // Wait for process exit
    this._subprocess.wait_async(null, () => {
      this._onExit();
    });
  }

  postMessage(value: unknown, _transferList?: unknown[]): void {
    if (this._exited || !this._stdinPipe) return;
    try {
      const line = JSON.stringify({ type: 'message', data: value }) + '\n';
      this._stdinPipe.write_all(_encoder.encode(line), null);
    } catch {
      // Worker stdin closed
    }
  }

  terminate(): Promise<number> {
    if (this._exited) return Promise.resolve(0);

    // Register listener before sending terminate to avoid race
    const exitPromise = new Promise<number>((resolve) => {
      this.once('exit', (code: number) => resolve(code));
    });

    // Send terminate command
    try {
      if (this._stdinPipe) {
        const msg = JSON.stringify({ type: 'terminate' }) + '\n';
        this._stdinPipe.write_all(_encoder.encode(msg), null);
      }
    } catch {}

    // Force-exit after timeout
    setTimeout(() => {
      if (!this._exited && this._subprocess) {
        this._subprocess.force_exit();
      }
    }, 500);

    return exitPromise;
  }

  ref(): this { return this; }
  unref(): this { return this; }

  /**
   * Resolve a worker filename to an absolute path or file:// URL.
   *
   * - URL instances → href string
   * - file:// URLs → kept as-is
   * - Absolute paths → converted to file:// URL
   * - Relative paths (./foo, ../bar) → resolved relative to cwd, converted to file:// URL
   * - eval mode → returned as-is (it's code, not a path)
   */
  private static _resolveFilename(filename: string | URL, isEval: boolean): string {
    if (isEval) return String(filename);

    if (filename instanceof URL) return filename.href;

    const str = String(filename);

    // Already a URL
    if (str.startsWith('file://') || str.startsWith('http://') || str.startsWith('https://')) {
      return str;
    }

    // Absolute path → file:// URL
    if (str.startsWith('/')) {
      return 'file://' + str;
    }

    // Relative path → resolve from cwd
    if (str.startsWith('./') || str.startsWith('../') || !str.includes('/')) {
      const cwd = GLib.get_current_dir();
      const resolved = GLib.build_filenamev([cwd, str]);
      // Canonicalize (resolve ./ and ../)
      const file = Gio.File.new_for_path(resolved);
      const canonical = file.get_path();
      return 'file://' + (canonical || resolved);
    }

    // Fallback — treat as absolute
    return 'file://' + str;
  }

  private _readMessages(dataStream: Gio.DataInputStream): void {
    dataStream.read_line_async(
      GLib.PRIORITY_DEFAULT,
      null,
      (_source: unknown, result: Gio.AsyncResult) => {
        try {
          const [line] = dataStream.read_line_finish_utf8(result);
          if (line === null) return; // EOF

          const msg = JSON.parse(line);
          switch (msg.type) {
            case 'online':
              this.emit('online');
              break;
            case 'message':
              this.emit('message', msg.data);
              break;
            case 'error': {
              const err = new Error(msg.message);
              if (msg.stack) err.stack = msg.stack;
              this.emit('error', err);
              break;
            }
          }

          this._readMessages(dataStream);
        } catch {
          // Stream closed or parse error
        }
      },
    );
  }

  private _stderrChunks: string[] = [];

  private _readStderr(dataStream: Gio.DataInputStream): void {
    dataStream.read_line_async(
      GLib.PRIORITY_DEFAULT,
      null,
      (_source: unknown, result: Gio.AsyncResult) => {
        try {
          const [line] = dataStream.read_line_finish_utf8(result);
          if (line === null) {
            // EOF — if we collected stderr output and worker errored, emit it
            if (this._stderrChunks.length > 0) {
              const stderrText = this._stderrChunks.join('\n');
              // Only emit if no IPC error was already emitted
              if (this.listenerCount('error') === 0) {
                this.emit('error', new Error(stderrText));
              }
            }
            return;
          }
          this._stderrChunks.push(line);
          this._readStderr(dataStream);
        } catch {
          // Stream closed
        }
      },
    );
  }

  private _onExit(): void {
    if (this._exited) return;
    this._exited = true;

    const exitCode = this._subprocess?.get_if_exited()
      ? this._subprocess.get_exit_status()
      : 1;

    this._cleanup();
    this.emit('exit', exitCode);
  }

  private _cleanup(): void {
    if (this._bootstrapFile) {
      try { this._bootstrapFile.delete(null); } catch {}
      this._bootstrapFile = null;
    }
    if (this._stdinPipe) {
      try { this._stdinPipe.close(null); } catch {}
      this._stdinPipe = null;
    }
    this._subprocess = null;
  }
}
