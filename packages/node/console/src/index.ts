// Reference: Node.js lib/internal/console/constructor.js
// Reimplemented for GJS using print()/printerr() on GJS, global console on Node.js

import type { ConsoleOptions } from 'node:console';

// GJS has global print() and printerr() — use them to bypass GLib.log_structured()
// which adds the "Gjs-Console-Message:" prefix and prevents ANSI interpretation.
const _isGJS = typeof print === 'function' && typeof printerr === 'function';

declare function print(...args: unknown[]): void;
declare function printerr(...args: unknown[]): void;

// Value rendering. `JSON.stringify` is this module's vocabulary for every value
// EXCEPT an Error, which it destroys: `message` and `stack` are own but
// NON-ENUMERABLE, so `JSON.stringify(new Error('boom'))` is `{}`, and an Error
// subclass assigning `this.name`/`this.code` degrades to
// `{"name":"GtkHostError","code":"unknown-tag"}` — the code and nothing else.
// Every `--app gjs` bundle routes `console.error` through here (the rolldown
// console shim), which is how a swallowed `<KeepAlive>` failure in a GTK app
// printed one line naming neither the feature nor the cause.

// `cause`/`errors` are rendered explicitly below, `name`/`message`/`stack` are in
// the header — so none of them belongs in the appended own-property object.
const _ERROR_KEYS_RENDERED_ELSEWHERE = ['name', 'message', 'stack', 'cause', 'errors'];

// `Error.isError` is the [[ErrorData]] brand check and survives realm boundaries;
// measured present on gjs 1.88.1, node 24 and the firefox140 build target. The
// `instanceof` arm serves the nativescript slot, whose JSC version is not pinned
// by this repo.
function _isError(value: unknown): value is Error {
    return typeof Error.isError === 'function' ? Error.isError(value) : value instanceof Error;
}

/** `Name: message` — or whichever half is non-empty. */
function _errorHeader(err: Error): string {
    const name = typeof err.name === 'string' && err.name.length > 0 ? err.name : 'Error';
    const message = typeof err.message === 'string' ? err.message : '';
    return message.length > 0 ? `${name}: ${message}` : name;
}

function _indentContinuation(text: string, pad: string): string {
    return text.split('\n').join('\n' + pad);
}

/**
 * An Error rendered the way a developer needs it: name, message, stack, and
 * everything else it carries.
 *
 * The stack is appended to a header built here rather than used alone, because
 * the two engines disagree about what `err.stack` holds: V8 prefixes it with
 * `Name: message`, SpiderMonkey does NOT — measured on gjs 1.88.1 it is frames
 * only (`GtkHostError@file:///…`) and `stack` is not even an own property there.
 * `err.stack` alone would therefore drop the message on the one runtime this
 * package exists for.
 */
function _formatError(err: Error, seen: Set<unknown>): string {
    const header = _errorHeader(err);
    // A cause chain may be cyclic; without this the formatter would hang the
    // process while formatting the error that was meant to explain a failure.
    if (seen.has(err)) return `[Circular ${header}]`;
    seen.add(err);

    const stack = typeof err.stack === 'string' ? err.stack.replace(/\n+$/, '') : '';
    let out = stack.length === 0 ? header : stack.startsWith(header) ? stack : `${header}\n${stack}`;

    const extras: Record<string, unknown> = {};
    let hasExtras = false;
    for (const key of Object.keys(err)) {
        if (_ERROR_KEYS_RENDERED_ELSEWHERE.includes(key)) continue;
        extras[key] = (err as unknown as Record<string, unknown>)[key];
        hasExtras = true;
    }
    if (hasExtras) out += ' ' + _stringify(extras, seen);

    // `cause` and `errors` are own but NON-ENUMERABLE when they come from
    // `new Error(msg, { cause })` / `new AggregateError(list, msg)` — measured on
    // node 24 and gjs 1.88.1 — so `Object.keys` above cannot see them, and
    // dropping them reproduces this very bug one level down the chain.
    const cause = (err as { cause?: unknown }).cause;
    if (cause !== undefined) {
        out += '\n  [cause]: ' + _indentContinuation(_formatValue(cause, seen), '  ');
    }
    const errors = (err as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
        for (let i = 0; i < errors.length; i++) {
            out += `\n  [errors][${i}]: ` + _indentContinuation(_formatValue(errors[i], seen), '  ');
        }
    }

    seen.delete(err);
    return out;
}

/**
 * `JSON.stringify` with Errors mapped to their rendered form, so an Error nested
 * in an array or object is not silently emptied either. For a graph containing no
 * Error the replacer is the identity and the output is byte-identical to a plain
 * `JSON.stringify` — including `undefined` for `undefined`/symbols/functions.
 */
function _stringify(value: unknown, seen: Set<unknown>): string {
    try {
        return JSON.stringify(value, (_key, nested) => (_isError(nested) ? _formatError(nested, seen) : nested));
    } catch (thrown) {
        // A real throw path, not a defensive catch: `JSON.stringify` throws
        // TypeError on a circular structure and on a BigInt anywhere in the graph.
        // Losing the whole line is the failure this module is being fixed for, so
        // the unrenderable value degrades to a marker and the line survives.
        return `[unserializable: ${_isError(thrown) ? thrown.message : String(thrown)}]`;
    }
}

function _formatValue(value: unknown, seen: Set<unknown>): string {
    return _isError(value) ? _formatError(value, seen) : _stringify(value, seen);
}

// Basic printf-style format specifier handling to match Node.js util.format behavior.
// Handles %s, %d, %i, %f, %o, %O — joins remaining args with spaces.
function _formatArgs(...args: unknown[]): string {
    // One set for the whole call: `_formatError` removes what it adds, so it is
    // empty again between arguments and a repeated Error still renders in full.
    const seen = new Set<unknown>();
    const fmt = args[0];
    const rest = args.slice(1);
    if (typeof fmt !== 'string' || !/%(s|d|i|f|o|O|c)/.test(fmt)) {
        // No format specifiers — join all args with spaces
        return args.map((a) => (typeof a === 'string' ? a : _formatValue(a, seen))).join(' ');
    }
    let i = 0;
    const result = fmt.replace(/%([sdifOoc])/g, (_match, spec) => {
        if (i >= rest.length) return _match;
        const val = rest[i++];
        switch (spec) {
            case 's':
                // Node prints the STACK for `%s` of an Error, not `String(err)`.
                return _isError(val) ? _formatError(val, seen) : String(val);
            case 'd':
            case 'i':
                return String(parseInt(String(val), 10));
            case 'f':
                return String(parseFloat(String(val)));
            case 'o':
            case 'O':
                return _formatValue(val, seen);
            case 'c':
                return ''; // CSS styles — ignore
            default:
                return _match;
        }
    });
    // Append remaining args
    const remaining = rest.slice(i);
    if (remaining.length === 0) return result;
    return result + ' ' + remaining.map((a) => (typeof a === 'string' ? a : _formatValue(a, seen))).join(' ');
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
        stderr?: { write: (data: string) => void },
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
        const target = stream === 'stderr' ? this._stderr || this._stdout : this._stdout;
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

    log(...args: unknown[]): void {
        this._write('stdout', ...args);
    }
    info(...args: unknown[]): void {
        this._write('stdout', ...args);
    }
    debug(...args: unknown[]): void {
        this._write('stdout', ...args);
    }
    warn(...args: unknown[]): void {
        this._write('stderr', ...args);
    }
    error(...args: unknown[]): void {
        this._write('stderr', ...args);
    }

    dir(obj: unknown, _options?: object): void {
        this._write('stdout', obj);
    }
    dirxml(...args: unknown[]): void {
        this.log(...args);
    }

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

    profile(_label?: string): void {
        /* No-op in non-browser environments */
    }
    profileEnd(_label?: string): void {
        /* No-op in non-browser environments */
    }
    timeStamp(_label?: string): void {
        /* No-op in non-browser environments */
    }
}

// Module-level singleton — all named exports delegate to this instance.
// On GJS it uses print()/printerr(); on Node.js it delegates to globalThis.console.
const _default = new Console();

export const log = (...args: unknown[]) => _default.log(...args);
export const info = (...args: unknown[]) => _default.info(...args);
export const debug = (...args: unknown[]) => _default.debug(...args);
export const warn = (...args: unknown[]) => _default.warn(...args);
export const error = (...args: unknown[]) => _default.error(...args);
export const dir = (obj: unknown, options?: object) => _default.dir(obj, options);
export const dirxml = (...args: unknown[]) => _default.dirxml(...args);
export const table = (data: unknown, properties?: string[]) => _default.table(data, properties);
export const clear = () => _default.clear();
export const assert = (value: unknown, ...args: unknown[]) => _default.assert(value, ...args);
export const trace = (...args: unknown[]) => _default.trace(...args);
export const time = (label?: string) => _default.time(label);
export const timeEnd = (label?: string) => _default.timeEnd(label);
export const timeLog = (label?: string, ...args: unknown[]) => _default.timeLog(label, ...args);
export const count = (label?: string) => _default.count(label);
export const countReset = (label?: string) => _default.countReset(label);
export const group = (...args: unknown[]) => _default.group(...args);
export const groupCollapsed = (...args: unknown[]) => _default.groupCollapsed(...args);
export const groupEnd = () => _default.groupEnd();
export const profile = (_label?: string) => {};
export const profileEnd = (_label?: string) => {};
export const timeStamp = (_label?: string) => {};

// Default export: console-like object with Console class attached
const consoleModule = {
    Console,
    log,
    info,
    debug,
    warn,
    error,
    dir,
    dirxml,
    table,
    time,
    timeEnd,
    timeLog,
    trace,
    assert,
    clear,
    count,
    countReset,
    group,
    groupCollapsed,
    groupEnd,
    profile,
    profileEnd,
    timeStamp,
};

export default consoleModule;
