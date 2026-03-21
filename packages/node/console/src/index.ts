// Native console module for GJS — no Deno dependency
// GJS already provides a full console global (log, warn, error, info, debug, table, etc.)
// The Node.js console module additionally exports a Console class constructor.

interface ConsoleConstructorOptions {
  stdout?: { write: (data: string) => void };
  stderr?: { write: (data: string) => void };
  ignoreErrors?: boolean;
  colorMode?: boolean | 'auto';
  inspectOptions?: object;
  groupIndentation?: number;
}

/**
 * The Console class can be used to create a simple logger with configurable output streams.
 * This implementation delegates to the global console for the basic case,
 * and writes to custom streams when provided.
 */
export class Console {
  private _stdout: { write: (data: string) => void } | undefined;
  private _stderr: { write: (data: string) => void } | undefined;
  private _groupDepth = 0;
  private _groupIndentation: number;
  private _timers = new Map<string, number>();
  private _counters = new Map<string, number>();

  constructor(
    stdoutOrOptions?: { write: (data: string) => void } | ConsoleConstructorOptions,
    stderr?: { write: (data: string) => void }
  ) {
    if (stdoutOrOptions && typeof (stdoutOrOptions as { write?: unknown }).write === 'function') {
      this._stdout = stdoutOrOptions as { write: (data: string) => void };
      this._stderr = stderr || this._stdout;
    } else if (stdoutOrOptions && typeof stdoutOrOptions === 'object') {
      const opts = stdoutOrOptions as ConsoleConstructorOptions;
      this._stdout = opts.stdout;
      this._stderr = opts.stderr || opts.stdout;
    }
    this._groupIndentation = 2;
  }

  private _write(stream: 'stdout' | 'stderr', ...args: unknown[]): void {
    const target = stream === 'stderr' ? (this._stderr || this._stdout) : this._stdout;
    if (target) {
      const indent = ' '.repeat(this._groupDepth * this._groupIndentation);
      const message = args.map(a => typeof a === 'string' ? a : String(a)).join(' ');
      target.write(indent + message + '\n');
    } else {
      // Delegate to global console
      const gc = globalThis.console;
      if (stream === 'stderr') {
        gc.error(...args);
      } else {
        gc.log(...args);
      }
    }
  }

  log(...args: unknown[]): void { this._write('stdout', ...args); }
  info(...args: unknown[]): void { this._write('stdout', ...args); }
  debug(...args: unknown[]): void { this._write('stdout', ...args); }
  warn(...args: unknown[]): void { this._write('stderr', ...args); }
  error(...args: unknown[]): void { this._write('stderr', ...args); }

  dir(obj: unknown, _options?: object): void { this._write('stdout', obj); }
  dirxml(...args: unknown[]): void { this.log(...args); }

  assert(value: unknown, ...args: unknown[]): void {
    if (!value) {
      this.error('Assertion failed:', ...args);
    }
  }

  clear(): void {
    if (this._stdout) {
      this._stdout.write('\x1Bc');
    } else {
      globalThis.console.clear();
    }
  }

  count(label: string = 'default'): void {
    const count = (this._counters.get(label) || 0) + 1;
    this._counters.set(label, count);
    this.log(`${label}: ${count}`);
  }

  countReset(label: string = 'default'): void {
    this._counters.delete(label);
  }

  group(...args: unknown[]): void {
    if (args.length > 0) this.log(...args);
    this._groupDepth++;
  }

  groupCollapsed(...args: unknown[]): void {
    this.group(...args);
  }

  groupEnd(): void {
    if (this._groupDepth > 0) this._groupDepth--;
  }

  table(tabularData: unknown, _properties?: string[]): void {
    if (this._stdout) {
      // Simple table fallback for custom streams
      this._write('stdout', tabularData);
    } else {
      globalThis.console.table(tabularData, _properties);
    }
  }

  time(label: string = 'default'): void {
    this._timers.set(label, Date.now());
  }

  timeEnd(label: string = 'default'): void {
    const start = this._timers.get(label);
    if (start !== undefined) {
      this.log(`${label}: ${Date.now() - start}ms`);
      this._timers.delete(label);
    } else {
      this.warn(`Warning: No such label '${label}' for console.timeEnd()`);
    }
  }

  timeLog(label: string = 'default', ...args: unknown[]): void {
    const start = this._timers.get(label);
    if (start !== undefined) {
      this.log(`${label}: ${Date.now() - start}ms`, ...args);
    } else {
      this.warn(`Warning: No such label '${label}' for console.timeLog()`);
    }
  }

  trace(...args: unknown[]): void {
    const err = new Error();
    const stack = err.stack?.split('\n').slice(1).join('\n') || '';
    this._write('stderr', 'Trace:', ...args, '\n' + stack);
  }

  profile(_label?: string): void { /* No-op in non-browser environments */ }
  profileEnd(_label?: string): void { /* No-op in non-browser environments */ }
  timeStamp(_label?: string): void { /* No-op in non-browser environments */ }
}

// Re-export all global console methods as named exports
const gc = globalThis.console;
export const log = gc.log.bind(gc);
export const info = gc.info.bind(gc);
export const debug = gc.debug.bind(gc);
export const warn = gc.warn.bind(gc);
export const error = gc.error.bind(gc);
export const dir = gc.dir.bind(gc);
export const dirxml = (gc as unknown as Record<string, Function | undefined>).dirxml?.bind(gc) || gc.log.bind(gc);
export const table = gc.table.bind(gc);
export const time = gc.time.bind(gc);
export const timeEnd = gc.timeEnd.bind(gc);
export const timeLog = (gc as unknown as Record<string, Function | undefined>).timeLog?.bind(gc) || gc.log.bind(gc);
export const trace = gc.trace.bind(gc);
export const assert = (gc as unknown as Record<string, Function | undefined>).assert?.bind(gc) || function(value: unknown, ...args: unknown[]) { if (!value) gc.error('Assertion failed:', ...args); };
export const clear = gc.clear.bind(gc);
export const count = gc.count.bind(gc);
export const countReset = gc.countReset.bind(gc);
export const group = gc.group.bind(gc);
export const groupCollapsed = (gc as unknown as Record<string, Function | undefined>).groupCollapsed?.bind(gc) || gc.group.bind(gc);
export const groupEnd = gc.groupEnd.bind(gc);
export const profile = (_label?: string) => {};
export const profileEnd = (_label?: string) => {};
export const timeStamp = (_label?: string) => {};

// Default export: console-like object with Console class attached
const consoleModule = {
  Console,
  log, info, debug, warn, error, dir, dirxml, table,
  time, timeEnd, timeLog, trace, assert, clear,
  count, countReset, group, groupCollapsed, groupEnd,
  profile, profileEnd, timeStamp,
};

export default consoleModule;
