// SPDX-License-Identifier: MIT
// Clone-error worker fixture for `message-errors.spec.ts`.
//
// A fixture rather than `eval: true` code because this one has to run under
// BOTH runtimes: GJS's bootstrap publishes `parentPort` as a global, real
// Node's `--eval` worker does not, so only the dual-runtime context pick
// below (same as `echo-worker.mjs`) works on each.
//
// Protocol:
//   parent → worker:  { type: 'clone-throw' }  → posts { type: 'clone-throw',
//                       threw: boolean, name } for `parentPort.postMessage` on
//                       a value that cannot be cloned
//   parent → worker:  { type: 'report' }       → posts { type: 'report',
//                       received } — every other message seen so far, in order
//   parent → worker:  anything else            → recorded for the next report

const ctx = globalThis.__gjsify_worker_context;
let parentPort;
if (ctx) {
    ({ parentPort } = ctx);
} else {
    const mod = await import('node:worker_threads');
    ({ parentPort } = mod);
}

if (!parentPort) {
    throw new Error('clone-error-worker.mjs: parentPort is null (not running inside a Worker?)');
}

const received = [];

parentPort.on('message', (msg) => {
    if (msg && msg.type === 'clone-throw') {
        try {
            parentPort.postMessage(() => {});
            parentPort.postMessage({ type: 'clone-throw', threw: false, name: null });
        } catch (err) {
            // The error object itself cannot cross — report its name.
            parentPort.postMessage({ type: 'clone-throw', threw: true, name: err && err.name });
        }
        return;
    }
    if (msg && msg.type === 'report') {
        parentPort.postMessage({ type: 'report', received });
        return;
    }
    received.push(msg);
});

parentPort.postMessage({ type: 'ready' });
