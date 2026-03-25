// Reference: Node.js lib/util.js
// Reimplemented for GJS

import type { InspectOptions } from 'node:util';

import * as types from './types.js';
import { getSystemErrorName, getSystemErrorMap } from './errors.js';

export { types };
export { getSystemErrorName, getSystemErrorMap };

// ---- inspect ----

const kCustomInspect = Symbol.for('nodejs.util.inspect.custom');

function inspectValue(value: unknown, opts: InspectOptions, depth: number): string {
  if (value === null) return opts.colors ? '\x1b[1mnull\x1b[22m' : 'null';
  if (value === undefined) return opts.colors ? '\x1b[90mundefined\x1b[39m' : 'undefined';

  const maxDepth = opts.depth ?? 2;

  if (typeof value === 'string') {
    const escaped = value.replace(/\\/g, '\\\\');
    // Smart quoting: use double quotes if string contains single quote but no double quote
    if (value.includes("'") && !value.includes('"')) {
      const dq = escaped.replace(/"/g, '\\"');
      return opts.colors ? `\x1b[32m"${dq}"\x1b[39m` : `"${dq}"`;
    }
    const sq = escaped.replace(/'/g, "\\'");
    return opts.colors ? `\x1b[32m'${sq}'\x1b[39m` : `'${sq}'`;
  }
  if (typeof value === 'number') {
    return opts.colors ? `\x1b[33m${value}\x1b[39m` : String(value);
  }
  if (typeof value === 'bigint') {
    return opts.colors ? `\x1b[33m${value}n\x1b[39m` : `${value}n`;
  }
  if (typeof value === 'boolean') {
    return opts.colors ? `\x1b[33m${value}\x1b[39m` : String(value);
  }
  if (typeof value === 'symbol') {
    return opts.colors ? `\x1b[32m${value.toString()}\x1b[39m` : value.toString();
  }
  if (typeof value === 'function') {
    const name = value.name ? `: ${value.name}` : '';
    return opts.colors ? `\x1b[36m[Function${name}]\x1b[39m` : `[Function${name}]`;
  }

  // Custom inspect
  if (value !== null && typeof value === 'object' && kCustomInspect in (value as Record<symbol, unknown>)) {
    const custom = (value as Record<symbol, unknown>)[kCustomInspect];
    if (typeof custom === 'function') {
      const result = custom.call(value, depth, opts);
      if (typeof result === 'string') return result;
      return inspectValue(result, opts, depth);
    }
  }

  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof RegExp) {
    return opts.colors ? `\x1b[31m${value.toString()}\x1b[39m` : value.toString();
  }
  if (value instanceof Error) {
    return value.stack || value.toString();
  }

  if (depth > maxDepth) {
    return Array.isArray(value) ? '[Array]' : '[Object]';
  }

  if (Array.isArray(value)) {
    return inspectArray(value, opts, depth);
  }

  if (value instanceof Map) {
    const entries = [...value.entries()].map(([k, v]) =>
      `${inspectValue(k, opts, depth + 1)} => ${inspectValue(v, opts, depth + 1)}`
    );
    return `Map(${value.size}) { ${entries.join(', ')} }`;
  }

  if (value instanceof Set) {
    const entries = [...value].map(v => inspectValue(v, opts, depth + 1));
    return `Set(${value.size}) { ${entries.join(', ')} }`;
  }

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const name = value.constructor?.name || 'TypedArray';
    const arr = Array.from(value as Uint8Array);
    return `${name}(${arr.length}) [ ${arr.join(', ')} ]`;
  }

  return inspectObject(value as Record<string, unknown>, opts, depth);
}

function inspectArray(arr: unknown[], opts: InspectOptions, depth: number): string {
  const maxLen = opts.maxArrayLength ?? 100;
  const len = Math.min(arr.length, maxLen);
  const items: string[] = [];
  for (let i = 0; i < len; i++) {
    items.push(inspectValue(arr[i], opts, depth + 1));
  }
  if (arr.length > maxLen) {
    items.push(`... ${arr.length - maxLen} more items`);
  }

  // Show hidden properties like [length] when showHidden is true
  if (opts.showHidden) {
    items.push(`[length]: ${arr.length}`);
  }

  const breakLength = opts.breakLength ?? 72;
  const compact = opts.compact ?? 3;

  // Compact grouping: when array has more elements than compact threshold,
  // use grouped multiline format (multiple items per line)
  if (typeof compact === 'number' && compact > 0 && arr.length > compact) {
    const indent = '  ';
    const indentLen = indent.length;
    // Calculate max item length (strip ANSI for measurement)
    const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const maxItemLen = Math.max(...items.map(item => stripAnsi(item).length));
    const biasedMax = Math.max(maxItemLen - 2, 1);
    const numItems = items.length;
    const approxCharHeights = 2.5;
    const columns = Math.min(
      Math.round(Math.sqrt(approxCharHeights * biasedMax * numItems) / biasedMax),
      Math.floor((breakLength - indentLen) / biasedMax),
      Math.floor((2.5 + numItems - 1) / 2),
      15
    );
    if (columns > 1) {
      const rows: string[] = [];
      for (let i = 0; i < numItems; i += columns) {
        rows.push(indent + items.slice(i, Math.min(i + columns, numItems)).join(', '));
      }
      return `[\n${rows.join(',\n')}\n]`;
    }
  }

  const singleLine = `[ ${items.join(', ')} ]`;
  if (singleLine.length <= breakLength) return singleLine;

  return `[\n${items.map(i => '  ' + i).join(',\n')}\n]`;
}

function inspectObject(obj: Record<string, unknown>, opts: InspectOptions, depth: number): string {
  const keys = opts.showHidden
    ? Object.getOwnPropertyNames(obj)
    : Object.keys(obj);

  if (opts.sorted) keys.sort();

  if (keys.length === 0) {
    const tag = Object.prototype.toString.call(obj);
    if (tag !== '[object Object]') return tag;
    return '{}';
  }

  const items = keys.map(key => {
    const val = inspectValue(obj[key], opts, depth + 1);
    return `${key}: ${val}`;
  });

  const breakLength = opts.breakLength ?? 72;
  const singleLine = `{ ${items.join(', ')} }`;
  if (singleLine.length <= breakLength) return singleLine;

  return `{\n${items.map(i => '  ' + i).join(',\n')}\n}`;
}

export function inspect(value: unknown, opts?: boolean | InspectOptions): string {
  const options: InspectOptions = typeof opts === 'boolean'
    ? { showHidden: opts }
    : { ...opts };

  if (options.colors === undefined) options.colors = false;
  return inspectValue(value, options, 0);
}

inspect.custom = kCustomInspect;
inspect.defaultOptions = {
  showHidden: false,
  depth: 2,
  colors: false,
  maxArrayLength: 100,
  maxStringLength: 10000,
  breakLength: 72,
  compact: 3,
  sorted: false,
};

// ---- format ----

export function format(fmt: string, ...args: unknown[]): string {
  // format() with no args returns ''
  if (fmt === undefined && args.length === 0) return '';

  if (typeof fmt !== 'string') {
    if (args.length === 0) return inspect(fmt);
    const parts = [inspect(fmt)];
    for (const arg of args) parts.push(inspect(arg));
    return parts.join(' ');
  }

  let i = 0;
  let result = '';
  let lastIdx = 0;

  for (let p = 0; p < fmt.length - 1; p++) {
    if (fmt[p] !== '%') continue;

    if (p > lastIdx) result += fmt.slice(lastIdx, p);

    const next = fmt[p + 1];

    // %% always produces literal % (no arg consumed)
    if (next === '%') {
      result += '%';
      lastIdx = p + 2;
      p++;
      continue;
    }

    if (i >= args.length) {
      result += '%' + next;
      lastIdx = p + 2;
      p++;
      continue;
    }

    const arg = args[i];
    switch (next) {
      case 's': {
        if (typeof arg === 'bigint') {
          result += `${arg}n`;
        } else if (typeof arg === 'symbol') {
          result += arg.toString();
        } else if (typeof arg === 'number' && Object.is(arg, -0)) {
          result += '-0';
        } else if (typeof arg === 'object' && arg !== null) {
          // Objects with custom toString use it, others get inspect
          const proto = Object.getPrototypeOf(arg);
          if (proto === null || (typeof arg.toString === 'function' && arg.toString !== Object.prototype.toString && arg.toString !== Array.prototype.toString)) {
            try {
              const str = arg.toString();
              if (typeof str === 'string' && str !== '[object Object]') {
                result += str;
              } else {
                result += inspect(arg, { depth: 0 });
              }
            } catch {
              result += inspect(arg, { depth: 0 });
            }
          } else {
            result += inspect(arg, { depth: 0 });
          }
        } else {
          result += String(arg);
        }
        i++;
        break;
      }
      case 'd': {
        if (typeof arg === 'bigint') {
          result += `${arg}n`;
        } else if (typeof arg === 'symbol') {
          result += 'NaN';
        } else {
          const n = Number(arg);
          result += Object.is(n, -0) ? '-0' : String(n);
        }
        i++;
        break;
      }
      case 'i': {
        if (typeof arg === 'bigint') {
          result += `${arg}n`;
        } else if (typeof arg === 'symbol') {
          result += 'NaN';
        } else {
          const n = Number(arg);
          if (!isFinite(n)) {
            // Node.js: parseInt('Infinity') → NaN, parseInt('-Infinity') → NaN
            result += 'NaN';
          } else {
            const truncated = Math.trunc(n);
            result += Object.is(truncated, -0) ? '-0' : String(truncated);
          }
        }
        i++;
        break;
      }
      case 'f': {
        if (typeof arg === 'bigint') {
          result += Number(arg).toString();
        } else if (typeof arg === 'symbol') {
          result += 'NaN';
        } else {
          const n = parseFloat(String(arg));
          result += Object.is(n, -0) ? '-0' : String(n);
        }
        i++;
        break;
      }
      case 'j':
        try {
          result += JSON.stringify(args[i++]);
        } catch {
          result += '[Circular]';
        }
        break;
      case 'o':
        result += inspect(args[i++], { showHidden: true, depth: 4 });
        break;
      case 'O':
        result += inspect(args[i++], { depth: 4 });
        break;
      default:
        result += '%' + next;
        break;
    }
    lastIdx = p + 2;
    p++;
  }

  if (lastIdx < fmt.length) {
    result += fmt.slice(lastIdx);
  }

  // Append remaining args (strings passed as-is, objects inspected)
  for (; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg === 'string') {
      result += ' ' + arg;
    } else {
      result += ' ' + inspect(arg);
    }
  }

  return result;
}

export function formatWithOptions(inspectOptions: InspectOptions, fmt: string, ...args: unknown[]): string {
  // Apply inspect options to embedded inspect calls — simplified implementation
  return format(fmt, ...args);
}

// ---- promisify / callbackify ----

const kCustomPromisify = Symbol.for('nodejs.util.promisify.custom');

export function promisify<T extends (...args: unknown[]) => void>(fn: T): (...args: unknown[]) => Promise<unknown> {
  if (typeof fn !== 'function') {
    throw new TypeError('The "original" argument must be of type Function');
  }

  // Check for custom promisify
  const custom = (fn as unknown as Record<symbol, unknown>)[kCustomPromisify];
  if (typeof custom === 'function') return custom as (...args: unknown[]) => Promise<unknown>;

  function promisified(this: unknown, ...args: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err: Error | null, ...values: unknown[]) => {
        if (err) {
          reject(err);
        } else if (values.length <= 1) {
          resolve(values[0]);
        } else {
          resolve(values);
        }
      });
    });
  }

  Object.setPrototypeOf(promisified, Object.getPrototypeOf(fn));
  Object.defineProperty(promisified, kCustomPromisify, { value: promisified });
  return promisified;
}

promisify.custom = kCustomPromisify;

export function callbackify<T>(fn: () => Promise<T>): (callback: (err: Error | null, result?: T) => void) => void;
export function callbackify<T>(fn: (...args: unknown[]) => Promise<T>): (...args: unknown[]) => void;
export function callbackify(fn: (...args: unknown[]) => Promise<unknown>): (...args: unknown[]) => void {
  if (typeof fn !== 'function') {
    throw new TypeError('The "original" argument must be of type Function');
  }

  return function (this: unknown, ...args: unknown[]) {
    const callback = args.pop();
    if (typeof callback !== 'function') {
      throw new TypeError('The last argument must be of type Function');
    }
    fn.apply(this, args).then(
      (result: unknown) => Promise.resolve().then(() => callback(null, result)),
      (err: Error) => Promise.resolve().then(() => callback(err || new Error()))
    );
  };
}

// ---- deprecate ----

export function deprecate<T extends (...args: unknown[]) => unknown>(fn: T, msg: string, code?: string): T {
  let warned = false;
  function deprecated(this: unknown, ...args: unknown[]): unknown {
    if (!warned) {
      warned = true;
      const warning = code ? `[${code}] ${msg}` : msg;
      console.warn(`DeprecationWarning: ${warning}`);
    }
    return fn.apply(this, args);
  }
  Object.setPrototypeOf(deprecated, fn);
  return deprecated as unknown as T;
}

// ---- debuglog ----

export function debuglog(section: string): (...args: unknown[]) => void {
  let debug: ((...args: unknown[]) => void) | undefined;

  return (...args: unknown[]) => {
    if (debug === undefined) {
      const nodeDebug = typeof globalThis.process?.env?.NODE_DEBUG === 'string'
        ? globalThis.process.env.NODE_DEBUG
        : '';
      const regex = new RegExp(`\\b${section}\\b`, 'i');
      if (regex.test(nodeDebug)) {
        const pid = typeof globalThis.process?.pid === 'number' ? globalThis.process.pid : 0;
        debug = (...a: unknown[]) => {
          console.error(`${section.toUpperCase()} ${pid}:`, ...a);
        };
      } else {
        debug = () => {};
      }
    }
    debug(...args);
  };
}

// ---- inherits ----

export function inherits(ctor: Function, superCtor: Function): void {
  if (ctor === undefined || ctor === null) {
    throw new TypeError('The constructor to "inherits" must not be null or undefined');
  }
  if (superCtor === undefined || superCtor === null) {
    throw new TypeError('The super constructor to "inherits" must not be null or undefined');
  }
  if (superCtor.prototype === undefined) {
    throw new TypeError('The super constructor to "inherits" must have a prototype');
  }
  Object.defineProperty(ctor, 'super_', { value: superCtor, writable: true, configurable: true });
  Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
}

// ---- Legacy type checking (deprecated but still used) ----

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isNull(value: unknown): value is null {
  return value === null;
}

export function isNullOrUndefined(value: unknown): value is null | undefined {
  return value == null;
}

export function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function isSymbol(value: unknown): value is symbol {
  return typeof value === 'symbol';
}

export function isUndefined(value: unknown): value is undefined {
  return value === undefined;
}

export function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

export function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}

export function isRegExp(value: unknown): value is RegExp {
  return value instanceof RegExp;
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function isPrimitive(value: unknown): boolean {
  return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

export function isDate(value: unknown): value is Date {
  return value instanceof Date;
}

export function isBuffer(value: unknown): boolean {
  return value instanceof Uint8Array && (value as unknown as { constructor?: { name?: string } }).constructor?.name === 'Buffer';
}

// ---- Re-export globals ----

export const TextDecoder = globalThis.TextDecoder;
export const TextEncoder = globalThis.TextEncoder;

// ---- isDeepStrictEqual ----

export function isDeepStrictEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;

  if (Array.isArray(aObj) && Array.isArray(bObj)) {
    if (aObj.length !== bObj.length) return false;
    for (let i = 0; i < aObj.length; i++) {
      if (!isDeepStrictEqual(aObj[i], bObj[i])) return false;
    }
    return true;
  }

  if (Array.isArray(aObj) !== Array.isArray(bObj)) return false;

  if (aObj instanceof Date && bObj instanceof Date) {
    return aObj.getTime() === bObj.getTime();
  }

  if (aObj instanceof RegExp && bObj instanceof RegExp) {
    return aObj.source === bObj.source && aObj.flags === bObj.flags;
  }

  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!isDeepStrictEqual(aObj[key], bObj[key])) return false;
  }

  return true;
}

// ---- toUSVString ----

export function toUSVString(string: string): string {
  if (typeof (string as unknown as { toWellFormed?: () => string }).toWellFormed === 'function') {
    return (string as unknown as { toWellFormed: () => string }).toWellFormed();
  }
  // Fallback
  return string.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

// ---- Default export ----

export default {
  format,
  formatWithOptions,
  inspect,
  promisify,
  callbackify,
  deprecate,
  debuglog,
  inherits,
  types,
  isBoolean,
  isNull,
  isNullOrUndefined,
  isNumber,
  isString,
  isSymbol,
  isUndefined,
  isObject,
  isError,
  isFunction,
  isRegExp,
  isArray,
  isPrimitive,
  isDate,
  isBuffer,
  isDeepStrictEqual,
  toUSVString,
  TextDecoder: globalThis.TextDecoder,
  TextEncoder: globalThis.TextEncoder,
  getSystemErrorName,
  getSystemErrorMap,
};
