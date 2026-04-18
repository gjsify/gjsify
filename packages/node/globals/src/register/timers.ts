// Registers: setImmediate, clearImmediate
// Also fully replaces setTimeout / setInterval / clearTimeout / clearInterval on GJS
// to work around a compound bug in GJS 1.86 + SpiderMonkey 128/140:
//
// GJS's native setTimeout returns a GLib.Source BoxedInstance. Two problems flow from
// that:
//
//   1. SpiderMonkey GC can finalize the BoxedInstance at points where GLib still
//      holds an in-flight reference, causing a double-unref / use-after-free →
//      SIGSEGV in g_source_unref_internal.
//   2. Node-compat code (WebTorrent, bittorrent-dht, async-limiter, …) calls
//      `timer.unref()` expecting Node.js semantics ("don't keep the event loop
//      alive"). On a GJS BoxedInstance `unref()` is `g_source_unref` — it
//      decrements the GLib refcount and can free the source outright. Later
//      `clearInterval` then tries to remove a freed source → corruption.
//
// Pinning the BoxedInstance in a JS Set (previous approach) partially mitigates
// (1) but does not fix (2) at all: the refcount is decremented at the C level
// regardless of JS references.
//
// Fix: don't use GJS's native setTimeout at all. Back the timers with
// GLib.timeout_add / GLib.Source.remove (numeric source IDs — no BoxedInstance,
// no GC race, no external-unref hazard). Return a Node-shaped Timeout object
// whose `.ref()` / `.unref()` / `.hasRef()` / `.refresh()` methods match Node.js
// semantics (no-ops for keepAlive — GJS apps already explicitly run a main loop).
//
// References:
//   - refs/node/lib/internal/timers.js (Timeout class shape)
//   - refs/gjs/modules/esm/_timers.js (the buggy native implementation)
//
// Downside: `drainMicrotaskQueue()` is not called after each tick (GJS internals
// aren't reachable from user JS in a stable way). In practice this is fine —
// SpiderMonkey's promise job queue drains automatically at JS boundaries.

// GJS detection: native setTimeout returns a GLib.Source BoxedInstance (typeof
// === 'object'). On Node.js it returns a number/Timeout — in that case we keep
// the native implementation untouched.
const _nativeTest = globalThis.setTimeout(() => {}, 0);
const _isGjsTimer = _nativeTest !== null && typeof _nativeTest === 'object';
globalThis.clearTimeout(_nativeTest as ReturnType<typeof setTimeout>);

/**
 * Node-compatible Timeout object returned by our setTimeout / setInterval.
 *
 * Mirrors the public surface of `NodeJS.Timeout`: `.ref()`, `.unref()`,
 * `.hasRef()`, `.refresh()`, `[Symbol.toPrimitive]()` so `+timeout` yields the
 * numeric ID (matches Node.js's behavior for backward-compat code paths).
 *
 * Critically `.unref()` is a no-op (instead of `g_source_unref` as on the raw
 * BoxedInstance). That prevents Node-style libraries from accidentally freeing
 * our GLib sources — the primary crash vector on this codebase.
 */
class GjsifyTimeout {
    _id: number | null = null;
    _args: unknown[];
    _callback: (...args: unknown[]) => unknown;
    _delay: number;
    _repeat: boolean;
    _refed = true;

    constructor(callback: (...args: unknown[]) => unknown, delay: number, args: unknown[], repeat: boolean) {
        this._callback = callback;
        this._delay = delay;
        this._args = args;
        this._repeat = repeat;
        this._schedule();
    }

    private _schedule(): void {
        const GLib = (globalThis as any).imports?.gi?.GLib;
        if (!GLib) return;
        // g_timeout_add_full returns a numeric source ID (guint). No BoxedInstance
        // to be GC'd, no refcount for user code to decrement. The callback is wrapped
        // in a GClosure managed by GLib; when the source is destroyed (return
        // G_SOURCE_REMOVE or explicit remove), the GClosure is finalized cleanly.
        this._id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._delay, () => {
            try {
                this._callback.apply(globalThis, this._args);
            } catch (err) {
                // Surface uncaught exceptions the same way Node.js setTimeout does.
                setTimeout(() => { throw err; }, 0);
            }
            if (this._repeat) return GLib.SOURCE_CONTINUE;
            this._id = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Node-compat no-op. GJS apps explicitly manage their main loop. */
    ref(): this { this._refed = true; return this; }
    /** Node-compat no-op (see ref). Crucially NOT `g_source_unref`. */
    unref(): this { this._refed = false; return this; }
    hasRef(): boolean { return this._refed; }

    /** Reset the timer to fire again after `delay` ms from now. */
    refresh(): this {
        this._cancel();
        this._schedule();
        return this;
    }

    /** @internal Remove the underlying GLib source. */
    _cancel(): void {
        if (this._id !== null) {
            const GLib = (globalThis as any).imports?.gi?.GLib;
            try { GLib?.Source.remove(this._id); } catch { /* already removed */ }
            this._id = null;
        }
    }

    /** Numeric coercion yields the source ID (matches Node.js legacy behavior). */
    [Symbol.toPrimitive](_hint?: string): number | null { return this._id; }

    /** Support `using` declarations (Explicit Resource Management) in Node 20+. */
    [Symbol.dispose]?(): void { this._cancel(); }
}

if (_isGjsTimer) {
    // Neutralize GLib.Source.prototype.unref to block Node-compat code that
    // expects `.unref()` to mean "don't keep the event loop alive" — on a GJS
    // BoxedInstance the native unref() is g_source_unref, which frees the GLib
    // source outright and leads to use-after-free at SM GC time. Leaking the
    // extra refcount is cheap; a freed source → SIGSEGV is not.
    //
    // Even though our own setTimeout/setInterval now returns a Node-shaped
    // Timeout (not a BoxedInstance), any OTHER code paths that hand out GLib
    // source BoxedInstances (GStreamer plugins, GIO async helpers, Cancellable
    // sources, third-party gi bindings) get the same protection for free.
    try {
        const GLib = (globalThis as any).imports?.gi?.GLib;
        if (GLib?.Source?.prototype) {
            const proto = GLib.Source.prototype;
            const origRef = proto.ref;
            const origUnref = proto.unref;
            // No-op ref/unref from JS. GLib's C code still refs/unrefs via its
            // own paths (g_source_attach, g_source_destroy_internal, etc.) which
            // don't go through this JS wrapper.
            proto.ref = function() { return this; };
            proto.unref = function() { /* no-op */ };
            // Keep originals accessible in case we ever need them.
            (proto as any)._gjsify_origRef = origRef;
            (proto as any)._gjsify_origUnref = origUnref;
        }
    } catch (_e) { /* GJS not available; patch is a no-op */ }

    (globalThis as any).setTimeout = function(
        this: unknown,
        callback: (...args: unknown[]) => unknown,
        delay: number | undefined = 0,
        ...args: unknown[]
    ): GjsifyTimeout {
        return new GjsifyTimeout(callback, Math.max(0, delay | 0), args, false);
    };

    (globalThis as any).clearTimeout = function(this: unknown, timeout: unknown): void {
        if (timeout instanceof GjsifyTimeout) {
            timeout._cancel();
            return;
        }
        // Robustness: also accept a bare numeric ID (legacy GJS native returns).
        if (typeof timeout === 'number') {
            try { (globalThis as any).imports?.gi?.GLib?.Source.remove(timeout); } catch { /* ignore */ }
        }
    };

    (globalThis as any).setInterval = function(
        this: unknown,
        callback: (...args: unknown[]) => unknown,
        delay: number | undefined = 0,
        ...args: unknown[]
    ): GjsifyTimeout {
        return new GjsifyTimeout(callback, Math.max(0, delay | 0), args, true);
    };

    (globalThis as any).clearInterval = function(this: unknown, timeout: unknown): void {
        if (timeout instanceof GjsifyTimeout) {
            timeout._cancel();
            return;
        }
        if (typeof timeout === 'number') {
            try { (globalThis as any).imports?.gi?.GLib?.Source.remove(timeout); } catch { /* ignore */ }
        }
    };
}

function setImmediate<T extends any[]>(callback: (...args: T) => void, ...args: T): ReturnType<typeof setTimeout> {
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
