/**
 * Re-exports native DOMParser global for use in browser builds.
 * On any browser, `DOMParser` is a native global.
 *
 * Node has no `DOMParser` native — `@gjsify/domparser`'s `runtimes.node`
 * is "polyfill", so the bundler routes Node-target imports to the package's
 * own polyfill at `lib/esm/index.js` and never reaches this file.
 */
export const DOMParser = globalThis.DOMParser;
