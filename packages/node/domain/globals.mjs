/**
 * Re-exports native `node:domain` for use in Node.js builds.
 *
 * On Node, `node:domain` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/domain` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/domain`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:domain';
export { default } from 'node:domain';
