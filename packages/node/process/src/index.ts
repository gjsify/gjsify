// Reference: Node.js lib/internal/process/*.js
// Reimplemented for GJS using GLib (env, paths, platform detection) and EventEmitter

import { EventEmitter } from '@gjsify/events';
import { ensureMainLoop, quitMainLoop } from '@gjsify/utils';
import { nativeTerminal } from '@gjsify/terminal-native';

const _encoder = new TextEncoder();

type ProcessPlatform = NodeJS.Platform;
type ProcessArch = NodeJS.Architecture;

// GJS-specific global type for accessing GNOME libraries
interface GjsGlobalThis {
  imports?: {
    gi?: {
      GLib?: Record<string, Function>;
      [key: string]: unknown;
    };
    system?: {
      programArgs?: string[];
      programInvocationName?: string;
      exit?: (code: number) => never;
      version?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

function getGjsGlobal(): GjsGlobalThis {
  return globalThis as unknown as GjsGlobalThis;
}

function detectGjsVersion(): string | undefined {
  try {
    const system = getGjsGlobal().imports?.system;
    if (system?.version !== undefined) {
      const v = Number(system.version);
      const major = Math.floor(v / 10000);
      const minor = Math.floor((v % 10000) / 100);
      const patch = v % 100;
      return `${major}.${minor}.${patch}`;
    }
  } catch { /* ignore */ }
  return undefined;
}

function detectNodeVersion(): string | undefined {
  if (typeof globalThis.process?.versions?.node === 'string') {
    return globalThis.process.versions.node;
  }
  return undefined;
}

function detectVersionInfo(): { version: string; versions: Record<string, string>; title: string } {
  const nodeVersion = detectNodeVersion();

  if (nodeVersion) {
    // Running on Node.js — use native values
    return {
      version: globalThis.process.version,
      versions: { ...globalThis.process.versions } as Record<string, string>,
      title: globalThis.process?.title || 'node',
    };
  }

  // Running on GJS
  const gjsVersion = detectGjsVersion();
  const versions: Record<string, string> = {
    node: '20.0.0', // Compatibility version — many npm packages check process.versions.node
  };
  if (gjsVersion) versions.gjs = gjsVersion;

  return {
    version: 'v20.0.0', // Compatibility version for Node.js API level checks
    versions,
    title: 'gjs',
  };
}

function detectPpid(): number {
  if (typeof globalThis.process?.ppid === 'number') {
    return globalThis.process.ppid;
  }
  try {
    const GLib = getGjsGlobal().imports?.gi?.GLib;
    if (GLib) {
      const [, contents] = GLib.file_get_contents('/proc/self/status');
      if (contents) {
        const str = new TextDecoder().decode(contents);
        const match = str.match(/PPid:\s+(\d+)/);
        if (match) return parseInt(match[1], 10);
      }
    }
  } catch { /* ignore */ }
  return 0;
}

function detectPlatform(): ProcessPlatform {
  try {
    const GLib = getGjsGlobal().imports?.gi?.GLib;
    if (GLib) {
      const osInfo = GLib.get_os_info('ID');
      if (osInfo) return 'linux';
    }
  } catch { /* ignore */ }

  if (typeof getGjsGlobal().imports?.system !== 'undefined') {
    return 'linux';
  }

  if (typeof globalThis.process?.platform === 'string') {
    return globalThis.process.platform as ProcessPlatform;
  }

  return 'linux';
}

function detectArch(): ProcessArch {
  if (typeof globalThis.process?.arch === 'string') {
    return globalThis.process.arch as ProcessArch;
  }
  return 'x64';
}

function getCwd(): string {
  // Try GLib first to avoid recursion — under GJS, globalThis.process.cwd
  // is our own method which calls getCwd(), causing infinite recursion.
  try {
    const GLib = getGjsGlobal().imports?.gi?.GLib;
    if (GLib?.get_current_dir) return GLib.get_current_dir();
  } catch { /* ignore */ }
  return '/';
}

function getEnvProxy(): Record<string, string | undefined> {
  // On Node.js, just return process.env
  if (typeof globalThis.process?.env === 'object') {
    return globalThis.process.env;
  }

  // On GJS, create a Proxy that uses GLib.getenv/setenv
  try {
    const GLib = getGjsGlobal().imports?.gi?.GLib;
    if (GLib) {
      return new Proxy({} as Record<string, string | undefined>, {
        get(_target, prop: string) {
          if (typeof prop !== 'string') return undefined;
          return GLib.getenv(prop) ?? undefined;
        },
        set(_target, prop: string, value: string) {
          if (typeof prop !== 'string') return false;
          GLib.setenv(prop, String(value), true);
          return true;
        },
        deleteProperty(_target, prop: string) {
          if (typeof prop !== 'string') return false;
          GLib.unsetenv(prop);
          return true;
        },
        has(_target, prop: string) {
          if (typeof prop !== 'string') return false;
          return GLib.getenv(prop) !== null;
        },
        ownKeys(_target) {
          const envp: string[] = GLib.listenv();
          return envp;
        },
        getOwnPropertyDescriptor(_target, prop: string) {
          if (typeof prop !== 'string') return undefined;
          const val = GLib.getenv(prop);
          if (val === null) return undefined;
          return { configurable: true, enumerable: true, writable: true, value: val };
        },
      });
    }
  } catch { /* ignore */ }

  return {};
}

function getArgv(): string[] {
  if (typeof globalThis.process?.argv !== 'undefined') {
    return globalThis.process.argv;
  }
  try {
    const system = getGjsGlobal().imports?.system;
    if (system?.programArgs) {
      // Node.js convention: argv = [executable, script, ...userArgs].
      // GJS `system.programInvocationName` holds the script path, so prepend
      // 'gjs' so consumers like yargs' `hideBin()` (which slices(2)) work.
      return ['gjs', system.programInvocationName || '', ...system.programArgs];
    }
  } catch { /* ignore */ }
  return ['gjs'];
}

function getExecPath(): string {
  if (typeof globalThis.process?.execPath === 'string') {
    return globalThis.process.execPath;
  }
  try {
    const system = getGjsGlobal().imports?.system;
    if (system?.programInvocationName) return system.programInvocationName;
  } catch { /* ignore */ }
  return '/usr/bin/gjs';
}

function getPid(): number {
  if (typeof globalThis.process?.pid === 'number') {
    return globalThis.process.pid;
  }
  try {
    const GLib = getGjsGlobal().imports?.gi?.GLib;
    if (GLib) {
      // GLib doesn't have a direct getpid, read from /proc/self
      const [, contents] = GLib.file_get_contents('/proc/self/stat');
      if (contents) {
        const str = new TextDecoder().decode(contents);
        const pid = parseInt(str, 10);
        if (!isNaN(pid)) return pid;
      }
    }
  } catch { /* ignore */ }
  return 0;
}

const startTime = Date.now();

function getGioNamespace(): any {
  const _gi: Record<string, unknown> | undefined = (globalThis as any).imports?.gi;
  if (!_gi) return null;
  let gio: any = null;
  try { gio = (_gi as any)['GioUnix']; } catch { /* try Gio */ }
  if (!gio) { try { gio = (_gi as any)['Gio']; } catch { /* absent */ } }
  return gio;
}

class ProcessWriteStream extends EventEmitter {
  readonly fd: number;
  // Required by Stream.pipe(): without this, pipe skips dest.write() entirely.
  writable = true;
  private _outGio: any = null;

  constructor(fd: number) {
    super();
    this.fd = fd;
    const gio = getGioNamespace();
    if (gio) {
      const Cls = gio.UnixOutputStream ?? gio.OutputStream;
      if (Cls) { try { this._outGio = Cls.new(this.fd, false); } catch { /* fallback */ } }
    }
  }

  write(data: string | Uint8Array): boolean {
    if (this._outGio) {
      try {
        const bytes = typeof data === 'string' ? _encoder.encode(data) : data;
        this._outGio.write_all(bytes, null);
        return true;
      } catch { /* fall through to console fallback */ }
    }
    // Fallback: console adds a trailing newline which breaks terminal UI,
    // but is acceptable when Gio streams are unavailable.
    if (this.fd === 2) {
      console.error(data);
    } else {
      console.log(data);
    }
    return true;
  }

  get isTTY(): boolean {
    if (nativeTerminal) return nativeTerminal.Terminal.is_tty(this.fd);
    try {
      const GLib = getGjsGlobal().imports?.gi?.GLib;
      if (GLib) return !!(GLib as any).log_writer_supports_color(this.fd);
    } catch { /* ignore */ }
    return false;
  }

  get columns(): number {
    if (nativeTerminal) {
      const [ok, , cols] = nativeTerminal.Terminal.get_size(this.fd);
      if (ok && cols > 0) return cols;
    }
    try {
      const GLib = getGjsGlobal().imports?.gi?.GLib;
      if (GLib) {
        const c = parseInt((GLib as any).getenv('COLUMNS') ?? '0', 10);
        if (c > 0) return c;
      }
    } catch { /* ignore */ }
    return 80;
  }

  // stdout/stderr must never be closed — the process owns the fds.
  // pipe() calls end() when its source emits 'end' (e.g. MuteStream); no-op here.
  end(): void {}
  destroy(): void {}

  get rows(): number {
    if (nativeTerminal) {
      const [ok, rows] = nativeTerminal.Terminal.get_size(this.fd);
      if (ok && rows > 0) return rows;
    }
    try {
      const GLib = getGjsGlobal().imports?.gi?.GLib;
      if (GLib) {
        const r = parseInt((GLib as any).getenv('LINES') ?? '0', 10);
        if (r > 0) return r;
      }
    } catch { /* ignore */ }
    return 24;
  }
}

class ProcessReadStream extends EventEmitter {
  readonly fd: number;
  isRaw = false;
  // Do NOT expose `readableFlowing` as an instance property: @inquirer/core uses
  // `'readableFlowing' in input` to defer startCycle() via setImmediate. In GJS,
  // setImmediate fires as a microtask — the property must stay absent so
  // @inquirer/core calls startCycle() synchronously on its own schedule.

  private _gio: any = null;
  private _stdinGio: any = null;
  private _reading = false;
  private _flowing = false;
  private _sttyCleanupRegistered = false;
  private _mainLoopHeld = false;
  // True while a read_bytes_async is in-flight. Prevents a second concurrent
  // read from starting when pause()+resume() fires between GLib iterations.
  private _pendingRead = false;

  constructor(fd: number) {
    super();
    this.fd = fd;
    // GioUnix.InputStream (GJS ≥ 1.88) supersedes Gio.UnixInputStream; fall back to Gio.
    this._gio = getGioNamespace();
  }

  get isTTY(): boolean {
    if (nativeTerminal) return nativeTerminal.Terminal.is_tty(this.fd);
    return false;
  }

  setRawMode(mode: boolean): this {
    if (nativeTerminal) {
      const ok = nativeTerminal.Terminal.set_raw_mode(this.fd, mode);
      if (ok) {
        this.isRaw = mode;
        return this;
      }
      // set_raw_mode returned false — fd may not be a TTY (e.g. piped stdin).
      // Fall through to stty fallback.
    }
    // Fallback: spawn `stty raw -echo` / `stty sane` with stdin inherited so it
    // sees the real terminal and the setting persists in the kernel tty driver.
    // Only works when fd 0 is actually a TTY.
    this._setRawModeViaStty(mode);
    this.isRaw = mode;
    return this;
  }

  private _setRawModeViaStty(mode: boolean): void {
    try {
      const _gi: any = (globalThis as any).imports?.gi;
      const Gio = _gi?.Gio ?? _gi?.['Gio'];
      if (!Gio) return;
      // G_SUBPROCESS_FLAGS_STDIN_INHERIT = 1 << 1 = 2
      // Makes stty inherit our fd 0 (the real TTY) so tcsetattr targets the same tty.
      const STDIN_INHERIT = Gio.SubprocessFlags?.STDIN_INHERIT ?? 2;
      // Match the termios settings from GjsifyTerminal's set_raw_mode:
      //   c_lflag &= ~(ICANON | ECHO)  →  -icanon -echo
      //   c_iflag &= ~ICRNL            →  -icrnl
      //   VMIN=1, VTIME=0              →  min 1 time 0
      const argv = mode
        ? ['stty', '-icanon', '-echo', '-icrnl', 'min', '1', 'time', '0']
        : ['stty', 'icanon', 'echo', 'icrnl'];
      const launcher = new Gio.SubprocessLauncher({ flags: STDIN_INHERIT });
      const proc = launcher.spawnv(argv);
      proc.wait(null);

      // Register a one-time exit handler to restore cooked mode when the process
      // exits — without this the shell inherits raw mode and becomes unusable.
      if (mode && !this._sttyCleanupRegistered) {
        this._sttyCleanupRegistered = true;
        const proc_ = (globalThis as any).process;
        if (proc_?.once && typeof proc_.once === 'function') {
          proc_.once('exit', () => this._setRawModeViaStty(false));
        }
      }
    } catch { /* stty not available or not a TTY */ }
  }

  setEncoding(_enc: string): this { return this; }

  resume(): this {
    this._flowing = true;
    if (this._gio && this.fd === 0 && !this._reading) {
      this._startReading();
    }
    return this;
  }

  pause(): this {
    this._flowing = false;
    this._reading = false;
    if (this._mainLoopHeld) {
      this._mainLoopHeld = false;
      // Defer the quit via GLib idle so microtask continuations run first.
      // If the next prompt's Interface calls resume() before this idle fires,
      // it sets _mainLoopHeld = true again and the quit is skipped.
      // This mirrors Node.js libuv unref: pausing stdin allows the event loop
      // to drain when no more prompts follow, but not between sequential prompts.
      const _gi: any = (globalThis as any).imports?.gi;
      const GLib = _gi?.GLib ?? _gi?.['GLib'];
      if (GLib?.idle_add) {
        GLib.idle_add(300 /* PRIORITY_LOW */, () => {
          if (!this._mainLoopHeld) quitMainLoop();
          return false; // SOURCE_REMOVE
        });
      } else {
        quitMainLoop();
      }
    }
    return this;
  }

  read(): null { return null; }

  private _startReading(): void {
    if (!this._gio || this._reading) return;

    // If a read_bytes_async is already in-flight from the previous loop cycle
    // (queued before pause() set _reading = false), don't start a second
    // concurrent read on the same fd. Just re-enable _reading so the pending
    // callback continues the loop when it fires.
    if (this._pendingRead) {
      this._reading = true;
      if (!this._mainLoopHeld) { this._mainLoopHeld = true; ensureMainLoop(); }
      return;
    }

    this._reading = true;
    // Keep the GLib main loop alive while waiting for stdin — same as
    // http.Server.listen() does for network sockets. Without this, gjs -m
    // exits as soon as module evaluation completes even though read_bytes_async
    // is pending, because GJS only stays alive when runAsync() registered a hook.
    if (!this._mainLoopHeld) { this._mainLoopHeld = true; ensureMainLoop(); }

    if (!this._stdinGio) {
      // GioUnix: class is `InputStream`. Gio: concrete class is `UnixInputStream`;
      // `InputStream` is abstract. The ?? chain picks the right one for each namespace.
      const Cls = (this._gio as any).UnixInputStream ?? (this._gio as any).InputStream;
      if (!Cls) { this._reading = false; return; }
      try {
        this._stdinGio = Cls.new(this.fd, false);
      } catch {
        this._reading = false;
        return;
      }
    }

    const loop = () => {
      if (!this._reading) { this._pendingRead = false; return; }
      this._pendingRead = true;
      (this._stdinGio as any).read_bytes_async(
        4096,
        0,
        null,
        (src: any, res: any) => {
          this._pendingRead = false;
          try {
            const bytes = (src as any).read_bytes_finish(res);
            const data: Uint8Array | null = bytes?.get_data?.() ?? null;
            if (data && data.byteLength > 0) {
              this.emit('data', Buffer.from(data));
            } else if (data !== null && data.byteLength === 0) {
              this._reading = false;
              this.emit('end');
              return;
            }
          } catch {
            this._reading = false;
            return;
          }
          if (this._reading) loop();
        },
      );
    };
    loop();
  }
}

function getMonotonicTime(): bigint {
  try {
    const GLib = getGjsGlobal().imports?.gi?.GLib;
    if (GLib?.get_monotonic_time) {
      // GLib returns microseconds, convert to nanoseconds
      return BigInt(GLib.get_monotonic_time()) * 1000n;
    }
  } catch { /* ignore */ }
  if (typeof performance?.now === 'function') {
    return BigInt(Math.round(performance.now() * 1e6));
  }
  return BigInt(Date.now()) * 1000000n;
}

const hrtimeBase = getMonotonicTime();

class Process extends EventEmitter {
  readonly platform: ProcessPlatform;
  readonly arch: ProcessArch;
  readonly env: Record<string, string | undefined>;
  readonly argv: string[];
  readonly argv0: string;
  readonly execPath: string;
  readonly pid: number;
  readonly ppid: number;
  readonly version: string;
  readonly versions: Record<string, string>;
  title: string;
  readonly execArgv: string[];
  readonly config: Record<string, unknown>;
  exitCode: number | undefined;

  constructor() {
    super();

    this.platform = detectPlatform();
    this.arch = detectArch();
    this.env = getEnvProxy();
    this.argv = getArgv();
    this.argv0 = this.argv[0] || 'gjs';
    this.execPath = getExecPath();
    this.execArgv = globalThis.process?.execArgv ?? [];
    this.config = (globalThis.process?.config as unknown as Record<string, unknown>) ?? { target_defaults: {}, variables: {} };
    this.pid = getPid();
    this.ppid = detectPpid();
    const versionInfo = detectVersionInfo();
    this.version = versionInfo.version;
    this.versions = versionInfo.versions;
    this.title = versionInfo.title;
  }

  cwd(): string {
    return getCwd();
  }

  chdir(directory: string): void {
    try {
      const GLib = getGjsGlobal().imports?.gi?.GLib;
      if (GLib?.chdir) {
        // Check if directory exists first
        if (!GLib.file_test(directory, 16 /* G_FILE_TEST_EXISTS */)) {
          const err = new Error(`ENOENT: no such file or directory, chdir '${directory}'`) as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          err.syscall = 'chdir';
          err.path = directory;
          throw err;
        }
        GLib.chdir(directory);
        return;
      }
    } catch (e) {
      // Re-throw our own ENOENT errors
      if (e && typeof e === 'object' && (e as NodeJS.ErrnoException).code === 'ENOENT') throw e;
    }

    const nativeProcess = globalThis.process;
    if (nativeProcess && nativeProcess !== (this as any) && typeof nativeProcess.chdir === 'function') {
      nativeProcess.chdir(directory);
      return;
    }

    throw new Error('process.chdir() is not supported in this environment');
  }

  kill(pid: number, signal?: string | number): boolean {
    const nativeProcess = globalThis.process;
    if (nativeProcess && nativeProcess !== (this as any) && typeof nativeProcess.kill === 'function') {
      return nativeProcess.kill(pid, signal);
    }
    // On GJS, use GLib.spawn to send signals via /bin/kill
    try {
      const GLib = getGjsGlobal().imports?.gi?.GLib;
      if (GLib) {
        const sig = typeof signal === 'number' ? String(signal) : (signal || 'SIGTERM');
        const sigArg = sig.startsWith('SIG') ? `-${sig.slice(3)}` : `-${sig}`;
        GLib.spawn_command_line_sync(`kill ${sigArg} ${pid}`);
        return true;
      }
    } catch { /* ignore */ }
    throw new Error('process.kill() is not supported in this environment');
  }

  exit(code?: number): never {
    this.exitCode = code ?? this.exitCode ?? 0;
    this.emit('exit', this.exitCode);

    const gjsImports = getGjsGlobal().imports;
    const GLib = gjsImports?.gi?.GLib as Record<string, unknown> | undefined;
    const system = gjsImports?.system;
    const idleAdd = GLib?.idle_add as ((priority: number, fn: () => boolean) => number) | undefined;
    const sourceRemove = GLib?.SOURCE_REMOVE as boolean | undefined;
    const priorityDefault = GLib?.PRIORITY_DEFAULT as number | undefined;

    // GJS path: schedule the exit via GLib.idle_add so the syscall fires
    // from a fresh main-loop iteration. Calling system.exit() directly from
    // a microtask continuation (e.g. yargs's parseAsync resolution) while a
    // GLib.MainLoop is parked deadlocks the process — the loop never returns
    // control to top-level, the syscall never runs.
    //
    // ensureMainLoop() is non-blocking on first call: it registers the loop
    // via setMainLoopHook so GJS keeps running it after JS module evaluation
    // completes. Without this, our idle source would sit queued in the default
    // main context but never dispatch (gjs -m exits as soon as JS eval ends),
    // and the process would exit with code 0 regardless of `code`.
    //
    // The idle source must be added BEFORE quitting the loop. Quit lives in
    // the idle callback so the source is guaranteed to dispatch before the
    // loop drains.
    if (system?.exit && idleAdd && typeof priorityDefault === 'number' && typeof sourceRemove === 'boolean') {
      const exitCodeNow = this.exitCode;
      ensureMainLoop();
      idleAdd(priorityDefault, () => {
        quitMainLoop();
        system.exit!(exitCodeNow);
        return sourceRemove;
      });
      // Park the JS continuation forever — the idle source will exit the
      // process before this Promise can resolve. Cast satisfies the `never`
      // return type without taking down the synchronous control flow.
      return new Promise<never>(() => { /* never */ }) as unknown as never;
    }

    // GJS without GLib (extremely unlikely) — direct syscall, may deadlock
    // a parked loop but at least exits when no loop is running.
    try {
      if (system?.exit) system.exit(this.exitCode);
    } catch { /* ignore */ }

    const nativeProcess = globalThis.process;
    if (nativeProcess && nativeProcess !== (this as any) && typeof nativeProcess.exit === 'function') {
      nativeProcess.exit(this.exitCode);
    }

    // Fallback
    throw new Error(`process.exit(${this.exitCode})`);
  }

  nextTick(callback: Function, ...args: unknown[]): void {
    // GTK interleaving is handled at the stream level (@gjsify/utils nextTick → GLib.idle_add).
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(() => callback(...args));
    } else {
      Promise.resolve().then(() => callback(...args));
    }
  }

  hrtime(time?: [number, number]): [number, number] {
    const now = getMonotonicTime() - hrtimeBase;
    const seconds = Number(now / 1000000000n);
    const nanoseconds = Number(now % 1000000000n);

    if (time) {
      let diffSec = seconds - time[0];
      let diffNano = nanoseconds - time[1];
      if (diffNano < 0) {
        diffSec--;
        diffNano += 1e9;
      }
      return [diffSec, diffNano];
    }

    return [seconds, nanoseconds];
  }

  uptime(): number {
    return (Date.now() - startTime) / 1000;
  }

  memoryUsage(): { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number } {
    try {
      const GLib = getGjsGlobal().imports?.gi?.GLib;
      if (GLib) {
        const [, contents] = GLib.file_get_contents('/proc/self/status');
        if (contents) {
          const str = new TextDecoder().decode(contents);
          const vmRSS = str.match(/VmRSS:\s+(\d+)/);
          const rss = vmRSS ? parseInt(vmRSS[1], 10) * 1024 : 0;
          return { rss, heapTotal: rss, heapUsed: rss, external: 0, arrayBuffers: 0 };
        }
      }
    } catch { /* ignore */ }

    // Delegate to native process.memoryUsage on Node.js, but NOT when
    // globalThis.process is this same instance (would infinite-recurse on GJS).
    const nativeProcess = globalThis.process;
    if (nativeProcess && nativeProcess !== (this as any) && typeof nativeProcess.memoryUsage === 'function') {
      return nativeProcess.memoryUsage();
    }

    return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
  }

  cpuUsage(previousValue?: { user: number; system: number }): { user: number; system: number } {
    // Delegate to native process.cpuUsage on Node.js, but NOT when
    // globalThis.process is this same instance (would infinite-recurse on GJS).
    const nativeProcess = globalThis.process;
    if (nativeProcess && nativeProcess !== (this as any) && typeof nativeProcess.cpuUsage === 'function') {
      return nativeProcess.cpuUsage(previousValue);
    }
    return { user: 0, system: 0 };
  }

  // Note: Cannot check globalThis.process.stdout here — on GJS globalThis.process
  // IS this instance, so that would cause infinite recursion.
  readonly stdout = new ProcessWriteStream(1);
  readonly stderr = new ProcessWriteStream(2);
  readonly stdin = new ProcessReadStream(0);

  abort(): void {
    this.exit(1);
  }

  // no-op stubs for compatibility
  umask(mask?: number): number { return 0o22; }
  emitWarning(warning: string | Error, name?: string): void {
    if (typeof warning === 'string') {
      console.warn(`(${name || 'Warning'}): ${warning}`);
    } else {
      console.warn(warning.message);
    }
  }
}

(Process.prototype.hrtime as unknown as Record<string, () => bigint>).bigint = function(): bigint {
  return getMonotonicTime() - hrtimeBase;
};

const process = new Process();

// Wire SIGWINCH → process.stdout.emit('resize') when native terminal is available.
// Runs only on GJS (nativeTerminal is null on Node.js).
if (nativeTerminal) {
  try {
    const watcher = new nativeTerminal.ResizeWatcher();
    watcher.connect('resized', (_obj: any, _rows: number, _cols: number) => {
      // Re-emit on both streams; consumers (chalk, inquirer) listen on stdout.
      process.stdout.emit('resize');
      process.stderr.emit('resize');
    });
    watcher.start();
  } catch { /* ignore if ResizeWatcher instantiation fails */ }
}

// Re-export everything
export const platform = process.platform;
export const arch = process.arch;
export const env = process.env;
export const argv = process.argv;
export const argv0 = process.argv0;
export const execPath = process.execPath;
export const pid = process.pid;
export const ppid = process.ppid;
export const version = process.version;
export const versions = process.versions;
export const cwd = process.cwd.bind(process);
export const chdir = process.chdir.bind(process);
export const exit = process.exit.bind(process);
export const nextTick = process.nextTick.bind(process);
export const hrtime = process.hrtime.bind(process);
export const uptime = process.uptime.bind(process);
export const memoryUsage = process.memoryUsage.bind(process);
export const cpuUsage = process.cpuUsage.bind(process);
export const kill = process.kill.bind(process);
export const abort = process.abort.bind(process);
export const umask = process.umask.bind(process);
export const emitWarning = process.emitWarning.bind(process);
export const execArgv = process.execArgv;
export const config = process.config;
export const stdout = process.stdout;
export const stderr = process.stderr;
export const stdin = process.stdin;

export default process;
