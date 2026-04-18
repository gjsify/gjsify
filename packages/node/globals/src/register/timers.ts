// Registers: setImmediate, clearImmediate
// Also patches setTimeout/clearTimeout to work around a GJS 1.86 + SpiderMonkey 128/140 bug:
//
// GJS _timers.js calls releaseSource(source) before drainMicrotaskQueue(). This removes
// the source from GJS's internal Map, leaving no JS reference. If SpiderMonkey GC runs
// during drainMicrotaskQueue, it finalizes the GLib.Source BoxedInstance (calling
// g_source_unref) while GLib still holds its context reference → double-unref crash:
//   GLib-CRITICAL: g_source_unref_internal: assertion 'old_ref > 0' failed
//
// Fix: call source.ref() immediately after creating the timer (extra ref), and
// source.unref() inside the callback's finally block — while GLib's own dispatch
// reference still protects the source. This closes the dangerous window without
// needing any cleanup timer (which would itself have the same bug).

// Track sources that received an extra ref, so clearTimeout can release it.
const _gjsExtraReffed = new Set<any>();

// Only patch in GJS (where globalThis.setTimeout returns a GLib.Source BoxedInstance).
// Detection: GJS setTimeout returns an object, Node.js returns a number/Timeout.
const _testSource = globalThis.setTimeout(() => {}, 0);
const _isGjsTimer = _testSource !== null && typeof _testSource === 'object';
globalThis.clearTimeout(_testSource as ReturnType<typeof setTimeout>);

if (_isGjsTimer) {
    const _orig = globalThis.setTimeout;
    const _origClear = globalThis.clearTimeout;

    (globalThis as any).setTimeout = function(
        this: unknown,
        callback: (...args: unknown[]) => unknown,
        delay = 0,
        ...args: unknown[]
    ): unknown {
        let source: any;
        source = (_orig as Function).call(this, function(this: unknown) {
            try {
                return (callback as Function).apply(this, args);
            } finally {
                // Release the extra ref taken on creation. Called inside the GLib
                // dispatch cycle while GLib's own dispatch reference (g_main_dispatch
                // takes g_source_ref before invoking the closure) keeps refcount > 0.
                if (_gjsExtraReffed.delete(source)) {
                    source.unref();
                }
            }
        }, delay);
        // Extra ref so that if SM GC runs during drainMicrotaskQueue (which fires
        // after releaseSource clears the Map), the BoxedInstance is not prematurely
        // freed while GLib's post-dispatch unref is still pending.
        source.ref();
        _gjsExtraReffed.add(source);
        return source;
    };

    (globalThis as any).clearTimeout = function(this: unknown, source: any): void {
        // Release the extra ref if the timer is cancelled before it fires.
        if (_gjsExtraReffed.delete(source)) {
            source.unref();
        }
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
