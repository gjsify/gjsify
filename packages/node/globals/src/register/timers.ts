// Registers: setImmediate, clearImmediate
// Also patches setTimeout/setInterval/clearTimeout/clearInterval to work around a
// GJS 1.86 + SpiderMonkey 128/140 bug:
//
// GJS _timers.js wraps user callbacks in a GClosure attached to a GLib.Source
// BoxedInstance. Inside the dispatch cycle, GJS calls drainMicrotaskQueue() after
// the user callback returns. During drainMicrotaskQueue SpiderMonkey GC can run
// precisely — it may determine the source variable is unreachable (liveness analysis
// past the last use in the GJS callback) even though GLib still holds its own ref
// for the in-flight dispatch. If SM GC finalizes the BoxedInstance at that moment,
// it calls g_source_unref, putting the source into an inconsistent state. When GLib
// then performs its post-dispatch unref, the source's refcount is already 0 → SIGSEGV
// in g_source_unref_internal (via BoxedInstance::finalize → g_source_unref).
//
// Both setTimeout AND setInterval sources are affected. setInterval is NOT safe even
// though it keeps the source in GJS's own Map — clearInterval called from inside the
// callback removes the source from the Map, and the same race opens.
//
// Fix: pin the source in a JS-level Set so SM GC cannot finalize it during the
// dangerous window. Schedule cleanup via GLib.timeout_add (numeric source ID, no
// BoxedInstance — immune to the same race) so the set does not grow without bound.

// Strong JS references to timer/interval sources, pinned across the dispatch cycle
// so SM GC cannot finalize them while GLib's own ref is still in flight.
const _gjsTimerRefs = new Set<unknown>();

// Only patch in GJS (where globalThis.setTimeout returns a GLib.Source BoxedInstance).
// Detection: GJS setTimeout returns an object, Node.js returns a number/Timeout.
const _testSource = globalThis.setTimeout(() => {}, 0);
const _isGjsTimer = _testSource !== null && typeof _testSource === 'object';
globalThis.clearTimeout(_testSource as ReturnType<typeof setTimeout>);

if (_isGjsTimer) {
    const _origSetTimeout = globalThis.setTimeout;
    const _origClearTimeout = globalThis.clearTimeout;
    const _origSetInterval = (globalThis as any).setInterval;
    const _origClearInterval = (globalThis as any).clearInterval;

    // GJS-only: pull GLib from the runtime's imports object so this file stays
    // importable on Node.js (where the patch is a no-op anyway).
    const GLib = (globalThis as any).imports?.gi?.GLib;
    const PRIORITY_DEFAULT = GLib?.PRIORITY_DEFAULT ?? 0;
    const SOURCE_REMOVE = GLib?.SOURCE_REMOVE ?? false;

    /** Schedule delayed removal via GLib.timeout_add (numeric ID, GC-safe). */
    function _scheduleUnpin(source: unknown): void {
        if (!GLib) {
            _gjsTimerRefs.delete(source);
            return;
        }
        GLib.timeout_add(PRIORITY_DEFAULT, 0, () => {
            _gjsTimerRefs.delete(source);
            return SOURCE_REMOVE;
        });
    }

    (globalThis as any).setTimeout = function(
        this: unknown,
        callback: (...args: unknown[]) => unknown,
        delay = 0,
        ...args: unknown[]
    ): unknown {
        let source: unknown;
        source = (_origSetTimeout as Function).call(this, function(this: unknown) {
            _gjsTimerRefs.add(source);
            try {
                return (callback as Function).apply(this, args);
            } finally {
                _scheduleUnpin(source);
            }
        }, delay);
        // Pin from creation too so clearTimeout-before-fire is also safe.
        _gjsTimerRefs.add(source);
        return source;
    };

    (globalThis as any).clearTimeout = function(this: unknown, source: unknown): void {
        (_origClearTimeout as Function).call(this, source);
        // Unpin after the current dispatch cycle completes — safe delayed cleanup.
        _scheduleUnpin(source);
    };

    if (_origSetInterval) {
        (globalThis as any).setInterval = function(
            this: unknown,
            callback: (...args: unknown[]) => unknown,
            delay = 0,
            ...args: unknown[]
        ): unknown {
            let source: unknown;
            source = (_origSetInterval as Function).call(this, function(this: unknown) {
                // Re-pin on every dispatch — Set.add is a no-op if already present.
                // Cheaper than a removal on the trailing edge because setInterval
                // fires repeatedly; we only remove on clearInterval.
                _gjsTimerRefs.add(source);
                return (callback as Function).apply(this, args);
            }, delay);
            _gjsTimerRefs.add(source);
            return source;
        };
    }

    if (_origClearInterval) {
        (globalThis as any).clearInterval = function(this: unknown, source: unknown): void {
            (_origClearInterval as Function).call(this, source);
            _scheduleUnpin(source);
        };
    }
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
