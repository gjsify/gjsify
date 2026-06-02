// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — wraps native Worker +
// MessageChannel + BroadcastChannel.
//
// Reference: Node.js lib/worker_threads.js, lib/internal/worker.js.
// Web mapping cross-checked against refs/deno/ext/node/polyfills/worker_threads.ts.
//
// This file is the browser entry point selected by the package's `"browser"`
// field + `exports."."` `"browser"` condition (Rolldown/Vite browser builds
// honour both via `mainFields:['browser','module','main']` and
// `conditionNames:['import','browser']`).
//
// Strategy: the browser already ships Web Workers + MessageChannel +
// MessagePort + BroadcastChannel natively. We thin-wrap them into the
// Node `worker_threads` surface:
//
//   - `Worker`          → wraps `globalThis.Worker` with the Node-shape API
//                          (`on('message'|'error'|'messageerror'|'exit'|'online')`,
//                          `postMessage`, `terminate`, `ref`/`unref`).
//   - `MessageChannel`  → re-exports `globalThis.MessageChannel`.
//   - `MessagePort`     → re-exports `globalThis.MessagePort`.
//   - `BroadcastChannel`→ re-exports `globalThis.BroadcastChannel`.
//   - `parentPort`      → in a DedicatedWorkerGlobalScope, a proxy over
//                          `globalThis.self` exposing `postMessage` + the
//                          Node `on('message')` shape. `null` in the main
//                          page context.
//   - `workerData`      → populated from the spawner's initial
//                          `{ __gjsifyWorkerData }` envelope (see below).
//   - `isMainThread`    → `true` when not inside a Worker scope.
//   - `threadId`        → `0` in main, a stable random non-zero id in a
//                          Worker (no real OS thread ids on the Web).
//   - `SHARE_ENV`       → symbol stub (Workers inherit no environment).
//   - `getEnvironmentData`/`setEnvironmentData` → in-process Map.
//
// workerData transport (no native Web equivalent):
//   Web Workers receive only a URL + options — there is no init payload slot.
//   We carry `options.workerData` as the spawner's FIRST `postMessage`,
//   wrapped in a `{ __gjsifyWorkerData: value }` envelope, with the user's
//   `transferList` attached. Inside the worker, `parentPort` recognises that
//   envelope, strips it (so user `on('message')` handlers never see it), and
//   populates the exported `workerData`. Because ESM module init is
//   synchronous while message delivery is async, `workerData` is `null` at
//   import time and filled on the first macrotask — consumers that need it
//   synchronously must `await onWorkerData()` (resolves once the envelope
//   lands, or immediately if it already has). Node's `workerData` is
//   available synchronously; this is the one shape gap.
//
// Honest gaps (slot: partial):
//   - `'exit'` has no native trigger — Web Workers don't surface a numeric
//     exit code. We emit it from `terminate()` (code 1) and from a
//     cooperative `{ __gjsifyWorkerExit: code }` envelope a worker may post
//     to signal voluntary shutdown. A worker that simply runs to idle emits
//     no `'exit'` (Node would emit code 0).
//   - `'online'` has no native signal — we emit it on the next microtask
//     after construction (best-effort "the Worker object exists"), not a
//     confirmed "worker code is running" handshake.
//   - `resourceLimits` is an empty object (ENOTSUP — no Web equivalent).
//   - No stdio (`stdin`/`stdout`/`stderr`) — Web Workers have no streams.
//   - `receiveMessageOnPort` returns `undefined` — the browser MessagePort
//     has no synchronous-drain API; use `on('message', …)` instead.
//   - SharedArrayBuffer transfer relies on the host enabling cross-origin
//     isolation (COOP/COEP); we don't fake it.

type Listener = (...args: unknown[]) => void;

// ─── Worker scope detection ─────────────────────────────────────────────────
// `DedicatedWorkerGlobalScope` is defined inside a Web Worker only. We probe
// via `typeof` to avoid `ReferenceError` outside a Worker — and we keep the
// probe a single boolean so the rest of the file can branch off it.

const _inWorkerScope: boolean =
    typeof (globalThis as { DedicatedWorkerGlobalScope?: unknown }).DedicatedWorkerGlobalScope !== 'undefined' &&
    typeof (globalThis as { importScripts?: unknown }).importScripts === 'function';

export const isMainThread: boolean = !_inWorkerScope;
// Math.floor(Math.random()*…)+1 keeps `threadId !== 0` for Workers — Node uses
// 0 for the main thread, so any positive integer is a valid Worker id.
export const threadId: number = _inWorkerScope ? Math.floor(Math.random() * 0x7fffffff) + 1 : 0;
export const resourceLimits: Record<string, unknown> = {};
export const SHARE_ENV: unique symbol = Symbol('worker_threads.SHARE_ENV');

// ─── workerData transport envelopes ─────────────────────────────────────────
// Sent as the spawner's first message; recognised + stripped by parentPort.

const WORKER_DATA_KEY = '__gjsifyWorkerData';
const WORKER_EXIT_KEY = '__gjsifyWorkerExit';

function isWorkerDataEnvelope(data: unknown): data is { [WORKER_DATA_KEY]: unknown } {
    return typeof data === 'object' && data !== null && WORKER_DATA_KEY in data;
}

// `workerData` cannot be filled synchronously on the Web (the payload arrives
// as an async message). It starts `null` and is replaced once the envelope
// lands. `onWorkerData()` resolves with the value (immediately if already set).
let _workerData: unknown = null;
let _workerDataReceived = false;
const _workerDataWaiters: Array<(value: unknown) => void> = [];

function _setWorkerData(value: unknown): void {
    _workerData = value;
    _workerDataReceived = true;
    while (_workerDataWaiters.length > 0) {
        _workerDataWaiters.shift()!(value);
    }
}

export let workerData: unknown = _workerData;

/**
 * Resolves with the value the spawner passed as `options.workerData`.
 * Resolves immediately if the envelope already arrived. Outside a Worker scope
 * (main page), resolves with `null`. This is the browser-faithful replacement
 * for Node's synchronously-available `workerData`.
 */
export function onWorkerData(): Promise<unknown> {
    if (!_inWorkerScope || _workerDataReceived) return Promise.resolve(_workerData);
    return new Promise((resolve) => _workerDataWaiters.push(resolve));
}

// ─── Native re-exports ──────────────────────────────────────────────────────

export const MessageChannel: typeof globalThis.MessageChannel = globalThis.MessageChannel;
export const MessagePort: typeof globalThis.MessagePort = globalThis.MessagePort;
export const BroadcastChannel: typeof globalThis.BroadcastChannel = globalThis.BroadcastChannel;

// ─── parentPort — proxy over `self` in a Worker scope ──────────────────────
// Inside a Worker, `globalThis.self.postMessage(data)` is the way to send a
// message back to the spawning page. We wrap it so Node-style code calling
// `parentPort.on('message', cb)` / `parentPort.postMessage(x)` works.

interface NodeParentPort {
    postMessage(value: unknown, transferList?: Transferable[]): void;
    on(event: 'message' | 'messageerror' | 'close', listener: Listener): NodeParentPort;
    off(event: 'message' | 'messageerror' | 'close', listener: Listener): NodeParentPort;
    once(event: 'message' | 'messageerror' | 'close', listener: Listener): NodeParentPort;
    addListener(event: 'message' | 'messageerror' | 'close', listener: Listener): NodeParentPort;
    removeListener(event: 'message' | 'messageerror' | 'close', listener: Listener): NodeParentPort;
    close(): void;
    start(): void;
    ref(): void;
    unref(): void;
}

interface WorkerScope {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    addEventListener(type: string, listener: (e: unknown) => void): void;
    removeEventListener(type: string, listener: (e: unknown) => void): void;
    close?(): void;
}

function makeParentPort(): NodeParentPort {
    const w = globalThis as unknown as WorkerScope;
    const onceWrappers = new Map<Listener, (e: unknown) => void>();

    // Intercept the spawner's first message: if it is a workerData envelope,
    // capture it and swallow it so user `message` handlers don't observe it.
    // Anything else flows through untouched.
    const dataInterceptor = (e: unknown) => {
        const data = (e as { data?: unknown }).data;
        if (isWorkerDataEnvelope(data)) {
            w.removeEventListener('message', dataInterceptor);
            _setWorkerData(data[WORKER_DATA_KEY]);
        }
    };
    w.addEventListener('message', dataInterceptor);

    // Forward a user listener, skipping any workerData envelope so it can never
    // leak into user code even if it arrives after a listener is attached.
    const makeForwarder = (listener: Listener) => (e: unknown) => {
        const data = (e as { data?: unknown }).data;
        if (isWorkerDataEnvelope(data)) return;
        listener(data);
    };

    return {
        postMessage(value, transferList) {
            // The Web `postMessage` shape on a Worker scope is
            // `postMessage(message, transfer?)`.
            if (transferList && transferList.length > 0) {
                w.postMessage(value, transferList);
            } else {
                w.postMessage(value);
            }
        },
        on(event, listener) {
            const type = event === 'close' ? 'close' : event === 'messageerror' ? 'messageerror' : 'message';
            const wrapped = type === 'message' ? makeForwarder(listener) : (e: unknown) => listener((e as { data?: unknown }).data);
            (listener as Listener & { __wrapped?: (e: unknown) => void }).__wrapped = wrapped;
            w.addEventListener(type, wrapped);
            return this;
        },
        off(event, listener) {
            const type = event === 'close' ? 'close' : event === 'messageerror' ? 'messageerror' : 'message';
            const wrapped = (listener as Listener & { __wrapped?: (e: unknown) => void }).__wrapped;
            if (wrapped) w.removeEventListener(type, wrapped);
            return this;
        },
        once(event, listener) {
            const type = event === 'close' ? 'close' : event === 'messageerror' ? 'messageerror' : 'message';
            const forward = type === 'message' ? makeForwarder(listener) : (e: unknown) => listener((e as { data?: unknown }).data);
            const wrapped = (e: unknown) => {
                if (type === 'message' && isWorkerDataEnvelope((e as { data?: unknown }).data)) return;
                w.removeEventListener(type, wrapped);
                onceWrappers.delete(listener);
                forward(e);
            };
            onceWrappers.set(listener, wrapped);
            w.addEventListener(type, wrapped);
            return this;
        },
        addListener(event, listener) {
            return this.on(event, listener);
        },
        removeListener(event, listener) {
            return this.off(event, listener);
        },
        close() {
            w.close?.();
        },
        // The native worker scope delivers messages without an explicit start;
        // `start()` exists for Node-shape parity and is a no-op.
        start() {},
        ref() {},
        unref() {},
    };
}

export const parentPort: NodeParentPort | null = _inWorkerScope ? makeParentPort() : null;

// ─── Worker — Node-shape wrapper over the native Web Worker ────────────────

export interface WorkerOptions {
    workerData?: unknown;
    transferList?: Transferable[];
    name?: string;
    type?: 'classic' | 'module';
    /** Accepted for Node parity; no Web equivalent (ENOTSUP). */
    resourceLimits?: Record<string, number>;
    /** Accepted for Node parity; ignored on the Web. */
    argv?: unknown[];
    /** Accepted for Node parity; ignored on the Web. */
    execArgv?: string[];
    /** Accepted for Node parity; ignored on the Web. */
    env?: Record<string, string> | symbol;
}

export class Worker {
    private _worker: globalThis.Worker;
    private _listeners = new Map<string, Set<Listener>>();
    private _exited = false;
    readonly threadId: number;
    readonly resourceLimits: Record<string, unknown>;

    constructor(filename: string | URL, options?: WorkerOptions) {
        const url = filename instanceof URL ? filename : String(filename);
        // Default to `type:'module'` so ESM workers work without ceremony —
        // matches the Vite/Rolldown convention for `new Worker(url, {type:'module'})`.
        this._worker = new globalThis.Worker(url, { type: options?.type ?? 'module', name: options?.name });
        this.threadId = Math.floor(Math.random() * 0x7fffffff) + 1;
        this.resourceLimits = options?.resourceLimits ?? {};

        this._worker.addEventListener('message', (e) => {
            const data = (e as MessageEvent).data;
            // A worker may post a cooperative exit envelope to surface a
            // Node-style numeric exit code (the Web has no native one).
            if (typeof data === 'object' && data !== null && WORKER_EXIT_KEY in data) {
                const code = (data as Record<string, unknown>)[WORKER_EXIT_KEY];
                this._worker.terminate();
                this._emitExit(typeof code === 'number' ? code : 0);
                return;
            }
            this._emit('message', data);
        });
        this._worker.addEventListener('messageerror', (e) => this._emit('messageerror', (e as MessageEvent).data));
        this._worker.addEventListener('error', (e) => this._emit('error', (e as ErrorEvent).error ?? e));

        // Hand the worker its init payload as the first message. The worker's
        // `parentPort` recognises + strips the envelope (see makeParentPort).
        // Posted unconditionally so the worker can always read `workerData`
        // (an absent option yields `undefined`, matching Node).
        const envelope = { [WORKER_DATA_KEY]: options?.workerData };
        const transferList = options?.transferList;
        if (transferList && transferList.length > 0) {
            this._worker.postMessage(envelope, transferList);
        } else {
            this._worker.postMessage(envelope);
        }

        // No native "online" signal on the Web — emit best-effort on the next
        // microtask so listeners attached synchronously after construction fire.
        queueMicrotask(() => this._emit('online'));
    }

    private _emit(event: string, ...args: unknown[]): void {
        const set = this._listeners.get(event);
        if (!set) return;
        for (const fn of [...set]) fn(...args);
    }

    private _emitExit(code: number): void {
        if (this._exited) return;
        this._exited = true;
        this._emit('exit', code);
    }

    on(event: string, listener: Listener): this {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event)!.add(listener);
        return this;
    }

    off(event: string, listener: Listener): this {
        this._listeners.get(event)?.delete(listener);
        return this;
    }

    once(event: string, listener: Listener): this {
        const wrapped = (...args: unknown[]) => {
            this.off(event, wrapped);
            listener(...args);
        };
        return this.on(event, wrapped);
    }

    addListener(event: string, listener: Listener): this {
        return this.on(event, listener);
    }

    removeListener(event: string, listener: Listener): this {
        return this.off(event, listener);
    }

    postMessage(value: unknown, transferList?: Transferable[]): void {
        if (transferList && transferList.length > 0) {
            this._worker.postMessage(value, transferList);
        } else {
            this._worker.postMessage(value);
        }
    }

    /**
     * Terminates the underlying Web Worker. Resolves with exit code 1 — Web
     * Workers can't surface a Node-style numeric exit; a cooperative worker
     * may instead post `{ __gjsifyWorkerExit: code }` before stopping.
     */
    async terminate(): Promise<number> {
        this._worker.terminate();
        this._emitExit(1);
        return 1;
    }

    /** No-op — the Web has no event-loop ref counting. */
    ref(): void {}
    /** No-op — the Web has no event-loop ref counting. */
    unref(): void {}
}

// ─── environmentData — in-process Map (no cross-Worker propagation) ────────
// Node propagates environmentData to spawned Workers automatically. On the
// Web there's no equivalent — each Worker is a fresh script. Consumers that
// need shared state should use BroadcastChannel or postMessage.

const _environmentData = new Map<string, unknown>();

export function setEnvironmentData(key: string, value: unknown): void {
    if (value === undefined) {
        _environmentData.delete(key);
    } else {
        _environmentData.set(key, value);
    }
}

export function getEnvironmentData(key: string): unknown {
    return _environmentData.get(key);
}

// ─── receive / clone stubs ──────────────────────────────────────────────────

export function receiveMessageOnPort(_port: MessagePort): { message: unknown } | undefined {
    // The browser MessagePort has no synchronous-drain API; messages are
    // delivered via the event loop only. Return undefined unconditionally
    // — consumers should switch to `on('message',…)` in the browser path.
    return undefined;
}

export function markAsUntransferable(_object: unknown): void {}
export function markAsUncloneable(_object: unknown): void {}
export function moveMessagePortToContext<T>(port: T, _context: unknown): T {
    return port;
}

export default {
    isMainThread,
    parentPort,
    workerData,
    onWorkerData,
    threadId,
    resourceLimits,
    SHARE_ENV,
    Worker,
    MessageChannel,
    MessagePort,
    BroadcastChannel,
    setEnvironmentData,
    getEnvironmentData,
    receiveMessageOnPort,
    markAsUntransferable,
    markAsUncloneable,
    moveMessagePortToContext,
};
