// SPDX-License-Identifier: MIT
// Comlink.expose() inside a worker, on both runtimes.
//
// The adapter is the whole point of the exercise: Comlink wants a DOM-shaped
// endpoint (addEventListener / removeEventListener / postMessage), and both
// runtimes hand us an EventEmitter-shaped port (on / off / postMessage).
// `endpointFor` is the ~15 lines that bridge it — the same shape
// @gjsify/web-worker would ship as its inside-the-worker global.

const ctx = globalThis.__gjsify_worker_context;
let parentPort;
if (ctx) {
    ({ parentPort } = ctx);
} else {
    ({ parentPort } = await import('node:worker_threads'));
}

// A relative specifier, not `new URL(..., import.meta.url)`: the bootstrap
// child is a bare `gjs`, and bare gjs has no `URL` global. That asymmetry
// between the parent's global surface and the child's is itself a finding.
const Comlink = ctx ? await import('../vendor/comlink.mjs') : await import(process.env.COMLINK_ESM);

/** EventEmitter-shaped port → DOM-shaped Comlink endpoint. */
const endpointFor = (port) => {
    const wrappers = new WeakMap();
    return {
        postMessage: (msg, transfer) => port.postMessage(msg, transfer),
        addEventListener: (_type, listener) => {
            const fn = (data) => {
                const handler = typeof listener === 'function' ? listener : listener.handleEvent;
                handler.call(listener, { data });
            };
            wrappers.set(listener, fn);
            port.on('message', fn);
        },
        removeEventListener: (_type, listener) => {
            const fn = wrappers.get(listener);
            if (fn) port.off('message', fn);
        },
        start: () => port.start?.(),
    };
};

const api = {
    answer: 42,
    add: (a, b) => a + b,
    slowAdd: async (a, b) => {
        await new Promise((r) => setTimeout(r, 10));
        return a + b;
    },
    throws: () => {
        throw new TypeError('from-the-worker');
    },
    // Takes a Comlink.proxy()'d callback: needs a MessagePort to travel
    // parent → worker and then be called back over.
    withCallback: async (cb) => {
        const got = await cb(7);
        return `callback returned ${got}`;
    },
    // Returns a structured-clone-hard value.
    structured: () => ({
        when: new Date(0),
        set: new Set([1, 2]),
        map: new Map([['k', 1]]),
        big: 1n,
        bytes: new Uint8Array([1, 2, 3]),
    }),
    // Row shape kept identical to echo.worker.mjs's, so the Comlink number
    // and the raw-postMessage number in 02 are the same measurement.
    rows: (n) =>
        Array.from({ length: n }, (_, i) => ({
            id: i,
            name: `item-${i}`,
            qty: i % 97,
            price: (i % 1000) / 100,
            active: i % 3 === 0,
            note: 'lorem ipsum dolor sit amet consectetur',
        })),
};

Comlink.expose(api, endpointFor(parentPort));

parentPort.postMessage({ type: 'ready' });
