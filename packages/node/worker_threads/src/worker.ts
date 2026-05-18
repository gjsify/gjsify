// Reference: Node.js lib/internal/worker.js
// Reimplemented for GJS using Gio.Subprocess (subprocess-based workers)
//
// Limitations:
// - Worker scripts must be pre-built .mjs files (no on-the-fly TypeScript)
// - Higher overhead than native threading (process spawning)
// - eval mode code must be self-contained (no bare specifier imports)
//
// Cross-process SharedBuffer:
// - At spawn time, the parent creates a SOCK_SEQPACKET socketpair via
//   @gjsify/sab-native's FdChannel and passes the child end as inherited
//   fd 3 (Gio.SubprocessLauncher.take_fd). The parent retains the other
//   end for sending fds via SCM_RIGHTS.
// - postMessage walks the value tree for SharedBuffer instances, sends
//   each fd over the side-channel with a sequence-allocated tag, and
//   serialises a {__sab: tag, size: N} placeholder in the JSON message.
// - The child bootstrap drains fds from fd 3 into a Map<tag, fd> and
//   materialises placeholders into SharedBuffer.fromFd(fd, size) before
//   dispatching the message to user code.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { EventEmitter } from 'node:events';
import { fdChannel } from '@gjsify/sab-native';
import { extractSharedBuffers } from './sab-transfer.js';

let _nextThreadId = 1;
const _encoder = new TextEncoder();

// GJS worker bootstrap script — runs in the child gjs process,
// sets up IPC via stdin/stdout pipes using gi:// imports.
//
// SharedBuffer side-channel: when init.sabSocketFd is a valid fd
// (always 3 in our spawn setup — child end of the parent's FdChannel
// socketpair), each JSON-side message that carries SharedBuffer
// placeholders is paired with exactly N preceding SCM_RIGHTS sends on
// fd 3. The parent always sends fds BEFORE writing the JSON line, and
// kernel buffering guarantees the fds are sitting in the side-channel
// socket buffer by the time the child reads the JSON. So after parsing
// each incoming message we count placeholders, call recv_fd that many
// times synchronously (returns immediately because data is ready),
// then materialise.
//
// Loading @gjsify/sab-native: the bootstrap can't `import` it (no
// module-resolution context in the spawned gjs -m), so it pulls the
// typelib directly via `imports.gi.GjsifySabNative` — same lazy
// pattern as the TS facade. If the typelib isn't on
// GI_TYPELIB_PATH (sab-native prebuild absent), the recv-loop stays
// dormant and any incoming __sab placeholder will fail loudly when
// resolveTag throws.
const BOOTSTRAP_CODE = `\
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const loop = new GLib.MainLoop(null, false);
const stdinStream = Gio.UnixInputStream.new(0, false);
const dataIn = Gio.DataInputStream.new(stdinStream);
const stdoutStream = Gio.UnixOutputStream.new(1, false);

const _encoder = new TextEncoder();

function send(obj) {
  const line = JSON.stringify(obj) + '\\n';
  stdoutStream.write_all(_encoder.encode(line), null);
}

// Try to load the sab-native typelib synchronously. Absent prebuild
// is fine — only fails the receive path when a SharedBuffer actually
// crosses the wire.
let SabNative = null;
try { SabNative = imports.gi.GjsifySabNative; } catch (_) { /* prebuild missing */ }

// Read init data (first line, blocking)
const [initLine] = dataIn.read_line_utf8(null);
const init = JSON.parse(initLine);

// fd → SharedBuffer cache keyed by tag. Filled by drainSabFds() right
// before materialise() walks the parsed JSON.
const sabFds = new Map();

// Count how many SharedBuffer placeholders sit in a parsed JSON value.
// The exact count is what we pass to drainSabFds().
function countSabPlaceholders(value) {
  if (value === null || typeof value !== 'object') return 0;
  if (typeof value.__sab === 'number' && typeof value.size === 'number') return 1;
  if (Array.isArray(value)) {
    let n = 0;
    for (const v of value) n += countSabPlaceholders(v);
    return n;
  }
  if (Object.prototype.toString.call(value) === '[object Object]') {
    let n = 0;
    for (const v of Object.values(value)) n += countSabPlaceholders(v);
    return n;
  }
  return 0;
}

// Synchronously drain exactly @count SCM_RIGHTS messages from fd 3,
// indexing each received fd by its sender-encoded tag. Called once per
// incoming JSON message that contains __sab placeholders. recv_fd
// blocks at most until the kernel has the message — and the sender
// always sends fds before writing to stdin, so by the time we get
// here every fd is already buffered.
function drainSabFds(count) {
  if (!SabNative || count <= 0) return;
  for (let i = 0; i < count; i++) {
    const [fd, tag] = SabNative.FdChannel.recv_fd(3);
    if (fd <= 0) throw new Error('FdChannel.recv_fd returned ' + fd + ' while draining ' + count + ' fds');
    sabFds.set(tag, fd);
  }
}

function materialise(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.__sab === 'number' && typeof value.size === 'number') {
    const fd = sabFds.get(value.__sab);
    if (fd === undefined) throw new Error('SharedBuffer placeholder \\'' + value.__sab + '\\' arrived before its fd');
    if (!SabNative) throw new Error('SharedBuffer placeholder arrived but @gjsify/sab-native typelib not loaded');
    const native = SabNative.SharedBuffer.from_fd(fd, value.size);
    sabFds.delete(value.__sab);
    return makeSharedBuffer(native);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = materialise(value[i]);
    return value;
  }
  if (Object.prototype.toString.call(value) === '[object Object]') {
    for (const k of Object.keys(value)) value[k] = materialise(value[k]);
    return value;
  }
  return value;
}

function makeSharedBuffer(native) {
  return {
    get byteLength() { return native.byte_length; },
    get fd() { return native.fd; },
    getUint8(off) { return native.get_u8(off); },
    setUint8(off, v) { native.set_u8(off, v); },
    getInt32LE(off) { return native.get_i32_le(off); },
    setInt32LE(off, v) { native.set_i32_le(off, v); },
    getUint32LE(off) { return native.get_u32_le(off); },
    setUint32LE(off, v) { native.set_u32_le(off, v); },
    getUint64LE(off) { return native.get_u64_le(off); },
    setUint64LE(off, v) { native.set_u64_le(off, v); },
    readBytes(off, len) {
      const bytes = native.read_bytes(off, len);
      const data = bytes.get_data();
      return data ? new Uint8Array(data) : new Uint8Array(0);
    },
    writeBytes(off, data) { native.write_bytes(off, new GLib.Bytes(data)); },
    get _nativeHandle() { return native; },
    get constructor() { return { name: 'SharedBuffer' }; },
  };
}

// Drain SharedBuffer fds attached to the init line (workerData may carry
// SharedBuffer instances) before materialise() runs against it.
if (init.sabSocketFd === 3) {
  try {
    drainSabFds(countSabPlaceholders(init.workerData));
  } catch (err) {
    send({ type: 'error', message: 'init fd drain failed: ' + (err && err.message ? err.message : err), stack: '' });
  }
}

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
  workerData: materialise(init.workerData ?? null),
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
      if (msg.type === 'message') {
        // Drain fds for any SharedBuffer placeholders BEFORE materialise.
        // recv_fd is synchronous but the sender always wrote the SCM_RIGHTS
        // messages before writing this stdin line, so they're already
        // buffered.
        if (init.sabSocketFd === 3) drainSabFds(countSabPlaceholders(msg.data));
        parentPort.emit('message', materialise(msg.data));
      }
      else if (msg.type === 'terminate') { send({ type: 'exit', code: 1 }); loop.quit(); return; }
      readNext();
    } catch (err) {
      send({ type: 'error', message: 'bootstrap message error: ' + (err && err.message ? err.message : err), stack: err && err.stack || '' });
      loop.quit();
    }
  });
}
readNext();

// Execute worker code
try {
  if (init.eval) {
    const AsyncFn = Object.getPrototypeOf(async function(){}).constructor;
    await new AsyncFn('parentPort', 'workerData', 'threadId', init.code)(
      parentPort, globalThis.__gjsify_worker_context.workerData, init.threadId
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
  /** Parent-side end of the SCM_RIGHTS side-channel for SharedBuffer fds.
   *  -1 when sab-native's prebuild isn't loaded → SharedBuffer transfer is
   *  unavailable but everything else works. Closed in `_cleanup()`. */
  private _sabSocketFd = -1;
  /** Per-Worker sequence counter for SharedBuffer transfer tags. Resets
   *  to 0 at spawn; each postMessage call increments it by the number of
   *  unique SharedBuffer instances in the value tree. */
  private _sabNextTag = 0;

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

    // SharedBuffer side-channel: create a SOCK_SEQPACKET socketpair via
    // @gjsify/sab-native and pass the child end as inherited fd 3 (the
    // bootstrap recv-loop checks for that fd explicitly). Quiet no-op when
    // sab-native's prebuild is unavailable — SharedBuffer transfer just
    // stays unsupported in that case (matches the prior "no SAB" status).
    let sabChildFd = -1;
    if (fdChannel) {
      const pair = fdChannel.makePair();
      if (pair) {
        this._sabSocketFd = pair.parentFd;
        sabChildFd = pair.childFd;
        // `take_fd(source_fd, target_fd)` transfers ownership of source_fd
        // to the launcher; on spawn it dup2's onto target_fd in the child.
        launcher.take_fd(sabChildFd, 3);
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

    // Walk workerData for SharedBuffer instances + route their fds over
    // the SCM_RIGHTS channel before the JSON init line lands on stdin,
    // exactly like postMessage does for subsequent messages. This makes
    // `workerData = { sab }` work at construction time.
    const initWorkerData = this._serializeWithSabTransfer(options?.workerData ?? null);

    const initData = JSON.stringify({
      threadId: this.threadId,
      workerData: initWorkerData,
      eval: isEval,
      filename: isEval ? undefined : resolvedFilename,
      code: isEval ? resolvedFilename : undefined,
      sabSocketFd: this._sabSocketFd !== -1 ? 3 : -1,
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
      // _serializeWithSabTransfer walks for SharedBuffer instances and
      // sends each fd over the SCM_RIGHTS channel BEFORE we write the
      // JSON line — the child's recv-loop populates its fd map first,
      // then materialise() finds every tag when the JSON arrives. The
      // ordering is load-bearing: kernel guarantees ordered delivery
      // within each fd (stdin, side-channel) but the two fds are
      // independent.
      const serialised = this._serializeWithSabTransfer(value);
      const line = JSON.stringify({ type: 'message', data: serialised }) + '\n';
      this._stdinPipe.write_all(_encoder.encode(line), null);
    } catch {
      // Worker stdin closed
    }
  }

  /**
   * Walk `value` for SharedBuffer instances, ship each fd over the
   * parent-side end of the FdChannel socketpair, return the placeholder-
   * substituted tree ready to JSON-serialise. No-op (returns value
   * untouched) when sab-native's prebuild isn't loaded or the side-
   * channel was never opened.
   */
  private _serializeWithSabTransfer(value: unknown): unknown {
    if (!fdChannel || this._sabSocketFd === -1) return value;
    const { value: substituted, table, nextTag } = extractSharedBuffers(value, this._sabNextTag);
    this._sabNextTag = nextTag;
    for (const { tag, buffer } of table) {
      const ok = fdChannel.sendFd(this._sabSocketFd, buffer.fd, tag);
      if (!ok) {
        // Side-channel failure is fatal for this transfer — surface as a
        // SharedBuffer-specific error rather than silently dropping the
        // placeholder, which would leave the child looking for a fd that
        // never arrives.
        throw new Error(`Failed to send SharedBuffer fd over worker side-channel (tag ${tag})`);
      }
    }
    return substituted;
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
    if (this._sabSocketFd !== -1 && fdChannel?.closeFd) {
      try { fdChannel.closeFd(this._sabSocketFd); } catch {}
      this._sabSocketFd = -1;
    }
    this._subprocess = null;
  }
}
