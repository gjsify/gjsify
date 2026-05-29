/**
 * Cross-runtime re-export of the native `console` global for use in Node.js
 * AND browser builds.
 *
 * `globalThis.console` exists on both runtimes — direct re-export avoids
 * dragging in the GJS polyfill (`./lib/esm/index.js`) for either target.
 * GJS bundles do NOT consult this file; the GJS-target alias layer routes
 * `@gjsify/console` to the polyfill at `lib/esm/index.js`.
 *
 * IMPORTANT: this file MUST NOT reference `node:console` (or any other
 * `node:` specifier) — the audit-runtimes `--strict` probe rejects re-exports
 * from `node:*` for a slot declared cross-runtime, and `node:console`
 * fails to resolve in a browser bundle.
 */
export const console = globalThis.console;
export const Console = globalThis.console.constructor;
export default globalThis.console;
