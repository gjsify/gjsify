// Node.js perf_hooks module for GJS
// Wraps the Web Performance API available in SpiderMonkey 128
// Reference: Node.js lib/perf_hooks.js

// Entry types for the GLib-based performance shim
interface PerfEntry {
  name: string;
  entryType: 'mark' | 'measure';
  startTime: number;
  duration: number;
}

// Re-export the global Performance object, with GLib fallback for GJS
let performance: Performance;
if (globalThis.performance) {
  performance = globalThis.performance;
} else {
  // GJS may not have globalThis.performance; create a shim using GLib
  let _startTime: number;
  let _now: () => number;

  try {
    const GLib = (globalThis as any).imports.gi.GLib;
    _startTime = GLib.get_monotonic_time();
    _now = () => (GLib.get_monotonic_time() - _startTime) / 1000;
  } catch {
    const _start = Date.now();
    _startTime = 0;
    _now = () => Date.now() - _start;
  }

  const _entries: PerfEntry[] = [];
  const _timeOrigin = Date.now() - _now();

  performance = {
    timeOrigin: _timeOrigin,
    now: _now,

    mark(name: string): PerfEntry {
      const entry: PerfEntry = { name, entryType: 'mark', startTime: _now(), duration: 0 };
      _entries.push(entry);
      return entry;
    },

    measure(name: string, startMark?: string, endMark?: string): PerfEntry {
      let startTime = 0;
      let endTime = _now();

      if (startMark) {
        const s = _entries.find(e => e.entryType === 'mark' && e.name === startMark);
        if (s) startTime = s.startTime;
      }
      if (endMark) {
        const e = _entries.find(e => e.entryType === 'mark' && e.name === endMark);
        if (e) endTime = e.startTime;
      }

      const entry: PerfEntry = { name, entryType: 'measure', startTime, duration: endTime - startTime };
      _entries.push(entry);
      return entry;
    },

    getEntries() { return [..._entries]; },
    getEntriesByName(name: string) { return _entries.filter(e => e.name === name); },
    getEntriesByType(type: string) { return _entries.filter(e => e.entryType === type); },

    clearMarks(name?: string) {
      for (let i = _entries.length - 1; i >= 0; i--) {
        if (_entries[i].entryType === 'mark' && (!name || _entries[i].name === name)) {
          _entries.splice(i, 1);
        }
      }
    },

    clearMeasures(name?: string) {
      for (let i = _entries.length - 1; i >= 0; i--) {
        if (_entries[i].entryType === 'measure' && (!name || _entries[i].name === name)) {
          _entries.splice(i, 1);
        }
      }
    },

    clearResourceTimings() {},
    setResourceTimingBufferSize() {},

    toJSON() { return { timeOrigin: _timeOrigin }; },
  } as unknown as Performance;
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
