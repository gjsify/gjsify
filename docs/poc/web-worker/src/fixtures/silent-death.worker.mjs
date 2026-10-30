// SPDX-License-Identifier: MIT
// Worker that dies in a way the crash contract does NOT cover. Which way is
// chosen by workerData.mode:
//
//   'exit'          — System.exit(3) / process.exit(3) without closing the port
//   'async-reject'  — an unhandled rejection inside a native async function
//   'abort'         — SIGKILL itself (no stderr, no exit handler, no trace)
//   'hang'          — stop answering, keep the process alive forever
//
// Answers #2358: for each mode, does the parent see `error`, `exit`, or
// nothing at all? Whatever the parent does see is what a spec `Worker` would
// have to turn into an `error` event.
//
// Every mode keeps a `message` listener attached: without one, the child has
// no work left and exits 0 on its own, which would make every row look the
// same for the wrong reason.

const ctx = globalThis.__gjsify_worker_context;
let parentPort, workerData;
if (ctx) {
    ({ parentPort, workerData } = ctx);
} else {
    ({ parentPort, workerData } = await import('node:worker_threads'));
}

const mode = workerData?.mode ?? 'exit';
const isGjs = !!ctx;

// Resolved up front: a failed dynamic import inside the death path would
// itself be an unhandled rejection, and then every mode would measure that.
const System = isGjs ? (await import('system')).default : null;
const GLib = isGjs ? (await import('gi://GLib')).default : null;

let hung = false;
parentPort.on('message', (msg) => {
    if (hung) return;
    if (msg?.type === 'ping') parentPort.postMessage({ type: 'pong' });
});

parentPort.postMessage({ type: 'ready', mode });

const die = () => {
    switch (mode) {
        case 'exit':
            if (isGjs) System.exit(3);
            else process.exit(3);
            break;
        case 'async-reject':
            // GJS has no host hook for unhandled rejections in a native async
            // function, so nothing should report this — that is the point.
            void (async () => {
                throw new Error('unhandled-async-reject');
            })();
            break;
        case 'abort':
            if (isGjs) {
                // GJS exposes no getpid(); /proc/self resolves to it.
                GLib.spawn_command_line_sync(`kill -9 ${GLib.file_read_link('/proc/self')}`);
            } else {
                process.kill(process.pid, 'SIGKILL');
            }
            break;
        case 'hang':
            // Never answer again, never exit. The listener stays attached, so
            // the loop stays alive and this really is a hang, not an exit.
            hung = true;
            break;
        default:
            break;
    }
};

setTimeout(die, 10);
