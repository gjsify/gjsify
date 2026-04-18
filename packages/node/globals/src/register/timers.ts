// Registers setImmediate / clearImmediate and — on GJS only — fully replaces
// setTimeout / setInterval / clearTimeout / clearInterval.
//
// Why replace the native timers: GJS's `globalThis.setTimeout` returns a
// GLib.Source BoxedInstance, which is incompatible with Node.js in two ways:
//
//   1. SM GC can finalize the BoxedInstance while GLib still holds an in-flight
//      dispatch ref → double-unref SIGSEGV in g_source_unref_internal.
//   2. Node-compat libraries call `timer.unref()` to mean "don't keep the event
//      loop alive". On the BoxedInstance `.unref()` is g_source_unref — it
//      decrements the GLib refcount and can free the source outright.
//
// Fix: back the timers with GLib.timeout_add (numeric source IDs — no
// BoxedInstance, no GC race, no external-unref hazard) and return a Node-shaped
// Timeout wrapper whose `.ref()` / `.unref()` / `.hasRef()` / `.refresh()` are
// no-ops on keep-alive (GJS apps run their main loop explicitly).

import type GLibNS from '@girs/glib-2.0';

type GjsGlobalThis = typeof globalThis & {
    imports?: { gi?: { GLib?: typeof GLibNS } };
};

function getGLib(): typeof GLibNS | undefined {
    return (globalThis as GjsGlobalThis).imports?.gi?.GLib;
}

// On Node.js setTimeout returns a number/Timeout; on GJS an object. If we're
// on Node.js, leave the native implementation alone.
const _probe = globalThis.setTimeout(() => {}, 0);
const _isGjsTimer = _probe !== null && typeof _probe === 'object';
globalThis.clearTimeout(_probe as ReturnType<typeof setTimeout>);

type TimerCallback = (...args: unknown[]) => unknown;

/**
 * Node-compatible Timeout returned by our setTimeout / setInterval. Mirrors
 * `NodeJS.Timeout`: `.ref() / .unref() / .hasRef() / .refresh()`, and
 * `Symbol.toPrimitive` so `+timeout` yields the numeric GLib source ID (a few
 * Node-ecosystem libraries key Maps on this coercion).
 */
class GjsifyTimeout {
    _id: number | null = null;
    _refed = true;
    readonly _callback: TimerCallback;
    readonly _delay: number;
    readonly _args: readonly unknown[];
    readonly _repeat: boolean;

    constructor(callback: TimerCallback, delay: number, args: readonly unknown[], repeat: boolean) {
        this._callback = callback;
        this._delay = delay;
        this._args = args;
        this._repeat = repeat;
        this._schedule();
    }

    _schedule(): void {
        const GLib = getGLib();
        if (!GLib) return;
        this._id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._delay, () => {
            try {
                this._callback.apply(globalThis, this._args as unknown[]);
            } catch (err) {
                // Surface uncaught timer exceptions without killing the main loop,
                // matching Node.js's `setTimeout(() => { throw… }, 0)` behavior.
                setTimeout(() => { throw err; }, 0);
            }
            if (this._repeat) return GLib.SOURCE_CONTINUE;
            this._id = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    ref(): this { this._refed = true; return this; }
    unref(): this { this._refed = false; return this; }
    hasRef(): boolean { return this._refed; }

    refresh(): this {
        this._cancel();
        this._schedule();
        return this;
    }

    _cancel(): void {
        if (this._id === null) return;
        try { getGLib()?.Source.remove(this._id); } catch { /* already removed */ }
        this._id = null;
    }

    [Symbol.toPrimitive](): number | null { return this._id; }
    [Symbol.dispose]?(): void { this._cancel(); }
}

function removeById(timeout: unknown): void {
    if (timeout instanceof GjsifyTimeout) {
        timeout._cancel();
    } else if (typeof timeout === 'number') {
        // Legacy: GJS's native setTimeout returned a source whose numeric ID was
        // recoverable via `+timer`. Accept bare numbers for callers still holding
        // a pre-patch reference.
        try { getGLib()?.Source.remove(timeout); } catch { /* ignore */ }
    }
}

if (_isGjsTimer) {
    // Node's setTimeout/setInterval overloads don't admit our return type; assign
    // via a permissive cast rather than fight the TimerHandler / Timeout intersection.
    type TimerFn = (cb: TimerCallback, delay?: number, ...args: unknown[]) => GjsifyTimeout;
    const setT: TimerFn = (cb, delay = 0, ...args) => new GjsifyTimeout(cb, Math.max(0, delay | 0), args, false);
    const setI: TimerFn = (cb, delay = 0, ...args) => new GjsifyTimeout(cb, Math.max(0, delay | 0), args, true);
    const g = globalThis as unknown as Record<string, unknown>;
    g.setTimeout = setT;
    g.clearTimeout = removeById;
    g.setInterval = setI;
    g.clearInterval = removeById;
}

function setImmediate<T extends unknown[]>(callback: (...args: T) => void, ...args: T): ReturnType<typeof setTimeout> {
  return setTimeout(callback, 0, ...args);
}

function clearImmediate(id: ReturnType<typeof setTimeout>): void {
  clearTimeout(id);
}

if (!('setImmediate' in globalThis)) {
  Object.defineProperty(globalThis, 'setImmediate', {
    value: setImmediate,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

if (!('clearImmediate' in globalThis)) {
  Object.defineProperty(globalThis, 'clearImmediate', {
    value: clearImmediate,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
