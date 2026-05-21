// SPDX-License-Identifier: MIT
// Echo worker fixture for file-based Worker spec tests.
//
// Loaded by `new Worker(new URL('./echo-worker.mjs', import.meta.url))` and
// other file-based-Worker test cases. Stays runnable as raw .mjs (no
// bundling) under both Node and GJS by picking the worker-context source at
// runtime:
//
//   - GJS: `@gjsify/worker_threads`'s bootstrap publishes `parentPort` /
//          `workerData` / `threadId` on `globalThis.__gjsify_worker_context`
//          before importing the user's worker module.
//   - Node: standard `node:worker_threads` named exports.
//
// Protocol:
//   parent → worker:  { type: 'ping',  payload }   → 'pong' echoes payload back
//   parent → worker:  { type: 'workerData' }       → posts back the workerData
//   parent → worker:  { type: 'threadId' }         → posts back the threadId
//   parent → worker:  { type: 'close' }            → exits gracefully

const ctx = globalThis.__gjsify_worker_context;
let parentPort, workerData, threadId;
if (ctx) {
    ({ parentPort, workerData, threadId } = ctx);
} else {
    // Node path — bare-specifier dynamic import resolves through the
    // built-in node: scheme. Won't execute under GJS because the GJS
    // branch above already populated the bindings.
    const mod = await import('node:worker_threads');
    ({ parentPort, workerData, threadId } = mod);
}

if (!parentPort) {
    throw new Error('echo-worker.mjs: parentPort is null (not running inside a Worker?)');
}

parentPort.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') {
        parentPort.postMessage({ type: 'error', reason: 'invalid message shape', received: msg });
        return;
    }
    switch (msg.type) {
        case 'ping':
            parentPort.postMessage({ type: 'pong', payload: msg.payload });
            return;
        case 'workerData':
            parentPort.postMessage({ type: 'workerData', value: workerData });
            return;
        case 'threadId':
            parentPort.postMessage({ type: 'threadId', value: threadId });
            return;
        case 'close':
            parentPort.postMessage({ type: 'closing' });
            parentPort.close();
            return;
        default:
            parentPort.postMessage({ type: 'error', reason: 'unknown type', received: msg });
    }
});

parentPort.postMessage({ type: 'ready' });
