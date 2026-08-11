// `process.nextTick` semantics on GJS, with cross-runtime fallbacks.

declare const queueMicrotask: ((cb: () => void) => void) | undefined;

// Burst-yield scheduler. GTK input events (move, click, scroll) are dispatched from
// GLib's main context at PRIORITY_DEFAULT (0), so when every nextTick was its own
// immediately-ready `timeout_add(PRIORITY_DEFAULT, 0)` source, a tight loop of
// hundreds (webtorrent DHT bootstrap, streamx pipe bursts) made GLib dispatch the
// whole batch before collecting input again — a frozen window.
//
// So: one module-owned FIFO queue, one drainer that takes CHUNK_SIZE callbacks per
// iteration and, if more remain, re-arms with delay=1 ms to force a main-loop
// iteration in between; when the queue empties the drainer goes idle. Cost is at
// most 1 ms of latency per CHUNK_SIZE callbacks, and short bursts pay nothing.
// `timeout_add` rather than `idle_add` keeps this to one numeric source ID for the
// whole burst — no per-call BoxedInstance to lose to the GC race.
const CHUNK_SIZE = 64;
const YIELD_DELAY_MS = 1;
const _queue: Array<() => void> = [];
let _drainerArmed = false;

function drainOnce(GLib: GLibShape): void {
    // Per-callback catch, because Node's `process.nextTick` guarantees later ticks
    // still run when an earlier one throws (it delivers the throw asynchronously via
    // 'uncaughtException'), and this keeps that contract.
    const end = Math.min(CHUNK_SIZE, _queue.length);
    for (let i = 0; i < end; i++) {
        const cb = _queue.shift()!;
        try {
            cb();
        } catch (err) {
            // GJS has no 'uncaughtException', so the throw is logged on stderr via
            // GLib rather than swallowed.
            try {
                GLib.log_default_handler(
                    'gjsify-nextTick',
                    GLib.LogLevelFlags.LEVEL_WARNING,
                    String((err as { stack?: string })?.stack || err),
                    null,
                );
            } catch {
                /* best-effort */
            }
        }
    }
    if (_queue.length > 0) {
        // Re-arm with a 1 ms yield so GTK events dispatch in between.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, YIELD_DELAY_MS, () => {
            drainOnce(GLib);
            return false;
        });
    } else {
        _drainerArmed = false;
    }
}

// On GJS, nextTick goes through the GLib main loop instead of the JS microtask
// queue, so I/O events interleave between stream/pipe steps.
//
// PRIORITY_DEFAULT (0) is required: while promise jobs are pending, GJS's internal
// microtask-drain source at priority 0 starves every source at a numerically higher
// priority — measured on 1.88.1, a PRIORITY_HIGH_IDLE (100) source does not
// dispatch at all under a continuous promise chain. PRIORITY_DEFAULT puts nextTick
// callbacks in the same dispatch band as I/O events.
type GLibShape = {
    timeout_add: (priority: number, delay: number, cb: () => boolean) => number;
    PRIORITY_DEFAULT: number;
    LogLevelFlags: { LEVEL_WARNING: number };
    log_default_handler: (domain: string, flags: number, msg: string, data: null) => void;
};

function tryGLibTimeout(cb: () => void): boolean {
    const GLib = (globalThis as Record<string, unknown> & { imports?: { gi?: { GLib?: GLibShape } } }).imports?.gi
        ?.GLib;
    if (!GLib?.timeout_add) return false;
    _queue.push(cb);
    if (!_drainerArmed) {
        _drainerArmed = true;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
            drainOnce(GLib);
            return false;
        });
    }
    return true;
}

/** @internal Test helper: reset burst state. */
export function __resetBurstStateForTests(): void {
    _queue.length = 0;
    _drainerArmed = false;
}

/**
 * Schedule a function on the next turn of the event loop: the burst-yield drainer on
 * GJS, otherwise `process.nextTick` → `queueMicrotask` → `Promise.resolve().then()`.
 */
export const nextTick = (fn: (...args: unknown[]) => void, ...args: unknown[]): void => {
    const cb = args.length > 0 ? () => fn(...args) : (fn as () => void);
    if (tryGLibTimeout(cb)) return;
    if (typeof globalThis.process?.nextTick === 'function') {
        globalThis.process.nextTick(fn, ...args);
        return;
    }
    if (typeof queueMicrotask === 'function') {
        queueMicrotask(cb);
        return;
    }
    Promise.resolve().then(cb);
};
