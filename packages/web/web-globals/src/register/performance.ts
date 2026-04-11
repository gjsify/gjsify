// Registers: performance, PerformanceObserver

import { performance, PerformanceObserver } from '@gjsify/perf_hooks';

if (typeof globalThis.performance === 'undefined') {
  (globalThis as any).performance = performance;
}
if (typeof (globalThis as any).PerformanceObserver !== 'function') {
  (globalThis as any).PerformanceObserver = PerformanceObserver;
}
