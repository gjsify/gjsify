/**
 * Re-exports native `node:diagnostics_channel` for use in Node.js builds.
 *
 * On Node, `node:diagnostics_channel` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/diagnostics_channel` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/diagnostics_channel`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:diagnostics_channel';
export { default } from 'node:diagnostics_channel';
