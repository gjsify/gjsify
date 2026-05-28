/**
 * Re-exports native `node:console` for use in Node.js builds.
 *
 * On Node, `node:console` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/console` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/console`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:console';
export { default } from 'node:console';
