// Reference: Node.js lib/internal/console/constructor.js
// Reimplemented for GJS using print()/printerr() on GJS, global console on Node.js

import type { ConsoleOptions } from 'node:console';

// GJS has global print() and printerr() — use them to bypass GLib.log_structured()
// which adds the "Gjs-Console-Message:" prefix and prevents ANSI interpretation.
const _isGJS = typeof print === 'function' && typeof printerr === 'function';

declare function print(...args: unknown[]): void;
declare function printerr(...args: unknown[]): void;

// Basic printf-style format specifier handling to match Node.js util.format behavior.
// Handles %s, %d, %i, %f, %o, %O — joins remaining args with spaces.
function _formatArgs(...args: unknown[]): string {
    const fmt = args[0];
    const rest = args.slice(1);
    if (typeof fmt !== 'string' || !/%(s|d|i|f|o|O|c)/.test(fmt)) {
        // No format specifiers — join all args with spaces
        return args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    }
    let i = 0;
    const result = fmt.replace(/%([sdifOoc])/g, (_match, spec) => {
        if (i >= rest.length) return _match;
        const val = rest[i++];
        switch (spec) {
            case 's': return String(val);
            case 'd':
            case 'i': return String(parseInt(String(val), 10));
            case 'f': return String(parseFloat(String(val)));
            case 'o':
            case 'O': return JSON.stringify(val);
            case 'c': return ''; // CSS styles — ignore
            default: return _match;
        }
    });
    // Append remaining args
    const remaining = rest.slice(i);
    if (remaining.length === 0) return result;
    return result + ' ' + remaining.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
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
    stdoutOrOptions?: { write: (data: string) => void } | ConsoleOptions,
    stderr?: { write: (data: string) => void }
  ) {
    if (stdoutOrOptions && typeof (stdoutOrOptions as { write?: unknown }).write === 'function') {
      this._stdout = stdoutOrOptions as { write: (data: string) => void };
      this._stderr = stderr || this._stdout;
    } else if (stdoutOrOptions && typeof stdoutOrOptions === 'object') {
      const opts = stdoutOrOptions as ConsoleOptions;
      this._stdout = opts.stdout;
      this._stderr = opts.stderr || opts.stdout;
    }
    this._groupIndentation = 2;
  }

  private _write(stream: 'stdout' | 'stderr', ...args: unknown[]): void {
    const target = stream === 'stderr' ? (this._stderr || this._stdout) : this._stdout;
    if (target) {
      const indent = ' '.repeat(this._groupDepth * this._groupIndentation);
      const message = _formatArgs(...args);
      target.write(indent + message + '\n');
    } else if (_isGJS) {
      const indent = ' '.repeat(this._groupDepth * this._groupIndentation);
      const message = indent + _formatArgs(...args);
      if (stream === 'stderr') {
        printerr(message);
      } else {
        print(message);
      }
    } else {
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
    } else if (_isGJS) {
      print('\x1Bc');
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
      this._write('stdout', tabularData);
    } else if (_isGJS) {
      print(JSON.stringify(tabularData, null, 2));
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

// Module-level singleton — all named exports delegate to this instance.
// On GJS it uses print()/printerr(); on Node.js it delegates to globalThis.console.
const _default = new Console();

export const log    = (...args: unknown[]) => _default.log(...args);
export const info   = (...args: unknown[]) => _default.info(...args);
export const debug  = (...args: unknown[]) => _default.debug(...args);
export const warn   = (...args: unknown[]) => _default.warn(...args);
export const error  = (...args: unknown[]) => _default.error(...args);
export const dir    = (obj: unknown, options?: object) => _default.dir(obj, options);
export const dirxml = (...args: unknown[]) => _default.dirxml(...args);
export const table  = (data: unknown, properties?: string[]) => _default.table(data, properties);
export const clear  = () => _default.clear();
export const assert = (value: unknown, ...args: unknown[]) => _default.assert(value, ...args);
export const trace  = (...args: unknown[]) => _default.trace(...args);
export const time   = (label?: string) => _default.time(label);
export const timeEnd = (label?: string) => _default.timeEnd(label);
export const timeLog = (label?: string, ...args: unknown[]) => _default.timeLog(label, ...args);
export const count      = (label?: string) => _default.count(label);
export const countReset = (label?: string) => _default.countReset(label);
export const group          = (...args: unknown[]) => _default.group(...args);
export const groupCollapsed = (...args: unknown[]) => _default.groupCollapsed(...args);
export const groupEnd       = () => _default.groupEnd();
export const profile    = (_label?: string) => {};
export const profileEnd = (_label?: string) => {};
export const timeStamp  = (_label?: string) => {};

// Default export: console-like object with Console class attached
const consoleModule = {
  Console,
  log, info, debug, warn, error, dir, dirxml, table,
  time, timeEnd, timeLog, trace, assert, clear,
  count, countReset, group, groupCollapsed, groupEnd,
  profile, profileEnd, timeStamp,
};

export default consoleModule;
