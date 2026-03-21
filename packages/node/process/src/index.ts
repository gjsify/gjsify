// Native process module for GJS — no Deno dependency
// Uses GNOME libraries (GLib) for system information and EventEmitter for events.

import { EventEmitter } from '@gjsify/events';

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
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

function getGjsGlobal(): GjsGlobalThis {
  return globalThis as unknown as GjsGlobalThis;
}

// Detect platform
function detectPlatform(): ProcessPlatform {
  try {
    const GLib = getGjsGlobal().imports?.gi?.GLib;
    if (GLib) {
      const osInfo = GLib.get_os_info('ID');
      if (osInfo) return 'linux'; // GLib is primarily Linux
    }
  } catch { /* ignore */ }

  // Check if running in GJS
  if (typeof getGjsGlobal().imports?.system !== 'undefined') {
    return 'linux'; // GJS is primarily Linux
  }

  // Fallback: check Node.js process
  if (typeof globalThis.process?.platform === 'string') {
    return globalThis.process.platform as ProcessPlatform;
  }

  return 'linux';
}

// Detect architecture
function detectArch(): ProcessArch {
  if (typeof globalThis.process?.arch === 'string') {
    return globalThis.process.arch as ProcessArch;
  }

  // Try to detect via GJS system module
  try {
    const system = getGjsGlobal().imports?.system;
    if (system?.programInvocationName) {
      // On GJS we can't easily determine arch without system calls
      // Default to x64 for now — could use GLib.spawn to check `uname -m`
    }
  } catch { /* ignore */ }

  return 'x64';
}

function getCwd(): string {
  if (typeof globalThis.process?.cwd === 'function') {
    return globalThis.process.cwd();
  }
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
      return [system.programInvocationName || 'gjs', ...system.programArgs];
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

// Use GLib.get_monotonic_time() for hrtime if available
function getMonotonicTime(): bigint {
  try {
    const GLib = getGjsGlobal().imports?.gi?.GLib;
    if (GLib?.get_monotonic_time) {
      // GLib returns microseconds, convert to nanoseconds
      return BigInt(GLib.get_monotonic_time()) * 1000n;
    }
  } catch { /* ignore */ }
  // Fallback: performance.now() if available
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
  exitCode: number | undefined;

  constructor() {
    super();

    this.platform = detectPlatform();
    this.arch = detectArch();
    this.env = getEnvProxy();
    this.argv = getArgv();
    this.argv0 = this.argv[0] || 'gjs';
    this.execPath = getExecPath();
    this.pid = getPid();
    this.ppid = 0;
    this.version = 'v20.0.0'; // Compatibility version string
    this.versions = {
      node: '20.0.0',
      gjs: '1.86.0',
    };
    this.title = 'gjs';
  }

  cwd(): string {
    return getCwd();
  }

  chdir(directory: string): void {
    try {
      const GLib = getGjsGlobal().imports?.gi?.GLib;
      if (GLib?.chdir) {
        GLib.chdir(directory);
        return;
      }
    } catch { /* ignore */ }

    if (typeof globalThis.process?.chdir === 'function') {
      globalThis.process.chdir(directory);
      return;
    }

    throw new Error('process.chdir() is not supported in this environment');
  }

  exit(code?: number): never {
    this.exitCode = code ?? this.exitCode ?? 0;
    this.emit('exit', this.exitCode);

    try {
      const system = getGjsGlobal().imports?.system;
      if (system?.exit) {
        system.exit(this.exitCode);
      }
    } catch { /* ignore */ }

    if (typeof globalThis.process?.exit === 'function') {
      globalThis.process.exit(this.exitCode);
    }

    // Fallback
    throw new Error(`process.exit(${this.exitCode})`);
  }

  nextTick(callback: Function, ...args: unknown[]): void {
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
    // On GJS, try reading from /proc/self/status
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

    if (typeof globalThis.process?.memoryUsage === 'function') {
      return globalThis.process.memoryUsage();
    }

    return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
  }

  cpuUsage(previousValue?: { user: number; system: number }): { user: number; system: number } {
    if (typeof globalThis.process?.cpuUsage === 'function') {
      return globalThis.process.cpuUsage(previousValue);
    }
    return { user: 0, system: 0 };
  }

  // Stub: stdout/stderr/stdin — these need stream to be implemented fully
  get stdout(): { write: (data: string) => boolean; fd: number } {
    if (typeof globalThis.process?.stdout !== 'undefined') return globalThis.process.stdout as { write: (data: string) => boolean; fd: number };
    return { write: (data: string) => { console.log(data); return true; }, fd: 1 };
  }

  get stderr(): { write: (data: string) => boolean; fd: number } {
    if (typeof globalThis.process?.stderr !== 'undefined') return globalThis.process.stderr as { write: (data: string) => boolean; fd: number };
    return { write: (data: string) => { console.error(data); return true; }, fd: 2 };
  }

  get stdin(): { fd: number } {
    if (typeof globalThis.process?.stdin !== 'undefined') return globalThis.process.stdin as { fd: number };
    return { fd: 0 };
  }

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

// Add hrtime.bigint
(Process.prototype.hrtime as unknown as Record<string, () => bigint>).bigint = function(): bigint {
  return getMonotonicTime() - hrtimeBase;
};

// Create singleton process instance
const process = new Process();

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
export const abort = process.abort.bind(process);
export const umask = process.umask.bind(process);
export const emitWarning = process.emitWarning.bind(process);
export const stdout = process.stdout;
export const stderr = process.stderr;
export const stdin = process.stdin;

export default process;
