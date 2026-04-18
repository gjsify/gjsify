// Registers: setImmediate, clearImmediate
// Also patches setTimeout/clearTimeout to work around a GJS 1.86 + SpiderMonkey 128/140 bug:
//
// GJS _timers.js calls releaseSource(source) before drainMicrotaskQueue(). This removes
// the source from GJS's internal Map, leaving no JS reference. If SpiderMonkey GC runs
// during drainMicrotaskQueue, it finalizes the GLib.Source BoxedInstance (calling
// g_source_unref) while GLib still holds its context/dispatch reference → double-unref
// crash:
//   GLib-CRITICAL: g_source_unref_internal: assertion 'old_ref > 0' failed
//
// Fix: when the callback fires, hold the source in a JS-level Set so SM GC cannot
// finalize the BoxedInstance during drainMicrotaskQueue. After GLib completes its own
// post-dispatch unref, schedule cleanup via GLib.idle_add — which returns a numeric
// source ID (no BoxedInstance) and therefore does not suffer from the same GC race.
// Using setTimeout for the cleanup (previous approach) recreated the same bug on the
// cleanup timer itself.

// Keep strong JS references to expired GLib.Source BoxedInstances until after GLib
// has completed its post-dispatch unref, to prevent premature SM GC finalization.
const _gjsTimeoutRefs = new Set<unknown>();

// Only patch in GJS (where globalThis.setTimeout returns a GLib.Source BoxedInstance).
// Detection: GJS setTimeout returns an object, Node.js returns a number/Timeout.
const _testSource = globalThis.setTimeout(() => {}, 0);
const _isGjsTimer = _testSource !== null && typeof _testSource === 'object';
globalThis.clearTimeout(_testSource as ReturnType<typeof setTimeout>);

if (_isGjsTimer) {
    const _orig = globalThis.setTimeout;
    const _origClear = globalThis.clearTimeout;

    // GJS-only: pull GLib from the runtime's imports object so this file stays
    // importable on Node.js (where the patch is a no-op anyway).
    const GLib = (globalThis as any).imports?.gi?.GLib;
    const PRIORITY_DEFAULT_IDLE = GLib?.PRIORITY_DEFAULT_IDLE ?? 200;
    const SOURCE_REMOVE = GLib?.SOURCE_REMOVE ?? false;

    (globalThis as any).setTimeout = function(
        this: unknown,
        callback: (...args: unknown[]) => unknown,
        delay = 0,
        ...args: unknown[]
    ): unknown {
        let source: unknown;
        source = (_orig as Function).call(this, function(this: unknown) {
            // Pin the source through the entire GLib dispatch cycle (callback +
            // releaseSource + drainMicrotaskQueue + GLib's post-dispatch unref).
            _gjsTimeoutRefs.add(source);
            try {
                return (callback as Function).apply(this, args);
            } finally {
                // Schedule removal via GLib.idle_add so the source leaves the Set
                // only after the current dispatch cycle has fully completed. Using
                // GLib.idle_add (numeric source ID, no BoxedInstance) avoids the
                // same GC race that would affect a cleanup setTimeout.
                if (GLib) {
                    GLib.idle_add(PRIORITY_DEFAULT_IDLE, () => {
                        _gjsTimeoutRefs.delete(source);
                        return SOURCE_REMOVE;
                    });
                } else {
                    // Fallback (shouldn't happen in GJS): remove immediately.
                    _gjsTimeoutRefs.delete(source);
                }
            }
        }, delay);
        return source;
    };

    (globalThis as any).clearTimeout = function(this: unknown, source: unknown): void {
        _gjsTimeoutRefs.delete(source);
        (_origClear as Function).call(this, source);
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
