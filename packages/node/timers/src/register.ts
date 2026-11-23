// Installs `setImmediate` / `clearImmediate` where the host has none.
//
// NativeScript's V8 runtime ships `setTimeout` but not `setImmediate`, while Node
// code (nodemailer, Node streams, process.nextTick shims) calls the bare global.
// The callback runs from a `setTimeout(0)` task, i.e. after every pending
// microtask, like Node's check phase. A host that already has the global keeps it.

import { Immediate } from './timeout.js';

type Defer = (run: () => void) => void;

const defer: Defer = (run) => {
    setTimeout(run, 0);
};

function setImmediate<T extends unknown[]>(callback: (...args: T) => void, ...args: T): Immediate {
    if (typeof callback !== 'function') {
        const err = new TypeError(`The "callback" argument must be of type function. Received ${typeof callback}`);
        (err as { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
        throw err;
    }
    return new Immediate(callback as (...a: unknown[]) => unknown, args, defer);
}

function clearImmediate(immediate: Immediate | undefined): void {
    if (immediate != null && typeof immediate.close === 'function') immediate.close();
}

const g = globalThis as Record<string, unknown>;

if (typeof g.setImmediate !== 'function') {
    Object.defineProperty(globalThis, 'setImmediate', {
        value: setImmediate,
        enumerable: false,
        writable: true,
        configurable: true,
    });
}

if (typeof g.clearImmediate !== 'function') {
    Object.defineProperty(globalThis, 'clearImmediate', {
        value: clearImmediate,
        enumerable: false,
        writable: true,
        configurable: true,
    });
}
