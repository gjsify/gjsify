// SPDX-License-Identifier: MIT
// Adapted from refs/process (Roman Shtylman / defunctzombie, MIT). Reimplemented
// for @gjsify browser target.
//
// Reference: refs/process/browser.js
// Original: Copyright (c) 2013 Roman Shtylman <shtylman@gmail.com>. MIT.
//
// This module is the `@gjsify/process` entry the bundler picks up when
// `gjsify build --app browser` resolves `process` / `node:process` /
// `@gjsify/process` (per `ALIASES_NODE_FOR_BROWSER` in
// `packages/infra/resolve-npm/lib/index.mjs`, PR #388). The full GJS impl
// (`./index.js`) is GLib + Gio bound (env, paths, native terminal,
// process.binding, …) and cannot run in a browser; this entry exposes the
// minimal subset every npm consumer expects: `nextTick`, an empty `env`,
// `cwd()='/'`, `platform='browser'`, `browser=true`, EventEmitter no-op
// listeners, and stdin/stdout/stderr stubs that drop writes.

const NOOP = (): void => {};

interface NextTickItem {
    fun: (...args: unknown[]) => void;
    args: unknown[];
}

// nextTick queue — batched via queueMicrotask so we stay on the microtask
// turn (which is the closest browser semantic to Node's process.nextTick;
// browser code that switches between Promises and process.nextTick observes
// the same ordering as queueMicrotask + Promise.then).
let _queue: NextTickItem[] = [];
let _draining = false;

function _drain(): void {
    if (_draining) return;
    _draining = true;
    while (_queue.length > 0) {
        const batch = _queue;
        _queue = [];
        for (const item of batch) {
            try {
                item.fun(...item.args);
            } catch (err) {
                // Mirror Node: an uncaught nextTick throw becomes an
                // uncaughtException on the global handler. Without an
                // EventEmitter underneath we fall back to console.error.
                queueMicrotask(() => {
                    throw err;
                });
            }
        }
    }
    _draining = false;
}

function nextTick(fun: (...args: unknown[]) => void, ...args: unknown[]): void {
    _queue.push({ fun, args });
    if (!_draining && _queue.length === 1) {
        queueMicrotask(_drain);
    }
}

// Minimal stdin / stdout / stderr stubs. Streaming APIs are NOT implemented;
// we expose the property surface every TTY-detector probes: `isTTY` (false in
// browser), `write(...)` no-op, `setRawMode()` returns this for chainability.
const _stdoutStub = {
    isTTY: false as const,
    columns: 80,
    rows: 24,
    write(_chunk: string | Uint8Array, _enc?: string, cb?: () => void): boolean {
        if (typeof cb === 'function') queueMicrotask(cb);
        return true;
    },
    end(_chunk?: string | Uint8Array, _enc?: string, cb?: () => void): void {
        if (typeof cb === 'function') queueMicrotask(cb);
    },
    on: NOOP,
    once: NOOP,
    off: NOOP,
    addListener: NOOP,
    removeListener: NOOP,
    removeAllListeners: NOOP,
    emit: () => false,
    setRawMode(_value: boolean) {
        return this;
    },
};

const _stdinStub = {
    isTTY: false as const,
    readable: false,
    on: NOOP,
    once: NOOP,
    off: NOOP,
    addListener: NOOP,
    removeListener: NOOP,
    removeAllListeners: NOOP,
    emit: () => false,
    pause() {
        return this;
    },
    resume() {
        return this;
    },
    setEncoding(_enc: string) {
        return this;
    },
    setRawMode(_value: boolean) {
        return this;
    },
    read() {
        return null;
    },
};

// EventEmitter no-op surface. The defunctzombie shim returns `[]` for
// listeners(name) and accepts any event registration, never emitting.
const _emitterMethods = {
    on: NOOP,
    addListener: NOOP,
    once: NOOP,
    off: NOOP,
    removeListener: NOOP,
    removeAllListeners: NOOP,
    emit: () => false,
    prependListener: NOOP,
    prependOnceListener: NOOP,
    listeners: (_name: string): unknown[] => [],
    rawListeners: (_name: string): unknown[] => [],
    listenerCount: (_name: string): number => 0,
    eventNames: (): string[] => [],
    getMaxListeners: (): number => Infinity,
    setMaxListeners: NOOP,
};

const browserProcess = {
    // Identity
    title: 'browser',
    browser: true as const,
    version: '',
    versions: {} as Record<string, string>,
    platform: 'browser' as NodeJS.Platform,
    arch: 'browser' as NodeJS.Architecture,
    pid: 0,
    ppid: 0,

    // Working dir / env
    env: {} as Record<string, string | undefined>,
    argv: [] as string[],
    argv0: 'browser',
    execPath: '',
    execArgv: [] as string[],
    config: Object.create(null) as Record<string, unknown>,

    // Streams (typed as `any` so consumers' `process.stdout.write(...)` etc.
    // resolve through the W3C Writable surface — we ship a structural subset).
    stdin: _stdinStub,
    stdout: _stdoutStub,
    stderr: _stdoutStub,

    // Lifecycle
    nextTick,
    cwd: (): string => '/',
    chdir: (_dir: string): void => {
        throw new Error('process.chdir is not supported in the browser');
    },
    umask: (): number => 0,
    exit(_code?: number): never {
        throw new Error('process.exit is not supported in the browser');
    },
    abort(): never {
        throw new Error('process.abort is not supported in the browser');
    },
    kill: (_pid: number, _signal?: string | number): boolean => false,

    // Timing
    uptime: (): number => 0,
    hrtime: Object.assign((_time?: [number, number]): [number, number] => [0, 0], { bigint: (): bigint => 0n }),

    // Memory / CPU stubs
    memoryUsage: Object.assign(
        () => ({
            rss: 0,
            heapTotal: 0,
            heapUsed: 0,
            external: 0,
            arrayBuffers: 0,
        }),
        { rss: (): number => 0 },
    ),
    cpuUsage: (_previous?: { user: number; system: number }): { user: number; system: number } => ({
        user: 0,
        system: 0,
    }),

    // Diagnostics
    emitWarning: NOOP,
    binding: (_name: string): never => {
        throw new Error('process.binding is not supported in the browser');
    },

    // EventEmitter no-ops
    ..._emitterMethods,
};

// Named exports — match `import { x } from 'node:process'` shape.
export const platform = browserProcess.platform;
export const arch = browserProcess.arch;
export const env = browserProcess.env;
export const argv = browserProcess.argv;
export const argv0 = browserProcess.argv0;
export const execPath = browserProcess.execPath;
export const execArgv = browserProcess.execArgv;
export const pid = browserProcess.pid;
export const ppid = browserProcess.ppid;
export const version = browserProcess.version;
export const versions = browserProcess.versions;
export const title = browserProcess.title;
export const browser = browserProcess.browser;
export const config = browserProcess.config;
export const stdin = browserProcess.stdin;
export const stdout = browserProcess.stdout;
export const stderr = browserProcess.stderr;
export const cwd = browserProcess.cwd;
export const chdir = browserProcess.chdir;
export const exit = browserProcess.exit;
export const abort = browserProcess.abort;
export const umask = browserProcess.umask;
export const kill = browserProcess.kill;
export const uptime = browserProcess.uptime;
export const hrtime = browserProcess.hrtime;
export const memoryUsage = browserProcess.memoryUsage;
export const cpuUsage = browserProcess.cpuUsage;
export const emitWarning = browserProcess.emitWarning;
export const binding = browserProcess.binding;
export { nextTick };

export default browserProcess;
