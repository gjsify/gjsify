// Node.js perf_hooks module for GJS
// Wraps the Web Performance API available in SpiderMonkey 128
// Reference: Node.js lib/perf_hooks.js

// Re-export the global Performance object, with GLib fallback for GJS
let performance: Performance;
if (globalThis.performance) {
  performance = globalThis.performance;
} else {
  // GJS may not have globalThis.performance; create a minimal shim using GLib
  let _startTime: number;
  try {
    const GLib = (globalThis as any).imports.gi.GLib;
    _startTime = GLib.get_monotonic_time();
    performance = {
      timeOrigin: Date.now() - (GLib.get_monotonic_time() - _startTime) / 1000,
      now() { return (GLib.get_monotonic_time() - _startTime) / 1000; },
      mark() {},
      measure() {},
      getEntries() { return []; },
      getEntriesByName() { return []; },
      getEntriesByType() { return []; },
      clearMarks() {},
      clearMeasures() {},
      clearResourceTimings() {},
      setResourceTimingBufferSize() {},
      toJSON() { return {}; },
    } as unknown as Performance;
  } catch {
    const _start = Date.now();
    performance = { timeOrigin: _start, now: () => Date.now() - _start } as unknown as Performance;
  }
}

// Re-export Web Performance API classes if available
const PerformanceObserver = (globalThis as any).PerformanceObserver;
const PerformanceEntry = (globalThis as any).PerformanceEntry;
const PerformanceObserverEntryList = (globalThis as any).PerformanceObserverEntryList;
const PerformanceMark = (globalThis as any).PerformanceMark;
const PerformanceMeasure = (globalThis as any).PerformanceMeasure;

/** Stub: event loop utilization metrics (not available in GJS). */
function eventLoopUtilization(_utilization1?: any, _utilization2?: any): { idle: number; active: number; utilization: number } {
  return { idle: 0, active: 0, utilization: 0 };
}

/** Stub: wraps a function to measure its execution time. */
function timerify<T extends (...args: any[]) => any>(fn: T): T {
  const wrapped = function (this: any, ...args: any[]) {
    const start = performance.now();
    const result = fn.apply(this, args);
    const duration = performance.now() - start;
    // In a full implementation, this would emit a PerformanceEntry
    void duration;
    return result;
  } as unknown as T;
  Object.defineProperty(wrapped, 'name', { value: fn.name });
  return wrapped;
}

/** Stub: monitor event loop delay. */
function monitorEventLoopDelay(_options?: { resolution?: number }): {
  enable(): void;
  disable(): void;
  reset(): void;
  percentile(p: number): number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly stddev: number;
  readonly percentiles: Map<number, number>;
} {
  const percentiles = new Map<number, number>();
  return {
    enable() {},
    disable() {},
    reset() {},
    percentile(_p: number) { return 0; },
    get min() { return 0; },
    get max() { return 0; },
    get mean() { return 0; },
    get stddev() { return 0; },
    get percentiles() { return percentiles; },
  };
}

export {
  performance,
  PerformanceObserver,
  PerformanceEntry,
  PerformanceObserverEntryList,
  PerformanceMark,
  PerformanceMeasure,
  eventLoopUtilization,
  timerify,
  monitorEventLoopDelay,
};

export default {
  performance,
  PerformanceObserver,
  PerformanceEntry,
  PerformanceObserverEntryList,
  PerformanceMark,
  PerformanceMeasure,
  eventLoopUtilization,
  timerify,
  monitorEventLoopDelay,
};
