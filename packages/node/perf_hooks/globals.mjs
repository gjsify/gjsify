/**
 * Re-exports native Performance API globals for browser builds.
 *
 * On browsers, `performance` is a global instance of `Performance` exposing
 * `now()`, `mark()`, `measure()`, `clearMarks()`, `clearMeasures()`, plus
 * `PerformanceObserver`. Universal since Chrome 6 / Firefox 7 / Safari 8.
 *
 * The dynamic resolver in `@gjsify/resolve-npm/runtime-aliases.mjs` routes
 * `@gjsify/perf_hooks` here when `package.json#gjsify.runtimes.browser === "native"`.
 *
 * NOT used on Node — Node's `node:perf_hooks` exposes a much richer
 * surface (`PerformanceObserver`, `monitorEventLoopDelay`, `createHistogram`,
 * `eventLoopUtilization`, etc.) that has no browser pendant. Node target
 * keeps the polyfill (`runtimes.node === "polyfill"`).
 */

export const performance = globalThis.performance;
export const PerformanceObserver = globalThis.PerformanceObserver;
export const PerformanceEntry = globalThis.PerformanceEntry;
export const PerformanceMark = globalThis.PerformanceMark;
export const PerformanceMeasure = globalThis.PerformanceMeasure;
export const PerformanceResourceTiming = globalThis.PerformanceResourceTiming;
export default {
    performance,
    PerformanceObserver,
    PerformanceEntry,
    PerformanceMark,
    PerformanceMeasure,
    PerformanceResourceTiming,
};
