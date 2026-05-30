// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — wraps native Worker +
// MessageChannel + BroadcastChannel.
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
//   - `Worker`          → wraps `globalThis.Worker` with a Node-shape API
//                          (`on('message'|'error'|'exit')`, `postMessage`,
//                          `terminate`, `ref`/`unref` stubs).
//   - `MessageChannel`  → re-exports `globalThis.MessageChannel`.
//   - `MessagePort`     → re-exports `globalThis.MessagePort`.
//   - `BroadcastChannel`→ re-exports `globalThis.BroadcastChannel`.
//   - `parentPort`      → in a DedicatedWorkerGlobalScope, a proxy over
//                          `globalThis.self` exposing `postMessage` + the
//                          Node `on('message')` shape. `null` in the main
//                          page context.
//   - `isMainThread`    → `true` when not inside a Worker scope.
//   - `threadId`        → `0` in main, a stable random non-zero id in a
//                          Worker (no real OS thread ids on the Web).
//   - `workerData`      → `{}` (no userland-driven init payload on Web
//                          Workers — they only get a URL + options).
//   - `SHARE_ENV`       → symbol stub (Workers inherit no environment).
//   - `MessagePort.unref()` stays a no-op (Web has no ref counting).
//   - `getEnvironmentData`/`setEnvironmentData` → in-process Map.
//
// Known gaps (slot: partial):
//   - No `workerData` payload — pass data via the first `postMessage`.
//   - No `transferList` on the Node-shape Worker.postMessage (we forward
//     the second arg to the native `Worker.postMessage`, so a real
//     `Transferable[]` still works — the gap is shape, not behaviour).
//   - `terminate()` returns a resolved Promise<number> (always exit code
//     1) — Web Workers can't surface a Node-style numeric exit.
//   - No `MessagePort.unref()` semantics — Web has no event-loop refs.
//   - `resourceLimits` is an empty object.

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
export const workerData: Record<string, unknown> = {};
export const resourceLimits: Record<string, unknown> = {};
export const SHARE_ENV: unique symbol = Symbol('worker_threads.SHARE_ENV');

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
    close(): void;
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
            const wrapped = (e: unknown) => listener((e as { data?: unknown }).data);
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
            const wrapped = (e: unknown) => {
                w.removeEventListener(type, wrapped);
                onceWrappers.delete(listener);
                listener((e as { data?: unknown }).data);
            };
            onceWrappers.set(listener, wrapped);
            w.addEventListener(type, wrapped);
            return this;
        },
        close() {
            w.close?.();
        },
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
}

export class Worker {
    private _worker: globalThis.Worker;
    private _listeners = new Map<string, Set<Listener>>();
    threadId: number;

    constructor(filename: string | URL, options?: WorkerOptions) {
        const url = filename instanceof URL ? filename : String(filename);
        // Default to `type:'module'` so ESM workers work without ceremony —
        // matches the Vite/Rolldown convention for `new Worker(url, {type:'module'})`.
        this._worker = new globalThis.Worker(url, { type: options?.type ?? 'module', name: options?.name });
        this.threadId = Math.floor(Math.random() * 0x7fffffff) + 1;

        this._worker.addEventListener('message', (e) => this._emit('message', (e as MessageEvent).data));
        this._worker.addEventListener('messageerror', (e) => this._emit('messageerror', (e as MessageEvent).data));
        this._worker.addEventListener('error', (e) => this._emit('error', (e as ErrorEvent).error ?? e));
    }

    private _emit(event: string, ...args: unknown[]): void {
        const set = this._listeners.get(event);
        if (!set) return;
        for (const fn of [...set]) fn(...args);
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

    async terminate(): Promise<number> {
        this._worker.terminate();
        this._emit('exit', 1);
        return 1;
    }

    ref(): void {}
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
