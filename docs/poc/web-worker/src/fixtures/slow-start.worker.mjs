// SPDX-License-Identifier: MIT
// Worker that is deliberately slow to reach its first `on('message')`: it
// blocks for SLOW_START_MS at module top level before attaching the listener.
//
// Answers #2476: does a message the parent posted while the child was still
// loading survive, or is it dropped on the floor?
//
// Protocol: echoes every message back as { type: 'got', seq }, then the parent
// counts how many of the N messages it sent arrived.

const SLOW_START_MS = Number(globalThis.__slowStartMs ?? 400);

const ctx = globalThis.__gjsify_worker_context;
let parentPort;
if (ctx) {
    ({ parentPort } = ctx);
} else {
    ({ parentPort } = await import('node:worker_threads'));
}

const until = Date.now() + SLOW_START_MS;
while (Date.now() < until) {
    // Busy-wait: a sleep would yield to the loop, and the point is to be
    // unavailable, not idle.
}

parentPort.on('message', (msg) => {
    if (msg?.type === 'close') {
        parentPort.close();
        return;
    }
    parentPort.postMessage({ type: 'got', seq: msg?.seq });
});

parentPort.postMessage({ type: 'ready' });
