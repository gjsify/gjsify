// Registers: performance, PerformanceObserver

import { performance, PerformanceObserver } from '@gjsify/perf_hooks';

/** Module-local typed view of the globals this file writes. */
interface _PerfGlobals {
  performance?: typeof performance;
  PerformanceObserver?: typeof PerformanceObserver;
}

const g = globalThis as unknown as _PerfGlobals;

if (typeof globalThis.performance === 'undefined') {
  g.performance = performance;
}
if (typeof g.PerformanceObserver !== 'function') {
  g.PerformanceObserver = PerformanceObserver;
}
