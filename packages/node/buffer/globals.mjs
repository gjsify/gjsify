/**
 * Re-exports native `node:buffer` for use in Node.js builds.
 *
 * On Node, `node:buffer` is built into the runtime — so a Node-target
 * bundle that imports `@gjsify/buffer` is routed here by the
 * resolver's `gjsify.runtimes.node === "native"` rule. This avoids dragging
 * the GJS polyfill into Node bundles entirely.
 *
 * GJS bundles do NOT consult this file; they route to `@gjsify/buffer`'s
 * own `lib/esm/index.js` (the polyfill).
 */
export * from 'node:buffer';
export { default } from 'node:buffer';
