// SPDX-License-Identifier: MIT
// Crash worker fixture for the file-based Worker spec tests (#2336).
//
// Loaded by `new Worker(new URL('./fixtures/crash-worker.mjs', import.meta.url))`
// and mirrors echo-worker.mjs's dual-runtime preamble: raw .mjs runs under both
// Node and gjs without bundling, and the worker only speaks the crash contract
// — announce `ready`, then throw inside a GLib-armspaced timer callback so the
// child must report the uncaught throw the way Node's worker does.
//
// GJS: @gjsify/worker_threads's bootstrap publishes `parentPort` /
// `workerData` / `threadId` on `globalThis.__gjsify_worker_context` before
// importing this module. Node: standard `node:worker_threads` named exports
// (never executes under GJS — the branch above already populated the
// bindings).
//
// Expected: the parent's Worker emits `error` (message: boom-in-timer) and
// then `exit` with code 1 — NOT a silent child that keeps running.

const ctx = globalThis.__gjsify_worker_context;
let parentPort;
if (ctx) {
    ({ parentPort } = ctx);
} else {
    const mod = await import('node:worker_threads');
    ({ parentPort } = mod);
}

if (!parentPort) {
    throw new Error('crash-worker.mjs: parentPort is null (not running inside a Worker?)');
}

parentPort.postMessage({ type: 'ready' });

setTimeout(() => {
    throw new Error('boom-in-timer');
}, 5);
